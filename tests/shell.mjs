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
import { tmpdir, homedir } from "node:os";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const MAC_KEY_TOOL = join(here, "..", "tools", "mac-key.mjs");
/* 签名一律走真工具（tools/mac-key.mjs）：测试里不另写一份格式，
   工具签的与应用验的不是同一串时，这里当场就红。 */
const macKeyTool = (args) => execFileSync(process.execPath, [MAC_KEY_TOOL, ...args], { encoding: "utf8" });
/* 失败路径上文件可能根本没被写出来（那本身就是断言要报的事实）：
   读文件的地方一律用这个，别让测试自己 ENOENT 死掉、把后面的断言全噎住。 */
const readOr = (p, d) => { try { return readFileSync(p, "utf8"); } catch (err) { return d === undefined ? "" : d; } };

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

  /* ---- 3c. 同一次失败的两次回调（2026-10-05 真机实况）：electron-updater 对一次失败既
          emit('error')，又让 checkForUpdates() 的 promise reject，两条路都走进 handleFailure，
          而 id 还是同一个。第二次进来时 phase 已被第一次改成 idle，于是跳过换源分支、把
          backupIndex 拨回 -1 并按 30 分钟重试——schedule 里的 clearTimeout 顺手杀掉了 1.5 秒
          后的换源重试，四条备用源实际只试了第一条（真机日志只出现一次「换备用源取元数据」）。 ---- */
  {
    const f4 = new FakeUpdater();
    const four = loadUpdate({ autoUpdater: f4 });
    four.mod.initUpdate({ log, isPackaged: true, currentVersion: "0.0.2" });

    // 一次检查里，同一条失败的两条路都报上来（中间不该再插 checking-for-update）
    f4.emit("checking-for-update");
    f4.emit("error", new Error("net::ERR_CONNECTION_RESET"));
    f4.emit("error", new Error("net::ERR_CONNECTION_RESET"));

    ok(f4.calls.setFeedURL.filter(c => c.provider === "generic").length === 1,
       "壳: 同一次失败回调两次，只换一次源（不叠加）");
    ok(four.mod.getStatus().phase === "idle" && four.mod.getStatus().error === "",
       "壳: 第二次回调不撤销刚做的换源（不打 error、不等 30 分钟）");

    // 接着模拟 1.5 秒后那次重试：应当推进到下一条备用源，而不是绕回第一条
    const n1 = f4.calls.setFeedURL.length;
    f4.emit("checking-for-update");
    f4.emit("error", new Error("net::ERR_CONNECTION_RESET"));
    ok(f4.calls.setFeedURL.length === n1 + 1 && f4.calls.setFeedURL[n1].url !== f4.calls.setFeedURL[n1 - 1].url,
       "壳: 第二次回调之后，换源链还能继续推进到下一条");

    four.mod.stopUpdate();
    four.restore();
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
    const mkApp = (dir, version, marker, bundleId) => {
      mkdirSync(join(dir, "Contents", "MacOS"), { recursive: true });
      mkdirSync(join(dir, "Contents", "Resources"), { recursive: true });
      writeFileSync(join(dir, "Contents", "Info.plist"),
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>' + (bundleId || "com.lllvernan.liantai") + '</string>' +
        '<key>CFBundleShortVersionString</key><string>' + version + '</string></dict></plist>\n');
      writeFileSync(join(dir, "Contents", "MacOS", "练习台"), "#!/bin/bash\nexit 0\n");
      writeFileSync(join(dir, "Contents", "Resources", "marker.txt"), marker);
    };
    mkApp(target, o.currentVersion, "old", o.targetId);
    const staging = join(base, "staging", "练习台.app");
    mkApp(staging, o.zipVersion, "new", o.newId);
    const zipName = "liantai-desktop-" + o.apiVersion + "-" + process.arch + ".zip";
    /* 文件名就用资产名：签名覆盖的内容里带着资产名（发布时签的就是 dist/ 里那个产物），
       测试这条链也要跟真实发布一致，否则验的是一条真实里走不通的路。 */
    const zipPath = join(base, zipName);
    execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", staging, zipPath]);
    const zipBytes = readFileSync(zipPath);
    /* 私钥现场生成到临时目录，不碰本机那把发布私钥（测试要能反复跑、而且不能需要任何本机秘密） */
    const keyDir = join(base, "keys");
    const keyPath = join(keyDir, "release.pem");
    mkdirSync(keyDir, { recursive: true });
    macKeyTool(["--init", "--key", keyPath]);
    let signKey = keyPath;
    if (o.foreignKey) { signKey = join(keyDir, "other.pem"); macKeyTool(["--init", "--key", signKey]); }
    macKeyTool(["--sign", zipPath, "--key", signKey]);
    const sigText = readFileSync(zipPath + ".sig", "utf8");
    const pubPem = macKeyTool(["--pubkey", "--key", keyPath]).split("\n\n")[0].trim();
    /* o.tamper：源上发的字节与签名时的不一样，且元数据里的 digest 也跟着改了
       （模拟「元数据被改、包也被换」）—— 这时 sha256 那道拦不住，只有签名能拦。 */
    const served = Buffer.from(zipBytes);
    if (o.tamper) served[Math.floor(served.length / 2)] ^= 0xff;
    const files = { api: null, bodyPath: "/dl/" + zipName, sigPath: "/dl/" + zipName + ".sig" };
    let sigHits = 0;
    const srv = createServer((req, res) => {
      const u = String(req.url || "").split("?")[0];
      if (u === "/api") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(files.api));
        return;
      }
      if (u === files.bodyPath) {
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": served.length });
        res.end(served);
        return;
      }
      if (u === files.sigPath) {
        sigHits++;
        const b = Buffer.from(sigText, "utf8");
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": b.length });
        res.end(b);
        return;
      }
      res.writeHead(404);
      res.end("nope");
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    const assets = [{
      name: zipName,
      size: served.length,
      digest: "sha256:" + createHash("sha256").update(served).digest("hex"),
      browser_download_url: (o.evil ? "https://evil.example/payload.zip"
                                   : "http://127.0.0.1:" + port + files.bodyPath),
    }];
    if (!o.noSig) {
      assets.push({ name: zipName + ".sig", size: Buffer.byteLength(sigText),
                    browser_download_url: "http://127.0.0.1:" + port + files.sigPath });
    }
    files.api = { tag_name: "v" + o.apiVersion, assets: assets };
    if (o.asList) files.api = [
      { tag_name: "v0.0.99-draft", draft: true, assets: [] },   // draft：跳过不看
      { tag_name: "v" + o.apiVersion, prerelease: true, assets: files.api.assets },
    ];
    let quitCalled = 0;
    const { mod, restore } = loadUpdate({});
    mod.initUpdate({ log, isPackaged: true, currentVersion: o.currentVersion, platform: "darwin",
                     releasesUrl: "https://example.invalid/releases",
                     userDataDir: userData, exePath: join(target, "Contents", "MacOS", "练习台"),
                     macApi: "http://127.0.0.1:" + port + "/api",
                     macPublicKeys: o.pubKeys === undefined ? [pubPem] : o.pubKeys,
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
    return { base, appsDir, target, userData, zipName, zipPath, zipBytes, mod, clean, keyPath, pubPem,
             versionOf, markerOf, sigHits: () => sigHits, quitCount: () => quitCalled };
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
    ok(c.sigHits() === 1, "壳/mac: 下完包去取了签名（校验这一步真的发生了，不是写在文档里）");

    ok(c.mod.installUpdate() === true, "壳/mac: 下好了才放行换包");
    const logPath = join(c.userData, "updates", "install.log");
    await waitFor(() => /更新完成/.test(readOr(logPath)), 30000);
    ok(/更新完成/.test(readOr(logPath)), "壳/mac: 换包脚本真跑完了（日志里写着「更新完成」）"
       + (readOr(logPath) ? "" : "（日志都没有：换包脚本可能没起来 —— " + JSON.stringify(c.mod.getStatus()) + "）"));
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
    await waitFor(() => /版本不符/.test(readOr(logPath)), 30000);
    ok(/版本不符/.test(readOr(logPath)), "壳/mac: 包内版本不符会写进日志"
       + (readOr(logPath) ? "" : "（日志都没有：换包脚本可能没起来 —— " + JSON.stringify(c.mod.getStatus()) + "）"));
    ok(c.versionOf() === "0.0.15" && c.markerOf() === "old",
       "壳/mac: 包内版本不符 -> 放弃并保留旧版（不拿一个来路不明的包装上去）");
    ok(readdirSync(c.appsDir).join(",") === "练习台.app", "壳/mac: 放弃时也不留残骸");
    ok(!existsSync(join(c.userData, "updates", c.zipName)) && existsSync(join(c.userData, "updates", c.zipName + ".bad")),
       "壳/mac: 放弃时把坏包改名成 .bad（留着看，但下次启动不能再被当成「已下好」端给他）");
    ok(readOr(logPath).indexOf(c.target) >= 0, "壳/mac: 放弃时把旧版重新打开（不能让他手上空着）");
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

  /* 6e. prerelease 也要能被 mac 链看见：mac 常发 prerelease，它不占 /releases/latest，
      查列表才找得到；列表响应（数组）与单对象都要认 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16", asList: true });
    await c.mod.checkUpdate();
    ok(c.mod.getStatus().phase === "available" && c.mod.getStatus().latestVersion === "0.0.16",
       "壳/mac: prerelease 在列也能查到（mac 链按版本号说话，不依赖 /releases/latest）");
    c.clean();
  }

  /* 6f. 源上发的字节与签名对不上：连元数据里的 digest 都一起改了（模拟「发布页被换掉」）——
      这时 sha256 那道必然通过，能拦下来的只有签名。这是这一整套东西存在的理由。 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16", tamper: true });
    await c.mod.checkUpdate();
    ok(c.mod.getStatus().phase === "available", "壳/mac: 元数据被改过也先当成「有新版」（该拦的在下载那步）");
    c.mod.downloadUpdate();
    await waitFor(() => c.mod.getStatus().phase === "error", 30000);
    const st = c.mod.getStatus();
    ok(st.errorStage === "download" && /签名验不过/.test(st.error),
       "壳/mac: 包与签名对不上 -> 拒收，并说清是哪一步拦下的");
    const dl = join(c.userData, "updates", c.zipName);
    ok(!existsSync(dl) && !existsSync(dl + ".part"),
       "壳/mac: 验不过的包一个字节都不留（不分「下好了」与「下了一半」）");
    c.clean();
  }

  /* 6g. 签名用了别的私钥（不是钉在包里的那把）：一样拒收 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16", foreignKey: true });
    await c.mod.checkUpdate();
    c.mod.downloadUpdate();
    await waitFor(() => c.mod.getStatus().phase === "error", 30000);
    ok(/签名验不过/.test(c.mod.getStatus().error),
       "壳/mac: 只有钉在包里的那把公钥算数（别人自己签一份没用）");
    c.clean();
  }

  /* 6h. 这一版根本没带签名：在「检查」这步就拒，不下 100MB 才发现 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16", noSig: true });
    await c.mod.checkUpdate();
    const st = c.mod.getStatus();
    ok(st.phase === "error" && st.errorStage === "check" && /没有签名文件/.test(st.error),
       "壳/mac: 没签过名的版本直接拒收（发布时漏签就是这个后果，宁可先不更新）");
    ok(!existsSync(join(c.userData, "updates", c.zipName)), "壳/mac: 拒收时不下包");
    c.clean();
  }

  /* 6i. 包里一把可用公钥都没有（例如公钥被改坏了）：同样拒收 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16", pubKeys: [] });
    await c.mod.checkUpdate();
    const st = c.mod.getStatus();
    ok(st.phase === "error" && /没有可用的签名公钥/.test(st.error),
       "壳/mac: 验不了就拒收（「有条件校验」等于没校验）");
    c.clean();
  }

  /* 6j. 包里的 .app 版本号写对了、标识不是练习台：脚本也要拦住 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16", newId: "com.example.other" });
    await c.mod.checkUpdate();
    c.mod.downloadUpdate();
    await waitFor(() => c.mod.getStatus().phase === "downloaded", 30000);
    c.mod.installUpdate();
    const logPath = join(c.userData, "updates", "install.log");
    await waitFor(() => /标识不是练习台/.test(readOr(logPath)), 30000);
    ok(/标识不是练习台/.test(readOr(logPath)), "壳/mac: 包内标识不符会写进日志"
       + (readOr(logPath) ? "" : "（日志都没有：换包脚本可能没起来 —— " + JSON.stringify(c.mod.getStatus()) + "）"));
    ok(c.versionOf() === "0.0.15" && c.markerOf() === "old",
       "壳/mac: 包内标识不是练习台（光版本号对不算）-> 放弃，旧版一个字节不动");
    ok(readdirSync(c.appsDir).join(",") === "练习台.app", "壳/mac: 放弃时也不留残骸（暂存名/旧包名都清掉）");
    c.clean();
  }

  /* 6k. 当前跑着的这个 .app 标识不是练习台（应用被塞进了别的包里的情形）：
      不许把不相干的目录当成自己的应用本体去替换 */
  {
    const c = await macCase({ currentVersion: "0.0.15", apiVersion: "0.0.16", zipVersion: "0.0.16", targetId: "com.example.other" });
    await c.mod.checkUpdate();
    c.mod.downloadUpdate();
    await waitFor(() => c.mod.getStatus().phase === "downloaded", 30000);
    const refused = c.mod.installUpdate() === false;
    ok(refused && /不是练习台/.test(c.mod.getStatus().error),
       "壳/mac: 找到的 .app 标识对不上 -> 拒绝换包并说清（不拿一个来路不明的目录开刀）");
    ok(c.quitCount() === 0 && c.versionOf() === "0.0.15", "壳/mac: 拒绝时不许动退出流程，也不许动旧版");
    c.clean();
  }
}

/* ---- 8. 钉在包里的公钥与本机发布私钥是不是同一把 ----
   这一条防的是「签的时候用 A、钉进去的是 B」：真机上表现为每一版都被自己的应用拒收，
   而两边的日志都只会说「签名验不过」，很难往这儿想。本机没那把私钥就跳过（别的机器上跑测试不该要它）。 */
{
  const src = readFileSync(join(here, "..", "update.js"), "utf8");
  const m = /const MAC_UPDATE_KEYS = \[([\s\S]*?)\n\];/.exec(src);
  const pinned = m ? (m[1].match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/) || [""])[0] : "";
  ok(pinned.indexOf("BEGIN PUBLIC KEY") > 0, "壳/签名: update.js 里钉着一把公钥（一把都没有 = 更新链自己把自己锁死）");
  const keyFile = join(homedir(), ".liantai-release-key");
  if (!existsSync(keyFile)) {
    console.log("  · 跳过「钉的公钥 = 本机发布私钥」：本机没有 " + keyFile);
  } else {
    const out = execFileSync(process.execPath, [MAC_KEY_TOOL, "--pubkey"], { encoding: "utf8" });
    const localPub = out.split("\n\n")[0].trim();
    ok(localPub === pinned, "壳/签名: update.js 钉的公钥 = 本机发布私钥对应的公钥（签的和验的不是同一把，每版都会被自己拒收）");
  }
}

/* ---- 7. 差量对照数据自检：blockmap 与当前安装包不是同一版时重置 ----
      两个缓存文件由两个程序写（installer.exe 是 NSIS 写的当前版本安装包，current.blockmap
      是 electron-updater 写的那次下载的对照数据），手动装过一次就会错位。错位时差量会
      拿旧版的对照数据去量新版安装包，拼出来的文件校验不过，白下一趟再从头全量下。 */
{
  const dir = mkdtempSync(join(tmpdir(), "liantai-bm-"));
  const bmPath = join(dir, "current.blockmap");
  const insPath = join(dir, "installer.exe");
  const writeBm = (sizes) => writeFileSync(bmPath, gzipSync(JSON.stringify({
    version: "2", files: [{ name: "file", offset: 0, sizes, checksums: sizes.map(() => "x") }],
  })));
  const { mod, restore } = loadUpdate({ autoUpdater: new FakeUpdater() });

  writeFileSync(insPath, Buffer.alloc(30));
  writeBm([10, 20]);
  ok(mod.alignDifferentialCache(dir) === false && existsSync(bmPath),
     "壳: 对照数据与安装包同一版 -> 不动它（差量照走）");
  writeBm([10, 15]);
  ok(mod.alignDifferentialCache(dir) === true && !existsSync(bmPath),
     "壳: 对照数据停在上一个版本 -> 重置，不拿错尺子去量安装包");
  writeBm([10, 20]);
  rmSync(insPath);
  ok(mod.alignDifferentialCache(dir) === false && existsSync(bmPath),
     "壳: 没有安装包可比 -> 不硬删（缺了对照数据差量本来也走不了）");
  writeFileSync(bmPath, "not a gzip");
  ok(mod.alignDifferentialCache(dir) === false && existsSync(bmPath),
     "壳: 对照数据读不懂 -> 当没事发生，不删");
  rmSync(dir, { recursive: true, force: true });
  restore();
}

/* ---- shell-policy：导航白名单 / Host / Origin / CSP 四条都能纯代码验（偏偏这四条以前一条都没被测） ---- */
{
  const policy = require(join(here, "..", "shell-policy.js"));
  const P = 18743;
  const own = policy.ownOrigin(P);

  ok(own === "http://127.0.0.1:18743", "壳/导航: 本源就是 127.0.0.1 + 当前端口 -> " + own);
  ok(policy.isOwnUrl(own + "/index.html", P) && policy.isOwnUrl(own, P)
     && policy.isOwnUrl(own + "/?v=1", P) && policy.isOwnUrl(own + "/#x", P),
     "壳/导航: 本源下的页面 / 根 / 带查询 / 带锚点都放行");
  ok(!policy.isOwnUrl("http://127.0.0.1:18744/index.html", P),
     "壳/导航: 同一个 127.0.0.1 上的**别的端口**不放行（那是别的服务）");
  ok(!policy.isOwnUrl("http://127.0.0.1:187431/index.html", P),
     "壳/导航: 端口只多一位（187431）也不算自家——按源比，不按字符串前缀比");
  ok(!policy.isOwnUrl("https://example.com/", P) && !policy.isOwnUrl("blob:http://127.0.0.1:18743/x", P)
     && !policy.isOwnUrl(undefined, P),
     "壳/导航: 外站 / blob / 非字符串一律不放行");

  ok(policy.hostAllowed("127.0.0.1:18743", P), "壳/Host: 本源自己的 Host 放行");
  /* DNS rebinding 的典型形态：攻击者的域名解析到 127.0.0.1，Host 写着他的域名 */
  ok(!policy.hostAllowed("evil.example.com:18743", P) && !policy.hostAllowed("evil.example.com", P)
     && !policy.hostAllowed(undefined, P) && !policy.hostAllowed("127.0.0.1:18744", P),
     "壳/Host: 外域域名 / 缺 Host / 别的端口一律拒（rebinding 下 Host 比 Origin 靠得住）");

  ok(policy.originAllowed(undefined, P) && policy.originAllowed(own, P),
     "壳/Origin: 不带 Origin 放行（页面 fetch 同源 GET 本来就不发 Origin），与本源相同也放行");
  ok(!policy.originAllowed("http://evil.example.com", P) && !policy.originAllowed("http://127.0.0.1:18744", P),
     "壳/Origin: 别的域 / 别的端口一律拒");

  const csp = policy.cspFor("NONCE");
  ok(csp.indexOf("default-src 'none'") >= 0 && csp.indexOf("object-src 'none'") >= 0
     && csp.indexOf("frame-ancestors 'none'") >= 0 && csp.indexOf("base-uri 'none'") >= 0,
     "壳/CSP: 默认全禁（default/object/frame-ancestors/base-uri）");
  ok(csp.indexOf("script-src 'nonce-NONCE'") >= 0 && csp.indexOf("'unsafe-eval'") < 0
     && csp.indexOf("script-src 'self'") < 0,
     "壳/CSP: 脚本只认 nonce——不给 unsafe-eval，也不给 self（没有外部脚本要加载）");
  ok(csp.indexOf("style-src 'self' 'unsafe-inline'") >= 0,
     "壳/CSP: 样式留 unsafe-inline（界面大量用 style=\"…\" 属性现算现写）");
  ok(csp.indexOf("connect-src 'self' https: http:") >= 0,
     "壳/CSP: 外部请求只开 https 与本机明文（接口地址是自由填的，有人指着本地代理）");
  ok(policy.cspForInlineFallback().indexOf("script-src 'self' 'unsafe-inline'") >= 0,
     "壳/CSP: 内联脚本认不出来时的退路是 unsafe-inline（宁可松一格，不能白屏）");

  const html = "<!doctype html><style>a</style><script>var x=1;</script>";
  const inj = policy.injectNonce(html, "NONCE");
  ok(inj.injected && inj.html.indexOf('<script nonce="NONCE">var x=1;</script>') >= 0
     && inj.html.indexOf("<style>a</style>") >= 0 && inj.tags === 1,
     "壳/CSP: 下发时给内联 <script> 打上本次 nonce，样式与正文一字不动");
  const noTag = policy.injectNonce("<p>没有脚本</p>", "NONCE");
  ok(noTag.injected === false && noTag.html === "<p>没有脚本</p>",
     "壳/CSP: 找不到 <script> 就如实回报 injected:false（不假装打上了）");

  /* 策略文件写了不等于接上了：主进程里三处引用各钉一颗锚 */
  const mainSrc = readFileSync(join(here, "..", "main.js"), "utf8");
  ok(mainSrc.indexOf("policy.hostAllowed(req.headers.host") >= 0
     && mainSrc.indexOf("policy.isOwnUrl(url, serverPort)") >= 0
     && mainSrc.indexOf("policy.originAllowed(req.headers.origin") >= 0,
     "壳: 三条判断都真接在了请求与导航上（写到策略文件里不等于生效）");
  ok(mainSrc.indexOf("'Content-Security-Policy': ") >= 0 && mainSrc.indexOf("policy.injectNonce(") >= 0,
     "壳: HTML 响应带 CSP 头，并给内联脚本打了 nonce");
  ok(!/indexOf\('http:\/\/' \+ HOST \+ ':'\)/.test(mainSrc),
     "壳: 不再有「任何 127.0.0.1 端口都放行」的前缀判法");

  /* 主进程 require 的仓内模块必须在 build.files 里：漏一个，包里的 main.js 就 require 不到——
     本地源码直跑一切正常，装上才知道。（electron-builder 只拿 files 列的东西，不是整个仓库。） */
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  const listed = (pkg.build && pkg.build.files) || [];
  const required = Array.from(mainSrc.matchAll(/require\('\.\/([\w.-]+\.js)'\)/g)).map((m) => m[1]);
  const notPacked = required.filter((f) => listed.indexOf(f) < 0);
  ok(required.length >= 2 && notPacked.length === 0,
     "壳: main.js 引的仓内模块都在 package.json 的 build.files 里 -> " + required.join("、")
     + (notPacked.length ? "（缺：" + notPacked.join("、") + "）" : ""));
}

/* ---- 9. 应用身份 / 仓库位置的单一真源：app-meta.js 与 package.json 必须一致 ----
   运行期读不到 package.json 的 `build` 段（打包时被 electron-builder 剥掉，实测 app.asar 里没有
   `build` / `appId`），所以常量写在 app-meta.js；package.json 那份是给 electron-builder 上传用的。
   两边漂移的后果是「包传到 A、客户端去 B 找」——链条上没有任何一步会报错，只是永远没更新。 */
{
  const APP = require(join(here, "..", "app-meta.js"));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  const pub = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};
  ok(APP.name === pkg.name, "壳/身份: app-meta.name = package.json.name（userData 目录名与产物名前缀按它来）");
  ok(APP.appId === (pkg.build && pkg.build.appId), "壳/身份: app-meta.appId = package.json.build.appId（换包时核的就是这个标识）");
  ok(APP.owner === pub.owner && APP.repo === pub.repo,
     "壳/身份: app-meta.owner/repo = package.json.build.publish（对不上就是「传到 A、客户端去 B 找」）");
  ok(APP.slug === pub.owner + "/" + pub.repo && APP.releasesUrl.indexOf(APP.slug) > 0 && APP.apiReleases.indexOf(APP.slug) > 0,
     "壳/身份: slug / releasesUrl / apiReleases 都由 owner+repo 推出来，不另写一份");
  const carries = ["main.js", "update.js", "tools/release.mjs", "tools/release-mac.mjs", "tools/gate.mjs",
                   "tools/release-check.mjs", "tools/push-via-api.mjs", "app-meta.js"]
    .filter((f) => readFileSync(join(here, "..", f), "utf8").indexOf(APP.slug) >= 0);
  ok(carries.length === 0,
     "壳/身份: 仓内代码里没有第二处写死仓库名（owner/repo 只在 app-meta.js，slug 由它推出）"
     + (carries.length ? "；还写着：" + carries.join("、") : ""));
}

