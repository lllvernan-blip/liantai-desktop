'use strict';

/**
 * 练习台 — Electron 桌面壳（第 1 步：只做壳，业务代码原样保留）
 *
 * 设计要点：
 *  - 用 node http 在 127.0.0.1 上起一个极小的静态文件服务，把 app/ 目录挂起来；
 *    窗口通过 http:// 源加载，而不是 file://。
 *    原因：后续要在页面里直接抓取外部网页/素材，http 源能规避 file:// 下的 CORS 限制。
 *  - 业务依赖为零；壳里唯一的额外依赖是 electron-updater（差量自动更新，见 update.js）。
 *  - 关键事件追加写入 logs/startup.log，便于在没有截图的情况下验证启动。
 */

const { app, BrowserWindow, Menu, shell, screen, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const update = require('./update.js');
/* 导航白名单 / Host 校验 / CSP 三条策略在 shell-policy.js（能拿出来单独跑，见 tests/shell.mjs） */
const policy = require('./shell-policy.js');

const APP_DIR = path.join(__dirname, 'app');
const PRELOAD = path.join(__dirname, 'preload.js');
/* 测试副本：tools/build-test.mjs 打测试包时会埋一个 app/build-test.json（只有测试包里有）。
   发现它就把 userData 换成 "…-test"，与正式版彻底分家——测试版里怎么折腾都碰不到正式版的
   记录，正式版也照常能用。这两行必须排在 LOG_DIR 之前：那行会第一次调 app.getPath('userData')，
   路径一旦取过就改不回来了。 */
const IS_TEST = fs.existsSync(path.join(APP_DIR, 'build-test.json'));
if (IS_TEST) app.setPath('userData', app.getPath('userData') + '-test');
/* 开发版：日志跟着项目走（__dirname 可写）；
   打包版：asar 包内只读，日志必须写进 userData，否则写入被静默吞掉——打包版出问题将没有任何排查抓手。
   userData 各平台不同：Windows 是 %APPDATA%\liantai-desktop，macOS 是 ~/Library/Application Support/liantai-desktop。
   注意：这个目录名来自 package.json 的 name（不是 build.productName）——
   给 package.json 加顶层 productName、或改 name，都会让用户数据搬去新目录（用户会以为记录全丢了）。 */
const LOG_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'logs')
  : path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'startup.log');
const HOST = policy.HOST;

/* 端口必须稳定，不能用随机端口。
   localStorage 按 origin（含端口）分区：端口一变，应用看到的是一套全新的空存储，
   用户的设置、练习记录、草稿、划线会“凭空消失”（数据还在磁盘上，只是换了 key 空间）。 */
/* 测试副本换一个固定端口：两个版本能同时开着对比。
   更要紧的是 localStorage 按 origin 分区——测试版若总被正式版挤到邻近端口，
   它每次看到的都是另一套空存储，测出来的东西不算数。 */
const PREFERRED_PORT = IS_TEST ? 18744 : 18743;
const PORT_BUSY_RETRY = 3;      // 先反复试首选端口（上一个实例可能正在退出）
const PORT_FALLBACK_STEPS = 5;  // 仍被占用时退到邻近端口，并显式告警

/* 更新源：默认读包内 app-update.yml（由 package.json 的 build.publish 生成，指向 GitHub Release）。
   LIANTAI_UPDATE_FEED 只是「不改包也能换源」的开关：本地验证差量更新、或 GitHub 连不上时指到备用源/自建源。 */
const UPDATE_FEED_ENV = 'LIANTAI_UPDATE_FEED';
/* mac 那条链（update.js 里的 initMacUpdater）查的是 GitHub Releases API。同一个思路：
   不改包也能换一个「谁说有新版」的地方——验收要拿假源把查→下→换→重启走一轮。 */
const RELEASE_API_ENV = 'LIANTAI_RELEASE_API';
/* 材料源：同上，不改包也能换一个「材料从哪拉」的地方。验收要拿一个假源把
   拉→验签→落盘走一轮，拿真 GitHub 跑既慢又不可控。 */
