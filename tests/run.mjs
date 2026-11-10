/*
 * 练习台 —— 零依赖自检
 *   node tests/run.mjs
 *
 * 它做的事：把 app/index.html 里的 <script> 抠出来，配上最小 DOM 桩子，
 * 再接上断言文件，在同一个作用域里跑一遍。不需要浏览器、不需要装包。
 *
 * 另有两份同样手法的自检（都排在应用自检之后）：
 *   tests/shell.mjs  壳侧——update.js 的状态机与禁用策略（假的 electron-updater）
 *   tests/site.mjs   官网页面 site/index.html——按平台给包、下载链接走加速镜像
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, "..", "app", "index.html");
const html = readFileSync(htmlPath, "utf8");

const open = html.indexOf("<script>");
const close = html.lastIndexOf("</script>");
if (open < 0 || close < 0) {
  console.error("没在 HTML 里找到 <script> 块，页面结构可能被改动了。");
  process.exit(1);
}
const app = html.slice(open + "<script>".length, close);

const src = [
  readFileSync(join(here, "dom-stub.js"), "utf8"),
  // 预置 gw_history：页面脚本求值时必须能读到，专门抓“启动顺序”类回归（如 HISTORY_KEY 撞 TDZ 被静默吞掉）
  // 这条记录故意用旧格式（裸模块键 gongwen）：启动路径上就该被迁成 zy.gongwen，断言同时覆盖这一点
  "localStorage.setItem('gw_history', JSON.stringify([{ ts: 42, module: 'gongwen', grade: { total: 60, scores: {} } }]));",
  // 再预置一份「有内容」的 gw_state：load() 的清洗链（经验/训练链/画像）必须整条跑通。
  // 只预置 gw_history 不够——那条路在 gw_state 缺失时提前返回，EXP_KINDS 之类的 TDZ 照样溜过去。
  "localStorage.setItem('gw_state', JSON.stringify({ settings: { subject: 'zy' }, profile: {}, cache: {}," +
  " experiences: [{ type: '错因', kind: '漏点', title: '启动哨兵', body: '带数据启动不该回默认' }] }));",
  app,
  // 静态 HTML（页面里写死的部分）也纳入断言：DOM 桩子不解析页面结构，只有这份原文可查
  "const PAGE_HTML = " + JSON.stringify(html) + ";",
  readFileSync(join(here, "assertions.js"), "utf8"),
].join("\n");

// 先跑壳侧自检（update.js 状态机）。**必须在页面自检之前**：
// 下面那个 data: 模块会把全局 setTimeout/setInterval 换成桩子（页面脚本在 node 里不需要真定时器），
// 换完再跑壳侧的话，状态机的定时器全是空转。
await import(new URL("./shell.mjs", import.meta.url).href);

// data: 模块报错时 stack 帧带着整段 base64（一帧约 1.7MB，一次自检刷 3.4MB 噪声）。
// 打印前把这段 URL 截短：只动输出，不动执行，真实错误信息一个字不少。
const trimDataURLs = (s) => String(s).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, "data:text/javascript;base64,…");
for (const m of ["error", "warn", "log"]) {
  const orig = console[m].bind(console);
  console[m] = (...args) => orig(...args.map((a) =>
    a instanceof Error ? trimDataURLs(a.stack || a.message) : (typeof a === "string" ? trimDataURLs(a) : a)));
}

// 以 data: 模块执行：桩子、应用、断言同处一个模块作用域，且支持顶层 await（异步自检用）
const b64 = Buffer.from(src, "utf8").toString("base64");
await import("data:text/javascript;base64," + b64);

// 官网页面（site/index.html）自检放最后：它会把 globalThis.document 换成自己那份，跑在前面会拆掉应用侧的桩子
await import(new URL("./site.mjs", import.meta.url).href);