/* mac 发布脚本「先核对清单再打包」的顺序问题：
   打包前无条件核 latest-mac.yml，会把「dist/ 空着」和「dist/ 里是上一版」两种正常起手式
   一并卡死——而这两件事本来都该由即将开始的打包自己处理。核对只应发生在「用手头产物」的路径上。 */
{
  const rm = readOr(join(here, "..", "tools", "release-mac.mjs"));
  ok(/step\("检查本地产物与清单"\);[\s\S]{0,400}?if \(skipBuild\) checkYml\(\)/.test(rm),
     "发布: release-mac 打包前不核对清单（只在 skip-build / dry-run 时核）");
  ok(/if \(!skipBuild\)[\s\S]{0,900}?checkYml\(\);[\s\S]{0,80}?\/\/ 刚出的包再核一遍/.test(rm),
     "发布: release-mac 出包之后补核一次清单（这次核的才是真要传的东西）");
  /* blockmap 是打包生成的、.sig 是签出来的，打包前算的清单里两样都没有。
     拿那份去上传，Release 就会少 blockmap 而 release-check 报「macOS 缺 2 项」。 */
  ok(/let want = wantedAssets\(\);/.test(rm),
     "发布: 打包前那份资产清单是可重算的（let，不是 const）");
  ok(/signAssets\(\);[\s\S]{0,500}?want = wantedAssets\(\);/.test(rm),
     "发布: 签完名重算资产清单（blockmap 与 .sig 到这才齐，不然会漏传）");
}