const MATERIALS_API_ENV = 'LIANTAI_MATERIALS_API';
const APP = require('./app-meta.js');
const RELEASES_URL = APP.releasesUrl;

let mainWindow = null;
let server = null;
let serverPort = 0;
/* 壳要说给用户听的话（首页提示区）。did-finish-load 时灌给页面，页面用自己的提示区渲染，
   而不是壳直接替它写 HTML——两类提示可以并列，不会互相盖掉。 */
let startupNotices = [];

function escHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ */
/* 日志                                                                */
/* ------------------------------------------------------------------ */

function log(event, detail) {
  const line =
    '[' + new Date().toISOString() + '] ' +
    'pid=' + process.pid + ' ' +
    'port=' + (serverPort || '-') + ' ' +
    event +
    (detail === undefined || detail === null || detail === '' ? '' : ' :: ' + detail);

  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (err) {
    // 日志失败不能影响启动
    console.error('[startup.log 写入失败]', err && err.message);
  }
  console.log(line);
}

function initLog() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    console.error('[logs 目录创建失败]', err && err.message);
  }
  log('app-start', 'electron=' + process.versions.electron + ' node=' + process.versions.node + ' ' + process.platform + ' ' + process.arch);
}

/* ------------------------------------------------------------------ */
/* 极简静态文件服务                                                     */
/* ------------------------------------------------------------------ */

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
};

function send(res, status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store', 'Content-Security-Policy': policy.cspFor(newNonce()) }, headers || {});
  res.writeHead(status, h);
  res.end(body);
}

/* 每次响应一个新 nonce：页面里那个内联 <script> 只有拿到当次 nonce 才能执行 */
function newNonce() {
  return crypto.randomBytes(16).toString('base64');
}

