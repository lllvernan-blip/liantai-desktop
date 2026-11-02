/*
 * 发布闸门：发版前必须为真的五件事，落到脚本里。
 *
 *   node tools/gate.mjs                单独跑（退出码 0 = 全绿）
 *   node tools/gate.mjs --fast         跳过联网那条（离线核对本地状态用）
 *   npm run release [-- --skip-gates]  发布链在开头自动跑它
 *
 * 为什么要有它：这几条原来只写在 AGENTS.md 的人肉清单里。规则写在文档里、没有任何东西执行它，
 * 就等于没有：`release.mjs` 当时对脏工作区只打印一句「注意：有未提交的改动」然后照发。
 *
 * 顺序按「便宜的先、最常错的先」排，不按重要程度排：
 *   ① lock 与 package.json 不同版（读两个 JSON，1ms；最常犯）
 *   ② 版本号已经发过（读本地 tag，几 ms；忘了升版本就会把上一个 Release 盖掉）
 *   ③ 工作区不干净（git status，几十 ms）
 *   ④ 明文 Key 进源码（git grep 全仓，几百 ms）
 *   ⑤ HEAD 没推上去（git ls-remote，要联网；最贵，放最后）
 * 贵的那条放最后，是为了让前三条能拦下的错不用先等一次网络。
 * 而且**一旦有一条●不过就停**：他接下来要做的是去修那一条，后面几条跑出来的结论暂时没有用。
 * 只报一条、修一条、重跑，每次 1 秒，比一口气读四段更省注意力。
 *
 * 每条各治一种翻车：
 *   ① 版本号分家 → 包出来的版本与 tag 对不上
 *   ② 忘了升版本 → 同一个 Release 被覆盖，已装老版本的用户收不到更新
 *   ③ 包对不上任何提交 → 用户报的 bug 复现不出来
 *   ④ 凭据进源码 → 推上去就是公开的，撤不回来（2026-10-03 清过 13 处，那次全靠人眼）
 *   ⑤ tag 指着远端不存在的提交 → 别人拉不到
 *
 * 发完之后的第八件（`npm run release:check` 逐个资产对账）不在这里：它验的是「发出去的东西齐不齐」，
 * 只能在发完之后跑，所以由 release-check.mjs 自己承担。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/* 各家 Key 的形态：`sk-` 后面不是固定十六进制（`sk-proj-…`、`sk-ant-api03-…` 都不含十六进制段）。
   2026-10-12 实测：原来那条只认十六进制尾巴的规则，上面两种真 Key 形态**全部漏过**。
   同一条扫描里带上 GitHub 令牌：这仓库有两处拿令牌推送的脚本，令牌被写进文件同样撤不回来。 */
