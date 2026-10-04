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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const T = [];
const ok = (c, m) => T.push((c ? "PASS  " : "FAIL  ") + m);

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.calls = { setFeedURL: [], checkForUpdates: 0, quitAndInstall: [] };
    // 元数据：update.js 会在它外面套一层，把安装包地址改到另一条源上
    this.info = {
      version: "1.0.1",
      files: [{ url: "liantai-desktop-setup-1.0.1.exe", sha512: "HASH-FROM-META", size: 100 }],
      path: "liantai-desktop-setup-1.0.1.exe",
      sha512: "HASH-FROM-META",
    };
  }
  async checkForUpdates() {
    this.calls.checkForUpdates++;
    return { updateInfo: {} };
  }
  async getUpdateInfoAndProvider() {
    return { info: JSON.parse(JSON.stringify(this.info)), provider: { name: "fake-provider" } };
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

/* 等一件事发生（换包是另一个进程在干，只能轮询）。超时返回最后一次的结果，交给断言去说。 */
const waitFor = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(100);
  }
  return !!fn();
};

/* 每轮都拿一份全新的 update.js：模块里带着 status / stopped / 定时器等状态，复用会串味。
   顺便把平台钉死在 Windows：第 2~5 组量的是「安装版全流程」——那是 Win 的行为。
   不给 platform 就按真实平台走的话，同一份自检在 mac 上会整片失败（mac 现在不支持自动更新），
   而这套状态机本身并没有错。mac 那一条分支在第 1b 组里单独量。 */