function handleRequest(req, res) {
  /* Host 必须是本机这一个源（见 shell-policy.js 的注释：DNS rebinding 下 Host 那道比 Origin 靠得住）。
     静态页面也过这一道：谁能读源码不重要，重要的是「页面」与「接口」只从本源进得来。 */
  if (!policy.hostAllowed(req.headers.host, serverPort)) {
    log('http-badhost', 'host=' + (req.headers.host || '-') + ' ' + req.method + ' ' + req.url);
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://' + HOST).pathname);
  } catch (err) {
    send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  // 解码后若还含 NUL 字符（如 %00），fs.stat 对含 \0 的路径会同步抛 TypeError，
  // 直接把请求处理打进 uncaughtException——这种请求只配 400，不配碰文件系统。
  if (pathname.indexOf('\0') !== -1) {
    log('http-badrequest', pathname);
    send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  // 更新接口优先于静态文件：它不属于 app/ 目录，也不能被路径拼接碰到
  if (pathname.indexOf('/__update/') === 0) {
    handleUpdateRoute(req, res, pathname);
    return;
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';
  // Windows 上用 / 作分隔符，统一后交给 path
  const safeSuffix = path.normalize(pathname).replace(/^([/\\])+/, '');
  const filePath = path.join(APP_DIR, safeSuffix);

  // 目录穿越防护：解析后的路径必须仍在 APP_DIR 内
  const rel = path.relative(APP_DIR, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    log('http-forbidden', pathname);
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      log('http-404', pathname);
      send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    /* HTML 下发时给内联 <script> 打 nonce，CSP 里的 script-src 只认它。
       打不上（页面结构被改得认不出标签）就退回宽松策略：宁可这一条防线松一格，也不能白屏。 */
    const nonce = newNonce();
    const isHtml = /\.html?$/i.test(filePath);
    if (isHtml) {
      let html;
      try {
        html = fs.readFileSync(filePath, 'utf8');
      } catch (readErr) {
        log('http-read-error', pathname + ' :: ' + readErr.message);
        send(res, 500, 'Internal Error', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const injected = policy.injectNonce(html, nonce);
      const body = Buffer.from(injected.injected ? injected.html : html, 'utf8');
      if (!injected.injected) log('csp-nonce-missing', pathname + ' :: 没找到 <script> 标签，本次用宽松策略下发');
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': injected.injected ? policy.cspFor(nonce) : policy.cspForInlineFallback(),
      });
      res.end(body);
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': policy.cspFor(nonce),
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (streamErr) => {
      log('http-stream-error', pathname + ' :: ' + streamErr.message);
      res.destroy();
    });
    stream.pipe(res);
  });
}

/* ------------------------------------------------------------------ */
/* 更新接口（供页面调用）                                              */
/* ------------------------------------------------------------------ */

/* GET /status 只读不动作，不需要 x-liantai 头；
   其余动作一律要 x-liantai 自定义头——跨站请求会先触发 OPTIONS 预检，
   而本服务从不回 CORS 头，预检不过就发不出来。防线不靠「端口没人知道」。
   所有路由（含 /status）都过 Origin 校验：与本源不符就拒。
   不带 Origin 的请求必须放行（页面自己 fetch 同源 GET 根本不发 Origin），
   所以这里不是「只靠 Origin」——另外两道是 Host 校验（handleRequest 开头）与 x-liantai 头。 */
function handleUpdateRoute(req, res, pathname) {
  const json = (code, body) => send(res, code, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8' });
  const action = pathname.slice('/__update'.length);

  if (!policy.originAllowed(req.headers.origin, serverPort)) {
    log('update-forbidden', 'origin=' + req.headers.origin + ' ' + req.method + ' ' + pathname);
    json(403, { ok: false, error: 'forbidden' });
    return;
  }

  if (req.method === 'GET' && action === '/status') {
    json(200, update.getStatus());
    return;
  }

  if (req.headers['x-liantai'] !== '1') {
    log('update-forbidden', req.method + ' ' + pathname);
    json(403, { ok: false, error: 'forbidden' });
    return;
  }

  if (req.method === 'POST' && action === '/check') {
    update.checkUpdate()
      .then((s) => json(200, { ok: true, status: s }))
      .catch(() => json(200, { ok: false, status: update.getStatus() }));
    return;
  }

  /* 只查不下不够用：出结果后得能把新版拉下来（mac 自实现那条链的下载入口）。
     Windows 那边下载是 electron-updater 自己干的（autoDownload），这个路由对它恒返回 409。 */
  if (req.method === 'POST' && action === '/download') {
    const ok = update.downloadUpdate();
    log('update-download-request', ok ? 'accepted' : 'rejected :: phase=' + update.getStatus().phase);
    json(ok ? 200 : 409, { ok, status: update.getStatus() });
    return;
  }

  if (req.method === 'POST' && action === '/install') {
    const ok = update.installUpdate();
    log('update-install-request', ok ? 'accepted' : 'rejected :: phase=' + update.getStatus().phase);
    json(ok ? 200 : 409, { ok, status: update.getStatus() });
    return;
  }

  json(404, { ok: false, error: 'unknown update route' });
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handleRequest);
    const onError = (err) => {
      s.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      s.removeListener('error', onError);
      server = s;
      resolve(s.address().port);
    };
    s.once('error', onError);
    s.once('listening', onListening);
    s.listen(port, HOST);
  });
}

function announcePort() {
  log('server-listening', 'http://' + HOST + ':' + serverPort + '/ -> ' + APP_DIR);
}

