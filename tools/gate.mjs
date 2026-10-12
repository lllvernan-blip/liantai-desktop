/*
 * 发布闸门：发版前必须为真的三件事，落到脚本里。
 *
 *   node tools/gate.mjs                单独跑（退出码 0 = 全绿）
 *   npm run release [-- --skip-gates]  发布链在开头自动跑它
 *
 * 为什么要有它：这三条原来只写在 AGENTS.md 的人肉清单里——① 工作区干净 ② 远端 sha = 本地 HEAD
 * ③ 源码不含明文 Key。规则写在文档里、没有任何东西执行它，就等于没有：`release.mjs` 当时对脏工作区
 * 只打印一句「注意：有未提交的改动」然后照发，②③两条连打印都没有。
 *
 * 三条各治一种翻车：
 *   ① 工作区不干净 → 打出来的包对应不上任何一个提交，用户报的 bug 复现不出来
 *   ② HEAD 没推上去 → `gh release create --target` 指着一条远端不存在的提交，别人拉不到
 *   ③ 明文 Key 进源码 → 一旦推上去就是公开的，撤不回来（2026-10-03 清过 13 处，那次全靠人眼）
 *
 * 第四条（`npm run release:check` 八件对账）不在这里：它验的是「发出去的东西齐不齐」，
 * 只能在发完之后跑，所以由 release-check.mjs 自己承担。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/* 各家 Key 的形态：`sk-` 后面不是固定十六进制（`sk-proj-…`、`sk-ant-api03-…` 都不含十六进制段）。
   2026-10-12 实测：原来那条只认十六进制尾巴的规则，上面两种真 Key 形态**全部漏过**。
   同一条扫描里带上 GitHub 令牌：这仓库有两处拿令牌推送的脚本，令牌被写进文件同样撤不回来。 */
