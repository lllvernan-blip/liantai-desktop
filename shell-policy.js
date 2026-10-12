'use strict';

/**
 * 壳侧的三条边界策略：导航白名单、Host 校验、渲染进程 CSP。
 *
 * 为什么单独一个模块：这三条都是能被纯代码验证的，`node tests/shell.mjs` 直接跑它们。
 * 留在 main.js 里就只能靠源码字符串匹配去「证实」，而那种断言把逻辑删了照样是绿的。
 * 主进程里凡是能拿出来的判断，都往这里放。
 */

const HOST = '127.0.0.1';

/* 本机源就这一个：127.0.0.1 + 当前端口。端口退让后它会变，所以一律现算，不写死。 */
function ownOrigin(port) {
  return 'http://' + HOST + ':' + port;
}

/* 窗口内导航只放行本实例自己那个源。按「源」比，不按字符串前缀比：
   前缀匹配会把 http://127.0.0.1:187431 也算成自家（端口是 18743 的时候）。
   允许跟在源后面的只有路径 / 查询 / 锚点三种开头。 */
function isOwnUrl(url, port) {
  if (typeof url !== 'string') return false;
  const origin = ownOrigin(port);
  if (url.indexOf(origin) !== 0) return false;
  const rest = url.slice(origin.length);
  return rest === '' || rest[0] === '/' || rest[0] === '?' || rest[0] === '#';
}

/* Host 必须是本机这一个源。DNS rebinding 下攻击者的域名解析到 127.0.0.1：
   请求是自己的页面发出的，Origin 可能是攻击者的域、也可能压根没有（`<img>`/`<script>` 这类不带 Origin），
   但 Host 一定写着攻击者的域名——所以这一道比 Origin 那道更靠得住。 */
function hostAllowed(hostHeader, port) {
  return hostHeader === HOST + ':' + port;
}

/* Origin 校验：与本源相同放行；不同就拒。
   **不带 Origin 的请求必须放行**：页面自己 fetch 同源的 GET（/__update/status 就是）根本不发 Origin，
   一刀切要求「必须有 Origin」只会把自己的轮询拒掉。改动作的那几条路由另有 x-liantai 自定义头把关，
   而带自定义头的跨站请求会先触发 OPTIONS 预检，本服务从不回 CORS 头——两道合起来才成立，别只留一道。 */
function originAllowed(originHeader, port) {
  return !originHeader || originHeader === ownOrigin(port);
}

/* 渲染进程的 CSP（由本地服务下发响应头，比页面里的 <meta> 更靠前，也不会被页面自己改掉）。
   script-src 只给 nonce：不给 'self'（没有外部脚本要加载）、也不给 'unsafe-inline'——
   页面里那个内联 <script> 由服务下发时打上 nonce，别的脚本一律不许加载、不许内联执行；
   没给 'unsafe-eval'，eval 与 new Function 也关着。
   style-src 必须留 'unsafe-inline'：界面大量用 style="…" 属性（进度条宽度这类）现算现写。
   connect-src 留 http: ：接口地址是用户自由填写的，有人指着本机或局域网的明文代理（如 ollama），
   而 https 本来就开着，禁掉 http 换不来多少安全。
   改这条要先想 default-src 'none'：新增任何一类资源（图标 / 字体 / 媒体）都得在这里开口子。 */
function cspFor(nonce) {
  return buildCsp("script-src 'nonce-" + nonce + "'");
}

/* 内联脚本认不出来时的退路：script-src 退回 'self' 'unsafe-inline'（只在这种情况下用） */
function cspForInlineFallback() {
  return buildCsp("script-src 'self' 'unsafe-inline'");
}

function buildCsp(scriptSrc) {
  return [
    "default-src 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' https: http:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/* 给 HTML 里的内联 <script> 打 nonce。
   认不出标签就如实回报 injected:false，调用方据此退回不带 nonce 的宽松策略——
   nonce 打不上去而策略照旧的话，页面会整个白屏；这一条防线松一格可以，白屏不行。 */
function injectNonce(html, nonce) {
  const src = String(html);
  const tags = src.match(/<script(?=[\s>])/gi) || [];
  const out = src.replace(/<script(?=[\s>])/gi, '<script nonce="' + nonce + '"');
  return { html: out, injected: tags.length > 0, tags: tags.length };
}

module.exports = { HOST, ownOrigin, isOwnUrl, hostAllowed, originAllowed, cspFor, cspForInlineFallback, injectNonce };
