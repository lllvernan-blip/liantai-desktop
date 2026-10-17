/*
 * 官网自检 —— site/index.html 的「按平台给对的包」与「链接走加速镜像」。
 *
 * 为什么单独一份：这片页面不在应用里跑，app/index.html 那套断言够不着它；而它出的错
 * 都是用户当面就看见的——点下载拿到旧版、拿到一个根本不存在的包、或者只有 Mac 的人有按钮。
 *
 * 手法与 run.mjs 一致：抠出页面里的 <script>，配最小 DOM 桩子，在 data: 模块里跑一遍。
 * 页面那两处取数是 async IIFE，所以断言在同一个模块里等一下再读 DOM；
 * 等的时候用的是 node 的真定时器——run.mjs 跑完应用侧之后，全局 setTimeout 已经被换成桩子了。
 *
 * 最后才跑（run.mjs 里排在应用自检之后）：它会把 globalThis.document 换成自己那份。
 */
import { readFileSync } from "node:fs";
import { setTimeout as realSetTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "site", "index.html"), "utf8");
const script = html.slice(html.indexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
if (!script.trim()) {
  console.error("没在 site/index.html 里找到 <script> 块，页面结构可能被改动了。");
  process.exit(1);
}

const T = [];
const ok = (c, m) => T.push((c ? "PASS  " : "FAIL  ") + m);

const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
const EXE = "liantai-desktop-setup-0.0.22.exe";
const DMG = "liantai-desktop-0.0.22-arm64.dmg";
const endsWith = (s, tail) => typeof s === "string" && s.slice(-tail.length) === tail;

/* 跑一遍页面脚本，返回它画完之后 DOM 里的东西。
   latest / api 传 null 表示这一级拿不到（页面该往下一级退）。 */
let runId = 0;
async function run(opts) {
  /* 箭头函数的体用圆括号包住：直接写 {…} 会被当成块，里面的引号会被读成标签 */
  const reply = (v) => (v === null ? "{ ok:false }" : "{ ok:true, json: async () => (" + JSON.stringify(v) + ") }");
  /* 源里带个序号：两次用例的源一模一样时，data: 模块会被模块缓存命中而不重跑 */
  runId++;
  const src = [
    "/* run " + runId + " */",
    // 最小 DOM：这页只用到 getElementById(...) 的 href / textContent / innerHTML
    "const __els = {};",
    "globalThis.document = { getElementById: id => __els[id] || (__els[id] = { href:'', innerHTML:'', _t:'',",
    "  get textContent(){ return this._t; }, set textContent(v){ this._t = String(v); } }) };",
    "globalThis.fetch = async (url) => { const u = String(url);",
    "  if(u.indexOf('latest.json') >= 0) return " + reply(opts.latest) + ";",
    "  if(u.indexOf('changelog.json') >= 0) return { ok:false };",
    "  if(u.indexOf('api.github.com') >= 0) return " + reply(opts.api) + ";",
    "  return { ok:false }; };",
    script,
    "await new Promise(r => globalThis.__realSetTimeout(r, 30));",
    "globalThis.__view = {",
    "  btnHref: __els.dlBtn.href, btnText: __els.dlBtn.textContent,",
    "  meta: __els.dlMeta.textContent,",
    "  otherHref: __els.dlOther.href, otherText: __els.dlOther.textContent,",
    "  srcAlt: __els.srcAlt.href, srcDirect: __els.srcDirect.href,",
    "  clRows: (__els.clList.innerHTML.match(/<div class=\"row\">/g) || []).length,",
    "  clN: __els.clN.textContent };",
  ].join("\n");
  globalThis.__realSetTimeout = realSetTimeout;
  /* node 22 起 globalThis.navigator 就存在了，模块里是严格模式、直接赋值会抛，只能用 defineProperty */
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: opts.ua }, configurable: true, writable: true });
  await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));
  const view = globalThis.__view;
  delete globalThis.__view;
  return view;
}

const bothPlatforms = {
  version: "0.0.22", date: "2026-10-17",
  windows: { version: "0.0.22", tag: "v0.0.22", date: "2026-10-17", file: EXE, size: 86729277 },
  mac: { version: "0.0.22", tag: "v0.0.22", date: "2026-10-17", file: DMG, size: 100813509 },
};

