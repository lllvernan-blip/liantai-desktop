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
   同一份 Release 资产。2026-09-25 夜在本机重测（元数据各 3 次 + 安装包单段 Range 各一轮）：
   ghproxy.net、gh-proxy.com、gh.xxooo.cf、gh.nxnow.top 都能取到 latest.yml 且支持单段 Range（206，
   差量照旧）；gh.ddlc.top 连续 429（error code: 1027）已换掉；gh-proxy.net 能取元数据但 Range
   返回 200 全量，不能走差量；直连 github.com 仍是连接超时。换线路时两条硬指标：元数据能取到、
   **支持单段 Range**——后者不满足就只能全量下载。
   主源永远是包内 app-update.yml（GitHub 官方）——只有它先失败才退到备用源。
   这里有一条不能省的规矩：备用源模式下「取 sha512 的源」与「下安装包的源」必须分开
   （applyCrossSourceDownload）。同一个源既能改 latest.yml 又能换安装包时，sha512 校验等于自证。
   所以相邻两条要同时活着才算一条能走通的路，排列表时按这个看。
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
  'https://gh.xxooo.cf/https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest/download/',
  'https://gh.nxnow.top/https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest/download/',
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
  if (id !== attempt) return;         // 迟到的旧错误（编号已被下一次尝试顶掉）
  if (id === handledAttempt) return;  // 同一次失败的第二次回调（error 事件 + promise reject）
  handledAttempt = id;
  if (status.phase === PHASE.CHECKING && useNextBackup()) {
    status.error = '';
    backupRetry = true;
    setPhase(PHASE.IDLE, '官方源连不上，换一条线路重试');
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
const MAC_API_DEFAULT = 'https://api.github.com/repos/lllvernan-blip/liantai-desktop/releases/latest';
const MAC_UA = 'liantai-desktop-updater';
const MAC_HOST_OK = /^(github\.com|api\.github\.com|[a-z0-9-]+\.githubusercontent\.com)$/i;   // 官方域（api 与资产）
const MAC_LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/i;                    // 自检用的假源
const MAC_API_TIMEOUT_MS = 30 * 1000;
const MAC_IDLE_TIMEOUT_MS = 60 * 1000;   // 下载 60 秒没有任何字节就算断（有字节流动会自动重置）
const MAC_REDIRECT_MAX = 5;
const UPDATE_DIR = 'updates';
const ZIP_NAME_RE = /^liantai-desktop-(\d+\.\d+\.\d+)-(arm64|x64)\.zip$/;

/* 换包脚本。写成文件、用 /bin/bash 起一个独立进程，因为它必须在应用退出**之后**才能动 .app。
   参数全部走位置参数（$1..$6），不做字符串拼接——路径里有空格（“/Applications/练习台.app”）
   或中文都不会被拆坏。
   注：这段是 bash，${...} 在 JS 模板串里要写成 \${ 转义。 */
const MAC_INSTALL_SCRIPT = `#!/bin/bash
# 练习台换包脚本：由应用在退出前写出并交出去，独立于应用活着
# $1=旧进程 pid  $2=新包 zip  $3=要替换的 .app  $4=期望版本  $5=日志文件  $6=重新打开的命令
set -u
PID="$1"; ZIP="$2"; TARGET="$3"; EXPECT="$4"; LOG="$5"; OPENCMD="$6"
note(){ printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG" 2>/dev/null; }
reopen(){ "$OPENCMD" "$TARGET" >>"$LOG" 2>&1; }

# 1) 等旧进程退出（最多 60 秒）：它不退，换包会把它脚下的目录搬走
n=0
while kill -0 "$PID" 2>/dev/null; do
  n=$((n+1))
  if [ "$n" -gt 300 ]; then note "更新放弃：旧进程 60 秒还没退出"; exit 1; fi
  sleep 0.2
done

# 2) 解压到临时目录，先不动原包
WORK="$(mktemp -d "\${TMPDIR:-/tmp}/liantai-update.XXXXXX")" || { note "更新放弃：建不了临时目录"; reopen; exit 1; }
if ! ditto -x -k "$ZIP" "$WORK" >>"$LOG" 2>&1; then
  mv "$ZIP" "$ZIP.bad" 2>/dev/null   # 坏包改名：别让它下次启动又被当成「已下好」端上去
  note "更新放弃：新包解压失败（下载不完整，或者包被改坏）——这份包已改名为 .bad，不会再用"
  rm -rf "$WORK"; reopen; exit 1
fi
NEW="$(/bin/ls -d "$WORK"/*.app 2>/dev/null | /usr/bin/head -n 1)"
if [ ! -d "$NEW" ]; then mv "$ZIP" "$ZIP.bad" 2>/dev/null; note "更新放弃：新包里没有 .app"; rm -rf "$WORK"; reopen; exit 1; fi
GOT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$NEW/Contents/Info.plist" 2>/dev/null)"
if [ "$GOT" != "$EXPECT" ]; then
  mv "$ZIP" "$ZIP.bad" 2>/dev/null
  note "更新放弃：包内版本不符（期望 $EXPECT，包内是 \${GOT:-读不到}）——这份包已改名为 .bad，不会再用"
  rm -rf "$WORK"; reopen; exit 1
fi

# 3) 换包：两次 rename，中间没有“应用不在”的窗口
BAK="$WORK/old.app"
if ! mv "$TARGET" "$BAK" 2>>"$LOG"; then
  note "更新放弃：没法挪走旧版（多半是权限）"; rm -rf "$WORK"; reopen; exit 1
fi
if ! mv "$NEW" "$TARGET" 2>>"$LOG"; then
  mv "$BAK" "$TARGET" 2>>"$LOG"
  note "更新失败：换入新版没成功，已恢复旧版"
  rm -rf "$WORK"; reopen; exit 1
fi
xattr -dr com.apple.quarantine "$TARGET" >>"$LOG" 2>&1
rm -rf "$BAK" "$WORK"
rm -f "$ZIP"
note "更新完成：$EXPECT"
reopen
exit 0
`;

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
  return MAC_HOST_OK.test(host) || MAC_LOOPBACK.test(host) || !!(mac && mac.apiHost && host === mac.apiHost);
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
function macPickAsset(assets, version) {
  const list = Array.isArray(assets) ? assets : [];
  const nameOf = (a) => String((a && a.name) || '');
  const urlOf = (a) => String((a && (a.browser_download_url || a.url)) || '');
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
    const tag = String((data && (data.tag_name || data.name)) || '').replace(/^v/i, '').trim();
    if (!/^\d+\.\d+\.\d+/.test(tag)) throw new Error('发布页没有可读的版本号');
    if (cmpVersion(tag, status.currentVersion) <= 0) {
      mac.pending = null;
      status.latestVersion = status.currentVersion;
      setPhase(PHASE.UP_TO_DATE, '已是最新（' + status.currentVersion + '）');
      schedule(PERIODIC_CHECK_MS);
      return snapshot();
    }
    const asset = macPickAsset(data.assets, tag);
    if (!asset) throw new Error('v' + tag + ' 没带适合本机的 mac 包');
    const url = String(asset.browser_download_url || asset.url || '');
    macAssertUrl(url);   // 地址不合规就在“检查”这一步就说清，不留到下载时才炸
    mac.pending = { version: tag, url: url, size: Number(asset.size) || 0, digest: String(asset.digest || '') };
    status.latestVersion = tag;
    setPhase(PHASE.AVAILABLE, 'v' + tag + ' 可用（点「更新到 v' + tag + '」开始下载）');
  } catch (err) {
    if (id === macAttempt) macFail('check', (err && err.message) || String(err));
  }
  return snapshot();
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

async function macPull(p) {
  macAssertUrl(p.url);
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

  let got = 0;
  let fail = null;
  try {
    const res = await macOpen(p.url, {}, MAC_IDLE_TIMEOUT_MS);
    const code = res.statusCode || 0;
    if (code !== 200) { res.resume(); throw new Error('下载地址回了 HTTP ' + code); }
    const total = Number(res.headers['content-length'] || p.size || 0);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    const t0 = Date.now();
    status.progress.total = total;
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
    if (p.digest) {
      const want = String(p.digest).replace(/^sha256:/i, '').toLowerCase();
      const gotHex = hash.digest('hex');
      if (want && want !== gotHex) throw new Error('下载校验没过（sha256 与发布页对不上）');
    }
    fs.renameSync(part, file);   // 校验过了才改回正名：半截文件不许看起来像“下好了”
  } catch (err) {
    fail = err;
  }
  try { fs.unlinkSync(part); } catch (err) { /* 没留下就算了 */ }
  if (fail) {
    if (id === macAttempt) macFail('download', (fail && fail.message) || String(fail));
    return;
  }

  mac.ready = { version: p.version, path: file };
  mac.pending = null;
  status.progress = { percent: 100, transferred: got, total: got, bytesPerSecond: 0 };
  setPhase(PHASE.DOWNLOADED, 'v' + p.version + ' 已下好，点「重启并更新」');
}

function macAssetName(p) {
  const fromUrl = String(p.url).split('?')[0].split('/').pop() || '';
  const clean = fromUrl.replace(/[^A-Za-z0-9._-]/g, '');
  if (ZIP_NAME_RE.test(clean)) return clean;
  return 'liantai-desktop-' + String(p.version).replace(/[^0-9A-Za-z.]/g, '') + '-' + process.arch + '.zip';
}

/* 从可执行文件往上找 .app（/Applications/练习台.app/Contents/MacOS/练习台） */
function macBundlePath() {
  const from = String((mac && mac.exePath) || process.execPath || '');
  const parts = from.split('/');
  for (let i = parts.length - 1; i >= 1; i--) {
    if (/\.app$/.test(parts[i])) return parts.slice(0, i + 1).join('/');
  }
  return '';
}

/* 换包：把脚本交出去，然后请他退出（脚本会等这个进程真的没了才动手）。
   同步返回 true = 已经交出去了（页面侧收到 200，随后应用会自己关掉再打开）。 */
function macInstall() {
  if (!macReady() || !mac.ready) return false;
  if (status.phase !== PHASE.DOWNLOADED) return false;
  const zip = mac.ready.path;
  const target = macBundlePath();
  if (!target) { macFail('install', '找不到应用本体（.app），这次更新只能手动装'); return false; }
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
    const child = spawn('/bin/bash', [scriptPath, String(mac.pid), zip, target, mac.ready.version, logPath, mac.openCmd], {
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

function stringify(m) {
  if (typeof m === 'string') return m;
  try {
    return JSON.stringify(m);
  } catch (err) {
    return String(m);
  }
}

module.exports = { initUpdate, checkUpdate, downloadUpdate, installUpdate, stopUpdate, macLastFailure, getStatus: snapshot, alignDifferentialCache, PHASE, BACKUP_FEEDS };
