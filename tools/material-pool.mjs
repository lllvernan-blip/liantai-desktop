/*
 * 材料池 —— 抓一手材料、提炼成事实骨架、落盘。
 *
 *   node tools/material-pool.mjs fetch <检索词> [篇数]   抓取 → 提炼 → 落盘
 *   node tools/material-pool.mjs list                    看池子里有什么
 *
 * 规矩全在 docs/材料规范.md（第五节「提炼」、第八节「时效」）：这里只实现，不另立口径。
 * 与 drift.mjs 同一套路子：把 app/index.html 的脚本抠出来配 DOM 桩跑，所以提炼走的是应用里真实的
 * callLLM（降级阶梯、空输出重发、撞额度翻倍都在），不是另写一份请求。
 *
 * 环境变量：
 *   LIANTAI_KEY      不设也能跑——从本机应用数据目录里取已存的 Key（只读，不写仓库、不打印）。
 *   LIANTAI_MODEL    默认 deepseek-flash。
 *   LIANTAI_MAT_DIR  材料池目录，默认 ~/练习台材料。
 *
 * 边界：真接口、真花钱（一篇一次提炼调用）。抓下来的原文不落盘，只落骨架。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir, homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const phase = (process.argv[2] || "").trim();
const DIR = process.env.LIANTAI_MAT_DIR || join(homedir(), "练习台材料");
const poolDir = join(DIR, "池子");
const rawDir = join(DIR, "原文");     // 只在 fetch 过程中临时用，跑完不留（规范：只存骨架，不存原文）

if (phase !== "fetch" && phase !== "list") {
  console.error("用法：node tools/material-pool.mjs fetch <检索词> [篇数] | list");
  process.exit(1);
}

function keysFromLocal(){
  const out = [];
  const base = process.env.HOME ? join(homedir(), "Library", "Application Support") : "";
  if (base && existsSync(base)) {
    for (const app of ["liantai-desktop-test", "liantai-desktop"]) {
      const dir = join(base, app, "Local Storage", "leveldb");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".ldb") && !f.endsWith(".log")) continue;
        const m = readFileSync(join(dir, f)).toString("utf16le").match(/sk-[A-Za-z0-9]{20,}/);
        if (m && !out.includes(m[0])) out.push(m[0]);
      }
    }
  }
  return out;
}
async function pickKey(){
  const explicit = process.env.LIANTAI_KEY || "";
  if (explicit) return explicit;
  for (const k of keysFromLocal()) {
    try {
      const r = await fetch("https://api.deepseek.com/v1/models", { headers: { Authorization: "Bearer " + k } });
      if (r.ok) { console.error("用本机已存的 Key（尾号 " + k.slice(-4) + "）"); return k; }
    } catch (e) { /* 换下一个 */ }
  }
  console.error("没找到能用的 Key：在环境变量里设 LIANTAI_KEY。");
  process.exit(1);
}