const KEY_RULES = [
  { name: "服务商 API Key", re: /sk-[A-Za-z0-9_-]{16,}/ },
  /* 规则本身也得能喂给 git grep：那里用的是 POSIX ERE，不支持 (?:…) 非捕获组（2026-10-12 撞过：
     「repetition-operator operand invalid」）。所以两边只用 ERE 认识的写法：字符类、{m,n}、普通分组。 */
  { name: "GitHub 令牌", re: /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  /* 签名私钥（发布用的那把在 ~/.liantai-release-key，不进仓库）：PEM 头是最明显的体征，
     它一旦被提交，拿到仓库的人就能签出「验得过」的假包，比 API Key 还难收场。 */
  { name: "PEM 私钥", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
/* 演示/测试用的假 Key 要显式标记才放行：把「靠人眼认出这是假的」改成「写下来它是假的」。
   标记只放行它所在的那一行，写它的人得自己看那一行里有没有真东西。 */
const ALLOW_MARK = "gate-allow";

function git(args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/* gh 只装在自备位置的可能（这台 mac 上没有 Homebrew）：先看 PATH，再退到 ~/.local/opt/gh/bin/gh。 */
export function resolveGh() {
  const onPath = spawnSync("gh", ["--version"], { encoding: "utf8" });
  if (!onPath.error && onPath.status === 0) return "gh";
  const local = join(homedir(), ".local", "opt", "gh", "bin", "gh");
  if (existsSync(local)) {
    const probe = spawnSync(local, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return local;
  }
  return "";
}

/* 仓库位置只有一处真源（app-meta.js）；package.json 的 build.publish 是给 electron-builder 的同一份信息，
   两边对不上由 tests/shell.mjs 报错 */
export function repoSlug() {
  return createRequire(import.meta.url)(join(root, "app-meta.js")).slug;
}

function gateCleanTree() {
  const r = git(["status", "--porcelain"]);
  if (r.status !== 0) return { ok: false, why: ["读不到 git 状态：" + (r.stderr || "").trim()] };
  const lines = (r.stdout || "").split("\n").map((s) => s.trimEnd()).filter(Boolean);
  if (!lines.length) return { ok: true, note: "工作区干净" };
  return {
    ok: false,
    why: [
      "工作区有 " + lines.length + " 处未提交的改动——先提交再发版，包才对得上一个提交：",
      ...lines.slice(0, 10).map((l) => "      " + l),
      ...(lines.length > 10 ? ["      …还有 " + (lines.length - 10) + " 处"] : []),
    ],
  };
}

function gateRemoteHead() {
  const head = git(["rev-parse", "HEAD"]);
  if (head.status !== 0) return { ok: false, why: ["读不到本地 HEAD"] };
  const local = head.stdout.trim();
  const gh = resolveGh();
  if (!gh) return { ok: false, why: ["找不到 gh（PATH 里没有，~/.local/opt/gh/bin/gh 也没有），没法核对远端 HEAD"] };
  const r = spawnSync(gh, ["api", "repos/" + repoSlug() + "/commits/main", "--jq", ".sha"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) {
    const err = (r.stderr || "").trim().split("\n").filter(Boolean)[0] || "";
    return { ok: false, why: ["取远端 main 的 sha 失败（网络或 gh 登录态）：" + err] };
  }
  const remote = (r.stdout || "").trim();
  if (remote && remote === local) return { ok: true, note: "远端 main = 本地 HEAD（" + local.slice(0, 8) + "）" };
  return {
    ok: false,
    why: [
      "远端 main（" + (remote ? remote.slice(0, 8) : "读不到") + "）与本地 HEAD（" + local.slice(0, 8) + "）不是同一条。",
      "      → 把本地这条推上去（或先拉远端）再发；tag 必须指着一条远端真实存在的提交。",
    ],
  };
}

function gateNoSecrets() {
  const hits = [];
  for (const rule of KEY_RULES) {
    const r = git(["grep", "-n", "-I", "-E", "-e", rule.re.source, "--", "."]);
    if (r.status > 1) return { ok: false, why: ["git grep 出错：" + (r.stderr || "").trim()] };
    for (const line of (r.stdout || "").split("\n").filter(Boolean)) {
      if (line.indexOf(ALLOW_MARK) >= 0) continue;
      const m = rule.re.exec(line);
      /* 报告里把命中串自己打码（首 6 位 + 尾 4 位）：闸门不过时那串东西还在屏幕上和日志里，
         不打码等于又贴了一遍。 */
      const raw = line.trim();
      const shown = m ? raw.replace(m[0], m[0].slice(0, 6) + "…" + m[0].slice(-4)) : raw;
      hits.push(rule.name + " · " + shown);
    }
  }
  if (!hits.length) return { ok: true, note: "跟踪文件里没有明文密钥（" + KEY_RULES.length + " 条规则）" };
  return {
    ok: false,
    why: [
      "跟踪文件里扫出 " + hits.length + " 处像密钥的串：",
      ...hits.slice(0, 10).map((h) => "      " + h),
      "      → 真凭据：立刻撤掉重发一份，并从提交里清掉；确属演示用的假 Key：在那一行加 " + ALLOW_MARK + " 标记。",
    ],
  };
}

const GATES = [
  ["工作区干净", gateCleanTree],
  ["远端 main = 本地 HEAD", gateRemoteHead],
  ["源码无明文密钥", gateNoSecrets],
];

/* 返回值：true = 全绿可以发；false = 有红线，调用方停手 */
export function runReleaseGates(opts) {
  const skipGates = !!(opts && opts.skip);
  console.log("\n=== 发布闸门（三条，规则见 AGENTS.md「发布」一节）===");
  if (skipGates) {
    console.log("  --skip-gates：三条都跳过（只在明知自己为什么这么干的时候用）");
    return true;
  }
  let allOk = true;
  for (const [title, fn] of GATES) {
    let r;
    try { r = fn(); }
    catch (e) { r = { ok: false, why: ["闸门自己抛了异常：" + (e && e.message ? e.message : e)] }; }
    if (r.ok) {
      console.log("  ✔ " + title + (r.note ? "   " + r.note : ""));
    } else {
      allOk = false;
      console.log("  ✘ " + title);
      for (const w of r.why || []) console.error("      " + w.trim());
    }
  }
  if (!allOk) console.error("\n  闸门没过，未开始发布。三条都是「发出去就撤不回来」的那一类。");
  return allOk;
}

/* 单独跑：node tools/gate.mjs */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const ok = runReleaseGates({ skip: process.argv.includes("--skip-gates") });
  console.log("");
  process.exit(ok ? 0 : 1);
}
