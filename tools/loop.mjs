/*
 * 工程闭环：提交前 / 发布前「一次跑完」的那套机械检查。
 *
 *   node tools/loop.mjs                静态检查 + 全量自检
 *   node tools/loop.mjs --no-tests     只做静态检查（改文档 / 发布脚本时省几秒）
 *   node tools/loop.mjs --staged       pre-commit 用：密钥只看暂存区里的内容
 *   node tools/loop.mjs --quiet        只在失败时细说；成功只留一行
 *
 * 为什么要有它：
 *   这些东西原来分散在 `tests/run.mjs`、`tools/gate.mjs`、`tools/release-check.mjs` 和
 *   AGENTS.md 的人肉清单里。人肉清单的问题不是「写得不对」，而是「没有人执行它」——
 *   漏跑一次不会报错，只会在下一个人那里变成一次排查。
 *   这里把「提交前就该为真」的检查收到一处，并给 .githooks/pre-commit 一个入口。
 *
 * 它不是发布闸门：发布闸门（gate.mjs）还要看工作区干净、远端 HEAD、lock 版本；
 * 那几条在 pre-commit 时天然不成立（工作区正脏着、HEAD 还没推）。两套各管各的时点。
 *
 * 只读：不打包、不上传、不建文件、不改 git 配置。要装钩子跑 tools/install-hooks.mjs。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { KEY_RULES, ALLOW_MARK, gateLockVersion } from "./gate.mjs";
import { checkDocRefs } from "./doc-refs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log([
    "用法：node tools/loop.mjs [--staged] [--quiet] [--no-tests]",
    "",
    "  --staged    按暂存区查密钥（pre-commit 用）：读 git show :路径，不看工作区的改动",
    "  --quiet     成功时只留一行（钩子用），失败照常逐条说",
    "  --no-tests  只做静态检查，不跑 tests/run.mjs",
  ].join("\n"));
  process.exit(0);
}
const staged = argv.includes("--staged");
const quiet = argv.includes("--quiet");
const noTests = argv.includes("--no-tests");

const t0 = Date.now();
const results = [];

function add(title, ok, note, details) {
  results.push({ title, ok, note: note || "", details: details || [] });
}

function git(args, opts) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: (opts && opts.encoding) || "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

/* ================= 1. 语法：Node 能解析的脚本都过一遍 =================
   `node --check` 只解析不执行，所以不会碰到 Electron / 网络 / 用户数据。
   页面里的内联脚本由全量自检真正执行，比单独解析更强，不在这里重复。 */
{
  /* 根目录按通配收，以后新加入口脚本不用再回来改这张名单。 */
  const files = [
    ...readdirSync(root).filter((f) => /\.js$/.test(f)),
    ...readdirSync(join(root, "tests")).filter((f) => /\.(mjs|cjs|js)$/.test(f)).map((f) => "tests/" + f),
    ...readdirSync(join(root, "tools")).filter((f) => /\.mjs$/.test(f)).map((f) => "tools/" + f),
  ];
  const bad = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ["--check", join(root, f)], { encoding: "utf8" });
    if (r.status !== 0) {
      const msg = (r.stderr || "").trim().split("\n").filter(Boolean).slice(0, 4).join(" / ");
      bad.push(f + "：" + msg);
    }
  }
  add("语法：Node 脚本都能解析", bad.length === 0,
    bad.length ? "有 " + bad.length + " 个解析不过" : "查了 " + files.length + " 个文件", bad);
}

