'use strict';

/**
 * 自动更新 —— 桌面壳的更新模块（electron-updater）。
 *
 * 为什么必须用它、而不是自己拉 GitHub Release：
 *   差量更新。NSIS 安装包配上 .blockmap 后，新版本只下载「和上一版不同的那几块」，
 *   80MB 的包实际常常只需要几 MB——这是自己用 Node 标准库写不出来的东西（要重建安装器）。
 *
 * 三件事必须同时成立，更新才不会出事：
 *   1. 用户数据不在安装目录里。练习记录 / Key / 草稿都在 %APPDATA%\liantai-desktop，
 *      更新只替换程序文件，用户数据一个字节都不动（这是安装版的意义，不是"删了重下"）。
 *   2. 免安装版不更新。portable 包的进程里带着 PORTABLE_EXECUTABLE_FILE，
 *      对它做 quitAndInstall 只会「安装出一个新副本」，属于帮倒忙——直接禁用并说明。
 *   3. 更新失败绝不能影响使用。所有异常只进日志和状态，不弹阻断式对话框。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const APP = require('./app-meta.js');

const PHASE = {
  DISABLED: 'disabled',
  IDLE: 'idle',
  CHECKING: 'checking',
  AVAILABLE: 'available',
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  UP_TO_DATE: 'up-to-date',
  ERROR: 'error',
};

const BOOT_CHECK_DELAY_MS = 12 * 1000;        // 启动后 12 秒再查（别和启动抢带宽/注意力）
const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000; // 开着不动也每 6 小时看一眼
const ERROR_RETRY_MS = 30 * 60 * 1000;        // 失败后 30 分钟再试（网络问题多半是一时的）
const CHECK_TIMEOUT_MS = 2 * 60 * 1000;       // 检查接口半挂：2 分钟没回话就算失败
const DOWNLOAD_STALL_MS = 10 * 60 * 1000;     // 下载 10 分钟没有任何进展也算失败
const BACKUP_RETRY_MS = 1500;                 // 换到备用源后隔一下再试

/* 备用源兼加速镜像：国内直连 GitHub 常常慢到没法用或直接连不通，GitHub 转发站能取到
   同一份 Release 资产。2026-10-18 01:00 本机实测（10MB 单段 Range 各两轮；口径：curl -r 0-10485759）：
   gh-proxy.com 1.6 MB/s（两轮都稳）、ghfast.top 0.7–2.2 MB/s（波动大）、ghproxy.net 8–36 KB/s，
   这三台都支持单段 Range（206，差量照旧）；gh.xxooo.cf / ghproxy.cc / gh.llkk.cc / hub.gitmirror.com /
   gh.zhaojun.im / ghproxy.cfd / gh-proxy.ygxz.in / gh.7vh.cn / ghp.ci 连不通；直连 github.com 37–95 KB/s。
   按实测重排成三条：gh-proxy.com、ghfast.top、ghproxy.net。
   元数据主源永远是包内 app-update.yml（GitHub 官方）；安装包地址默认就改到第一条镜像上——
   直连官方慢到没法用，镜像才是常态入口（候选顺序见 downloadSequence，逐条兜底到官方直连）。
   这里有一条不能省的规矩：「取 sha512 的源」与「下安装包的源」必须分开（applyCrossSourceDownload）：
   同一个源既能改 latest.yml 又能换安装包时，sha512 校验等于自证。所以元数据取自备用源 i 时，
   安装包从别的源取；相邻两条同时活着才算一条能走通的路，排列表时按这个看。
   镜像自己也会挂，所以按顺序试；下载阶段某条不通就换下一条，三条加官方都试完才照常报错 + 30 分钟重试。
   备用元数据只是兜底不是新默认：某轮借它走通后，下一轮检查开始时仍回到官方元数据源（backToOfficialFeed）。 */
const GITHUB_OWNER = APP.owner;
const GITHUB_REPO = APP.repo;
/* 官方元数据源用 generic 指向 GitHub 官方下载路径，不用 provider github。两条理由：
   1. 只有 GenericProvider 的 resolveFiles 是恒等的（Provider.js 里 pathTransformer 默认 p => p），
      hook 改写出来的绝对镜像地址才原样保留；provider github 那条路会把绝对 URL 当相对文件名，
      再拼一次 /owner/repo/releases/download/<tag>/，镜像地址被嵌成一段垃圾路径，线上取不到包。
   2. useMultipleRangeRequest:false 与 GitHubProvider 的默认一致（GitHubProvider.js 里写死 false），
      也正是镜像实测支持的能力（单段 Range 206）；generic 默认走多段 Range，镜像没验证过。
   取到的仍是同一份 Release：provider github 走 API 找资产、这里走 releases/latest/download/，
   latest.yml 与 sha512 的来源不变（都在 github.com 官方）。
   （releaseNotes / releaseName 本仓库没人用，换 provider 不丢东西。） */
const OFFICIAL_FEED = {
  provider: 'generic',
  url: 'https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest/download/',
  useMultipleRangeRequest: false,
};
const BACKUP_FEEDS = [
  'https://gh-proxy.com/https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest/download/',
  'https://ghfast.top/https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest/download/',
  'https://ghproxy.net/https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest/download/',
];

let autoUpdater = null;
let log = () => {};
let notify = () => {};
let timer = null;
let stallTimer = null;
let stopped = false;   // 应用正在退出：不再发任何更新请求，别和退出流程抢
let explicitFeed = ''; // 用户/调试显式指定的源：那是唯一来源，不动它
let backupIndex = -1;  // -1 = 还在用包内 app-update.yml；否则元数据取自 BACKUP_FEEDS[backupIndex]
let backupRetry = false;   // 备用源链重试标记：schedule 重试也走 checkUpdate，但不能被拨回官方源（0.0.9 回归：拨回去备用源就永远轮不到）
let downloadBase = '';     // 非空 = 安装包从这条源下载（与取 sha512 的源不同，见 applyCrossSourceDownload）
let downloadRetry = false; // 下载阶段换源重试标记：schedule 重试也走 checkUpdate，但不能把安装包源拨回默认镜像
let dlStep = 0;            // 安装包源游标：0 = 本轮默认（加速镜像），每次下载失败 +1，走到末尾是官方直连兜底
let crossSourceReady = false;   // 更新组件支持源拆分才允许兜底（拆不了就宁愿不兜底，也不回到「自证」）
let switchedAway = false;  // 已经换离主源（只影响日志措辞）
/* 每次尝试一个编号：electron-updater 对同一次失败既 emit('error') 又会 reject，
   有编号才能保证只处理一次；迟到的旧错误（编号已被下一次尝试顶掉）直接丢掉。 */
let attempt = 0;
/* 已经处理过的那次编号。上面那句话写的是意图，但光比编号挡不住两条路：同一次失败的两次
   回调 id 都等于 attempt，第二次进来时 phase 已被第一次改掉，于是跳过换源分支、把 backupIndex
   拨回主源并按 30 分钟重试——schedule 里的 clearTimeout 顺手把 1.5 秒后那次换源重试也杀了。
   2026-10-05 真机日志：主源不通后退到第一条备用源，又 reset，然后没有下文，四条只试了一条。
   归零点在 checking-for-update：electron-updater 每开始一轮检查都会发它，所以这个标记只跨
   「同一轮里的两条路」，不会拦住下一轮（手动重试、1.5 秒后的换源重试都从新一轮开始）。 */
let handledAttempt = -1;

const status = {
  phase: PHASE.IDLE,
  supported: false,      // 这套构建能不能自动更新
  reason: '',            // 不能更新的原因：dev / portable / missing-module
  currentVersion: '',
  latestVersion: '',
  progress: null,        // { percent, transferred, total, bytesPerSecond }
  error: '',
  lastCheckAt: '',
  feed: '',              // 生效的更新源（默认是包内 app-update.yml 里的配置）
  releasesUrl: '',       // 给免安装版/手动兜底用的发布页
  feedHost: '',          // 备用源时给页面一个短名字（ghproxy.net 这种）：这一条负责取 sha512
  downloadHost: '',      // 安装包实际从那台主机下载（与 feedHost 不同，才叫校验与下载分离）
  autoDownload: true,    // 后台静默下载（Windows 的 electron-updater 只做这个）；mac 自实现那条链是 false
  errorStage: '',        // 哪一步坏的：check / download / install（页面据此说「检查失败」还是「下载失败」）
};

function snapshot() {
  return {
    phase: status.phase,
    supported: status.supported,
    reason: status.reason,
    currentVersion: status.currentVersion,
    latestVersion: status.latestVersion,
    progress: status.progress ? Object.assign({}, status.progress) : null,
    error: status.error,
    lastCheckAt: status.lastCheckAt,
    feed: status.feed,
    feedHost: status.feedHost,
    downloadHost: status.downloadHost,
    autoDownload: status.autoDownload,
    errorStage: status.errorStage,
    releasesUrl: status.releasesUrl,
  };
}

function setPhase(phase, detail) {
  status.phase = phase;
  if (detail !== undefined) log('update-' + phase, typeof detail === 'string' ? detail : JSON.stringify(detail));
  notify(snapshot());
}

/* 免安装版（portable）：electron-builder 会在进程环境里塞 PORTABLE_EXECUTABLE_FILE/DIR。
   打包版但没这个变量 = NSIS 安装版 = 可以自动更新。 */
