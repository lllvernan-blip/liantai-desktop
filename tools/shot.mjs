/*
 * 练习台 —— 真实渲染取景器
 *   node tools/shot.mjs <场景文件.mjs> [输出目录] [--plain]
 *
 * 每个场景默认拍两张：原始态 + 折叠块全展开态（--plain 只拍原始态）。
 * 收尾会把这轮的自检结论直接打在终端上：没有 FAIL 就不用去看那些图。
 * 退出码：0 = 全过；2 = 有 FAIL（当作可卡口的检查用）。
 *
 * 为什么要它
 * ──────────
 * tests/run.mjs 用的是 DOM 桩子（querySelectorAll 恒返回 []），量不出任何几何；
 * 而界面问题恰恰常常是「看不见的空白」「差 20px 的错位」这类只能靠真实布局发现的东西。
 * 本工具起一个临时静态服务指向 app/，用 Electron 真实渲染 1280x900，
 * 逐场景截图、把关键块的位置/尺寸打进日志，并过一遍客观规则（见 shot-app.cjs 的 AUDIT_JS）。
 *
 * 场景文件是 ESM，导出 { scenes: [...] }，每个场景 { name, js, full?, crop?, probe? }：
 *   name  输出文件名（不带扩展名）
 *   js    在页面里执行的代码（写成一个函数再 toString，见 tools/scenes-*.mjs 的写法）
 *   full  true 时先把窗口撑到整页高再截，用来看整屏留白
 *
 * 注意：Electron 侧一律 win.close() + app.quit() 收尾，绝不用 process.kill——
 * 强杀会在页面加载完之前干掉渲染进程，日志留下 render-process-gone 与 ERR_FAILED，
 * 看着像「应用启动失败」，其实是取景器自己造的，还会残留进程占住单实例锁。
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve, extname } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const target = process.argv[2];
if (!target || target.startsWith("--")) {
  console.error("用法: node tools/shot.mjs <场景文件.mjs> [输出目录] [--plain]");
  process.exit(1);
}
const PLAIN = process.argv.includes("--plain");   // 只拍原始态，不拍展开态
const scenePath = resolve(process.cwd(), target);
if (!existsSync(scenePath)) {
  console.error("找不到场景文件: " + scenePath);
  process.exit(1);
}
const outDir = resolve(process.cwd(), process.argv[3] || "_shots");
mkdirSync(outDir, { recursive: true });

const mod = await import(pathToFileURL(scenePath).href);
const scenes = mod.scenes;
if (!Array.isArray(scenes) || !scenes.length) {
  console.error("场景文件必须导出 { scenes: [...] }");
  process.exit(1);
}
const sceneJson = join(tmpdir(), "liantai-scenes-" + Date.now() + ".json");
writeFileSync(sceneJson, JSON.stringify(scenes), "utf8");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const server = createServer((req, res) => {
  const url = decodeURIComponent(String(req.url || "/").split("?")[0]);
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const file = resolve(join(root, "app"), rel);
  if (!file.startsWith(resolve(join(root, "app"))) || !existsSync(file)) {
    res.writeHead(404); res.end("404"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;
const url = "http://127.0.0.1:" + port + "/index.html";

const require = createRequire(import.meta.url);
const electronPath = require("electron");

// 启动方式有两处本机坑，都踩过：
// ① Electron 只认「app 目录」。cwd 里若放着别的 package.json（本项目根目录就有，main=main.js），
//    它会把显式传入的脚本路径丢掉、去跑那个 main——表现是「什么都没跑、静默退出」。
//    所以另起一个临时 app 目录，把 shot-app.cjs 复制成 main.js（main 写绝对路径在 Windows 上也不稳）。
// ② 给 Electron 传「app 目录之后再跟参数」会让它静默退出，什么都不加载；参数一律走环境变量。
const appDir = join(tmpdir(), "liantai-shot-app");
mkdirSync(appDir, { recursive: true });
copyFileSync(join(here, "shot-app.cjs"), join(appDir, "main.js"));
writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "liantai-shot", version: "1.0.0", main: "main.js" }, null, 2), "utf8");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;   // 本机默认把它设为 1，会让 electron.exe 退化成纯 Node
env.LIANTAI_SHOT_URL = url;
env.LIANTAI_SHOT_SCENES = sceneJson;
env.LIANTAI_SHOT_OUT = outDir;
if (PLAIN) env.LIANTAI_SHOT_EXPAND = "0";

// 子进程自己会写 <输出目录>/_run.log（几何与失败原因）；这里是它的 stdout/stderr 副本，
// 另存一个文件名——曾经两者同名，父进程收尾时把子进程写的日志整份覆盖成空，白排查一轮。
const logFile = resolve(outDir, "_child.txt");
let logText = "";
const code = await new Promise((done) => {
  const child = spawn(electronPath, [appDir], {
    cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => { const s = String(d); process.stdout.write(s); logText += s; });
  child.stderr.on("data", (d) => { const s = String(d); process.stderr.write("[electron] " + s); logText += "[stderr] " + s; });
  child.on("error", (e) => { console.error("拉起 Electron 失败: " + e.message); done(1); });
  child.on("exit", (c, sig) => {
    if (c !== 0) console.error("Electron 退出码 " + c + " 信号 " + sig);
    done(c == null ? 1 : c);
  });
});
writeFileSync(logFile, logText, "utf8");

server.close();
try { rmSync(sceneJson, { force: true }); } catch (e) {}
console.log("截图输出目录: " + outDir);

// 结论先行：把自检结果从 _run.log 里挑出来打在终端上，别让人去翻日志。
// 只在有 FAIL 时才需要点开对应的图——图是给人看的，规则是给机器看的。
let failCount = 0;
try {
  const runLog = readFileSync(resolve(outDir, "_run.log"), "utf8").split(/\r?\n/);
  const audits = runLog.filter((l) => l.startsWith("AUDIT "));
  const summary = runLog.filter((l) => l.startsWith("自检 ") || l.startsWith("!!! "));
  failCount = audits.filter((l) => l.indexOf(":: FAIL") >= 0).length;
  if (audits.length) {
    console.log("\n—— 自检不合规 ——");
    for (const l of audits) console.log(l);
  } else {
    console.log("\n自检：所有规则都过，不用点开图。");
  }
  for (const l of summary) console.log(l);
} catch (e) {
  console.log("（读不到 _run.log：" + e.message + "）");
}
process.exit(failCount ? 2 : code);