/* ================= 2. 应用页面：仍然是单文件、零外链 =================
   业务页是「一个 HTML + 一段内联脚本 + 内联样式」，这是打包、离线、CSP 与测试的共同前提。
   往页面里塞第二个 <script>、外链 JS / CSS 或 http(s) 的 @import，都会让其中一处悄悄失效
   （最常见的是：开发时能开，装进壳里被 CSP 拦掉，测试却还是绿的）。 */
{
  const html = readFileSync(join(root, "app", "index.html"), "utf8");
  const scriptOpen = (html.match(/<script\b/gi) || []).length;
  const scriptClose = (html.match(/<\/script>/gi) || []).length;
  const external = [];
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) external.push("有 <script src=…>");
  if (/<link\b[^>]*\bhref\s*=\s*["']?https?:/i.test(html)) external.push("有外链 <link href=…>");
  if (/@import\s+(?:url\()?\s*["']?https?:/i.test(html)) external.push("CSS 里有外链 @import");
  const single = scriptOpen === 1 && scriptClose === 1;
  const ok = single && external.length === 0;
  add("页面：app/index.html 仍是单段内联脚本、无外链资源", ok,
    ok ? "脚本 1 段 · 样式内联" : "页面约束被改动了",
    [...(single ? [] : ["<script> 有 " + scriptOpen + " 个开始、" + scriptClose + " 个结束（应为各 1）"]), ...external]);
}

/* ================= 3. 规则文件尺寸：超了会被指令链截断 =================
   截断点落在哪儿不好预测，可能正好切掉半条约束。 */
{
  let size = 0;
  try { size = statSync(join(root, "AGENTS.md")).size; } catch (e) { size = -1; }
  const LIMIT = 32 * 1024;
  add("规则：AGENTS.md 不超过 32 KiB", size > 0 && size <= LIMIT,
    size > 0 ? "当前 " + size + " B（上限 " + LIMIT + " B）" : "读不到 AGENTS.md");
}

/* ================= 4. 版本号：package.json 与 lock 同版 =================
   规则与发布闸门共用 gate.mjs 里的那一份；这里只借用，不另写。 */
{
  const r = gateLockVersion();
  add("版本：package-lock 与 package.json 同版", r.ok, r.ok ? r.note : "", r.ok ? [] : r.why || []);
}

/* ================= 5. 文档引用的仓内文件都在 =================
   同一套规则也跑在发布对账里（tools/doc-refs.mjs）；文档指向不存在的脚本，
   下一个人会照着敲一遍才发现。 */
{
  const d = checkDocRefs(root);
  add("文档：引用的仓内文件都存在", d.missing.length === 0,
    d.missing.length ? "缺 " + d.missing.length + " 处" : "查了 " + d.checked + " 处",
    d.missing);
}

/* ================= 6. 明文密钥：暂存区 / 工作区 =================
   pre-commit 时看的是「这次要提交进去的内容」：git show :路径。
   只看工作区的话，把密钥从文件里删掉、暂存区里还留着旧内容时，扫描会是绿的而提交带着密钥。
   规则与发布闸门共用 KEY_RULES；测试用的假 Key 靠同一行里的 gate-allow 标记放行。 */
{
  const list = staged
    ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    : git(["ls-files", "-z", "-co", "--exclude-standard"]);
  if (list.status !== 0) {
    add("密钥：扫描" + (staged ? "暂存区" : "工作区"), false, "git 读不到文件清单", [(list.stderr || "").trim()]);
  } else {
    const paths = (list.stdout || "").split("\u0000").filter(Boolean);
    const hits = [];
    let scanned = 0;
    let skipped = 0;
    for (const p of paths) {
      let text;
      if (staged) {
        const r = git(["show", ":" + p]);
        if (r.status !== 0) { skipped++; continue; }
        text = r.stdout;
      } else {
        try { text = readFileSync(join(root, p), "utf8"); } catch (e) { skipped++; continue; }
      }
      /* 二进制文件里出现 8 位随机串的概率极低、误报却难解释；跳过并计数。 */
      if (text.indexOf("\u0000") >= 0 || text.length > 8 * 1024 * 1024) { skipped++; continue; }
      scanned++;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.indexOf(ALLOW_MARK) >= 0) continue;
        for (const rule of KEY_RULES) {
          const m = rule.re.exec(line);
          if (!m) continue;
          /* 命中串自己打码：报错信息会进终端、日志与聊天记录，打全了等于又贴一遍。 */
          const shown = line.trim().replace(m[0], m[0].slice(0, 6) + "…" + m[0].slice(-4));
          hits.push(p + ":" + (i + 1) + " · " + rule.name + " · " + shown.slice(0, 160));
        }
      }
    }
    add("密钥：" + (staged ? "暂存区" : "工作区") + "没有明文密钥",
      hits.length === 0,
      "查了 " + scanned + " 个文本文件" + (skipped ? "，跳过 " + skipped + " 个二进制 / 不可读文件" : ""),
      hits.length ? [...hits.slice(0, 10), hits.length > 10 ? "…还有 " + (hits.length - 10) + " 处" : ""] : []);
  }
}

/* ================= 7. 闭环入口自己还在 =================
   脚本与钩子互相指着，改名字时最容易只改一边：钩子调一个不存在的文件，
   git 只在提交那一刻报一句 "No such file"，而且那之前你已经把检查当成过了。 */
{
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const want = {
    test: /tests\/run\.mjs/,
    check: /tools\/loop\.mjs/,
    "check:staged": /tools\/loop\.mjs[^\n]*--staged/,
    "hooks:install": /tools\/install-hooks\.mjs/,
  };
  const missing = Object.entries(want)
    .filter(([k, re]) => !(pkg.scripts && re.test(pkg.scripts[k] || "")))
    .map(([k]) => "scripts." + k);
  const hookPath = join(root, ".githooks", "pre-commit");
  const hook = (() => { try { return readFileSync(hookPath, "utf8"); } catch (e) { return ""; } })();
  if (!hook) missing.push(".githooks/pre-commit");
  else if (!/tools\/loop\.mjs[^\n]*--staged/.test(hook)) missing.push(".githooks/pre-commit 没有调 tools/loop.mjs --staged");

  /* Qoder 的任务结束钩子：配置在项目级 .qoder/settings.json，入口脚本可以换，
     但必须仍然指到 stop-check（它再调 tools/qoder-stop.mjs）。 */
  let qoder = null;
  try { qoder = JSON.parse(readFileSync(join(root, ".qoder", "settings.json"), "utf8")); } catch (e) { qoder = null; }
  const stopGroups = qoder && qoder.hooks && Array.isArray(qoder.hooks.Stop) ? qoder.hooks.Stop : [];
  const stopHooks = stopGroups.flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks : []));
  const qoderWired = stopHooks.some((h) => h && h.type === "command" && /stop-check\.sh/.test(String(h.command || "")));
  if (!qoderWired) missing.push(".qoder/settings.json 的 Stop 钩子");

  add("闭环：npm scripts、pre-commit 与 Qoder Stop 钩子都接在 loop 上", missing.length === 0,
    missing.length ? "缺 " + missing.join("、") : "test / check / check:staged / hooks:install + 两个钩子");
}

