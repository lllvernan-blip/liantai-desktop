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

let autoUpdater = null;
let log = () => {};
let notify = () => {};
let timer = null;
let stallTimer = null;
let stopped = false;   // 应用正在退出：不再发任何更新请求，别和退出流程抢

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

  if (detectPortable()) {
    status.supported = false;
    status.reason = 'portable';
    setPhase(PHASE.DISABLED, '免安装版不自动更新：下载新版 exe 覆盖原文件即可（用户数据在 %APPDATA%，不受影响）');
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

  // 换源不改包：本地调试、或 GitHub 不通时指到镜像/自建源
  const feed = (options.feed || '').trim();
  if (feed) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feed });
      status.feed = feed;
    } catch (err) {
      log('update-feed-error', (err && err.message) || String(err));
    }
  }

  // 更新器自己的日志并进 startup.log：更新没动静时，日志是唯一的抓手
  autoUpdater.logger = {
    info: (m) => log('update-info', stringify(m)),
    warn: (m) => log('update-warn', stringify(m)),
    error: (m) => log('update-error', stringify(m)),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => {
    status.error = '';
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
    status.error = (err && err.message) || String(err);
    setPhase(PHASE.ERROR, status.error);
    schedule(ERROR_RETRY_MS);   // 网络抖一下就永久放弃是不行的
  });

  status.supported = true;
  setPhase(PHASE.IDLE, '初始化完成，源=' + (status.feed || '包内 app-update.yml'));

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
    status.error = where + '超过 ' + Math.round(DOWNLOAD_STALL_MS / 60000) + ' 分钟没有进展';
    setPhase(PHASE.ERROR, status.error);
    schedule(ERROR_RETRY_MS);
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
}

async function checkUpdate() {
  if (stopped || !status.supported || !autoUpdater) return snapshot();
  if (status.phase === PHASE.CHECKING || status.phase === PHASE.DOWNLOADING) return snapshot();
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
    status.error = (err && err.message) || String(err);
    setPhase(PHASE.ERROR, status.error);
    schedule(ERROR_RETRY_MS);
  }
  return snapshot();
}

/* isSilent=false：让用户看见安装进度，别在"什么都没发生"里静默重启 */
function installUpdate() {
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

function stringify(m) {
  if (typeof m === 'string') return m;
  try {
    return JSON.stringify(m);
  } catch (err) {
    return String(m);
  }
}

module.exports = { initUpdate, checkUpdate, installUpdate, stopUpdate, getStatus: snapshot, PHASE };