function detectPortable() {
  return !!(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
}

function initUpdate(options) {
  log = options.log || log;
  notify = options.onStatusChange || notify;
  status.currentVersion = options.currentVersion || '';
  status.releasesUrl = options.releasesUrl || '';
  status.feed = options.feed || '';

  if (!options.isPackaged) {
    status.supported = false;
    status.reason = 'dev';
    setPhase(PHASE.DISABLED, '源码直跑（开发版），不检查更新');
    return status;
  }

  /* macOS：不过 electron-updater（它走 Squirrel.Mac，要求更新包与本体的签名一致，
     而 mac 版没买开发者证书，硬走只会在用户机器上报签名校验失败），改用本模块自实现的换包链：
     查 GitHub 最新 Release -> 下 zip（带 sha256 校验）-> 解压换包 -> 重新打开。
     与 Windows 的关键区别：**下与装都要用户点两下**（autoDownload = false）。
     平台可注入（options.platform）：自检要在一台机器上把各平台分支都量一遍。 */
  if ((options.platform || process.platform) === 'darwin') {
    return initMacUpdater(options);
  }

  if (detectPortable()) {
    status.supported = false;
    status.reason = 'portable';
    setPhase(PHASE.DISABLED, '免安装版不自动更新：下载新版后覆盖原文件即可，你的数据不受影响');
    return status;
  }

  let updaterModule = null;
  try {
    updaterModule = require('electron-updater');
  } catch (err) {
    status.supported = false;
    status.reason = 'missing-module';
    status.error = '缺少 electron-updater 模块（打包时没带上）';
    setPhase(PHASE.ERROR, status.error + ' :: ' + (err && err.message));
    return status;
  }

  /* 拿到了模块不等于拿到了可用的 updater：半成品/版本不对时 autoUpdater 可能不存在。
     这里必须自己挡下来——直接往下写属性会抛，而 initUpdate 是在启动链上调的，
     一抛就是「更新组件有问题 → 应用打不开」，代价远远大于自动更新本身。 */
  if (!updaterModule || !updaterModule.autoUpdater || typeof updaterModule.autoUpdater.checkForUpdates !== 'function') {
    status.supported = false;
    status.reason = 'missing-module';
    status.error = '更新组件不完整（electron-updater 版本不对或文件缺失）';
    setPhase(PHASE.ERROR, status.error);
    return status;
  }
  autoUpdater = updaterModule.autoUpdater;

  autoUpdater.autoDownload = true;          // 后台静默下好，再问用户要不要重启
  autoUpdater.autoInstallOnAppQuit = true;  // 用户直接关窗口也算数：下次启动就是新版
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  // 换源不改包：本地调试、或 GitHub 不通时指到备用源/自建源
  const feed = (options.feed || '').trim();
  if (feed) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feed });
      status.feed = feed;
      status.feedHost = hostOf(feed);
      explicitFeed = feed;   // 显式指定的源是唯一来源：失败也不自作主张换备用
    } catch (err) {
      log('update-feed-error', (err && err.message) || String(err));
    }
  } else {
    /* 首轮检查也必须真的切到官方 generic 源：不切就还在用包内 app-update.yml 的 provider github，
       hook 改写出的镜像地址会被那条路拼坏（第一次检查同样拿不到镜像包）。
       只在这里设一次；备用源用过之后的复位由 backToOfficialFeed 负责。 */
    try {
      autoUpdater.setFeedURL(Object.assign({}, OFFICIAL_FEED));
    } catch (err) {
      log('update-feed-error', (err && err.message) || String(err));
    }
  }

  installCrossSourceHook();
  if (crossSourceReady) applyCrossSourceDownload();   // 官方元数据也默认把安装包改到第一条镜像（拆不了源的组件除外）

  // 更新器自己的日志并进 startup.log：更新没动静时，日志是唯一的抓手
  autoUpdater.logger = {
    info: (m) => log('update-info', stringify(m)),
    warn: (m) => log('update-warn', stringify(m)),
    error: (m) => log('update-error', stringify(m)),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => {
    status.error = '';
    handledAttempt = -1;   // 新一轮检查开始：同一次失败的计数在这里归零
    setPhase(PHASE.CHECKING);
  });

  autoUpdater.on('update-available', (info) => {
    status.latestVersion = (info && info.version) || '';
    setPhase(PHASE.AVAILABLE, status.latestVersion + ' 可用，开始后台下载');
    armStallWatchdog();
  });

  autoUpdater.on('update-not-available', (info) => {
    status.latestVersion = (info && info.version) || status.currentVersion;
    setPhase(PHASE.UP_TO_DATE, '已是最新（' + status.currentVersion + '）');
  });

  autoUpdater.on('download-progress', (p) => {
    armStallWatchdog();   // 有字节流动就重置卡住计时
    status.progress = {
      percent: Math.max(0, Math.min(100, Math.round((p && p.percent) || 0))),
      transferred: (p && p.transferred) || 0,
      total: (p && p.total) || 0,
      bytesPerSecond: (p && p.bytesPerSecond) || 0,
    };
    setPhase(PHASE.DOWNLOADING);
  });

  autoUpdater.on('update-downloaded', (info) => {
    clearStallWatchdog();
    status.latestVersion = (info && info.version) || status.latestVersion;
    status.progress = { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 };
    setPhase(PHASE.DOWNLOADED, status.latestVersion + ' 已下载，重启后生效');
  });

  autoUpdater.on('error', (err) => {
    clearStallWatchdog();
    handleFailure(attempt, (err && err.message) || String(err));
  });

  status.supported = true;
  setPhase(PHASE.IDLE, '就绪');
  schedule(BOOT_CHECK_DELAY_MS);
  return status;
}

/* 卡住看门狗：checkForUpdates 与下载都可能「既不 resolve 也不 emit error」（连接建了但对端不回）。
   没这道兜底，phase 就永远停在 checking/downloading，而页面那时恰好把「检查更新」藏起来——变成单向门，
   只能重启应用。所以超时就当失败处理，走统一的报错 + 重试。 */
function armStallWatchdog() {
  clearStallWatchdog();
  if (stopped) return;
  stallTimer = setTimeout(() => {
    stallTimer = null;
    if (stopped) return;
    const where = status.phase === PHASE.DOWNLOADING ? '下载' : '检查更新';
    handleFailure(attempt, where + '超过 ' + Math.round(DOWNLOAD_STALL_MS / 60000) + ' 分钟没有进展');
  }, DOWNLOAD_STALL_MS);
  if (stallTimer && typeof stallTimer.unref === 'function') stallTimer.unref();
}

function clearStallWatchdog() {
  if (stallTimer) {
    clearTimeout(stallTimer);
    stallTimer = null;
  }
}

function schedule(delayMs) {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    checkUpdate().catch(() => {});
  }, delayMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

/* 退出时叫停：quitAndInstall 与退出流程都在跑的时候，再插一个 checkForUpdates 只是自找不确定性 */
function stopUpdate() {
  stopped = true;
  clearStallWatchdog();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (mac && mac.timer) {
    clearTimeout(mac.timer);
    mac.timer = null;
  }
}

function hostOf(url) {
  const m = /^https?:\/\/([^\/]+)/.exec(String(url || ''));
  return m ? m[1] : '';
}

/* 安装包候选源：默认从加速镜像起步，按顺序往后，最后官方直连兜底（空串 = 不拆，走官方地址）。
   起点随元数据源走：官方元数据从第 0 条镜像开始；元数据取自备用源 i 时，安装包从第 i+1 条起。 */
function downloadSequence() {
  const n = BACKUP_FEEDS.length;
  const start = backupIndex < 0 ? 0 : (backupIndex + 1) % n;
  const seq = [];
  for (let k = 0; k < n; k++) seq.push(BACKUP_FEEDS[(start + k) % n]);
  seq.push('');
  return seq;
}

/* 校验与下载分离：安装包地址从候选源取，元数据（latest.yml，带着 sha512）独立取——
   一个源只能控制一边，想偷换安装包就得另一个源同时给出匹配的假哈希。
   官方元数据模式下元数据在 github.com、安装包改到第一条镜像上，也是两台不同的主机，分离照旧成立。 */
function applyCrossSourceDownload() {
  if (explicitFeed || (backupIndex >= 0 && BACKUP_FEEDS.length < 2)) {
    downloadBase = '';
    status.downloadHost = '';
    return;
  }
  const seq = downloadSequence();
  downloadBase = seq[Math.min(dlStep, seq.length - 1)];
  status.downloadHost = downloadBase ? hostOf(downloadBase) : '';
}

/* 下载阶段换源：按候选顺序推进一条（镜像 → 镜像 → 官方直连兜底）。返回 false = 全试完了。 */
function advanceDownloadSource() {
  const seq = downloadSequence();
  if (dlStep + 1 >= seq.length) return false;
  dlStep++;
  applyCrossSourceDownload();
  return true;
}

/* 安装包地址改写：electron-updater 拿到的元数据里只有一个相对文件名，我们把它补成
   「另一条源」下的绝对地址，sha512 仍取元数据原文——这就是分离点。
   包名只取末段：元数据里就算写了绝对地址（哪怕是别人的域名），也一概拨回我们选的下载源，
   不让元数据决定去哪下。 */
function installCrossSourceHook() {
  if (!autoUpdater || typeof autoUpdater.getUpdateInfoAndProvider !== 'function') {
    log('update-warn', '更新组件不支持源拆分，备用源兜底将不启用');
    return;
  }
  const original = autoUpdater.getUpdateInfoAndProvider.bind(autoUpdater);
  autoUpdater.getUpdateInfoAndProvider = async function () {
    const res = await original();
    if (!downloadBase || !res || !res.info) return res;
    const info = Object.assign({}, res.info);
    const files = Array.isArray(info.files) ? info.files : [];
    info.files = files.map((f) => {
      if (!f || !f.url) return f;
      const name = String(f.url).split('?')[0].split('/').pop();
      if (!name) return f;
      try { return Object.assign({}, f, { url: new URL(name, downloadBase).toString() }); }
      catch (err) { return f; }
    });
    log('update-info', '元数据源=' + (status.feedHost || '官方') + '，安装包改走=' + status.downloadHost);
    return { info: info, provider: res.provider };
  };
  crossSourceReady = true;
}

