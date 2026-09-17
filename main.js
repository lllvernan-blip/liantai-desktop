'use strict';

/**
 * 综应练习台 — Electron 桌面壳（第 1 步：只做壳，业务代码原样保留）
 *
 * 设计要点：
 *  - 用 node http 在 127.0.0.1 上起一个极小的静态文件服务，把 app/ 目录挂起来；
 *    窗口通过 http:// 源加载，而不是 file://。
 *    原因：后续要在页面里直接抓取外部网页/素材，http 源能规避 file:// 下的 CORS 限制。
 *  - 只使用 electron + node 标准库，零额外依赖。
 *  - 关键事件追加写入 logs/startup.log，便于在没有截图的情况下验证启动。
 */

const { app, BrowserWindow, Menu, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, 'app');
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'startup.log');
const HOST = '127.0.0.1';

/* 端口必须稳定，不能用随机端口。
   localStorage 按 origin（含端口）分区：端口一变，应用看到的是一套全新的空存储，
   用户的设置、练习记录、草稿、划线会“凭空消失”（数据还在磁盘上，只是换了 key 空间）。 */
const PREFERRED_PORT = 18743;
const PORT_BUSY_RETRY = 3;      // 先反复试首选端口（上一个实例可能正在退出）
const PORT_FALLBACK_STEPS = 5;  // 仍被占用时退到邻近端口，并显式告警

let mainWindow = null;
let server = null;
let serverPort = 0;

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
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(status, h);
  res.end(body);
}

function handleRequest(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://' + HOST).pathname);
  } catch (err) {
    send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
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
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (streamErr) => {
      log('http-stream-error', pathname + ' :: ' + streamErr.message);
      res.destroy();
    });
    stream.pipe(res);
  });
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: '综应练习台',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 第 1 步不暴露任何 preload API
      sandbox: true,
    },
  });

  // 隐藏默认菜单栏
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  const wc = mainWindow.webContents;

  wc.on('did-finish-load', () => {
    log('did-finish-load', wc.getURL());
  });

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    log('did-fail-load', 'code=' + errorCode + ' desc=' + errorDescription + ' url=' + validatedURL + ' mainFrame=' + isMainFrame);
  });

  wc.on('render-process-gone', (_e, details) => {
    log('render-process-gone', 'reason=' + details.reason + ' exitCode=' + details.exitCode);
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
    log('app-ready');
    return startServer();
  }).then(() => {
    createWindow();
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
    stopServer();
  });

  app.on('will-quit', () => {
    log('will-quit');
  });
}