async function startServer() {
  // 1) 首选端口：稳定 origin 是第一优先，宁可等一会儿
  for (let attempt = 1; attempt <= PORT_BUSY_RETRY; attempt++) {
    try {
      serverPort = await listenOn(PREFERRED_PORT);
      announcePort();
      return serverPort;
    } catch (err) {
      log('port-busy', 'port=' + PREFERRED_PORT + ' attempt=' + attempt + ' :: ' + (err.code || err.message));
      if (attempt < PORT_BUSY_RETRY) await new Promise((r) => setTimeout(r, 400));
    }
  }

  // 2) 退到邻近端口：能用，但要明确告警——origin 变了，用户会看到“数据没了”
  for (let p = PREFERRED_PORT + 1; p <= PREFERRED_PORT + PORT_FALLBACK_STEPS; p++) {
    try {
      serverPort = await listenOn(p);
      announcePort();
      log('port-fallback-warning', 'origin 与常用端口不同，本机已有数据可能显示为空（数据未丢失，只是换了存储空间）');
      return serverPort;
    } catch (err) {
      log('port-busy', 'port=' + p + ' :: ' + (err.code || err.message));
    }
  }

  // 3) 最后退到系统分配端口（保底能启动，但存储空间不确定）
  serverPort = await listenOn(0);
  announcePort();
  log('port-random-warning', '已退到系统分配端口，本机已有数据可能显示为空');
  return serverPort;
}

function stopServer() {
  if (!server) return;
  try {
    server.close();
    log('server-closed');
  } catch (err) {
    log('server-close-error', err && err.message);
  }
  server = null;
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

/* 菜单。
   Windows / Linux：本来就没有系统级菜单栏这回事，直接清掉（autoHideMenuBar 也配合）。
   macOS 不能清：Cmd+C / Cmd+V / Cmd+A / Cmd+Z 这些编辑快捷键是菜单项的 role 提供的，
   菜单一空，作答框里连复制粘贴都不响应——这工具整个是靠打字练的，不能少这几项。
   只留最小三组：应用菜单（关于/隐藏/退出）、编辑菜单、窗口菜单。 */
function applyMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

/* 窗口尺寸记忆：默认 1040×720 居中——内容列就一张纸的宽度，开再大两侧全是空，看着像铺满了屏幕却没内容。
   用户手动调过就记住（userData/window-bounds.json），下次按他的来；读不到/不合法就用默认，不算错。
   最大化/全屏状态不写回：那不是用户想要的「窗口大小」，下次开机不该被扣在全屏上。 */
const WIN_DEFAULT = { width: 1040, height: 720 };
function windowBoundsFile() { return path.join(app.getPath('userData'), 'window-bounds.json'); }
function loadWindowBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(windowBoundsFile(), 'utf8'));
    if (b && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width >= 900 && b.height >= 600) return b;
  } catch (e) {}
  return null;
}
let _boundsSaveTimer = null;
function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
  clearTimeout(_boundsSaveTimer);
  _boundsSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(windowBoundsFile(), JSON.stringify(mainWindow.getBounds())); } catch (e) {}
  }, 300);
}

/* ============ 材料池 ============
   池子是一堆「事实骨架」（一条一个事实、带数字带限定语的清单）。只存骨架不存原文：既省空间，
   也避开转载整篇文章的问题。骨架由后台抓取提炼写入，界面出题时来取一篇。
   位置在 userData/材料池/ —— 测试副本有自己的 userData，池子也就自然跟着分家，互不影响。
   界面是沙箱拿不到 fs，所以读写都在这里，只通过 preload 的三个口子（见 preload.js）暴露出去。 */