/* 把 feed 拨回官方源。只在新一轮检查开始时调（下载中绝不换源）；显式指定的源是唯一来源，不碰。
   switchedAway 表示当前 feed 已经不在官方源上——「借备用源走通了」和「备用源全灭后报错」两种情况都算。 */
function backToOfficialFeed() {
  if (explicitFeed || !switchedAway) return;
  try {
    autoUpdater.setFeedURL(Object.assign({}, OFFICIAL_FEED));
    backupIndex = -1;
    switchedAway = false;
    status.feed = '';
    status.feedHost = '';
    applyCrossSourceDownload();
    log('update-info', '上一轮走了备用源，本轮检查回到官方源');
  } catch (err) {
    log('update-warn', '回到官方源失败：' + ((err && err.message) || String(err)));
  }
}

/* 换到下一条备用源（这条源负责取元数据，安装包走它的下一条）。返回 true 表示已换成并用新源重试。 */
function useNextBackup() {
  if (explicitFeed) return false;                            // 显式指定的源是唯一来源
  if (!crossSourceReady) {
    log('update-warn', '不能把校验与下载拆到两条源上，本次不做备用源兜底');
    return false;
  }
  if (backupIndex + 1 >= BACKUP_FEEDS.length) return false;   // 主源 + 全部备用源都试过了
  backupIndex++;
  dlStep = 0;   // 换了元数据源：安装包源也从新来源下的默认（第一条镜像）重排
  const url = BACKUP_FEEDS[backupIndex];
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url, useMultipleRangeRequest: false });   // 这条源只负责元数据（单段 Range 与官方源、镜像一致）
    status.feed = url;
    status.feedHost = hostOf(url);
    applyCrossSourceDownload();
    log('update-info', (switchedAway ? '再换下一条备用源重试：' : '主源连不上，换备用源取元数据：') + url +
      '（安装包走 ' + downloadBase + '）');
    switchedAway = true;
    return true;
  } catch (err) {
    log('update-warn', '切备用源失败：' + ((err && err.message) || String(err)));
    return false;
  }
}

/* 一次失败的统一处理：能换备用源就换（只在“检查”阶段——下载阶段失败换源也没意义），
   换不动（都没了/显式指定了源）就报错并按 30 分钟重试。 */
function handleFailure(id, msg) {
  if (id !== attempt) return;         // 迟到的旧错误（编号已被下一次尝试顶掉）
  if (id === handledAttempt) return;  // 同一次失败的第二次回调（error 事件 + promise reject）
  handledAttempt = id;
  /* 下载阶段失败：默认镜像某一条可能挂了，换下一条安装包源重试（镜像 → 镜像 → 官方直连兜底），
     别一头扎进 30 分钟重试循环。这是「换安装包源」，与下面「换元数据源」是两层，别混。 */
  if (status.phase === PHASE.DOWNLOADING && crossSourceReady && advanceDownloadSource()) {
    downloadRetry = true;
    status.error = '';
    setPhase(PHASE.IDLE, '下载线路不通，换一条安装包源重试');
    schedule(BACKUP_RETRY_MS);
    return;
  }
  if (status.phase === PHASE.CHECKING && useNextBackup()) {
    status.error = '';
    backupRetry = true;
    setPhase(PHASE.IDLE, '官方源连不上，换一条线路重试');
    schedule(BACKUP_RETRY_MS);
    return;
  }
  backupRetry = false;
  downloadRetry = false;
  dlStep = 0;         // 放弃这一轮：下一轮安装包源从默认镜像重排
  backupIndex = -1;   // 下一轮从主源重新开始（GitHub 通了就该回到官方）
  applyCrossSourceDownload();   // backupIndex 归零，下载源也跟着回到默认
  status.error = msg;
  setPhase(PHASE.ERROR, msg);
  schedule(ERROR_RETRY_MS);   // 网络抖一下就永久放弃是不行的
}

/* 差量下载靠两个缓存文件配对，可它们由两个程序分别写，会指到不同的版本：
     installer.exe     ← NSIS 安装器写。内容是「当前装着的这一版」的安装包。
     current.blockmap  ← electron-updater 写。内容是「上一次成功下载那一版」的 blockmap。
   手动装过一次、或者装完没走它自己的下载，两者就分属两个版本。那时差量会拿旧版本的对照
   数据去量新版本的安装包，拼出来的文件校验不过，白下一趟再从头全量下载（实测 84MB、二十多
   分钟）。对不上就把 blockmap 删掉：少了它，electron-updater 会去取「当前版本」那一份，
   与 installer.exe 天然对齐。
   判据用「块大小之和 == 安装包大小」：blockmap 里 sizes 逐块相加精确等于文件大小，两个版本
   差 2.5KB 就能分辨。传 cacheDir 可直接受测。 */
function alignDifferentialCache(cacheDir) {
  if (!cacheDir) {
    if (process.platform !== 'win32') return false;
    cacheDir = resolveUpdaterCacheDir();
    if (!cacheDir) return false;
  }
  try {
    const bmFile = path.join(cacheDir, 'current.blockmap');
    const insFile = path.join(cacheDir, 'installer.exe');
    if (!fs.existsSync(bmFile) || !fs.existsSync(insFile)) return false;
    const bm = JSON.parse(zlib.gunzipSync(fs.readFileSync(bmFile)).toString());
    const first = bm && bm.files && bm.files[0];
    if (!first || !Array.isArray(first.sizes)) return false;
    let sum = 0;
    for (const n of first.sizes) sum += n;
    if (sum === fs.statSync(insFile).size) return false;
    fs.unlinkSync(bmFile);
    log('update-info', '差量对照数据与当前安装包不是同一版，已重置');
    return true;
  } catch (err) {
    log('update-warn', '差量对照数据自检跳过：' + ((err && err.message) || String(err)));
    return false;
  }
}

/* 缓存目录名写在包内 app-update.yml 里（electron-updater 按它算路径）；
   位置在 %LOCALAPPDATA%，不是 userData 那个 %APPDATA%。 */
function resolveUpdaterCacheDir() {
  try {
    const yml = path.join(process.resourcesPath || '', 'app-update.yml');
    if (!fs.existsSync(yml)) return '';
    const m = /updaterCacheDirName:\s*(\S+)/.exec(fs.readFileSync(yml, 'utf8'));
    if (!m) return '';
    return path.join(process.env.LOCALAPPDATA || '', m[1]);
  } catch (err) {
    return '';
  }
}

async function checkUpdate() {
  if (stopped) return snapshot();
  if (macReady()) return macCheckOnce();
  if (!status.supported || !autoUpdater) return snapshot();
  if (status.phase === PHASE.CHECKING || status.phase === PHASE.DOWNLOADING) return snapshot();
  alignDifferentialCache();
  if (backupRetry) {
    backupRetry = false;   // 备用源链重试：沿用当前备用源继续往下试，不能拨回官方源（拨回去备用源就永远轮不到）
  } else if (downloadRetry) {
    downloadRetry = false;   // 下载阶段换源重试：dlStep 已在换源时推进，别拨回默认镜像
  } else {
    backToOfficialFeed();
    dlStep = 0;              // 新一轮检查：安装包源从默认镜像重新排
    applyCrossSourceDownload();
  }
  const id = ++attempt;
  try {
    const p = autoUpdater.checkForUpdates();
    p.catch(() => {});   // 竞速输掉的那一边也要有人接住，否则会冒 unhandledRejection
    await Promise.race([p, new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error('检查更新超时（' + Math.round(CHECK_TIMEOUT_MS / 1000) + ' 秒没有回应）')), CHECK_TIMEOUT_MS);
      if (t && typeof t.unref === 'function') t.unref();
    })]);
    status.lastCheckAt = new Date().toISOString();
    if (status.phase === PHASE.UP_TO_DATE) schedule(PERIODIC_CHECK_MS);
  } catch (err) {
    handleFailure(id, (err && err.message) || String(err));
  }
  return snapshot();
}

/* isSilent=false：让用户看见安装进度，别在"什么都没发生"里静默重启 */
function installUpdate() {
  if (macReady()) return macInstall();
  if (!status.supported || !autoUpdater) return false;
  if (status.phase !== PHASE.DOWNLOADED) return false;
  log('update-install', 'quitAndInstall');
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      status.error = (err && err.message) || String(err);
      setPhase(PHASE.ERROR, status.error);
    }
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* macOS：自实现换包（未签名，Squirrel.Mac 用不了）                      */
/* ------------------------------------------------------------------ */