export const KEY_RULES = [
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
export const ALLOW_MARK = "gate-allow";

function git(args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/* 核对远端用 git 自己的凭据，不走 gh：发版本来就要 push，push 能通这台机就一定认得远端；
   gh 走的是另一套 token，过期了会在这里误报成「取不到远端」，把人引到一个跟发版无关的坑里。
   仓库位置（app-meta.js 的 slug）也不再需要了——ls-remote 直接问 remote origin。 */

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
  const r = git(["ls-remote", "origin", "main"]);
  if (r.status !== 0) {
    const err = (r.stderr || "").trim().split("\n").filter(Boolean)[0] || "";
    return {
      ok: false,
      why: [
        "git ls-remote 取不到远端 main（网络或推送凭据）：" + err,
        "      → 离线只想核对本地状态：node tools/gate.mjs --fast",
      ],
    };
  }
  const remote = ((r.stdout || "").split("\t")[0] || "").trim();
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
  // 三条规则合成一次 git grep：多个 -e 之间是「或」。三次进程 → 一次，命中后按第一条能对上的规则归名。
  const args = ["grep", "-n", "-I", "-E"];
  for (const rule of KEY_RULES) args.push("-e", rule.re.source);
  args.push("--", ".");
  const r = git(args);
  if (r.status > 1) return { ok: false, why: ["git grep 出错：" + (r.stderr || "").trim()] };
  const hits = [];
  for (const line of (r.stdout || "").split("\n").filter(Boolean)) {
    if (line.indexOf(ALLOW_MARK) >= 0) continue;
    const rule = KEY_RULES.find((x) => x.re.test(line));
    if (!rule) continue;
    const m = rule.re.exec(line);
    /* 报告里把命中串自己打码（首 6 位 + 尾 4 位）：闸门不过时那串东西还在屏幕上和日志里，
       不打码等于又贴了一遍。 */
    const raw = line.trim();
    const shown = m ? raw.replace(m[0], m[0].slice(0, 6) + "…" + m[0].slice(-4)) : raw;
    hits.push(rule.name + " · " + shown);
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

/* 版本号写在两个文件里：`package.json` 的 version，和 `package-lock.json` 里那两处（顶层 + packages[""]）。
   靠人记着同步就会漏——2026-10-17 实际撞到：lock 还停在 0.0.15，包已经在 0.0.22，
   而 Windows 那边一跑 `npm install` 就被 npm 顺手改成 0.0.22，工作区当场变脏、第一条闸门把发布拦下。
   拦下的那一刻看到的是「工作区有未提交改动」，跟真正的原因（版本号两处分家）隔了一层。 */
export function gateLockVersion() {
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); }
  catch (e) { return { ok: false, why: ["读不到 / 解析不了 package.json：" + (e && e.message ? e.message : e)] }; }
  let lock;
  try { lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")); }
  catch (e) { return { ok: false, why: ["读不到 / 解析不了 package-lock.json：" + (e && e.message ? e.message : e)] }; }
  const inner = (lock.packages && lock.packages[""] && lock.packages[""].version) || "(没有这一项)";
  const bad = [];
  if (lock.version !== pkg.version) bad.push("顶层 version = " + lock.version);
  if (inner !== pkg.version) bad.push('packages[""].version = ' + inner);
  if (!bad.length) return { ok: true, note: "package-lock.json 与 package.json 同版（" + pkg.version + "）" };
  return {
    ok: false,
    why: [
      "package.json 是 " + pkg.version + "，package-lock.json 里对不上：" + bad.join("；") + "。",
      "      → 在仓库里跑一次 npm install（它会把 lock 里这两行改成当前版本），把改动一起提交再发。",
    ],
  };
}

/* 这一条治的是最难发现的一种错：忘了升版本号。
   闸门以前不查它，于是流程能一路跑到最后一步，把新的包盖到上一个 Release 上——
   而 Electron 自动更新看的是 latest.yml / latest.json 里的版本号，已经装了旧版的人什么也不会收到。
   本地 tag 就够判：这个仓库一直单人发、tag 不发就不会缺。远端 tag 留给 release-check 去对。 */
function gateVersionFresh() {
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); }
  catch (e) { return { ok: false, why: ["读不到 / 解析不了 package.json：" + (e && e.message ? e.message : e)] }; }
  const tag = "v" + pkg.version;
  const r = git(["tag", "-l", tag]);
  if (r.status !== 0) return { ok: false, why: ["读不到本地 tag 列表：" + (r.stderr || "").trim()] };
  if (!(r.stdout || "").trim()) return { ok: true, note: tag + " 还没被用过" };
  return {
    ok: false,
    why: [
      "本地已经有 " + tag + " 这个 tag，说明 " + pkg.version + " 这版发过了。现在直接发会把同一个 Release 盖掉。",
      "      → 先升版本号：npm version patch --no-git-tag-version（只改 package.json 与 lock，不自动提交、不打 tag）",
      "      → 再提交，然后 npm run release。",
    ],
  };
}

const GATES = [
  ["lock 版本 = package.json 版本", gateLockVersion],
  ["版本号没被发过", gateVersionFresh],
  ["工作区干净", gateCleanTree],
  ["源码无明文密钥", gateNoSecrets],
  ["远端 main = 本地 HEAD", gateRemoteHead],
];

/* 返回值：true = 全绿可以发；false = 有红线，调用方停手 */
export function runReleaseGates(opts) {
  const skipGates = !!(opts && opts.skip);
  const fast = !!(opts && opts.fast);
  console.log("\n=== 发布闸门（5 条，规则见 AGENTS.md「发布」一节）===");
  if (skipGates) {
    console.log("  --skip-gates：全部跳过（只在明知自己为什么这么干的时候用）");
    return true;
  }
  const ran = [];
  let allOk = true;
  for (const [title, fn] of GATES) {
    if (fast && fn === gateRemoteHead) {
      console.log("  -  " + title + "   --fast 跳过（离线核对本地状态）");
      continue;
    }
    let r;
    try { r = fn(); }
    catch (e) { r = { ok: false, why: ["闸门自己抛了异常：" + (e && e.message ? e.message : e)] }; }
    ran.push(title);
    if (r.ok) {
      console.log("  ✔ " + title + (r.note ? "   " + r.note : ""));
    } else {
      allOk = false;
      /* 全走 stdout：走 stderr 的话，输出接管道（CI、日志、> 文件）时会和 ✔ 那几行乱序。 */
      console.log("  ✘ " + title);
      for (const w of r.why || []) console.log("      " + w.trim());
      break;   // 拦下了就停：后面几条跑出来的结论现在没用，多报几条只是多读几段
    }
  }
  if (!allOk) {
    console.log("\n  闸门没过（跑到第 " + ran.length + " 条），未开始发布。");
    return false;
  }
  console.log("\n  " + ran.length + " 条全过，可以发。");
  return allOk;
}

/* 单独跑：node tools/gate.mjs */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const ok = runReleaseGates({
    skip: process.argv.includes("--skip-gates"),
    fast: process.argv.includes("--fast"),
  });
  console.log("");
  process.exit(ok ? 0 : 1);
}