/* ================= 8. 全量自检 =================
   页面、壳、官网三份都由 tests/run.mjs 串起来跑。这里只负责跑一次、把结果说清楚；
   断言本身的判据不在这里重写。 */
let testNote = "";
if (noTests) {
  testNote = "按 --no-tests 跳过";
} else {
  const t = Date.now();
  const r = spawnSync(process.execPath, [join(root, "tests", "run.mjs")], {
    cwd: root,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 128 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const sums = [...out.matchAll(/^== (?:(.*?) )?(\d+)\/(\d+) passed ==$/gm)]
    .map((m) => (m[1] ? m[1].replace(/\s+/g, "") : "页面") + " " + m[2] + "/" + m[3]);
  const fails = out.split("\n").filter((l) => /^FAIL\s/.test(l.trim()));
  const pass = r.status === 0 && fails.length === 0 && sums.length > 0;
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  testNote = pass ? sums.join(" · ") + "（" + secs + "s）" : "没跑过" + (r.error ? "：" + r.error.message : "");
  add("全量自检：node tests/run.mjs", pass, testNote,
    pass ? [] : [...fails.slice(0, 20), fails.length > 20 ? "…还有 " + (fails.length - 20) + " 条 FAIL" : "",
      "单独跑一次看完整输出：node tests/run.mjs"]);
}

/* ================= 汇报 =================
   安静模式成功时只留一行；失败无论哪种模式都逐条说，并给可执行的下一步。 */
const failed = results.filter((r) => !r.ok);
if (!quiet) console.log("\n=== 工程闭环" + (staged ? "（暂存区）" : "") + " ===");
for (const r of results) {
  if (quiet && r.ok) continue;
  console.log("  " + (r.ok ? "✔" : "✘") + " " + r.title + (r.note ? "   " + r.note : ""));
  if (!r.ok) for (const d of r.details) if (d) console.error("      " + String(d).trim());
}
if (failed.length) {
  console.error("\n  有 " + failed.length + " 项没过。" + (staged ? "这次提交被拦下，改完重新 git add。" : "改完再跑一次 node tools/loop.mjs。"));
  process.exit(1);
}
const total = ((Date.now() - t0) / 1000).toFixed(1);
if (quiet) {
  const t = results.find((r) => r.title.indexOf("全量自检") >= 0);
  console.log("  工程闭环通过（" + results.length + " 项" + (t && !noTests ? " · " + t.note : "") + "）");
} else {
  console.log("\n  " + results.length + " 项全过（" + total + "s）。" + (noTests ? "这次没跑自检（--no-tests）。" : "可以提交。"));
}