/* 为什么自己写：electron-updater 在 mac 上走 Squirrel.Mac，它要求更新包与本体的签名一致；
   本项目的 mac 版没买开发者证书（package.json 里 build.mac.identity = null），硬走只会在
   用户机器上报签名校验失败。Windows 那边照旧走 electron-updater（差量更新、备用源那套一个字不动），
   mac 这边是另一条独立链：查 GitHub 最新 Release → 下 zip（校验 sha256）→ 解压换包 → 重新打开。

   四条不许动的边界：
   1. 只查不动手：开机自查（12 秒后）只把「有新版本」推给界面，**下载要用户点**「更新到 vX」，
      **换包要用户再点**「重启并更新」。mac 上不存在「自己把应用换掉」这件事（未签名的包用不了 Squirrel.Mac 那套自动替换）。
   2. 只从 GitHub 官方域取包：github.com / *.githubusercontent.com（资产会 302 到
      release-assets.githubusercontent.com）；明文 http 只放本机回环（自检要起假源）。
      地址来自 API 响应，所以响应就算被拐走，也只能拐到这几个域。
   3. 换包前后都留退路：先把旧包挪走再放新的，放失败原地搬回并重新打开旧版；
      任何一次失败都写进 <userData>/updates/install.log 的最后一行——脚本阶段没有界面可说话，
      下次启动 main.js 会读它并在首页说出来（见 macLastFailure）。
   4. 用户数据不动：只替换 .app 本体，练习记录 / Key / 草稿都在 userData 里，一个字节不碰。 */
const MAC_API_DEFAULT = APP.apiReleases + '?per_page=15';   // 扫列表而不是 /releases/latest：mac 常发 prerelease，它不占 latest，查 latest 永远看不到
const MAC_UA = APP.userAgent;
const MAC_HOST_OK = /^(github\.com|api\.github\.com|[a-z0-9-]+\.githubusercontent\.com)$/i;   // 官方域（api 与资产）
const MAC_MIRROR_HOSTS = /^(gh-proxy\.com|ghfast\.top)$/i;   // 加速镜像主机：只认这两台，不放宽成通配
const MAC_MIRROR_PREFIXES = ['https://gh-proxy.com/', 'https://ghfast.top/'];   // 顺序按 2026-10-18 实测（见文件顶部）
const MAC_LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/i;                    // 自检用的假源
const MAC_API_TIMEOUT_MS = 30 * 1000;
const MAC_IDLE_TIMEOUT_MS = 60 * 1000;   // 下载 60 秒没有任何字节就算断（有字节流动会自动重置）
const MAC_REDIRECT_MAX = 5;
const UPDATE_DIR = 'updates';
const ZIP_NAME_RE = /^liantai-desktop-(\d+\.\d+\.\d+)-(arm64|x64)\.zip$/;
const MAC_SIG_SUFFIX = '.sig';              // 签名资产名 = 包名 + 这个后缀
const MAC_SIG_MAX = 8 * 1024;               // 签名文件不会超过几行；比这大就不是签名

/* 发布侧签名用的公钥（私钥在本机 ~/.liantai-release-key，不进仓库、不上传，见 tools/mac-key.mjs）。
   为什么要有这一层：光的 sha256 期望值是从同一份 Release 元数据里读的——元数据被改（账号被盗、
   有人拿 token 发了一版），地址与期望值会一起被改，校验必然通过。签名只有本机那把私钥做得出，
   GitHub 上没有，所以包被换过就验不过；验不过就拒收（宁可先不更新，也不把来路不明的包装上去）。
   数组是留给轮换的：先把新公钥加进来发一版，再用新私钥签下一版，已装版本就平滑换过去了。
   轮换/丢失的代价写在 tools/mac-key.mjs 开头（丢私钥 = 已装版本手动重装一次）。 */
