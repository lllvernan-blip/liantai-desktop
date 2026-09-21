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
const BACKUP_RETRY_MS = 1500;                 // 换到备用源后隔一下再试

/* 备用源兜底：国内直连 GitHub 实测常常直接连不通（连接被重置 / 超时），而 GitHub 转发站能取到
   同一份 Release 资产。2026-09-18 实测可用且都支持 Range（差量照旧）：ghproxy.net、gh-proxy.com、gh.ddlc.top。
   主源永远是包内 app-update.yml（GitHub 官方）——只有它先失败才退到备用源。
   这里有一条不能省的规矩：备用源模式下「取 sha512 的源」与「下安装包的源」必须分开
   （applyCrossSourceDownload）。同一个源既能改 latest.yml 又能换安装包时，sha512 校验等于自证。
   备用源自己也会挂（实测里 ghproxy.cc 证书过期、ghfast.top 连不通），所以按顺序试，全失败就照常报错+重试。
   备用只是兜底不是新默认：某轮借它走通后，下一轮检查开始时仍回到官方源（backToOfficialFeed）。 */
const GITHUB_OWNER = 'lllvernan-blip';
const GITHUB_REPO = 'liantai-desktop';
/* 等价于包内 app-update.yml（provider github + owner/repo；未签名无 pubkey；缓存目录名与
   electron-updater 按应用名算出的默认值一致），换回它 = 换回包内配置。 */
const OFFICIAL_FEED = { provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO };
const BACKUP_FEEDS = [
  'https://ghproxy.net/https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest/download/',
  'https://gh-proxy.com/https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest/download/',
  'https://gh.ddlc.top/https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest/download/',
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
let crossSourceReady = false;   // 更新组件支持源拆分才允许兜底（拆不了就宁愿不兜底，也不回到「自证」）
let switchedAway = false;  // 已经换离主源（只影响日志措辞）
/* 每次尝试一个编号：electron-updater 对同一次失败既 emit('error') 又会 reject，
   有编号才能保证只处理一次；迟到的旧错误（编号已被下一次尝试顶掉）直接丢掉。 */
let attempt = 0;

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
  }

  installCrossSourceHook();

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
    handleFailure(attempt, (err && err.message) || String(err));
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
}

function hostOf(url) {
  const m = /^https?:\/\/([^\/]+)/.exec(String(url || ''));
  return m ? m[1] : '';
}

/* 校验与下载分离：备用源模式下，元数据（latest.yml，带着 sha512）取自 BACKUP_FEEDS[i]，
   安装包改为从 BACKUP_FEEDS[i+1] 取。一个源只能控制一边，想偷换安装包就得让另一个源同时给出匹配的假哈希。
   官方源不拆：包内 app-update.yml 与安装包本来就在同一个 GitHub Release 上，拆不出第二条信任链。 */
function applyCrossSourceDownload() {
  if (explicitFeed || backupIndex < 0 || BACKUP_FEEDS.length < 2) {
    downloadBase = '';
    status.downloadHost = '';
    return;
  }
  downloadBase = BACKUP_FEEDS[(backupIndex + 1) % BACKUP_FEEDS.length];
  status.downloadHost = hostOf(downloadBase);
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
  const url = BACKUP_FEEDS[backupIndex];
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url });   // 这条源只负责元数据
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
  if (id !== attempt) return;   // 同一次失败的第二次回调，或者迟到的旧错误
  if (status.phase === PHASE.CHECKING && useNextBackup()) {
    status.error = '';
    backupRetry = true;
    setPhase(PHASE.IDLE, '主源连不上，换备用源重试');
    schedule(BACKUP_RETRY_MS);
    return;
  }
  backupRetry = false;
  backupIndex = -1;   // 下一轮从主源重新开始（GitHub 通了就该回到官方）
  applyCrossSourceDownload();   // backupIndex 归零，下载源也跟着回到「不拆」
  status.error = msg;
  setPhase(PHASE.ERROR, msg);
  schedule(ERROR_RETRY_MS);   // 网络抖一下就永久放弃是不行的
}

async function checkUpdate() {
  if (stopped || !status.supported || !autoUpdater) return snapshot();
  if (status.phase === PHASE.CHECKING || status.phase === PHASE.DOWNLOADING) return snapshot();
  if (backupRetry) {
    backupRetry = false;   // 备用源链重试：沿用当前备用源继续往下试，不能拨回官方源（拨回去备用源就永远轮不到）
  } else {
    backToOfficialFeed();
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