function loadUpdate(exports) {
  const prev = require.cache[UPDATER_KEY];
  require.cache[UPDATER_KEY] = { id: UPDATER_KEY, filename: UPDATER_KEY, loaded: true, exports };
  delete require.cache[UPDATE_PATH];
  const mod = require(UPDATE_PATH);
  const rawInit = mod.initUpdate;
  mod.initUpdate = (options) => rawInit(Object.assign({ platform: "win32" }, options || {}));
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
  process.env.PORTABLE_EXECUTABLE_FILE = "X:\\tmp\\练习台.exe";
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

/* ---- 1b. macOS：不走 electron-updater（未签名，Squirrel.Mac 会报签名校验失败），改成自实现换包链；
        完整流程（查 -> 下 -> 换 -> 重启）在第 6 组用本地假源 + 临时目录真跑 ---- */
{
  const { mod, restore } = loadUpdate({});   // 不给 electron-updater：mac 这条链不该依赖它
  mod.initUpdate({ log, isPackaged: true, currentVersion: "1.0.0", platform: "darwin",
                   releasesUrl: "https://example.invalid/releases", userDataDir: "/tmp/liantai-none",
                   exePath: "/Applications/练习台.app/Contents/MacOS/练习台" });
  const st = mod.getStatus();
  ok(st.supported === true && st.phase === "idle", "壳: macOS 上更新可用（自实现换包，不靠 Squirrel）");
  ok(st.autoDownload === false, "壳: macOS 不后台静默下（一次一百来 MB，得他点）");
  ok(st.releasesUrl === "https://example.invalid/releases", "壳: macOS 状态里带着发布页地址（下不成/换不成时的退路）");
  ok(mod.installUpdate() === false, "壳: 没查也没下就 install，必须拒绝");
  ok(mod.downloadUpdate() === false, "壳: 还没查到新版就 download，必须拒绝");
  mod.stopUpdate();
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

/* ---- 3. 直连 GitHub 不通时退到备用源（国内实况：连接被重置） ---- */
{
  const fake = new FakeUpdater();
  const { mod, restore } = loadUpdate({ autoUpdater: fake });
  mod.initUpdate({ log, isPackaged: true, currentVersion: "0.0.2" });

  const feeds = Array.isArray(mod.BACKUP_FEEDS)? mod.BACKUP_FEEDS : [];
  ok(feeds.length >= 3 && feeds.every(u=>/^https:\/\//.test(u)) && new Set(feeds).size === feeds.length,
     "壳: 备用源列表至少三条、全 https 且不重复 -> " + feeds.length + " 条");

  const failOnce = () => {
    fake.emit("checking-for-update");
    fake.emit("error", new Error("net::ERR_CONNECTION_RESET"));
  };

  failOnce();
  ok(fake.calls.setFeedURL.length === 1 && fake.calls.setFeedURL[0].provider === "generic" && /^https:\/\//.test(fake.calls.setFeedURL[0].url),
     "壳: 主源连不通 -> 自动退到备用源（generic）");
  ok(mod.getStatus().phase === "idle" && mod.getStatus().error === "",
     "壳: 换备用源重试途中不把错误糊到界面上");
  ok(!!mod.getStatus().feedHost, "壳: 状态里带上备用源主机名（页面能说清在走谁）");
  ok(logs.some((l) => l.indexOf("换备用源") >= 0), "壳: 换源这件事写进日志（排查有抓手）");

  failOnce();
  ok(fake.calls.setFeedURL.length === 2 && fake.calls.setFeedURL[1].url !== fake.calls.setFeedURL[0].url,
     "壳: 备用源也不通 -> 按顺序换下一个（不绕圈）");

  /* 数不写死：备用源有几条就试几条（以后加/换线路，这里不用跟着改）
     已失败 2 次（主源 + 第一条备用源），补到 feeds.length 次，再超一次才该落 error */
  for(let i = 3; i <= feeds.length; i++){ failOnce(); }
  ok(fake.calls.setFeedURL.length === feeds.length, "壳: 备用源列表 " + feeds.length + " 条都试过了");

  const before = fake.calls.setFeedURL.length;
  failOnce();
  const st = mod.getStatus();
  ok(fake.calls.setFeedURL.length === before && st.phase === "error" && /ERR_CONNECTION_RESET/.test(st.error),
     "壳: 全都试过才落 error（不无限换源），并且留下原因");

  const beforeReset = fake.calls.setFeedURL.length;
  await mod.checkUpdate();
  ok(fake.calls.setFeedURL.slice(beforeReset).some(c => c.provider === "github"),
     "壳: 备用源全灭后，下一轮从官方源重来（不把小道当默认）");

  // 显式指定源的人不该被悄悄换走（本地验更新、自建源都用这条路）
  const f2 = new FakeUpdater();
  const two = loadUpdate({ autoUpdater: f2 });
  two.mod.initUpdate({ log, isPackaged: true, currentVersion: "0.0.2", feed: "http://127.0.0.1:9/" });
  f2.emit("checking-for-update");
  f2.emit("error", new Error("net::ERR_CONNECTION_REFUSED"));
  ok(f2.calls.setFeedURL.length === 1 && f2.calls.setFeedURL[0].url === "http://127.0.0.1:9/",
     "壳: 显式指定的源是唯一来源（不拿备用源去改它）");

  two.mod.stopUpdate();
  two.restore();

  /* ---- 3b. 备用源链重试必须真走备用源（0.0.9 回归：schedule 重试也走 checkUpdate，
          若开头就被拨回官方源，备用源永远轮不到、永远卡在第一条） ---- */
  {
    const f3 = new FakeUpdater();
    const three = loadUpdate({ autoUpdater: f3 });
    three.mod.initUpdate({ log, isPackaged: true, currentVersion: "0.0.2" });

    const failRound = async () => {
      await three.mod.checkUpdate();
      f3.emit("checking-for-update");
      f3.emit("error", new Error("net::ERR_CONNECTION_RESET"));
      await wait(20);
    };

    await failRound();   // 官方挂 -> 换备用源0
    ok(f3.calls.setFeedURL.some(c => c.provider === "generic"), "壳: 官方失败退到备用源");

    const genericCount = f3.calls.setFeedURL.filter(c => c.provider === "generic").length;
    await failRound();   // 模拟 1.5s 后的重试：真机路径 schedule -> checkUpdate
    ok(!f3.calls.setFeedURL.some((c, i) => i > 0 && c.provider === "github"),
       "壳: 备用源重试不被拨回官方源（0.0.9 回归哨兵）");
    ok(f3.calls.setFeedURL.filter(c => c.provider === "generic").length === genericCount + 1,
       "壳: 重试失败后按顺序推进到下一条备用源");

    three.mod.stopUpdate();
    three.restore();
  }

  mod.stopUpdate();
  restore();
}

/* ---- 4. 校验与下载分离：sha512 与安装包不得来自同一个源 ---- */
{
  const fake = new FakeUpdater();
  const { mod, restore } = loadUpdate({ autoUpdater: fake });
  mod.initUpdate({ log, isPackaged: true, currentVersion: "0.0.2" });

  let r = await fake.getUpdateInfoAndProvider();
  ok(r.info.files[0].url === "liantai-desktop-setup-1.0.1.exe", "壳: 官方源模式不改写安装包地址（同一份 Release）");

  fake.emit("checking-for-update");
  fake.emit("error", new Error("net::ERR_CONNECTION_RESET"));
  await wait(20);

  const st = mod.getStatus();
  r = await fake.getUpdateInfoAndProvider();
  const dlHost = new URL(r.info.files[0].url).host;
  ok(!!st.feedHost && !!st.downloadHost && dlHost === st.downloadHost && dlHost !== st.feedHost,
     "壳: 备用源模式：校验元数据和安装包来自两台不同主机（一个源改不了两边）");
  ok(/liantai-desktop-setup-1\.0\.1\.exe$/.test(r.info.files[0].url), "壳: 分流只改源，不改包名（差量还得认得出同一个包）");
  ok(r.info.files[0].sha512 === "HASH-FROM-META", "壳: 哈希仍取自元数据源（下载源碰不到它）");

  // 元数据里写绝对地址（哪怕别人的域名）也一概拨回我们选的下载源：不让元数据指定去哪下
  fake.info = { version: "1.0.1", files: [{ url: "https://evil.example/payload.exe", sha512: "HASH-FROM-META" }], sha512: "HASH-FROM-META" };
  r = await fake.getUpdateInfoAndProvider();
  ok(new URL(r.info.files[0].url).host === st.downloadHost,
     "壳: 元数据给的绝对下载地址被拨回我们的下载源（不被元数据牵着走）");

  // 显式指定源的人：只有那一个源，既不兜底也不拆
  const f2 = new FakeUpdater();
  const two = loadUpdate({ autoUpdater: f2 });
  two.mod.initUpdate({ log, isPackaged: true, currentVersion: "0.0.2", feed: "http://127.0.0.1:9/" });
  const r2 = await f2.getUpdateInfoAndProvider();
  ok(two.mod.getStatus().downloadHost === "" && r2.info.files[0].url === "liantai-desktop-setup-1.0.1.exe",
     "壳: 显式指定源时不拆分（唯一来源就是那一个）");
  two.mod.stopUpdate();
  two.restore();

  mod.stopUpdate();
  restore();
}

/* ---- 5. 拆不了就不兜底：宁可没有备用源，也不回到「一个源自己给自己签哈希」 ---- */
{
  const fake = new FakeUpdater();
  fake.getUpdateInfoAndProvider = undefined;   // 假装更新组件没有这个钩子（拆不了源）
  const { mod, restore } = loadUpdate({ autoUpdater: fake });
  mod.initUpdate({ log, isPackaged: true, currentVersion: "0.0.2" });

  fake.emit("checking-for-update");
  fake.emit("error", new Error("net::ERR_CONNECTION_RESET"));
  await wait(20);

  const st = mod.getStatus();
  ok(fake.calls.setFeedURL.every((c) => c.provider !== "generic"),
     "壳: 组件不支持源拆分时不退备用源（宁可不兜底，也不自证）");
  ok(st.phase === "error" && /ERR_CONNECTION_RESET/.test(st.error), "壳: 拆不了时直接按失败处理，并留下原因");
  ok(logs.some((l) => l.indexOf("不能把校验与下载拆到两条源上") >= 0), "壳: 为什么不兜底也要写进日志");

  mod.stopUpdate();
  restore();
}

/* ---- 6. macOS 换包链全程（假源 + 临时目录，换包脚本真的跑） ----
   为什么值得写这么重：这条链的最后一步是「把自己换掉再重启」，写错了用户手上就没有应用了。
   所以这里量的是真脚本：真 ditto 解压、真 PlistBuddy 读版本、真两次 mv、真回滚；
   只有两处是假的——pid 换成一个不存在的号（真 pid 会让脚本白等 60 秒），
   open 换成 /bin/echo（真去开一个假 .app 没意义，echo 能证明它被调了、调的是谁）。
   这一组只在 macOS 上跑：它真的调 /usr/bin/ditto 与 /usr/libexec/PlistBuddy，Windows 上没这两个东西。
   漏测吗？不漏——「状态机本身对不对」在第 1b 组已经量过，第 6 组量的是「脚本真跑起来会怎样」。 */
if (process.platform !== "darwin") {
  console.log("  · 跳过第 6 组（mac 换包链真跑）：它要 macOS 的 ditto / PlistBuddy，这个平台没有");
} else {
  const macCase = async (o) => {
    const base = mkdtempSync(join(tmpdir(), "liantai-mac-"));
    const appsDir = join(base, "Applications");
    const target = join(appsDir, "练习台.app");
    const userData = join(base, "userdata");
    mkdirSync(appsDir, { recursive: true });
    const mkApp = (dir, version, marker) => {
      mkdirSync(join(dir, "Contents", "MacOS"), { recursive: true });
      mkdirSync(join(dir, "Contents", "Resources"), { recursive: true });
      writeFileSync(join(dir, "Contents", "Info.plist"),
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.lllvernan.liantai</string>' +
        '<key>CFBundleShortVersionString</key><string>' + version + '</string></dict></plist>\n');
      writeFileSync(join(dir, "Contents", "MacOS", "练习台"), "#!/bin/bash\nexit 0\n");
      writeFileSync(join(dir, "Contents", "Resources", "marker.txt"), marker);
    };
    mkApp(target, o.currentVersion, "old");
    const staging = join(base, "staging", "练习台.app");
    mkApp(staging, o.zipVersion, "new");
    const zipName = "liantai-desktop-" + o.apiVersion + "-" + process.arch + ".zip";
    const zipPath = join(base, "src.zip");
    execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", staging, zipPath]);
    const zipBytes = readFileSync(zipPath);
    const files = { api: null, body: zipPath, bodyPath: "/dl/" + zipName };
    const srv = createServer((req, res) => {
      const u = String(req.url || "").split("?")[0];
      if (u === "/api") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(files.api));
        return;
      }
      if (u === files.bodyPath) {
        const b = readFileSync(files.body);
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": b.length });
        res.end(b);
        return;
      }
      res.writeHead(404);
      res.end("nope");
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    files.api = {
      tag_name: "v" + o.apiVersion,
      assets: [{
        name: zipName,
        size: zipBytes.length,
        digest: "sha256:" + createHash("sha256").update(zipBytes).digest("hex"),
        browser_download_url: (o.evil ? "https://evil.example/payload.zip"
                                     : "http://127.0.0.1:" + port + files.bodyPath),
      }],
    };
    let quitCalled = 0;
    const { mod, restore } = loadUpdate({});
    mod.initUpdate({ log, isPackaged: true, currentVersion: o.currentVersion, platform: "darwin",
                     releasesUrl: "https://example.invalid/releases",
                     userDataDir: userData, exePath: join(target, "Contents", "MacOS", "练习台"),
                     macApi: "http://127.0.0.1:" + port + "/api",
                     macOpenCommand: "/bin/echo", pid: 999999,
                     quit: () => { quitCalled++; } });
    const versionOf = () => {
      try {
        return execFileSync("/usr/libexec/PlistBuddy",
          ["-c", "Print :CFBundleShortVersionString", join(target, "Contents", "Info.plist")],
          { encoding: "utf8" }).trim();
      } catch (err) { return "读不到"; }
    };
    const markerOf = () => {
      try { return readFileSync(join(target, "Contents", "Resources", "marker.txt"), "utf8").trim(); }
      catch (err) { return "读不到"; }
    };
    const clean = () => {
      try { mod.stopUpdate(); } catch (err) { /* 已经停了 */ }
      restore();
      srv.close();
      rmSync(base, { recursive: true, force: true });
    };
    return { base, appsDir, target, userData, zipName, zipPath, zipBytes, mod, clean,
             versionOf, markerOf, quitCount: () => quitCalled };
  };

  /* 6a. 查 -> 下 -> 换 -> 重启，一路正常 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16" });
    await c.mod.checkUpdate();
    ok(c.mod.getStatus().phase === "available" && c.mod.getStatus().latestVersion === "0.0.16",
       "壳/mac: 查到新版 -> available（查完先不下）");
    ok(c.mod.getStatus().autoDownload === false, "壳/mac: 状态里写明「不自动下」，页面才敢把「更新到 vX」当主按钮");
    ok(!existsSync(join(c.userData, "updates", c.zipName)), "壳/mac: 只查不下（要的就是「点一下再拉」）");

    ok(c.mod.downloadUpdate() === true, "壳/mac: 点「更新」才开下");
    await waitFor(() => c.mod.getStatus().phase === "downloaded", 30000);
    const dlPath = join(c.userData, "updates", c.zipName);
    ok(existsSync(dlPath), "壳/mac: 下进 userData/updates（不碰应用本体）");
    ok(existsSync(dlPath) && createHash("sha256").update(readFileSync(dlPath)).digest("hex") ===
       createHash("sha256").update(c.zipBytes).digest("hex"), "壳/mac: 落盘内容与源上逐字节一致");
    ok(c.mod.getStatus().progress && c.mod.getStatus().progress.percent === 100, "壳/mac: 下完进度到 100");

    ok(c.mod.installUpdate() === true, "壳/mac: 下好了才放行换包");
    const logPath = join(c.userData, "updates", "install.log");
    await waitFor(() => existsSync(logPath) && /更新完成/.test(readFileSync(logPath, "utf8")), 30000);
    ok(c.versionOf() === "0.0.16" && c.markerOf() === "new",
       "壳/mac: 换包真的换成了（真解压、真两次 mv，不是「看起来像」）");
    ok(readdirSync(c.appsDir).join(",") === "练习台.app", "壳/mac: 目录里没留下 old.app / 临时目录");
    ok(!existsSync(dlPath), "壳/mac: 换成功就把下好的包删掉（不留垃圾）");
    ok(c.quitCount() === 1, "壳/mac: 脚本交出去之后才请应用退出（顺序反了就是把应用白关一次）");
    const ilog = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    ok(ilog.indexOf(c.target) >= 0, "壳/mac: 换完会重新打开（用 echo 冒充 open，验的是它真被调了、调的是谁）");
    c.clean();
  }

  /* 6b. 包内版本与元数据不符：必须掉头，旧版一个字节都不能动 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.99" });
    await c.mod.checkUpdate();
    ok(c.mod.getStatus().phase === "available", "壳/mac: 元数据说 0.0.16 就算查到");
    c.mod.downloadUpdate();
    await waitFor(() => c.mod.getStatus().phase === "downloaded", 30000);
    c.mod.installUpdate();
    const logPath = join(c.userData, "updates", "install.log");
    await waitFor(() => existsSync(logPath) && /版本不符/.test(readFileSync(logPath, "utf8")), 30000);
    ok(c.versionOf() === "0.0.15" && c.markerOf() === "old",
       "壳/mac: 包内版本不符 -> 放弃并保留旧版（不拿一个来路不明的包装上去）");
    ok(readdirSync(c.appsDir).join(",") === "练习台.app", "壳/mac: 放弃时也不留残骸");
    ok(!existsSync(join(c.userData, "updates", c.zipName)) && existsSync(join(c.userData, "updates", c.zipName + ".bad")),
       "壳/mac: 放弃时把坏包改名成 .bad（留着看，但下次启动不能再被当成「已下好」端给他）");
    ok(readFileSync(logPath, "utf8").indexOf(c.target) >= 0, "壳/mac: 放弃时把旧版重新打开（不能让他手上空着）");
    c.clean();
  }

  /* 6c. 元数据给的地址不在 GitHub 域上：连下都不下，直接在「检查」这步说清 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16", evil: true });
    await c.mod.checkUpdate();
    const st = c.mod.getStatus();
    ok(st.phase === "error" && st.errorStage === "check" && /非 GitHub 主机/.test(st.error),
       "壳/mac: 元数据把下载地址指到别处 -> 拒绝，并说清为什么（不留到下载时才炸）");
    c.clean();
  }

  /* 6d. 应用放在没写权限的目录（比如只读卷）：不许先把应用关掉再失败 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16" });
    await c.mod.checkUpdate();
    c.mod.downloadUpdate();
    await waitFor(() => c.mod.getStatus().phase === "downloaded", 30000);
    chmodSync(c.appsDir, 0o500);
    let refused = false;
    try { refused = c.mod.installUpdate() === false; } finally { chmodSync(c.appsDir, 0o755); }
    ok(refused && /没有权限/.test(c.mod.getStatus().error),
       "壳/mac: 目录不可写就当场拒绝换包（并说清下好的包在哪），不把应用白关一次");
    ok(c.quitCount() === 0, "壳/mac: 拒绝时不许动退出流程");
    c.clean();
  }
}

console.log(T.join("\n"));
const fails = T.filter((x) => x.indexOf("FAIL") === 0);
console.log("\n== 壳侧 " + (T.length - fails.length) + "/" + T.length + " passed ==");
if (fails.length) process.exitCode = 1;