const MAC_UPDATE_KEYS = [
  /* 指纹 29abcdf1767fd4b9（`node tools/mac-key.mjs --pubkey` 可核对是不是同一把） */
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjNyzNNVXoExoNC/1n9q8lal0cew5gDzufSATBHY3oEs=
-----END PUBLIC KEY-----`,
];

/* 换包脚本。写成文件、用 /bin/bash 起一个独立进程，因为它必须在应用退出**之后**才能动 .app。
   参数全部走位置参数（$1..$7），不做字符串拼接——路径里有空格（“/Applications/练习台.app”）
   或中文都不会被拆坏。
   注：这段是 bash，${...} 在 JS 模板串里要写成 \${ 转义。 */
const MAC_INSTALL_SCRIPT = `#!/bin/bash
# 练习台换包脚本：由应用在退出前写出并交出去，独立于应用活着
# $1=旧进程 pid  $2=新包 zip  $3=要替换的 .app  $4=期望版本  $5=日志文件  $6=重新打开的命令  $7=包标识
set -u
PID="$1"; ZIP="$2"; TARGET="$3"; EXPECT="$4"; LOG="$5"; OPENCMD="$6"; APPID="$7"
note(){ printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG" 2>/dev/null; }
reopen(){ "$OPENCMD" "$TARGET" >>"$LOG" 2>&1; }

# 1) 等旧进程退出（最多 60 秒）：它不退，换包会把它脚下的目录搬走
n=0
while kill -0 "$PID" 2>/dev/null; do
  n=$((n+1))
  if [ "$n" -gt 300 ]; then note "更新放弃：旧进程 60 秒还没退出"; exit 1; fi
  sleep 0.2
done

# 2) 解压到临时目录，先不动原包。
#    优先用目标目录自己（同一个卷）：这样后面两次改名都是 rename（原子、瞬间），
#    而不是 mv 退化成「复制一遍 200MB 再删旧的」——复制期间正式位置上的应用会半新半旧。
DIR="$(/usr/bin/dirname "$TARGET")"
WORK="$(mktemp -d "$DIR/.liantai-update.XXXXXX" 2>/dev/null || true)"
if [ -z "$WORK" ] || [ ! -d "$WORK" ]; then
  WORK="$(mktemp -d "\${TMPDIR:-/tmp}/liantai-update.XXXXXX")" || { note "更新放弃：建不了临时目录"; reopen; exit 1; }
  note "目标目录里建不了暂存目录，改用系统临时目录（跨卷时多一次复制）"
fi
# STAGE 与 BAK 都放在目标目录里：新包从暂存名改名到正式名、旧包从正式名改名到暂存名，
# 两步都在同一个卷上（rename），中间没有「应用不在」的窗口，也不会出现半个应用。
STAGE="$DIR/.liantai-new.$$.app"
BAK="$DIR/.liantai-old.$$.app"
# 任何一条出口都在目标目录里留下半截东西是不行的（BAK 除外：回滚失败时它可能是旧版唯一一份）
trap 'rm -rf "$WORK" "$STAGE"' EXIT

if ! ditto -x -k "$ZIP" "$WORK" >>"$LOG" 2>&1; then
  mv "$ZIP" "$ZIP.bad" 2>/dev/null   # 坏包改名：别让它下次启动又被当成「已下好」端上去
  note "更新放弃：新包解压失败（下载不完整，或者包被改坏）——这份包已改名为 .bad，不会再用"
  reopen; exit 1
fi
NEW="$(/bin/ls -d "$WORK"/*.app 2>/dev/null | /usr/bin/head -n 1)"
if [ ! -d "$NEW" ]; then mv "$ZIP" "$ZIP.bad" 2>/dev/null; note "更新放弃：新包里没有 .app"; reopen; exit 1; fi
GOT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$NEW/Contents/Info.plist" 2>/dev/null)"
if [ "$GOT" != "$EXPECT" ]; then
  mv "$ZIP" "$ZIP.bad" 2>/dev/null
  note "更新放弃：包内版本不符（期望 \${EXPECT}，包内是 \${GOT:-读不到}）——这份包已改名为 .bad，不会再用"
  reopen; exit 1
fi
# 包身份也要核：光比版本号的话，一个「版本号写成一样」的别的应用就能被换上去
IDENT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$NEW/Contents/Info.plist" 2>/dev/null)"
if [ "$IDENT" != "$APPID" ]; then
  mv "$ZIP" "$ZIP.bad" 2>/dev/null
  note "更新放弃：包内标识不是练习台（期望 \${APPID}，包内是 \${IDENT:-读不到}）——这份包已改名为 .bad，不会再用"
  reopen; exit 1
fi

# 3) 新包先落到目标卷的暂存名上，再改名就位
if ! mv "$NEW" "$STAGE" 2>>"$LOG"; then
  if ! cp -pR "$NEW" "$STAGE" 2>>"$LOG"; then
    note "更新放弃：新包搬不进目标目录（磁盘空间不够？权限？）"; reopen; exit 1
  fi
  note "新包跨卷复制到目标目录（改名前）"
fi
STAGED="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$STAGE/Contents/Info.plist" 2>/dev/null)"
if [ "$STAGED" != "$EXPECT" ]; then note "更新放弃：暂存到目标卷后包读不出来（磁盘空间不够？）"; reopen; exit 1; fi

if ! mv "$TARGET" "$BAK" 2>>"$LOG"; then
  note "更新放弃：没法挪走旧版（多半是权限）"; reopen; exit 1
fi
if ! mv "$STAGE" "$TARGET" 2>>"$LOG"; then
  if ! mv "$BAK" "$TARGET" 2>>"$LOG"; then
    cp -pR "$BAK" "$TARGET" 2>>"$LOG" && rm -rf "$BAK"   # rename 也失败的最后一道退路：整份拷回
  fi
  note "更新失败：换入新版没成功，已恢复旧版"
  reopen; exit 1
fi
xattr -dr com.apple.quarantine "$TARGET" >>"$LOG" 2>&1
rm -rf "$BAK" "$WORK"
rm -f "$ZIP"
note "更新完成：$EXPECT"
reopen
exit 0
`;

/* 签名覆盖的内容：包内容的 sha256 + 资产名（资产名里带着版本与架构）。
   发布工具（tools/mac-key.mjs）调的是这一个函数，两边不会各写一遍格式而对不上。 */
function macSigPayload(hashHex, name) {
  return String(hashHex).toLowerCase() + ' ' + String(name);
}

/* 公钥解析：只认能解析成 Ed25519 的；一把都解析不出来 = 无法校验，那条链一律拒收 */
function macParseKeys(list) {
  const out = [];
  for (const raw of (Array.isArray(list) ? list : [list])) {
    if (!raw) continue;
    try {
      const k = crypto.createPublicKey(String(raw));
      if (k.asymmetricKeyType !== 'ed25519') { log('update-key-bad', '不是 Ed25519 公钥，略过'); continue; }
      out.push(k);
    } catch (err) {
      log('update-key-bad', (err && err.message) || String(err));
    }
  }
  return out;
}

let mac = null;        // null = 没走 mac 这条链；{ok:true,...} = 可用
let macAttempt = 0;    // 同一次失败的重复回调靠它去重

function macReady() { return !!(mac && mac.ok); }

function macDir() { return mac && mac.userDataDir ? path.join(mac.userDataDir, UPDATE_DIR) : ''; }

function initMacUpdater(options) {
  mac = {
    ok: false,
    api: options.macApi || MAC_API_DEFAULT,
    apiHost: (() => { try { return new URL(options.macApi || MAC_API_DEFAULT).hostname; } catch (err) { return ''; } })(),
    userDataDir: options.userDataDir || '',
    exePath: options.exePath || '',
    quit: options.quit || (() => {}),
    reveal: options.reveal || (() => {}),
    openCmd: options.macOpenCommand || 'open',
    /* 自检里换成一个不存在的 pid：脚本一上来就等「旧进程退出」，拿真 pid 会白等 60 秒才放弃。
       换 X：换包脚本还得把「开应用」换掉（真开一个假包没意义）。 */
    pid: options.pid || process.pid,
    pending: null,     // 查到的待下载（还没下）
    ready: null,       // 已下好、可直接换包的 zip
    keys: macParseKeys(options.macPublicKeys || MAC_UPDATE_KEYS),   // 可验的签名公钥（自检会传测试用的公钥）
    running: false,    // 下载中：重复点不叠加请求
    timer: null,
  };
  status.autoDownload = false;   // mac 上不存在“后台静默下”：一次一百来 MB，得让他点
  status.errorStage = '';

  if (!mac.userDataDir) {
    status.supported = false;
    status.reason = 'mac-no-dir';
    setPhase(PHASE.DISABLED, '拿不到用户数据目录，这次不检查更新');
    return status;
  }

  /* 上次下好了却没换（他点了稍后，或者干脆关掉了）：开机就把「重启并更新」摆出来，
     不让他为了一个已经躺在硬盘上的包再下一遍。 */
  const found = macScanDownloaded();
  if (found) {
    mac.ok = true;
    status.supported = true;
    mac.ready = found;
    status.latestVersion = found.version;
    setPhase(PHASE.DOWNLOADED, '上次已下好 v' + found.version + '，点「重启并更新」即可');
    return status;
  }

  mac.ok = true;
  status.supported = true;
  setPhase(PHASE.IDLE, '就绪');
  schedule(BOOT_CHECK_DELAY_MS);
  return status;
}

/* 已经下好的包：只看我们自己下的文件名（liantai-desktop-<版本>-<架构>.zip），
   比当前版本旧或相同的算上一轮没清干净的，不当数 */
function macScanDownloaded() {
  if (!mac || !mac.userDataDir) return null;
  let names = [];
  try { names = fs.readdirSync(macDir()); } catch (err) { return null; }
  let best = null;
  for (const n of names) {
    const m = ZIP_NAME_RE.exec(n);
    if (!m) continue;
    if (m[2] !== process.arch) continue;
    if (cmpVersion(m[1], status.currentVersion) <= 0) continue;
    if (best && cmpVersion(m[1], best.version) <= 0) continue;
    best = { version: m[1], path: path.join(macDir(), n) };
  }
  return best;
}

/* 版本号按段比：字符串比会把 0.0.10 判成比 0.0.9 旧 */
function cmpVersion(a, b) {
  const pa = String(a || '').split('.'), pb = String(b || '').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/* 只允许从官方域（或自检用的回环）取东西。
   另外认「显式配的那个 API 主机」：LIANTAI_RELEASE_API 指到自建转发站时，
   元数据与包就在那台机器上——不认它，这个开关等于废的（但默认的官方 API 主机会写死在白名单里，
   不靠「懒得写」过关：曾经这里漏了 api.github.com，真机上第一步就被自己拦下）。 */
function macHostAllowed(host) {
  return MAC_HOST_OK.test(host) || MAC_MIRROR_HOSTS.test(host) || MAC_LOOPBACK.test(host) || !!(mac && mac.apiHost && host === mac.apiHost) || !!(mat && mat.apiHost && host === mat.apiHost);
}

/* 一个 github.com 地址对应的候选来源：镜像（按 MAC_MIRROR_PREFIXES 顺序）在前，官方域兜底在后。
   **只改写 github.com 的地址**——API 响应里的任意主机不被改写，也不会因此进白名单；
   所以元数据被拐走也只能拐到我们硬编码的这几台上。非 github.com 的地址原样一条。 */
function macSourceUrls(url) {
  const raw = String(url || '');
  let u = null;
  try { u = new URL(raw); } catch (err) { return [raw]; }
  if (u.hostname.toLowerCase() !== 'github.com') return [raw];
  const out = MAC_MIRROR_PREFIXES.map((prefix) => prefix + u.toString());
  out.push(raw);
  return out;
}

function macAssertUrl(raw) {
  let u = null;
  try { u = new URL(String(raw || '')); } catch (err) { throw new Error('下载地址读不出来'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('不支持的下载协议：' + u.protocol);
  if (MAC_LOOPBACK.test(u.hostname)) return u;
  if (u.protocol !== 'https:') throw new Error('拒绝从明文 http 下载：' + u.hostname);
  if (!macHostAllowed(u.hostname)) throw new Error('拒绝从非 GitHub 主机下载：' + u.hostname);
  return u;
}

/* 一次请求（不跟重定向）。setTimeout 是**空闲**超时：连接不上、或连上后一直不吐字节，都会触发。 */
function macRequestOnce(u, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, { headers: Object.assign({ 'User-Agent': MAC_UA }, headers || {}) }, (res) => resolve(res));
    req.setTimeout(timeoutMs, () => req.destroy(new Error('网络没反应（' + Math.round(timeoutMs / 1000) + ' 秒没有任何数据）')));
    req.on('error', reject);
  });
}

/* 跟重定向，但每一步都重新过一遍域名白名单：
   GitHub 的资产会 302 到 *.githubusercontent.com，白名单里本来就有它 */
async function macOpen(url, headers, timeoutMs) {
  let u = macAssertUrl(url);
  for (let hop = 0; hop <= MAC_REDIRECT_MAX; hop++) {
    const res = await macRequestOnce(u, headers, timeoutMs);
    const code = res.statusCode || 0;
    if (code >= 300 && code < 400 && res.headers.location) {
      res.resume();   // 丢掉这一段 body，否则连接不复用
      u = macAssertUrl(new URL(res.headers.location, u).toString());
      continue;
    }
    return res;
  }
  throw new Error('重定向次数过多（' + MAC_REDIRECT_MAX + ' 次）');
}

async function macGetJson(url) {
  const res = await macOpen(url, { Accept: 'application/vnd.github+json' }, MAC_API_TIMEOUT_MS);
  const code = res.statusCode || 0;
  if (code !== 200) { res.resume(); throw new Error('GitHub 回了 HTTP ' + code); }
  const chunks = [];
  let n = 0;
  for await (const c of res) {
    n += c.length;
    if (n > 2 * 1024 * 1024) { res.destroy(); throw new Error('接口响应体过大，不像一份 Release 元数据'); }
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    throw new Error('接口返回的不是 JSON');
  }
}

/* 从 assets 里挑本机要用的包：只认我们自己发的 zip，优先架构对得上的那个 */
/* 注意别和下面的 macAssetName（本地文件名）撞名：同名函数声明会互相覆盖，
   结果就是元数据里的资产名被当成「本地文件名」算，包名成 undefined。 */
function assetNameOf(a) { return String((a && a.name) || ''); }
function assetUrlOf(a) { return String((a && (a.browser_download_url || a.url)) || ''); }
function macPickAsset(assets, version) {
  const list = Array.isArray(assets) ? assets : [];
  const nameOf = assetNameOf;
  const urlOf = assetUrlOf;
  const archOk = (a) => {
    const m = /-(arm64|x64)\.zip$/i.exec(nameOf(a));
    return !m || m[1].toLowerCase() === String(process.arch).toLowerCase();
  };
  const zips = list.filter((a) => /\.zip$/i.test(nameOf(a)) && !/\.blockmap$/i.test(nameOf(a)) && urlOf(a));
  const mine = zips.filter((a) => nameOf(a).indexOf('liantai-desktop-') === 0);
  const pool = mine.length ? mine : zips;
  const exact = pool.filter((a) => new RegExp('-' + process.arch + '\\.zip$', 'i').test(nameOf(a)));
  const fine = (exact.length ? exact : pool.filter(archOk));
  return fine.length ? fine[0] : null;
}

async function macCheckOnce() {
  if (status.phase === PHASE.CHECKING || status.phase === PHASE.DOWNLOADING) return snapshot();
  if (stopped) return snapshot();
  const id = ++macAttempt;
  status.error = '';
  status.errorStage = '';
  setPhase(PHASE.CHECKING);
  try {
    const data = await macGetJson(mac.api);
    /* prerelease 也算数：mac 链是自实现的，按版本号说话，下的是 zip 不受签名限制。
       Windows 的 electron-updater 走 /releases/latest，prerelease 不占 latest，两边互不干扰。 */
    const list = Array.isArray(data)? data : [data];
    let pendingTag = null, pendingAsset = null, pendingAssets = [], newestTag = null;
    for (const rel of list) {
      if (!rel || rel.draft) continue;
      const tag = String(rel.tag_name || rel.name || '').replace(/^v/i, '').trim();
      if (!/^\d+\.\d+\.\d+/.test(tag)) continue;
      if (!newestTag) newestTag = tag;
      if (cmpVersion(tag, status.currentVersion) <= 0) continue;
      const asset = macPickAsset(rel.assets || [], tag);
      if (!asset) continue;   // 这条没带 mac 包（多半是另一端先建的 Release），看下一条
      pendingTag = tag; pendingAsset = asset; pendingAssets = rel.assets || []; break;
    }
    if (!pendingTag) {
      mac.pending = null;
      status.latestVersion = status.currentVersion;
      setPhase(PHASE.UP_TO_DATE, '已是最新（' + status.currentVersion + '）');
      schedule(PERIODIC_CHECK_MS);
      return snapshot();
    }
    if (!pendingAsset) throw new Error('v' + newestTag + ' 没带适合本机的 mac 包');
    const url = assetUrlOf(pendingAsset);
    const assetName = assetNameOf(pendingAsset);
    macAssertUrl(url);   // 地址不合规就在“检查”这一步就说清，不留到下载时才炸
    /* 资产名必须是我们发的那种包名，且与下载地址的最后一段一致：
       签名覆盖的是「资产名」，两个名字对不上就说明这份元数据自己都不自洽。 */
    if (!ZIP_NAME_RE.test(assetName)) throw new Error('这版带的包名不是我们发的包：' + assetName);
    let urlBase = '';
    try { urlBase = decodeURIComponent(String(url).split('?')[0].split('/').pop() || ''); } catch (err) { urlBase = ''; }
    if (urlBase !== assetName) throw new Error('包的下载地址与资产名对不上（' + assetName + ' / ' + urlBase + '）——拒收');
    /* 签名资产：必须在同一个 Release 里、同一个名字加后缀。没有 = 发布侧漏签（或有人换了一版），
       按本机规矩在「检查」这步就拒收——别先下 100MB 再发现验不了。 */
    const sigAsset = pendingAssets.find((a) => assetNameOf(a) === assetName + MAC_SIG_SUFFIX && assetUrlOf(a));
    if (!mac.keys.length) {
      throw new Error('本机没有可用的签名公钥，这版包无从校验——拒收（请手动下载安装）');
    }
    if (!sigAsset) {
      throw new Error('v' + pendingTag + ' 没有签名文件（' + assetName + MAC_SIG_SUFFIX + '）——按规矩不收，请手动下载安装');
    }
    const sigUrl = assetUrlOf(sigAsset);
    macAssertUrl(sigUrl);
    mac.pending = { version: pendingTag, url: url, assetName: assetName, sigUrl: sigUrl,
                    size: Number(pendingAsset.size) || 0, digest: String(pendingAsset.digest || '') };
    status.latestVersion = pendingTag;
    setPhase(PHASE.AVAILABLE, 'v' + pendingTag + ' 可用（点「更新到 v' + pendingTag + '」开始下载）');
  } catch (err) {
    if (id === macAttempt) macFail('check', (err && err.message) || String(err));
  }
  return snapshot();
}

/* 取签名文件（很小，读回内存） */
async function macFetchSig(url) {
  const res = await macOpen(url, { Accept: 'application/octet-stream' }, MAC_API_TIMEOUT_MS);
  const code = res.statusCode || 0;
  if (code !== 200) { res.resume(); throw new Error('签名文件取不回来（HTTP ' + code + '）'); }
  const chunks = [];
  let n = 0;
  for await (const c of res) {
    n += c.length;
    if (n > MAC_SIG_MAX) { res.destroy(); throw new Error('签名文件太大，不像一份 Ed25519 签名'); }
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

/* 验签：签的是「刚下下来的这份包的 sha256 + 资产名」，用钉在包里的公钥验。
   这一步与 sha256 校验的区别在信任源：sha256 期望值跟下载地址来自同一份元数据，
   一起被改也看不出来；签名只有本机那把私钥做得出。验不过就拒收，不给「下次再说」。 */
async function macCheckSignature(p, hashHex, sigUrl) {
  const text = await macFetchSig(sigUrl || p.sigUrl);
  if (!text) throw new Error('签名文件是空的');
  if (!/^[A-Za-z0-9+/=]+$/.test(text)) throw new Error('签名文件内容不是 base64');
  const sig = Buffer.from(text, 'base64');
  if (!sig.length) throw new Error('签名解不出来');
  const payload = Buffer.from(macSigPayload(hashHex, p.assetName), 'utf8');
  for (const key of mac.keys) {
    try {
      if (crypto.verify(null, payload, key, sig)) return true;
    } catch (err) { /* 这把验不了就看下一把 */ }
  }
  throw new Error('包签名验不过（发布侧没签过这个包，或者包与签名被换过）——拒收，请手动下载安装');
}

/* 下载：由页面点「更新到 vX」触发（POST /__update/download）。同步返回 true = 已开始。 */
function downloadUpdate() {
  if (!macReady() || mac.running) return false;
  if (status.phase !== PHASE.AVAILABLE || !mac.pending) return false;
  mac.running = true;
  macPull(mac.pending)
    .catch((err) => macFail('download', (err && err.message) || String(err)))
    .then(() => { mac.running = false; });
  return true;
}

/* 下载一条来源：下到 .part -> 核 sha256 -> 验签名。任一步不过就抛，由 macPull 换下一条来源。
   进度节流、空闲超时（MAC_IDLE_TIMEOUT_MS）、.part 落盘都保持原有语义。 */
async function macPullOnce(p, bodyUrl, sigUrl, part) {
  const res = await macOpen(bodyUrl, {}, MAC_IDLE_TIMEOUT_MS);
  const code = res.statusCode || 0;
  if (code !== 200) { res.resume(); throw new Error('下载地址回了 HTTP ' + code); }
  const total = Number(res.headers['content-length'] || p.size || 0);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  const t0 = Date.now();
  status.progress.total = total;
  let got = 0;
  let lastPercent = -1;
  await new Promise((resolve, reject) => {
    res.on('data', (c) => {
      got += c.length;
      hash.update(c);
      const percent = total ? Math.max(0, Math.min(100, Math.round(got / total * 100))) : 0;
      if (percent === lastPercent) return;   // 每变一个百分点才推一次，别把状态通道刷爆
      lastPercent = percent;
      status.progress = {
        percent: percent,
        transferred: got,
        total: total,
        bytesPerSecond: Math.round(got / Math.max(0.5, (Date.now() - t0) / 1000)),
      };
      setPhase(PHASE.DOWNLOADING, '下载中 ' + percent + '%');
    });
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    res.pipe(out);
  });
  if (p.size && got !== p.size) throw new Error('下载不完整（收到 ' + got + ' 字节，应为 ' + p.size + '）');
  /* 未签名链上 sha256 是包内容唯一的防线：发布页不给 digest 就拒收，不许静默跳过——
     有条件校验等于没有校验。 */
  const want = String(p.digest || '').replace(/^sha256:/i, '').toLowerCase();
  if (!want) throw new Error('发布页没给 sha256，包完整性无从校验——拒收（宁可先不更新）');
  const gotHex = hash.digest('hex');
  if (want !== gotHex) throw new Error('下载校验没过（sha256 与发布页对不上）');
  await macCheckSignature(p, gotHex, sigUrl);   // 独立一遭：期望值与地址同源，签名不靠它们
  return got;
}

async function macPull(p) {
  const dir = macDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = macAssetName(p);
  const file = path.join(dir, name);
  const part = file + '.part';
  const id = ++macAttempt;
  status.error = '';
  status.errorStage = '';
  status.progress = { percent: 0, transferred: 0, total: p.size || 0, bytesPerSecond: 0 };
  setPhase(PHASE.DOWNLOADING, '开始下载 ' + name);

  /* 包与签名按同一条来源成对试：github.com 的地址先经镜像、官方域兜底；不是 github.com 的地址
     只有它自己一条。某条来源取回后照旧走 sha256 + Ed25519 验签，校验不过或中途断就换下一条，
     全部试完才报错——任何一步都不跳过、不放宽。 */
  const bodyCands = macSourceUrls(p.url);
  const sigCands = macSourceUrls(p.sigUrl);
  let fail = null;
  for (let i = 0; i < bodyCands.length; i++) {
    const body = bodyCands[i];
    const sig = sigCands[i] || sigCands[sigCands.length - 1];
    try {
      const got = await macPullOnce(p, body, sig, part);
      fs.renameSync(part, file);   // 校验过了才改回正名：半截文件不许看起来像“下好了”
      mac.ready = { version: p.version, path: file };
      mac.pending = null;
      status.progress = { percent: 100, transferred: got, total: got, bytesPerSecond: 0 };
      setPhase(PHASE.DOWNLOADED, 'v' + p.version + ' 已下好，点「重启并更新」');
      return;
    } catch (err) {
      fail = err;
      try { fs.unlinkSync(part); } catch (e) { /* 没留下就算了 */ }
      if (i + 1 < bodyCands.length) {
        log('update-download-retry', '这条来源没走通（' + ((err && err.message) || String(err)) + '），换下一条来源重来：' + body);
      }
    }
  }
  if (id === macAttempt) macFail('download', (fail && fail.message) || String(fail));
}

function macAssetName(p) {
  /* 查询时已核过「资产名 = 下载地址最后一段」，存盘就按资产名存：
     签名验的是资产名，两处用同一个字符串，才不会「验过了 A、存下来的是 B」。 */
  if (p.assetName && ZIP_NAME_RE.test(p.assetName)) return p.assetName;
  const fromUrl = String(p.url).split('?')[0].split('/').pop() || '';
  const clean = fromUrl.replace(/[^A-Za-z0-9._-]/g, '');
  if (ZIP_NAME_RE.test(clean)) return clean;
  return 'liantai-desktop-' + String(p.version).replace(/[^0-9A-Za-z.]/g, '') + '-' + process.arch + '.zip';
}

/* 从可执行文件往上找 .app（/Applications/练习台.app/Contents/MacOS/练习台） */
function macBundlePathRaw() {
  const from = String((mac && mac.exePath) || process.execPath || '');
  const parts = from.split('/');
  for (let i = parts.length - 1; i >= 1; i--) {
    if (/\.app$/.test(parts[i])) return parts.slice(0, i + 1).join('/');
  }
  return '';
}

/* 包标识：换包前先问「这真是练习台吗」。只看「哪个目录以 .app 结尾」是不够的——
   应用被放在一个别的 .app 里层、或者目录名被改过时，会把不相干的东西当成自己的应用本体去替换。 */
function macBundleId(app) {
  try {
    const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
    const m = /CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
    return m ? m[1].trim() : '';
  } catch (err) { return ''; }
}

function macBundlePath() {
  const raw = macBundlePathRaw();
  return raw && macBundleId(raw) === APP.appId ? raw : '';
}

/* 换包：把脚本交出去，然后请他退出（脚本会等这个进程真的没了才动手）。
   同步返回 true = 已经交出去了（页面侧收到 200，随后应用会自己关掉再打开）。 */
function macInstall() {
  if (!macReady() || !mac.ready) return false;
  if (status.phase !== PHASE.DOWNLOADED) return false;
  const zip = mac.ready.path;
  const target = macBundlePath();
  if (!target) {
    const raw = macBundlePathRaw();
    macFail('install', raw
      ? '找到的 .app 不是练习台（包标识 ' + (macBundleId(raw) || '读不到') + '），不敢替换它——这次更新只能手动装'
      : '找不到应用本体（.app），这次更新只能手动装');
    return false;
  }
  if (!fs.existsSync(zip)) { macFail('install', '已下好的包不见了（' + zip + '），请重新下载'); return false; }
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK);
  } catch (err) {
    try { mac.reveal(zip); } catch (e) { /* 打不开“显示位置”也不影响这件事说清楚 */ }
    macFail('install', '没有权限替换 ' + target + '（它所在的目录不许写入）。已下好的包在 ' + zip + '，可以点「打开发布页」手动装');
    return false;
  }
  const logPath = path.join(macDir(), 'install.log');
  const scriptPath = path.join(macDir(), 'install-' + mac.pid + '.sh');
  try {
    fs.writeFileSync(scriptPath, MAC_INSTALL_SCRIPT, { mode: 0o755 });
  } catch (err) {
    macFail('install', '换包脚本写不出来（' + ((err && err.message) || String(err)) + '）');
    return false;
  }
  try {
    const child = spawn('/bin/bash', [scriptPath, String(mac.pid), zip, target, mac.ready.version, logPath, mac.openCmd, APP.appId], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    macFail('install', '换包脚本起不来（' + ((err && err.message) || String(err)) + '）');
    return false;
  }
  log('update-install', '换包脚本已交出去：' + target + ' <- ' + zip + '（日志 ' + logPath + '）');
  mac.ready = null;   // 脚本接管了：不让页面再点第二次
  setPhase(PHASE.DOWNLOADED, '正在退出并换包…（换完会自己重新打开）');
  setImmediate(() => {
    try { mac.quit(); } catch (err) { log('update-install-error', (err && err.message) || String(err)); }
  });
  return true;
}

function macFail(stage, msg) {
  status.errorStage = stage;
  status.error = msg;
  const where = stage === 'download' ? '下载失败' : stage === 'install' ? '换包失败' : '检查更新失败';
  setPhase(PHASE.ERROR, where + '：' + msg);
  schedule(ERROR_RETRY_MS);   // 网络抖一下就永久放弃是不行的
}

/* 上一次换包留下的最后一行日志。main.js 在启动时读它：失败过就得在首页说一句，
   不然“点了更新，应用关掉又打开，还是老版本”这件事没有任何解释。读完把日志改名，免得反复报。 */
function macLastFailure() {
  if (!mac || !mac.userDataDir) return '';
  const logPath = path.join(macDir(), 'install.log');
  let text = '';
  try { text = fs.readFileSync(logPath, 'utf8'); } catch (err) { return ''; }
  try { fs.renameSync(logPath, logPath + '.old'); } catch (err) { /* 改不动就算了，下次再说 */ }
  const lines = String(text).split('\n').filter((l) => l.trim());
  const last = lines.length ? lines[lines.length - 1] : '';
  if (!last || last.indexOf('更新完成') >= 0) return '';
  return last.replace(/^\S+ \S+ /, '').trim();   // 去掉时间戳
}

/* ============ 材料同步 ============
   池子（出题用的材料骨架）不随安装包走。材料的时效线是半年，它有自己的更新节奏，
   每刷新一次就重新打包发版太重；所以单独发在一个固定 tag（materials）的 prerelease 上，
   应用启动后安静地拉一份最新的。安装包里仍然带一份兜底，只在池子还是空的时候播下去。

   三条底线：
   1. **拉不到不影响使用**。池子空、网络不通、验签不过——一律没声，界面回落到编材料，
      全程不报错、不弹窗。有据出题是加成，不是前提。
   2. **材料必须验签**。它会进 prompt 影响出题，等于发布内容的一部分；光靠 Release 元数据里的
      sha256 是自证的（元数据被改，地址与期望值会一起被改，校验必然过）。签名只有发布侧那把
      私钥做得出，公钥钉在上面 MAC_UPDATE_KEYS——与 mac 更新包共用同一把、同一套验签。
   3. **池子目录整个由这份包管**（有就写、没有就删）。一份被判不合格的材料下架后，本机不能
      还留着它继续被抽中。

   取数复用 mac 链那一套（macOpen / macGetJson：域名白名单、逐步跟重定向、空闲超时），
   不另写一份请求——两份下载逻辑早晚会分叉。 */
const MAT_TAG = 'materials';
const MAT_PACK = 'liantai-materials.json';
const MAT_SIG_SUFFIX = '.sig';
const MAT_DIR_NAME = '材料池';
const MAT_MARK = 'materials-sync.json';
const MAT_MAX_PACK = 4 * 1024 * 1024;             // 整包上限：66KB 是当前量级，4MB 已经宽松得多
const MAT_MAX_SIG = 8 * 1024;
const MAT_MAX_ITEM = 256 * 1024;                  // 单篇上限：骨架是清单，这么大一定是搞错了
const MAT_MAX_ITEMS = 400;
const MAT_NAME_RE = /^[A-Za-z0-9._-]{1,80}\.md$/;
const MAT_BOOT_DELAY_MS = 20 * 1000;              // 启动后 20 秒再拉：别和启动、更新查询抢带宽
const MAT_PERIOD_MS = 12 * 60 * 60 * 1000;        // 一天两次足够（时效线是半年）
const MAT_RETRY_MS = 60 * 60 * 1000;              // 失败一小时后再试

let mat = null;   // null = 没初始化；{...} = 在用

function matDir() { return path.join(mat.userDataDir, MAT_DIR_NAME); }
function matMarkFile() { return path.join(mat.userDataDir, MAT_MARK); }
function matApiUrl() { return mat.api; }

function matReadMark() {
  try {
    const j = JSON.parse(fs.readFileSync(matMarkFile(), 'utf8'));
    return (j && typeof j === 'object') ? j : {};
  } catch (err) { return {}; }
}
function matWriteMark(obj) {
  try { fs.writeFileSync(matMarkFile(), JSON.stringify(obj), 'utf8'); } catch (err) { /* 写不进去只影响下次判断，不影响材料用 */ }
}

function matSchedule(delayMs) {
  if (!mat) return;
  if (mat.timer) { clearTimeout(mat.timer); mat.timer = null; }
  mat.timer = setTimeout(() => { mat.timer = null; matSyncNow(); }, Math.max(1000, delayMs));
  if (mat.timer && mat.timer.unref) mat.timer.unref();   // 别为了拉材料把进程吊着不退出
}

/* 取一份二进制（带上限）。上限是硬闸：没有它，一个畸形的响应能把内存吃干。 */
async function matGetBuf(url, max, accept) {
  const res = await macOpen(url, { Accept: accept || 'application/octet-stream' }, MAC_API_TIMEOUT_MS);
  const code = res.statusCode || 0;
  if (code !== 200) { res.resume(); throw new Error('取材料回了 HTTP ' + code); }
  const chunks = [];
  let n = 0;
  for await (const c of res) {
    n += c.length;
    if (n > max) { res.destroy(); throw new Error('材料包超过 ' + max + ' 字节，不像一份骨架包'); }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/* 验签：签的是「这份包的 sha256 + 资产名」，与 update.js 的 macSigPayload 同一串格式。 */
function matVerify(buf, sigText) {
  if (!mat.keys.length) throw new Error('本机没有可用的签名公钥，这份材料无从校验——拒收');
  const t = String(sigText || '').trim();
  if (!t) throw new Error('签名文件是空的');
  if (!/^[A-Za-z0-9+/=]+$/.test(t)) throw new Error('签名文件内容不是 base64');
  const sig = Buffer.from(t, 'base64');
  if (!sig.length) throw new Error('签名解不出来');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const payload = Buffer.from(macSigPayload(hash, MAT_PACK), 'utf8');
  for (const key of mat.keys) {
    try { if (crypto.verify(null, payload, key, sig)) return; } catch (err) { /* 这把验不了看下一把 */ }
  }
  throw new Error('签名验不过——这份材料不是发布侧的（或者下载途中被改过），拒收');
}

/* 包的结构校验。字段一律当成不可信输入：名字只认裸文件名（挡掉 ../ 与绝对路径），
   重名、空内容、超大单篇都在这里拦下，不留给下游。 */
function matParse(buf) {
  let data = null;
  try { data = JSON.parse(buf.toString('utf8')); } catch (err) { throw new Error('材料包不是 JSON'); }
  if (!data || typeof data !== 'object') throw new Error('材料包不是个对象');
  if (data.v !== 1) throw new Error('材料包的格式版本不认识：' + stringify(data.v));
  const items = Array.isArray(data.items) ? data.items : null;
  if (!items || !items.length) throw new Error('材料包里没有材料');
  if (items.length > MAT_MAX_ITEMS) throw new Error('材料包里的篇数超过上限（' + items.length + '）');
  const out = [];
  const seen = Object.create(null);
  for (const it of items) {
    const name = String((it && it.name) || '');
    const text = it && it.text;
    if (!MAT_NAME_RE.test(name) || name !== path.basename(name)) throw new Error('材料包里有个文件名不合法：' + name);
    if (seen[name]) throw new Error('材料包里有重名：' + name);
    if (typeof text !== 'string' || !text.trim()) throw new Error(name + ' 的内容是空的');
    if (Buffer.byteLength(text, 'utf8') > MAT_MAX_ITEM) throw new Error(name + ' 超过了单篇上限');
    seen[name] = true;
    out.push({ name: name, text: text });
  }
  return { items: out, git: String(data.git || ''), at: String(data.at || '') };
}

/* 落盘：逐篇「写临时名 -> 改名就位」。rename 在同一卷上是原子的，读到的一篇要么是旧的
   一整篇、要么是新的一整篇，不会是半截。写完再把包外的旧篇删掉（池子整个由包管）。 */
function matApply(pack) {
  const dir = matDir();
  fs.mkdirSync(dir, { recursive: true });
  const keep = Object.create(null);
  for (const it of pack.items) {
    const dst = path.join(dir, it.name);
    const tmp = dst + '.part';
    fs.writeFileSync(tmp, it.text, 'utf8');
    fs.renameSync(tmp, dst);
    keep[it.name] = true;
  }
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (err) { return { written: pack.items.length, removed: 0 }; }
  for (const n of names) {
    const full = path.join(dir, n);
    if (n.slice(-5) === '.part') { try { fs.unlinkSync(full); } catch (err) {} continue; }
    if (n.slice(-3) !== '.md') continue;
    if (keep[n]) continue;
    try { fs.unlinkSync(full); removed++; } catch (err) { /* 删不动就先留着，下轮再说 */ }
  }
  return { written: pack.items.length, removed: removed };
}

/* 播种：安装包里那份兜底材料，只在池子还是空的时候播。
   已经有池子的（上一版播过、或同步下来过）一律不动——一个旧兜底把新同步下来的盖回去就荒唐了。 */
function matSeed(appDir) {
  let have = [];
  try { have = fs.readdirSync(matDir()).filter((f) => /[.]md$/.test(f)); } catch (err) { have = []; }
  if (have.length) return 0;
  const src = path.join(appDir, 'materials', 'pool');
  let names = [];
  try { names = fs.readdirSync(src).filter((f) => /[.]md$/.test(f)).sort(); } catch (err) { return 0; }
  if (!names.length) return 0;
  fs.mkdirSync(matDir(), { recursive: true });
  let n = 0;
  for (const name of names) {
    if (!MAT_NAME_RE.test(name)) continue;
    try { fs.writeFileSync(path.join(matDir(), name), fs.readFileSync(path.join(src, name))); n++; } catch (err) { /* 单篇播不进去不影响其余 */ }
  }
  if (n) log('materials-seed', '随包的兜底材料已就位：' + n + ' 篇');
  if (n) {
    /* 把「这批有多少篇」记下来：它是一件防回退的据。打包发出去那份材料可能比随包的旧
       （改了池子但还没重发材料包，而软件先构建了），那时候同步拿一份更小的包把刚装好的池子
       换掉就是回退。所以「包里比随包的还少」一律视为「发布侧还没有更新的」，不动文件。 */
    const seen = matReadMark();
    matWriteMark(Object.assign({}, seen, { shipped: n }));
  }
  return n;
}

async function matSyncNow() {
  if (!mat || mat.running) return null;
  if (mat.lastAt && (Date.now() - mat.lastAt) < MAT_PERIOD_MS) {
    matSchedule(MAT_PERIOD_MS - (Date.now() - mat.lastAt) + 1000);
    return null;
  }
  mat.running = true;
  try {
    const rel = await macGetJson(matApiUrl());
    const assets = Array.isArray(rel && rel.assets) ? rel.assets : [];
    const packAsset = assets.find((a) => assetNameOf(a) === MAT_PACK && assetUrlOf(a));
    const sigAsset = assets.find((a) => assetNameOf(a) === MAT_PACK + MAT_SIG_SUFFIX && assetUrlOf(a));
    if (!packAsset) throw new Error('材料 Release 里没有 ' + MAT_PACK);
    if (!sigAsset) throw new Error('材料 Release 里没有签名文件，按规矩不收');
    const packUrl = assetUrlOf(packAsset);
    /* 资产名与下载地址的最后一段必须一致：签名覆盖的是资产名，两个名字对不上，
       说明这份元数据自己都不自洽（与 mac 链同一条规矩）。 */
    let urlBase = '';
    try { urlBase = decodeURIComponent(String(packUrl).split('?')[0].split('/').pop() || ''); } catch (err) { urlBase = ''; }
    if (urlBase !== MAT_PACK) throw new Error('材料的下载地址与资产名对不上——拒收');
    const buf = await matGetBuf(packUrl, MAT_MAX_PACK);
    const sigText = (await matGetBuf(assetUrlOf(sigAsset), MAT_MAX_SIG, 'text/plain')).toString('utf8');
    matVerify(buf, sigText);
    const pack = matParse(buf);
    /* 防回退：随包那份比发布侧的还多，说明改过池子但还没重发材料包。
       同步默认是「镜像」（包里没的就删），这时候镜像一次就是回退。 */
    const seen = matReadMark();
    const shipped = Number(seen.shipped) || 0;
    if (shipped && pack.items.length < shipped) {
      mat.lastAt = Date.now();
      mat.lastGit = pack.git;
      matWriteMark(Object.assign({}, seen, { at: mat.lastAt, git: pack.git, packAt: pack.at, count: pack.items.length }));
      log('materials-sync-older', '发布侧那份（' + pack.items.length + ' 篇）比随包的（' + shipped + ' 篇）还少，不动本机池子');
      matSchedule(MAT_PERIOD_MS);
      return null;
    }
    const r = matApply(pack);
    mat.lastAt = Date.now();
    mat.lastError = '';
    mat.lastGit = pack.git;
    matWriteMark({ at: mat.lastAt, git: pack.git, packAt: pack.at, count: pack.items.length });
    log('materials-sync', '已更新 ' + pack.items.length + ' 篇（写了 ' + r.written + '，撤了 ' + r.removed + '）' + (pack.git ? ' @' + pack.git : ''));
    matSchedule(MAT_PERIOD_MS);
    return r;
  } catch (err) {
    const msg = (err && err.message) || String(err);
    mat.lastError = msg;
    /* 失败一律没声：池子照旧用本机已有的（或随包的兜底），界面该回落编材料就回落。 */
    log('materials-sync-fail', msg);
    matSchedule(MAT_RETRY_MS);
    return null;
  } finally {
    mat.running = false;
  }
}

function initMaterials(options) {
  const mark = {};
  mat = {
    userDataDir: options.userDataDir || '',
    api: options.api || (APP.apiReleases + '/tags/' + MAT_TAG),
    apiHost: (() => {
      try { return new URL(options.api || (APP.apiReleases + '/tags/' + MAT_TAG)).hostname; } catch (err) { return ''; }
    })(),
    keys: macParseKeys(options.publicKeys || MAC_UPDATE_KEYS),
    running: false,
    timer: null,
    lastAt: 0,
    lastError: '',
    lastGit: '',
  };
  if (!mat.userDataDir) { mat = null; return null; }
  if (options.log) log = options.log;

  const seeded = matSeed(options.appDir || '');
  const seen = matReadMark();
  mat.lastAt = Number(seen.at) || 0;
  mat.lastGit = String(seen.git || '');
  matSchedule(MAT_BOOT_DELAY_MS);
  return { seeded: seeded, mark: seen };
}

function materialsStatus() {
  if (!mat) return { ok: false };
  return { ok: true, dir: matDir(), lastAt: mat.lastAt, lastGit: mat.lastGit, lastError: mat.lastError, running: mat.running };
}

function stringify(m) {
  if (typeof m === 'string') return m;
  try {
    return JSON.stringify(m);
  } catch (err) {
    return String(m);
  }
}

module.exports = { initUpdate, checkUpdate, downloadUpdate, installUpdate, stopUpdate, macLastFailure, getStatus: snapshot, alignDifferentialCache, macSigPayload, macSourceUrls, macHostAllowed, PHASE, OFFICIAL_FEED, BACKUP_FEEDS, MAC_MIRROR_PREFIXES, MAC_UPDATE_KEYS,
  initMaterials, materialsStatus, matSyncNow };
