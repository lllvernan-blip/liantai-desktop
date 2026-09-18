/*
 * 综应练习台 —— 探针运行器（零依赖）
 *   node tools/probe.mjs <探针文件.js>
 *
 * 为什么要有它
 * ────────────
 * `node -e` 的脚本里只要出现「冒号 + 反斜杠」，Git Bash 就会把这段参数当成
 * 路径列表去改写： `\"` 变成 `/"`， `\\` 变成 `//`。后果分两种，第二种更坏：
 *   1. 直接语法错误（还算好，一眼能看出）；
 *   2. 搜索串被悄悄改掉，程序照跑、照样返回 false，看起来像"功能没生效/没打包进去"，
 *      能白排查半天。
 * （实测：参数里没有冒号时不会被改；`MSYS_NO_PATHCONV=1` 与 `MSYS2_ARG_CONV_EXCL='*'`
 *   在本机都**治不住**，所以别指望环境变量，老老实实写成文件。）
 *
 * 它和你已知的 tests/run.mjs 用同一套抠脚本方式：把 app/index.html 的 <script> 抽出来，
 * 配上最小 DOM 桩子，再把探针接在后面，在同一个模块作用域里跑。
 * 所以探针里可以直接用应用的全部函数与常量（MODULES / moduleAvg / gen / pickSubtypeFor ...），
 * 也可以顶层 await。
 *
 * 上面这层基础建设是 tests/run.mjs 的，本文件只是把入口换成一个可传参的探针文件；
 * 探针本身是一次性的，用完删掉，别往 tests/ 里塞。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const target = process.argv[2];
if (!target) {
  console.error("用法: node tools/probe.mjs <探针文件.js>");
  process.exit(1);
}
const probePath = resolve(process.cwd(), target);
if (!existsSync(probePath)) {
  console.error("找不到探针文件: " + probePath);
  process.exit(1);
}

const html = readFileSync(join(root, "app", "index.html"), "utf8");
const open = html.indexOf("<script>");
const close = html.lastIndexOf("</script>");
if (open < 0 || close < 0) {
  console.error("没在 HTML 里找到 <script> 块，页面结构可能被改动了。");
  process.exit(1);
}
const app = html.slice(open + "<script>".length, close);

const src = [
  readFileSync(join(root, "tests", "dom-stub.js"), "utf8"),
  "localStorage.setItem('gw_history', JSON.stringify([]));",
  app,
  readFileSync(probePath, "utf8"),
].join("\n");

const b64 = Buffer.from(src, "utf8").toString("base64");
await import("data:text/javascript;base64," + b64);