/* 测试副本（tools/build-test.mjs）：与正式版并存、数据分家的那一只 app。
   三处都不能松——userData 没切开就等于拿真数据当试验场；更新链没摘掉，自动更新会把
   测试版顶成正式版；端口撞上则让 localStorage 分区漂走，测的东西不算数。 */
{
  const mainSrc = readFileSync(join(here, "..", "main.js"), "utf8");
  const bt = readOr(join(here, "..", "tools", "build-test.mjs"));

  ok(/const IS_TEST = fs\.existsSync\([\s\S]{0,200}?build-test\.json/.test(mainSrc),
     "测试副本: 壳在最早期认 app/build-test.json 这个标记");
  /* 与 load() 的 TDZ 同一类：路径一旦取过就改不回来，setPath 必须排在第一次 getPath 之前。 */
  const iSet = mainSrc.indexOf("app.setPath('userData'");
  const iLog = mainSrc.indexOf("const LOG_DIR =");
  ok(iSet > 0 && iLog > 0 && iSet < iLog,
     "测试副本: setPath('userData') 排在 LOG_DIR 之前（取过路径就改不动了）");
  ok(/PREFERRED_PORT = IS_TEST \? 18744 : 18743/.test(mainSrc),
     "测试副本: 端口与正式版分开（localStorage 按 origin 分区，撞上就换一套空存储）");
  ok(/if \(IS_TEST\) \{ log\('update-skipped'[\s\S]{0,80}?return; \}/.test(mainSrc),
     "测试副本: 不接更新链（否则自动更新把自己顶成正式版）");

  ok(/appId: pkg\.build\.appId \+ "\.test"/.test(bt) && /publish: null/.test(bt),
     "测试副本: 打包配置换独立 appId、不写发布源");
  ok(/rmSync\(FLAG, \{ force: true \}\)/.test(bt),
     "测试副本: 打完撤掉标记（留着会让下一次正式包也变成测试版）");
}

/* 材料池的通道（preload.js + main.js）：界面是沙箱，拿不到 fs，池子只能从这三个只读口子进。
   守两件事：开的口子不能多，名字不能用来越出池子目录。 */
{
  const pre = readOr(join(here, "..", "preload.js"));
  const mainJs = readOr(join(here, "..", "main.js"));
  const exposed = Array.from(pre.matchAll(/exposeInMainWorld\(\s*"([^"]+)"\s*,\s*\{([\s\S]*)\n\}\);/g));
  ok(exposed.length === 1 && exposed[0][1] === "liantai",
     "材料池: preload 只往 window.liantai 上挂东西（别的全局名不占）");
  const names = exposed.length ? Array.from(exposed[0][2].matchAll(/(\w+)\s*:\s*\(/g)).map(m => m[1]) : [];
  ok(names.length === 3 && ["poolPick","poolList","poolStat"].every(n => names.indexOf(n) >= 0),
     "材料池: 只开三个口子（取一篇 / 列池子 / 数数量），不开通用 fs（当前 " + names.join("/") + "）");
  // 只允许 require("electron")：不写 require("fs") 之类，注释里提到 fs 不算
  const reqs = Array.from(pre.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)).map(m => m[1]);
  ok(reqs.length === 1 && reqs[0] === "electron",
     "材料池: preload 只 require electron（沙箱里本来也 require 不到别的，当前 " + reqs.join("/") + "）");

  ok(/const PRELOAD = path\.join\(__dirname, 'preload\.js'\)/.test(mainJs) && /preload: PRELOAD/.test(mainJs),
     "材料池: 窗口真的挂上了 preload（写好了不挂等于没写）");
  ok(/sandbox: true/.test(mainJs) && /contextIsolation: true/.test(mainJs) && /nodeIntegration: false/.test(mainJs),
     "材料池: 沙箱三条没被为了开通道而放开（页面依旧拿不到 Node）");
  // 路径校验：只认文件名本身，挡掉 ../ 与绝对路径
  ok(/s !== path\.basename\(s\)/.test(mainJs) && /\[.\]md\$/.test(mainJs),
     "材料池: 文件名只认 basename，挡掉 ../ 与绝对路径");
  ok(/if \(!all\.length\) return null;/.test(mainJs),
     "材料池: 池子真的空才返回 null（由界面回落编材料，不是报错）；都用过时怎么办见「取材次序」");
}

/* 材料同步（update.js 的「材料同步」）：池子与版本发布解耦，启动后从 materials Release 拉一份。
   守三件事：①验签——不认来路不明的材料（它要进 prompt 影响出题）；②拒收畸形的包；
   ③拉不到不影响使用。手法与 mac 换包链一样：起一个回环假源，真签名、真下载、真验。 */
{
  const PASS_NAME = "liantai-materials.json";
  const keyDir0 = mkdtempSync(join(tmpdir(), "liantai-matkey-"));
  const keyPath0 = join(keyDir0, "k.pem");
  macKeyTool(["--init", "--key", keyPath0]);
  const otherPath0 = join(keyDir0, "other.pem");
  macKeyTool(["--init", "--key", otherPath0]);
  const pubPem0 = macKeyTool(["--pubkey", "--key", keyPath0]).split("\n\n")[0].trim();

  /* 拿真工具签：测试里不另写一份格式。工具签的与应用验的不是同一串时，这里当场就红。
     文件名必须是资产名本身——签名覆盖的是「sha256 + 资产名」。 */
  const signPack = (dir, packText, keyFile) => {
    const p = join(dir, PASS_NAME);
    writeFileSync(p, packText, "utf8");
    macKeyTool(["--sign", p, "--key", keyFile]);
    return readFileSync(p + ".sig", "utf8");
  };
  const packTextOf = (items) => JSON.stringify({ v: 1, at: "2026-10-15T00:00:00Z", git: "abc123", count: items.length, items: items });
  /* 默认这一轮：发布侧 3 篇、随包 2 篇——发布侧比随包多才叫更新（比随包少的那一路另有断言） */
  const oneItem = [1, 2, 3].map((i) => ({ name: "p" + i + ".md", text: "# 甲材料" + i + "\n主题：基层治理\n\n## 背景\n- 一条真事。\n" }));

  /* 一轮同步：先随包播种，再从假源拉。返回池子里最终有哪些文件。 */
  async function matRound(o) {
    const base = mkdtempSync(join(tmpdir(), "liantai-mat-"));
    const userData = join(base, "ud");
    const appDir = join(base, "app");
    mkdirSync(join(appDir, "materials", "pool"), { recursive: true });
    writeFileSync(join(appDir, "materials", "pool", "seed-a.md"), "# 兜底甲\n主题：基层治理\n", "utf8");
    writeFileSync(join(appDir, "materials", "pool", "seed-b.md"), "# 兜底乙\n主题：生态环保\n", "utf8");
    for (let i = 0; i < (o.bundleExtra || 0); i++) writeFileSync(join(appDir, "materials", "pool", "seed-x" + i + ".md"), "# 兜底丙" + i + "\n", "utf8");
    mkdirSync(userData, { recursive: true });

    const packText = packTextOf(o.items || oneItem);
    const sigText = signPack(base, packText, o.foreignKey ? otherPath0 : keyPath0);
    const served = o.tamper ? packText + " " : packText;
    const sigBody = o.bigSig ? "A".repeat(9 * 1024) : sigText;
    let apiHits = 0;
    let port = 0;
    const srv = createServer((req, res) => {
      const u = String(req.url || "").split("?")[0];
      if (u === "/api") {
        apiHits++;
        if (o.apiBroken) { res.writeHead(500); res.end("nope"); return; }
        const assets = [{ name: PASS_NAME, size: Buffer.byteLength(served),
                          browser_download_url: "http://127.0.0.1:" + port + "/dl/" + PASS_NAME }];
        if (!o.noSig) assets.push({ name: PASS_NAME + ".sig", size: Buffer.byteLength(sigBody),
                                    browser_download_url: "http://127.0.0.1:" + port + "/dl/" + PASS_NAME + ".sig" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ tag_name: "materials", prerelease: true, assets: assets }));
        return;
      }
      if (u === "/dl/" + PASS_NAME) {
        const b = Buffer.from(served, "utf8");
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": b.length });
        res.end(b);
        return;
      }
      if (u === "/dl/" + PASS_NAME + ".sig") { res.writeHead(200); res.end(sigBody); return; }
      res.writeHead(404); res.end("nope");
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    port = srv.address().port;

    const { mod, restore } = loadUpdate({});
    const seen = [];
    const init = mod.initMaterials({ userDataDir: userData, appDir: appDir,
      api: "http://127.0.0.1:" + port + "/api", publicKeys: o.pubKeys === undefined ? [pubPem0] : o.pubKeys,
      log: (e, d) => seen.push(e + (d === undefined ? "" : " :: " + d)) });
    await mod.matSyncNow();
    const twice = await mod.matSyncNow();       // 再来一次：12 小时内不该反复拉
    let files = [];
    try { files = readdirSync(join(userData, "材料池")).filter((f) => /[.]md$/.test(f)).sort(); } catch (err) { files = []; }
    const parts = [];
    try { parts = readdirSync(join(userData, "材料池")).filter((f) => /[.]part$/.test(f)); } catch (err) {}
    const marker = readOr(join(userData, "materials-sync.json"), "");
    const st = mod.materialsStatus();
    restore();
    srv.close();
    rmSync(base, { recursive: true, force: true });
    return { files, parts, marker, seen, init, apiHits, twice, st, err: st.lastError };
  }

  const seeded = await matRound({});
  ok(seeded.init && seeded.init.seeded === 2,
     "材料同步: 首次运行把随包的兜底播下去（池子本来空，当前播了 " + (seeded.init && seeded.init.seeded) + " 篇）");
  ok(seeded.files.join(",") === "p1.md,p2.md,p3.md",
     "材料同步: 拉下来的一轮里，包里有的写上、包里没有的不留（拉前 seed-a/seed-b，拉后 " + seeded.files.join("/") + "）");
  ok(!seeded.parts.length, "材料同步: 落盘不留 .part 半成品（写临时名再改名，读到的一篇总是完整的）");
  ok(seeded.seen.some((x) => x.indexOf("materials-sync :: ") === 0),
     "材料同步: 成功时留一行可说清的记（当前 " + (seeded.seen.find((x) => x.indexOf("materials-sync") === 0) || "无") + "）");
  ok(seeded.marker.indexOf("\"git\":\"abc123\"") >= 0, "材料同步: 写下发的是哪个提交的材料（可追溯）");
  ok(seeded.apiHits === 1 && seeded.twice === null,
     "材料同步: 12 小时内不反复拉（这一轮问了 " + seeded.apiHits + " 次，第二次直接跳过）");

  /* 验签：包被换过（这里用另一把私钥签）就整包拒收，池子纹丝不动。 */
  const foreign = await matRound({ foreignKey: true });
  ok(foreign.files.join(",") === "seed-a.md,seed-b.md" && /签名验不过/.test(foreign.err),
     "材料同步: 签名不是发布侧的——整包拒收，本机池子不动（当前 " + foreign.files.join("/") + "，原因：" + foreign.err + "）");
  ok(foreign.marker.indexOf('"at"') < 0,
     "材料同步: 拒收时不记「已经同步过」（免得下次误以为拿到新的；播种时记的那笔不算）");

  /* 包被改过一个字节（签名没跟着改）：同样拦在验签这一步 */
  const tampered = await matRound({ tamper: true });
  ok(tampered.files.join(",") === "seed-a.md,seed-b.md" && /签名验不过/.test(tampered.err),
     "材料同步: 下载途中被改过的包收不下（签名覆盖了整包哈希）");

  ok((await matRound({ noSig: true })).err.indexOf("没有签名文件") >= 0,
     "材料同步: Release 里没有签名文件就不收（宁可不更新，也不收一份无从校验的材料）");
  ok((await matRound({ pubKeys: [] })).err.indexOf("没有可用的签名公钥") >= 0,
     "材料同步: 本机一把公钥都没有时拒收，不是「验不了就先收下」");
  ok((await matRound({ bigSig: true })).err.indexOf("超过") >= 0,
     "材料同步: 签名文件尺寸有上限（没有它，一个畸形响应能把内存吃干）");

  const badName = await matRound({ items: [{ name: "../escape.md", text: "# 甲\n" }] });
  ok(badName.files.join(",") === "seed-a.md,seed-b.md" && /文件名不合法/.test(badName.err),
     "材料同步: 包里的文件名要是一个裸文件名（挡掉 ../ 与绝对路径，当前 " + badName.err + "）");
  ok((await matRound({ items: [{ name: "a.md", text: "# x\n" }, { name: "a.md", text: "# y\n" }] })).err.indexOf("重名") >= 0,
     "材料同步: 包里重名拒收（后者静默盖前者会让池子与包对不上）");
  ok((await matRound({ items: [{ name: "a.md", text: "   " }] })).err.indexOf("内容是空的") >= 0,
     "材料同步: 空内容的条目拒收（一篇空骨架拿去出题只会浪费一次调用）");
  ok((await matRound({ items: [] })).err.indexOf("没有材料") >= 0,
     "材料同步: 空包拒收（发一个空包不等于「清空池子」）");

  /* 拉不到不影响使用：源挂了就安静地算了，池子用随包兜底 */
  const down = await matRound({ apiBroken: true });
  ok(down.files.join(",") === "seed-a.md,seed-b.md" && down.seen.some((x) => x.indexOf("materials-sync-fail") === 0),
     "材料同步: 源挂了也是没声——池子用随包兜底（当前 " + down.files.join("/") + "）");
  ok(!down.st.running, "材料同步: 失败后不卡在「正在拉」上，下轮还会自己重试");

  /* 随包兜底只在池子空的时候播：不能把已经同步下来的新池子盖回去 */
  const base2 = mkdtempSync(join(tmpdir(), "liantai-mat2-"));
  mkdirSync(join(base2, "app", "materials", "pool"), { recursive: true });
  writeFileSync(join(base2, "app", "materials", "pool", "seed-a.md"), "# 兜底甲\n", "utf8");
  mkdirSync(join(base2, "ud", "材料池"), { recursive: true });
  writeFileSync(join(base2, "ud", "材料池", "live.md"), "# 同步下来的\n", "utf8");
  const { mod: mod2, restore: restore2 } = loadUpdate({});
  const init2 = mod2.initMaterials({ userDataDir: join(base2, "ud"), appDir: join(base2, "app"), api: "http://127.0.0.1:9/api" });
  restore2();
  ok(init2.seeded === 0 && readdirSync(join(base2, "ud", "材料池")).join(",") === "live.md",
     "材料同步: 池子已经有东西就不播种（旧兜底把新同步的盖回去就荒唐了）");
  /* 防回退：改了池子但还没重发材料包时，发布侧那份会比随包的还少——
     同步默认是镜像（包里没的就删），那一下就是把刚装好的池子换小了。 */
  const older = await matRound({ bundleExtra: 3 });
  ok(older.files.length === 5 && older.seen.some((x) => x.indexOf("materials-sync-older") === 0),
     "材料同步: 发布侧那份比随包的还少就不动本机池子（当前剩 " + older.files.length + " 篇）");

  rmSync(base2, { recursive: true, force: true });
  rmSync(keyDir0, { recursive: true, force: true });

  /* 随包兜底要真的进得了包，也要真的被播下去——两边缺一样，断网用户的池子就是空的。 */
  const pkg = JSON.parse(readOr(join(here, "..", "package.json"), "{}"));
  const buildFiles = ((pkg.build || {}).files) || [];
  ok(buildFiles.indexOf("materials/pool/**/*") >= 0,
     "材料同步: 打包清单里带上了随包兜底（否则装完包里没有 materials/pool，断网就是空池子）");
  ok(buildFiles.indexOf("materials/**/*") < 0,
     "材料同步: 打包清单只收池子，不收 materials/ 下别的（提示词、README 不该随包发出去）");
  const updSrc = readOr(join(here, "..", "update.js"));
  ok(/path\.join\(appDir, 'materials', 'pool'\)/.test(updSrc),
     "材料同步: 播种读的就是打包进去的那个位置（appDir/materials/pool）");
  ok(/appDir: __dirname/.test(readOr(join(here, "..", "main.js"))),
     "材料同步: 壳把 appDir 真传进去了（写了不传等于没写）");
}

/* 取材次序（pool-pick.js）：直接拿各种池子形态真跑，不靠正则瞄源码。
   守两条：没用过的优先；都用过了也要给得出一篇（只是隔开一段）。 */
{
  const pp = require(join(here, "..", "pool-pick.js"));
  const mkPool = (n, topics) => Array.from({ length: n }, (_, i) => ({ name: "m" + i + ".md", topics: topics || [] }));
  const names = (arr) => arr.map((x) => x.name);
  const lastN = (arr, n) => arr.slice(Math.max(0, arr.length - n));

  const pool20 = mkPool(20, ["基层治理"]);
  const hist5 = ["m0.md", "m1.md", "m2.md", "m3.md", "m4.md"];
  let leaked = 0;
  for (let i = 0; i < 60; i++) {
    const p = pp.pickOne(pool20, hist5, [], Math.random);
    if (hist5.indexOf(p.name) >= 0) leaked++;
  }
  ok(leaked === 0, "取材次序: 池子里还有没用过的，就不拿用过的（60 次里漏了 " + leaked + " 次）");

  /* 池子比窗口大：全部用过之后，拿到的不能是「当时最近 20 次」里的
     （不能用开头那一批算：历史每长一次，队尾的 20 个就换了一批） */
  const pool45 = mkPool(45, ["生态环保"]);
  let hitRecent = 0;
  let hist = names(pool45);
  for (let i = 0; i < 60; i++) {
    const recentNow = hist.slice(Math.max(0, hist.length - pp.RECENT));
    const p = pp.pickOne(pool45, hist, [], Math.random);
    if (recentNow.indexOf(p.name) >= 0) hitRecent++;
    hist = hist.filter((n) => n !== p.name).concat(p.name);   // 与主进程记使用次序的方式一致：先摘掉再压末尾
  }
  ok(hitRecent === 0,
     "取材次序: 隔开 " + pp.RECENT + " 道题才会重放（45 篇的池子、连取 60 次，撞上近期材料 " + hitRecent + " 次）");

  /* 池子比窗口小：窗口自己收窄，但绝不能熄火——原来「都用过就回 null」就是在这里熄的 */
  const pool8 = mkPool(8, []);
  const hist8 = names(pool8);
  const got8 = [];
  let histB = hist8.slice();
  for (let i = 0; i < 20; i++) {
    const p = pp.pickOne(pool8, histB, [], Math.random);
    if (!p) break;
    got8.push(p.name); histB.push(p.name);
  }
  ok(got8.length === 20,
     "取材次序: 池子比窗口还小也总是给出下一篇（8 篇全用过，连取 20 次取到 " + got8.length + " 次）");

  ok(pp.pickOne([], [], []) === null && pp.pickOne(null, null, null) === null,
     "取材次序: 池子真的空才回 null（由界面回落编材料）");

  /* 主题对得上优先，但不强求：弱项主题一冷门就取不到材料是不行的 */
  const mixed = mkPool(30, ["基层治理"]).concat([{ name: "eco.md", topics: ["生态环保"] }, { name: "eco2.md", topics: ["生态环保"] }]);
  let offTopic = 0;
  for (let i = 0; i < 40; i++) if (pp.pickOne(mixed, [], ["生态环保"], Math.random).name.indexOf("eco") !== 0) offTopic++;
  ok(offTopic === 0, "取材次序: 主题对得上的优先（40 次里走开 " + offTopic + " 次）");
  ok(pp.pickOne(mixed, [], ["这个主题池子里没有"], Math.random) !== null,
     "取材次序: 主题一个都对不上也照样给一篇（不强求）");

  /* 材料头解析：拿真池子文件断言，不靠正则瞄源码 */
  const _realRmw = readFileSync(join(here, "..", "materials", "pool", "20261015-rmw-40812288.md"), "utf8");
  const _hdRmw = pp.parsePoolHead(_realRmw);
  ok(_hdRmw.media === "人民网" && /^\d{4}-\d{2}-\d{2}$/.test(_hdRmw.date) && _hdRmw.topics.indexOf("就业服务") >= 0,
     "材料头: 解析出媒体 / 日期 / 主题（真文件）");
  ok(pp.parsePoolHead(readFileSync(join(here, "..", "materials", "pool", "20261015-rmrb-30185834.md"), "utf8")).media === "人民日报",
     "材料头: 人民网与人民日报按域名分开");
  ok(pp.parsePoolHead("来源：https://example.com/a\n发布：2026-01-01\n主题：x").media === "example.com",
     "材料头: 认不出来的域名原样显示（不假装认识）");
  ok(pp.parsePoolHead("").title === "" && pp.parsePoolHead(null).topics.length === 0,
     "材料头: 空 / 坏输入不抛，回空");
  const _mainSrc2 = readOr(join(here, "..", "main.js"));
  ok(/poolPickOne\.parsePoolHead\(head\)/.test(_mainSrc2) && /media: pick\.media/.test(_mainSrc2),
     "材料头: 主进程真的用了这套解析，并把媒体 / 日期 / 主题递给界面");

  /* 主进程得真的用它，而且要记得住「使用次序」——只标「用过」的话，「最久没用过」就永远是错的 */
  const mainSrc = readOr(join(here, "..", "main.js"));
  ok(/poolPickOne\.pickOne\(all, used, topics\)/.test(mainSrc),
     "取材次序: 主进程真的用了这个函数（写了不接等于没写）");
  ok(/used\.splice\(i, 1\)/.test(mainSrc) && /used\.push\(pick\.name\)/.test(mainSrc),
     "取材次序: 记的是使用次序（重放一篇要先摘掉再压末尾）");
  const pkgPool = JSON.parse(readOr(join(here, "..", "package.json"), "{}"));
  ok((((pkgPool.build || {}).files) || []).indexOf("pool-pick.js") >= 0,
     "取材次序: 打包清单里有 pool-pick.js（漏了就是装完一开就 require 不到）");
}

/* 规则文件自己的尺寸上限：超了会被 Codex 系指令链按字节截断，而截断点落在哪儿
   不好预测（可能正好切掉半条约束），所以按它自己写的上限卡住。 */
{
  const agents = readFileSync(join(here, "..", "AGENTS.md"));
  const LIMIT = 32 * 1024;
  ok(agents.length <= LIMIT,
     "规则: AGENTS.md 不超过自己写的 " + (LIMIT / 1024) + " KiB（当前 " + agents.length + " B）");
}

console.log(T.join("\n"));
const fails = T.filter((x) => x.indexOf("FAIL") === 0);
console.log("\n== 壳侧 " + (T.length - fails.length) + "/" + T.length + " passed ==");
if (fails.length) process.exitCode = 1;
