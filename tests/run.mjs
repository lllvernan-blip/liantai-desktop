/*
 * 练习台 —— 零依赖自检
 *   node tests/run.mjs
 *
 * 它做的事：把 app/index.html 里的 <script> 抠出来，配上最小 DOM 桩子，
 * 再接上断言文件，在同一个作用域里跑一遍。不需要浏览器、不需要装包。
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
  app,
  readFileSync(join(here, "assertions.js"), "utf8"),
].join("\n");

// 先跑壳侧自检（update.js 状态机）。**必须在页面自检之前**：
// 下面那个 data: 模块会把全局 setTimeout/setInterval 换成桩子（页面脚本在 node 里不需要真定时器），
// 换完再跑壳侧的话，状态机的定时器全是空转。
await import(new URL("./shell.mjs", import.meta.url).href);

// 以 data: 模块执行：桩子、应用、断言同处一个模块作用域，且支持顶层 await（异步自检用）
const b64 = Buffer.from(src, "utf8").toString("base64");
await import("data:text/javascript;base64," + b64);