/* ---------- list：不连网，只看盘上有什么 ---------- */
if (phase === "list") {
  if (!existsSync(poolDir)) { console.log("池子是空的（" + poolDir + " 不存在）。"); process.exit(0); }
  const files = readdirSync(poolDir).filter(f => f.endsWith(".md")).sort();
  let total = 0;
  console.log("池子：" + poolDir + "（" + files.length + " 篇）\n");
  for (const f of files) {
    const s = readFileSync(join(poolDir, f), "utf8");
    const n = (s.match(/^\s*[-•]\s|^\s*\d+\.\s/gm) || []).length;
    total += n;
    const title = (s.match(/^# (.+)$/m) || [, f])[1];
    const pub = (s.match(/^发布：(.+)$/m) || [, ""])[1];
    const cur = (s.match(/^时效：(.+)$/m) || [, ""])[1];
    console.log("  " + title.slice(0, 40).padEnd(42) + " " + String(n).padStart(3) + " 条  " + pub + "  " + cur);
  }
  console.log("\n合计 " + total + " 条事实骨架。");
  process.exit(0);
}

/* ---------- fetch：抓 → 提炼 → 落盘 ---------- */
const query = (process.argv[3] || "").trim();
const want = Math.max(1, Number(process.argv[4]) || 1);
if (!query) { console.error("要一个检索词：node tools/material-pool.mjs fetch 养老 10"); process.exit(1); }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
async function get(url, asJson){
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return asJson ? r.json() : r.text();
}

/* 政策文件库检索。子库名写错会静默返回空（见 docs/材料规范.md 第三节），所以拿到结果必须断言条数。 */
const SUBS = ["zhengcelibrary_gw", "zhengcelibrary_bm", "zhengcelibrary_gb"];
async function search(q, n){
  const items = [];
  for (const t of SUBS) {
    const url = "https://sousuo.www.gov.cn/search-gov/data?t=" + t
      + "&q=" + encodeURIComponent(q) + "&searchfield=title&n=" + n + "&p=1";
    let j;
    try { j = await get(url, true); } catch (e) { console.error("  子库 " + t + " 抓取失败：" + e.message); continue; }
    const list = (j && j.searchVO && j.searchVO.listVO) || [];
    // 不带 searchfield 时接口返回全量、看着有数据其实没筛；这里核对标题里真的含检索词
    for (const it of list) {
      const title = String(it.title || "").replace(/<[^>]+>/g, "");
      if (title.indexOf(q) < 0) continue;
      items.push({ title, url: it.url, wenhao: (it.pcode || it.wenhao || "").trim(),
        pub: (it.pubtimeStr || "").trim(), id: it.id });
    }
  }
  if (!items.length) throw new Error("三个子库都没拿到含「" + q + "」的条目——子库名或检索词要复核");
  const seen = new Set();
  return items.filter(it => it.url && !seen.has(it.url) && seen.add(it.url));
}

/* 正文提取：政府网正文在 <div id="UCAP-CONTENT">，到 pagination / share-box 为止 */
function extractBody(html){
  const start = html.indexOf('id="UCAP-CONTENT"');
  if (start < 0) return "";
  let seg = html.slice(start);
  for (const stop of ['class="pagination"', 'class="share-box"', 'id="jiedu-blk"']) {
    const i = seg.indexOf(stop);
    if (i > 0) seg = seg.slice(0, i);
  }
  return [...seg.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim())
    .filter(s => s.length > 4)
    .join("\n");
}

const key = await pickKey();
const model = process.env.LIANTAI_MODEL || "deepseek-flash";
const SKEL_PROMPT = readFileSync(join(here, "..", "tests", "dom-stub.js"), "utf8");
const html = readFileSync(join(here, "..", "app", "index.html"), "utf8");
const openAt = html.indexOf("<script>");
const closeAt = html.lastIndexOf("</script>");
const appSrc = html.slice(openAt + "<script>".length, closeAt);

/* 提炼 prompt —— 逐条照 docs/材料规范.md 第五节写。改这里之前先去改那份规范。 */
const REFINE_SYS = [
  "你是材料提炼员。把给定的一手材料正文，抽成一份「事实骨架」。",
  "硬规矩（逐条照做，不许变通）：",
  "1. 一条只写一个事实。一条里塞了并列要件，后面就没法核。",
  "2. 保留带钱、带比例、带时间的数字——这些是材料密度的来源，也是唯一能核的东西。",
  "3. 允许啰嗦，不许归纳。「多地推行多种举措」这种句子等于什么都没写。",
  "4. 底线是能出题：评价、意义、表态、套话一律不要，那些出不了题。",
  "5. 「难点」这一栏宁缺勿造。凑不出真实难点，就只写一句「原文未提及」——不许拿上一栏的做法和要求充数。",
  "6. 只从正文抽事实。发布日期、文号、栏目名属于元数据，不是材料事实，不许写进任何条目。",
  "返回 JSON，字段：background（背景）、measures（做法）、effects（成效）、difficulties（争议/难点）。",
  "每个字段是字符串数组，一项一条；某一栏原文没有就返回空数组（difficulties 除外，它要写「原文未提及」）。",
].join("\n");

console.error("抓取「" + query + "」…");
const hits = await search(query, want * 3);
console.error("  命中 " + hits.length + " 条（取前 " + want + " 篇）");

// 正文先抓完（这一步不用 Key、不占模型调用）；下面的探针拼成独立模块，看不到本文件的函数，
// 所以能传的只有数据。
const picked = hits.slice(0, want);
const bodies = {};
for (const it of picked) {
  try { bodies[it.url] = extractBody(await get(it.url)); }
  catch (e) { bodies[it.url] = ""; console.error("  抓正文失败：" + it.title.slice(0, 24) + " —— " + e.message); }
}
const tooShort = picked.filter(it => (bodies[it.url] || "").replace(/\s/g, "").length < 400);
if (tooShort.length) console.error("  正文太短的 " + tooShort.length + " 篇会被跳过");

if (!existsSync(poolDir)) mkdirSync(poolDir, { recursive: true });

const probe = `
const T = await import("node:timers");
globalThis.setTimeout = T.setTimeout; globalThis.clearTimeout = T.clearTimeout;
globalThis.setInterval = T.setInterval; globalThis.clearInterval = T.clearInterval;
state.settings.apiKey = ${JSON.stringify(key)};
state.settings.baseUrl = "https://api.deepseek.com/v1";
state.settings.model = ${JSON.stringify(model)};
state.settings.reasonLevel = "quick";     // 提炼是抽取活，不需要 1.8 万字的思考（见 GRADE_LEVEL 那条注释）
state.modelCaps = {};

const REFINE_SYS = ${JSON.stringify(REFINE_SYS)};
const items = ${JSON.stringify(picked)};
const bodies = ${JSON.stringify(bodies)};

const fs = await import("node:fs");
const path = await import("node:path");
const outDir = ${JSON.stringify(poolDir)};
const stamp = new Date().toISOString().slice(0, 10);
const done = [];

for (const it of items) {
  const body = bodies[it.url] || "";
  if (body.replace(/\\s/g, "").length < 400) { console.log("SKIP " + JSON.stringify({ title: it.title.slice(0,30), why: "正文太短（" + body.length + " 字）" })); continue; }
  let sk = null, err = "";
  try {
    sk = await callLLM(REFINE_SYS, "【正文】\\n" + body, true, null, { temp: 0, level: "quick" });
  } catch (e) { err = String((e && (e.code || e.message)) || e); }
  if (!sk || typeof sk !== "object") { console.log("FAIL " + JSON.stringify({ title: it.title.slice(0,30), err: err || "没解出骨架" })); continue; }
  const sec = (t, arr) => "## " + t + "\\n" + ((arr && arr.length) ? arr.map((x,i)=> (t==="做法"? (i+1)+". " : "- ") + x).join("\\n") : "- （原文未提及）");
  const md = [
    "# " + it.title,
    "",
    "来源：" + it.url,
    "发布：" + it.pub,
    "文号：" + (it.wenhao || "（无）"),
    "抓取：" + stamp,
    "时效：" + (it.wenhao ? "长期框架（有正式文号，按大事件处理）" : "半年（自 " + it.pub + " 起）"),
    "",
    sec("背景", sk.background),
    "",
    sec("做法", sk.measures),
    "",
    sec("成效", sk.effects),
    "",
    sec("争议 / 难点", sk.difficulties),
    "",
  ].join("\\n");
  const name = stamp.replace(/-/g, "") + "-" + String(it.id || Math.random().toString(36).slice(2,8)) + ".md";
  fs.writeFileSync(path.join(outDir, name), md, "utf8");
  const n = ["background","measures","effects","difficulties"].reduce((a,k)=> a + ((sk[k]||[]).length), 0);
  console.log("OK " + JSON.stringify({ file: name, title: it.title.slice(0,32), 条数: n,
    分布: { 背景:(sk.background||[]).length, 做法:(sk.measures||[]).length, 成效:(sk.effects||[]).length, 难点:(sk.difficulties||[]).length },
    正文字数: body.replace(/\\s/g,"").length }));
  done.push(name);
}
console.log("DONE " + JSON.stringify({ 落盘: done.length, 目录: outDir }));
`;

const src = [SKEL_PROMPT, appSrc, probe].join("\n");
await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));