function poolDir() { return path.join(app.getPath('userData'), '材料池'); }
function poolUsedFile() { return path.join(app.getPath('userData'), 'pool-used.json'); }
/* 名字一律只认文件名本身：挡掉 ../ 与绝对路径，越出池子目录的请求一律当没这篇 */
function poolFile(name) {
  const s = String(name || '');
  if (!s || s !== path.basename(s) || !/[.]md$/.test(s)) return null;
  return path.join(poolDir(), s);
}
function poolUsedRead() {
  try { const j = JSON.parse(fs.readFileSync(poolUsedFile(), 'utf8')); return Array.isArray(j) ? j : []; }
  catch (e) { return []; }
}
function poolListSync() {
  let names = [];
  try { names = fs.readdirSync(poolDir()).filter(f => /[.]md$/.test(f)); } catch (e) { return []; }
  const used = poolUsedRead();
  return names.map(name => {
    let head = '';
    try { head = fs.readFileSync(path.join(poolDir(), name), 'utf8').slice(0, 400); } catch (e) {}
    const title = ((head.match(/^# (.+)$/m) || [, ''])[1] || '').trim();
    const topics = (((head.match(/^主题：(.+)$/m) || [, ''])[1] || '')).split('、').map(s => s.trim()).filter(Boolean);
    return { name, title, topics, used: used.indexOf(name) >= 0 };
  });
}
function poolHandlers() {
  ipcMain.handle('pool:list', () => poolListSync());
  ipcMain.handle('pool:stat', () => { const all = poolListSync(); return { total: all.length, unused: all.filter(x => !x.used).length }; });
  ipcMain.handle('pool:pick', (_e, arg) => {
    const all = poolListSync();
    if (!all.length) return null;                    // 池子空：由界面回落到编材料
    const topics = (arg && Array.isArray(arg.topics)) ? arg.topics : [];
    // 优先挑主题对得上的；已用过的一律不碰（同一个人不该重复拿到同一篇）
    let cands = all.filter(x => !x.used && topics.length && x.topics.some(t => topics.indexOf(t) >= 0));
    if (!cands.length) cands = all.filter(x => !x.used);
    if (!cands.length) return null;                  // 都用过了：回落编材料，而不是重放旧的
    const pick = cands[Math.floor(Math.random() * cands.length)];
    const f = poolFile(pick.name);
    if (!f) return null;
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return null; }
    try {
      const used = poolUsedRead();
      if (used.indexOf(pick.name) < 0) { used.push(pick.name); fs.writeFileSync(poolUsedFile(), JSON.stringify(used), 'utf8'); }
    } catch (e) {}
    return { name: pick.name, title: pick.title, text };
  });
}

function createWindow() {
  const saved = loadWindowBounds();
  mainWindow = new BrowserWindow({
    width: saved ? saved.width : WIN_DEFAULT.width,
    height: saved ? saved.height : WIN_DEFAULT.height,
    ...(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: saved.x, y: saved.y } : { center: true }),
    title: IS_TEST ? '练习台（测试）' : '练习台',
    autoHideMenuBar: true,
    // macOS 无边框标题栏（SPEC 3.2）：顶栏融入窗口壳，页面侧用 .shell-mac 给红绿灯让位；Windows 忽略此选项
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // 开屏底色跟页面底板同色（暖浅灰）：默认纯白会在页面加载前闪一屏白
    backgroundColor: '#F4F1EA',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 界面是沙箱（sandbox: true）：文件系统一律拿不到，需要的东西由 preload.js 那三个只读口子递过去
      preload: PRELOAD,
      sandbox: true,
    },
  });
  // 记住的位置若落在已拔掉的显示器上（外接屏场景），拉回主屏居中，不跟用户玩「窗口找不到了」
  try {
    const b = mainWindow.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const visible = b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y;
    if (!visible) mainWindow.center();
  } catch (e) {}
  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);
  mainWindow.on('close', saveWindowBounds);

  // 隐藏默认菜单栏（macOS 例外，见 applyMenu 的注释）
  applyMenu();
  if (process.platform !== 'darwin') mainWindow.setMenuBarVisibility(false);

  const wc = mainWindow.webContents;

  wc.on('did-finish-load', () => {
    log('did-finish-load', wc.getURL());
    // 页面刚加载完：把当前更新状态推过去（开机后 12 秒才查，这里通常还是 idle，页面会自己接着轮询）
    try {
      wc.executeJavaScript(
        'try { typeof __updatePush === "function" && __updatePush(' + JSON.stringify(update.getStatus()) + '); } catch (e) {}'
      ).catch(() => {});
    } catch (err) {
      log('update-push-failed', (err && err.message) || String(err));
    }
    // 壳要说的话（端口退让 / 上次换包失败）：灌进页面，由页面自己的提示区并列渲染
    if (startupNotices.length) {
      try {
        wc.executeJavaScript(
          'try { window.__otaStartupNotices = ' + JSON.stringify(startupNotices) +
          '; typeof renderStartNotices === "function" && renderStartNotices(); } catch (e) {}'
        ).catch(() => {});
      } catch (err) {
        log('startup-notice-failed', (err && err.message) || String(err));
      }
    }
  });

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    log('did-fail-load', 'code=' + errorCode + ' desc=' + errorDescription + ' url=' + validatedURL + ' mainFrame=' + isMainFrame);
  });

  wc.on('render-process-gone', (_e, details) => {
    log('render-process-gone', 'reason=' + details.reason + ' exitCode=' + details.exitCode);
    /* 崩溃别留白屏：重载本机页面。连续崩也重载——每次都有日志，查得回来；
       不重载的话用户只能自己猜着重启。 */
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      try { wc.loadURL('http://' + HOST + ':' + serverPort + '/index.html').catch((err) => log('reload-after-crash-failed', err && err.message)); } catch (err) {
        log('reload-after-crash-failed', (err && err.message) || String(err));
      }
    }
  });

  wc.on('preload-error', (_e, preloadPath, error) => {
    log('preload-error', preloadPath + ' :: ' + (error && error.message));
  });

  wc.on('console-message', (...args) => {
    // Electron 36+ 传 (event, details)，更早版本传位置参数；两种都兼容
    const details = args[1] && typeof args[1] === 'object' ? args[1] : null;
    const level = details ? details.level : args[1];
    const message = details ? details.message : args[2];
    const line = details ? details.lineNumber : args[3];
    const sourceId = details ? details.sourceId : args[4];
    // 只记录警告级别以上的控制台消息，避免日志噪声
    if (level === 'warning' || level === 'error' || (typeof level === 'number' && level >= 2)) {
      log('console', 'level=' + level + ' ' + sourceId + ':' + line + ' ' + message);
    }
  });

  // 外部链接交给系统浏览器，窗口内不做导航
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  /* setWindowOpenHandler 只拦 window.open，拦不住窗口内 location 跳转 / 表单提交——
     补 will-navigate：本实例自己那个源（端口算在内）放行，其余一律取消，http(s) 转交系统浏览器。 */
  wc.on('will-navigate', (e, url) => {
    if (policy.isOwnUrl(url, serverPort)) return;
    e.preventDefault();
    log('will-navigate-blocked', url);
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  const target = 'http://' + HOST + ':' + serverPort + '/index.html';
  log('load-url', target);
  mainWindow.loadURL(target).catch((err) => {
    log('load-url-error', err && err.message);
  });

  mainWindow.on('closed', () => {
    log('window-closed');
    mainWindow = null;
  });

  mainWindow.on('unresponsive', () => log('window-unresponsive'));
  mainWindow.on('responsive', () => log('window-responsive'));
}

/* ------------------------------------------------------------------ */
/* 更新                                                                */
/* ------------------------------------------------------------------ */

function setupUpdate() {
  /* 测试版不接更新链：它换了 userData，自动更新一装就把自己换成正式版，被测的东西当场消失。 */
  if (IS_TEST) { log('update-skipped', '测试副本，不接更新链'); return; }
  // 更新是锦上添花，绝不能弄死启动：这儿的任何异常都只能进日志
  try {
    update.initUpdate({
      log: log,
      isPackaged: app.isPackaged,
      currentVersion: app.getVersion(),
      releasesUrl: RELEASES_URL,
      feed: process.env[UPDATE_FEED_ENV] || '',
      /* mac 链要的四样：往哪下、往哪放、退出时找谁、显示位置时找谁 */
      macApi: process.env[RELEASE_API_ENV] || '',
      userDataDir: app.getPath('userData'),
      exePath: process.execPath,
      quit: () => app.quit(),
      reveal: (p) => { try { shell.showItemInFolder(p); } catch (err) { /* 没打开也不影响把话说清 */ } },
      // 状态变了就推给页面（页面自己决定怎么显示：顶栏提示 / 设置面板里的行）
      onStatusChange: (s) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.executeJavaScript(
          'try { typeof __updatePush === "function" && __updatePush(' + JSON.stringify(s) + '); } catch (e) {}'
        ).catch(() => {});
      },
    });
  } catch (err) {
    log('update-setup-failed', (err && err.stack) || String(err));
  }

  /* 材料池：与版本发布解耦，启动后安静拉一份最新的。拉不到就用随包兜底（或本机已有的），
     全程不报错、不弹窗——有据出题是加成，不是前提。见 update.js 的「材料同步」。 */
  try {
    const m = update.initMaterials({
      userDataDir: app.getPath('userData'),
      appDir: __dirname,
      api: process.env[MATERIALS_API_ENV] || '',
      log: log,
    });
    if (m && m.seeded) log('materials-seeded', '首次运行，随包兜底 ' + m.seeded + ' 篇');
  } catch (err) {
    log('materials-setup-failed', (err && err.stack) || String(err));
  }
}

