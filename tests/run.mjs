/*
 * 综应练习台 —— 零依赖自检
 *   node tests/run.mjs
 *
 * 它做的事：把 综应练习台.html 里的 <script> 抠出来，配上最小 DOM 桩子，
 * 再接上断言文件，在同一个作用域里跑一遍。不需要浏览器、不需要装包。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, "..", "综应练习台.html");
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
  app,
  readFileSync(join(here, "assertions.js"), "utf8"),
].join("\n");

// 以 data: 模块执行：桩子、应用、断言同处一个模块作用域，且支持顶层 await（异步自检用）
const b64 = Buffer.from(src, "utf8").toString("base64");
await import("data:text/javascript;base64," + b64);