/* 一级：站点自带的 latest.json（线上正常情形） */
let v = await run({ ua: WIN_UA, latest: bothPlatforms, api: null });
ok(endsWith(v.btnHref, "releases/download/v0.0.22/" + EXE), "取数一级: Windows 打开时，主按钮就是这个版本的 .exe");
ok(v.btnHref.indexOf("https://ghproxy.net/https://github.com/") === 0, "取数一级: 主按钮先走加速镜像，不是直连 github.com");
ok(v.btnText === "下载 Windows 版", "取数一级: 主按钮文案跟着这台电脑的平台走");
ok(v.meta.indexOf("0.0.22") === 0 && v.meta.indexOf("2026-10-17") > 0 && v.meta.indexOf("83 MB") > 0,
   "取数一级: 版本 / 日期 / 大小写在按钮下面（这是这个包的数，不是另一个平台的）");
ok(endsWith(v.otherHref, "releases/download/v0.0.22/" + DMG) && v.otherText === "下载 macOS 版",
   "取数一级: 「不是这台电脑？」给的是另一个平台的包");
ok(endsWith(v.srcAlt, "v0.0.22/" + EXE) && v.srcAlt.indexOf("https://gh-proxy.com/") === 0,
   "取数一级: 换源第一条指向第二个镜像，包还是同一个");
ok(endsWith(v.srcDirect, "v0.0.22/" + EXE) && v.srcDirect.indexOf("https://github.com/") === 0,
   "取数一级: 换源最后一条是直连 GitHub（镜像全挂了也下得到）");
ok(v.clRows === 4 && v.clN === "18", "更新日志: 读不到 changelog.json 时用页面内联那份，最近 4 条在外、其余折叠");

/* 同一份数据，换一台 Mac 打开：按钮该换过来 */
v = await run({ ua: MAC_UA, latest: bothPlatforms, api: null });
ok(endsWith(v.btnHref, "releases/download/v0.0.22/" + DMG) && v.btnText === "下载 macOS 版",
   "取数一级: Mac 打开时主按钮换成 dmg");
ok(endsWith(v.otherHref, "v0.0.22/" + EXE) && v.otherText === "下载 Windows 版",
   "取数一级: Mac 上「不是这台电脑？」换成 Windows 包");

/* 二级：latest.json 还没生成（或访客没取到），退 GitHub API。
   这里造的情形正是这个仓库发版的常态：最新一版只有 mac（prerelease 单发），Windows 还没跟上。
   API 列表里最新的 v0.0.23 只有 dmg，v0.0.22 两端齐。 */
const apiList = [
  { tag_name: "v0.0.23", draft: false, published_at: "2026-10-20T00:00:00Z",
    assets: [{ name: "liantai-desktop-0.0.23-arm64.dmg", size: 100000000 }] },
  { tag_name: "v0.0.22", draft: false, published_at: "2026-10-17T00:00:00Z",
    assets: [{ name: EXE, size: 86729277 }, { name: DMG, size: 100813509 }] },
  { tag_name: "v0.0.21", draft: false, prerelease: true, published_at: "2026-10-13T00:00:00Z",
    assets: [{ name: "liantai-desktop-0.0.21-arm64.dmg", size: 100800653 }] },
];
v = await run({ ua: WIN_UA, latest: null, api: apiList });
ok(endsWith(v.btnHref, "v0.0.22/" + EXE) && v.meta.indexOf("0.0.22") === 0,
   "取数二级: mac 单发一版时，Windows 那栏仍指上一次的正式包（不给不存在的包）");
ok(endsWith(v.otherHref, "releases/download/v0.0.23/liantai-desktop-0.0.23-arm64.dmg"),
   "取数二级: Mac 那栏拿到最新那一版（mac 单发的版本也是给人用的）");
v = await run({ ua: MAC_UA, latest: null, api: apiList });
ok(endsWith(v.btnHref, "v0.0.23/liantai-desktop-0.0.23-arm64.dmg") && v.meta.indexOf("0.0.23") === 0,
   "取数二级: Mac 打开时主按钮直接是最新那一版");

/* 两级都拿不到：保持写死的数，不显示拿不准的东西（也不该是空的或旧版） */
v = await run({ ua: WIN_UA, latest: null, api: null });
ok(endsWith(v.btnHref, "v0.0.22/" + EXE) && v.meta.indexOf("0.0.22") === 0,
   "取数兜底: 两级都拿不到时用页面里写死的版本，按钮照样能下载");
ok(v.btnHref.indexOf("/v0.0.21/") < 0, "取数兜底: 写死的版本号不是上一版（旧版号会让用户下到旧包）");
ok(html.indexOf('href="https://github.com/lllvernan-blip/liantai-desktop/releases/download/v0.0.21') < 0,
   "页面源码里没有残留指向 v0.0.21 安装包的链接");

console.log(T.join("\n"));
const fails = T.filter((x) => x.indexOf("FAIL") === 0);
console.log("\n== 官网 " + (T.length - fails.length) + "/" + T.length + " passed ==");
if (fails.length) process.exitCode = 1;