/* 启动时要把话说给用户听的几件事（首页提示区，不是日志）。
   端口退让 = origin 变了 = 他会看到一套空存储：只写日志不行（打包版日志写进 userData，他不会去看）。
   上次换包失败 = 「点了更新，应用关掉又打开，还是老版本」——不说一句就没有任何解释。 */
function collectStartupNotices() {
  if (serverPort !== PREFERRED_PORT) {
    startupNotices.push('<b>注意：</b>本次启动端口 ' + serverPort +
      ' 被占用，你之前的练习数据不在这里显示——<b>数据没有丢</b>，' +
      '关掉占用端口的程序后重新打开本应用即可恢复。');
    log('port-fallback-notice', '已把端口退让的事写进首页提示');
  }
  const fail = update.macLastFailure();
  if (fail) {
    startupNotices.push('<b>上次自动更新没成功：</b>' + escHtml(fail) +
      '。现在用的还是 v' + escHtml(app.getVersion()) +
      '，可以到「设置 → 版本与更新」再试一次，或点那里的「打开发布页」手动装。');
    log('update-install-failed-notice', fail);
  }
}

/* ------------------------------------------------------------------ */
/* 进程级异常                                                          */
/* ------------------------------------------------------------------ */

process.on('uncaughtException', (err) => {
  log('uncaughtException', (err && err.stack) || String(err));
});

process.on('unhandledRejection', (reason) => {
  log('unhandledRejection', (reason && reason.stack) || String(reason));
});

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // 已有实例：直接退出，由已有实例的 second-instance 事件激活窗口
  initLog();
  log('second-instance-exit', '未获得单实例锁，退出');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('second-instance', '第二个实例被阻止，激活已有窗口');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  initLog();

  app.on('web-contents-created', (_e, contents) => {
    contents.on('render-process-gone', (_ev, details) => {
      log('render-process-gone(global)', 'reason=' + details.reason + ' exitCode=' + details.exitCode);
    });
  });

  app.whenReady().then(() => {
    poolHandlers();
    log('app-ready');
    return startServer();
  }).then(() => {
    createWindow();
    setupUpdate();
    collectStartupNotices();
  }).catch((err) => {
    log('startup-failed', (err && err.stack) || String(err));
    app.quit();
  });

  app.on('window-all-closed', () => {
    log('window-all-closed');
    stopServer();
    app.quit();
  });

  app.on('before-quit', () => {
    log('before-quit');
    update.stopUpdate();
    stopServer();
  });

  app.on('will-quit', () => {
    log('will-quit');
  });
}
