/*
 * 壳侧自检 —— update.js 的状态机与禁用策略（零依赖，不需要 Electron）。
 *
 * 为什么单独一份：app/index.html 的断言全打在页面侧，而「免安装版必须禁用」
 * 「没下载完不许 install」「出错了要能再试」「退出中不再发请求」这些恰恰是主进程侧的边界，
 * 以前一条都没人兜。
 *
 * 手法：把假的 electron-updater 塞进 require.cache（update.js 内部是惰性 require，替换即生效），
 * 于是可以纯代码驱动 update-available / download-progress / update-downloaded / error 全流程。
 */
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { setTimeout as realSetTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const T = [];
const ok = (c, m) => T.push((c ? "PASS  " : "FAIL  ") + m);

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.calls = { setFeedURL: [], checkForUpdates: 0, quitAndInstall: [] };
  }
  async checkForUpdates() {
    this.calls.checkForUpdates++;
    return { updateInfo: {} };
  }
  setFeedURL(o) {
    this.calls.setFeedURL.push(o);
  }
  quitAndInstall(a, b) {
    this.calls.quitAndInstall.push([a, b]);
  }
}

const UPDATER_KEY = require.resolve("electron-updater");
const UPDATE_PATH = require.resolve(join(here, "..", "update.js"));

/* 用自己的定时器，不用全局 setTimeout：
   run.mjs 随后会把全局定时器换成 DOM 桩的空实现（页面脚本在 node 里不需要真定时器）。
   壳侧这份跑在它之前，但两边都不该依赖执行顺序。 */
const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));

/* 每轮都拿一份全新的 update.js：模块里带着 status / stopped / 定时器等状态，复用会串味 */
function loadUpdate(exports) {
  const prev = require.cache[UPDATER_KEY];
  require.cache[UPDATER_KEY] = { id: UPDATER_KEY, filename: UPDATER_KEY, loaded: true, exports };
  delete require.cache[UPDATE_PATH];
  const mod = require(UPDATE_PATH);
  return {
    mod,
    restore() {
      if (prev) require.cache[UPDATER_KEY] = prev;
      else delete require.cache[UPDATER_KEY];
    },
  };
}

const logs = [];
const log = (event, detail) => logs.push(event + (detail === undefined ? "" : " :: " + detail));

/* ---- 1. 开发版（源码直跑）与免安装版必须禁用 ---- */
{
  const { mod, restore } = loadUpdate({ autoUpdater: new FakeUpdater() });
  mod.initUpdate({ log, isPackaged: false, currentVersion: "9.9.9" });
  const st = mod.getStatus();
  ok(st.phase === "disabled" && st.reason === "dev" && st.supported === false, "壳: 开发版不检查更新");
  restore();
}
{
  const { mod, restore } = loadUpdate({ autoUpdater: new FakeUpdater() });
  process.env.PORTABLE_EXECUTABLE_FILE = "X:\\tmp\\综应练习台.exe";
  try {
    mod.initUpdate({ log, isPackaged: true, currentVersion: "1.0.0" });
    const st = mod.getStatus();
    ok(st.phase === "disabled" && st.reason === "portable" && st.supported === false,
       "壳: 免安装版禁用自动更新（对它 quitAndInstall 只会装出一个新副本）");
  } finally {
    delete process.env.PORTABLE_EXECUTABLE_FILE;
  }
  restore();
}
{
  const { mod, restore } = loadUpdate({});   // 没带上 electron-updater 的畸形包
  mod.initUpdate({ log, isPackaged: true, currentVersion: "1.0.0" });
  const st = mod.getStatus();
  ok(st.phase === "error" && st.reason === "missing-module", "壳: 缺 electron-updater 时明确报错，不做哑巴");
  restore();
}

/* ---- 2. 安装版全流程：换源 / 发现新版 / 下载 / 安装 ---- */
{
  const fake = new FakeUpdater();
  const { mod, restore } = loadUpdate({ autoUpdater: fake });
  const seen = [];
  mod.initUpdate({
    log,
    isPackaged: true,
    currentVersion: "1.0.0",
    feed: "http://127.0.0.1:9/",
    releasesUrl: "https://example.invalid/releases",
    onStatusChange: (s) => seen.push(s.phase),
  });
  const st0 = mod.getStatus();
  ok(st0.supported === true && st0.phase === "idle" && st0.currentVersion === "1.0.0", "壳: 安装版进入可更新状态");
  ok(fake.calls.setFeedURL.length === 1 && fake.calls.setFeedURL[0].provider === "generic" && fake.calls.setFeedURL[0].url === "http://127.0.0.1:9/",
     "壳: LIANTAI_UPDATE_FEED 能不改包换源（generic 源）");
  ok(seen.length >= 1, "壳: 状态变化会推给页面（onStatusChange 有回调）");

  fake.emit("update-available", { version: "1.0.1" });
  ok(mod.getStatus().phase === "available" && mod.getStatus().latestVersion === "1.0.1", "壳: 发现新版本 -> available");

  fake.emit("download-progress", { percent: 42.6, transferred: 100, total: 200, bytesPerSecond: 10 });
  ok(mod.getStatus().phase === "downloading" && mod.getStatus().progress.percent === 43, "壳: 下载进度取整并进入 downloading");
  fake.emit("download-progress", { percent: 999 });
  ok(mod.getStatus().progress.percent === 100, "壳: 进度上限夹在 100（不把 999% 端给用户）");

  ok(mod.installUpdate() === false, "壳: 没下完就 install 必须拒绝（页面侧收到 409）");

  fake.emit("update-downloaded", { version: "1.0.1" });
  ok(mod.getStatus().phase === "downloaded", "壳: 下载完成 -> downloaded");
  ok(mod.installUpdate() === true, "壳: downloaded 时 install 放行");
  await wait(20);   // quitAndInstall 排在 setImmediate 上
  ok(fake.calls.quitAndInstall.length === 1 && fake.calls.quitAndInstall[0][1] === true,
     "壳: install 调 quitAndInstall(false, true)（装完自动拉起新版）");

  fake.emit("error", new Error("net::ERR_CONNECTION_REFUSED"));
  ok(mod.getStatus().phase === "error" && /ERR_CONNECTION_REFUSED/.test(mod.getStatus().error),
     "壳: 出错落在 error 态并留下原文（不吞掉原因）");

  const before = fake.calls.checkForUpdates;
  await mod.checkUpdate();
  ok(fake.calls.checkForUpdates === before + 1, "壳: 出错之后还能再检查（错误态不自锁）");

  fake.emit("checking-for-update");
  const during = fake.calls.checkForUpdates;
  await mod.checkUpdate();
  ok(fake.calls.checkForUpdates === during, "壳: 检查进行中重复触发不叠加请求");

  mod.stopUpdate();
  const afterStop = fake.calls.checkForUpdates;
  await mod.checkUpdate();
  ok(fake.calls.checkForUpdates === afterStop, "壳: 退出流程中不再发更新请求");
  restore();
}

console.log(T.join("\n"));
const fails = T.filter((x) => x.indexOf("FAIL") === 0);
console.log("\n== 壳侧 " + (T.length - fails.length) + "/" + T.length + " passed ==");
if (fails.length) process.exitCode = 1;
