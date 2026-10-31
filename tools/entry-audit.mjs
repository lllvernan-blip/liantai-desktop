/*
 * 入口屏文案体检（零依赖）
 *   node tools/entry-audit.mjs                 只报数（拿基线，不判失败）
 *   node tools/entry-audit.mjs --max-chars 40  任一入口屏「文案」超 40 字即失败
 *   node tools/entry-audit.mjs --max-total 165 全部入口屏文案合计超这个数即失败（预算见 tools/loop.mjs）
 *   node tools/entry-audit.mjs --strict        有流程句 / 机制词命中即失败
 *   node tools/entry-audit.mjs --json          机器可读，砍前后拿同一份口径对账
 *
 * 预算给两个口径：合计看「这一刀砍下去没有」（单屏会放过一句超长说明句），
 * 单屏看「有没有哪一屏偷偷长回去」。2026-11-01 起入口屏一句说明性文案都不写（预算 0），
 * 合计这一档只是把「零」钉住：哪屏又冒出一句，数就立刻不是 0。
 *
 * 为什么要拿脚本盯文案
 * ────────────────────
 * 入口屏是「打开到落笔」的第一段路，也是减摩擦里唯一不花功能预算的那一段。AGENTS 把文案分成
 * 四类（空态提示留 / 必备声明留 / 讲机制流程删 / 重复口径并），但这条规矩会悄悄长回来：下一个
 * 改界面的人顺手在说明句里补一句「先读材料再成稿」，屏就又重了，而且没人看得见。所以判定必须
 * 能机器跑——四条都能机械识别：
 *   字数    眼睛觉得重，先落在字数上（只算说明性文案，按钮与模块名是行动和称呼，不背这个账）；
 *   流程句  句子里出现「→」就是在背流水线，不是在说人话；
 *   机制词  一张固定词表（采分点 / 点选即判 / 加权均分 …），命中就是在讲机制怎么运转；
 *   重复口径 同一句在 3 个以上入口屏重复出现——留一处说清，其余并掉。
 * 另报一栏「折叠内」：收在没 open 的 details 里的字单独统计——字还是写了，账照记，但别让
 * 「折起来」冒充「删掉了」（减负的读数和减字的读数不是一回事，混着报会骗人）。
 *
 * 手法与 tests/run.mjs、tools/probe.mjs 同一套：把 app/index.html 的 <script> 抠出来，配最小
 * DOM 桩子在 node 里跑起来，调真的 renderHome / renderStart / renderModuleLanding 把每一屏渲出来，
 * 从 #docBody 的 innerHTML 取现场。预置 gw_state 里给 apiKey + model（假的占位串，不带 sk- 前缀），
 * 为的是让红按钮走 canStart() 为真的那一支——那是用户填完 Key 之后真正看到的入口屏。
 * 桩子不解析 DOM，所以分块、实体解码这些活儿在本文件里自带。
 *
 * 基线不落纸：读数会随文案变，抄一份进注释或文档就成了第二份真相。要看现状直接跑本文件。
 * 闸门已经接上：tools/loop.mjs 第 9 项用 `--strict --max-total <实测>` 跑它，预算那个常数就在
 * loop.mjs 里（砍完把数往下改，别往上留余量）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const argv = process.argv.slice(2);
const flagOf = (name) => argv.indexOf(name);
if (flagOf("--help") >= 0) {
  console.log("用法: node tools/entry-audit.mjs [--max-chars N] [--max-total N] [--strict] [--json]");
  process.exit(0);
}
const maxCharsIdx = flagOf("--max-chars");
const MAX_CHARS = maxCharsIdx >= 0 ? Number(argv[maxCharsIdx + 1]) : null;
if (maxCharsIdx >= 0 && !(MAX_CHARS > 0)) {
  console.error("--max-chars 要跟一个正整数");
  process.exit(2);
}
const maxTotalIdx = flagOf("--max-total");
const MAX_TOTAL = maxTotalIdx >= 0 ? Number(argv[maxTotalIdx + 1]) : null;
if (maxTotalIdx >= 0 && !(MAX_TOTAL >= 0)) {   // 允许 0：入口屏已经一句说明性文案都不写，预算就该是 0
  console.error("--max-total 要跟一个正整数");
  process.exit(2);
}
const STRICT = flagOf("--strict") >= 0;
const JSON_OUT = flagOf("--json") >= 0;

/* ---------------- 启动页面脚本并逐屏抓 innerHTML ---------------- */

const html = readFileSync(join(root, "app", "index.html"), "utf8");
const open = html.indexOf("<script>");
const close = html.lastIndexOf("</script>");
if (open < 0 || close < 0) {
  console.error("没在 HTML 里找到 <script> 块，页面结构可能被改动了。");
  process.exit(2);
}
const app = html.slice(open + "<script>".length, close);

// 注入到应用同一模块作用域里的一段截屏代码：只读不写，渲染全走真函数
const pageBoot = [
  "globalThis.__audit = { screens: [], tut: [] };",
  "const __bodyHtml = () => (globalThis.__els && globalThis.__els['#docBody'] ? String(globalThis.__els['#docBody'].innerHTML || '') : '');",
  "const __shot = (name, subj, mod, kind) => {",
  "  if (subj) state.settings.subject = subj;",
  "  if (kind === 'home') renderHome();",
  "  else if (kind === 'start') renderStart();",
  "  else renderModuleLanding(mod);",
  "  globalThis.__audit.screens.push({ name: name, kind: kind, subject: curSubject(), module: mod || null, html: __bodyHtml() });",
  "};",
  "__shot('首页', null, null, 'home');",
  "__shot(SUBJECTS['zy'].name + ' 起始页', 'zy', null, 'start');",
  "__shot(SUBJECTS['sl'].name + ' 起始页', 'sl', null, 'start');",
  "moduleKeysOf('zy').concat(moduleKeysOf('sl')).forEach(k => __shot(SUBJECTS[subjectOf(k)].short + ' · ' + MODULES[k].name, subjectOf(k), k, 'landing'));",
  "globalThis.__audit.tut = TUT_SEQ.map(s => ({ scr: s.scr, text: s.text, nk: s.nk ? s.nk.text : '', onlyKey: !!s.onlyKey }));",
].join("\n");

const src = [
  readFileSync(join(root, "tests", "dom-stub.js"), "utf8"),
  "localStorage.setItem('gw_history', JSON.stringify([]));",
  // apiKey / model 用占位串：canStart() 为真，入口屏才显示用户填好之后看到的那一版
  "localStorage.setItem('gw_state', JSON.stringify({ settings: { subject: 'zy', apiKey: 'audit-placeholder', model: 'audit-model' }, profile: {}, cache: {} }));",
  app,
  pageBoot,
].join("\n");

await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

const screens = globalThis.__audit.screens;
const tut = globalThis.__audit.tut;
if (!screens.length) {
  console.error("一屏都没渲染出来：入口页的渲染函数或 #docBody 的 id 变了。");
  process.exit(2);
}

/* ---------------- 分块：按块级边界切行，记住每行落在哪个区域 ---------------- */

const BLOCK_TAGS = new Set(["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "button", "section", "header", "footer", "tr", "table"]);
const VOID_TAGS = new Set(["br", "input", "img", "hr", "meta", "link", "source", "area"]);
// 区域 = 这屏上这块文字是干什么用的。文案账只记 标题 / 说明句 / 其他。
const REGION_BY_CLASS = [
  ["hero-big", "标题"],
  ["hero-sub", "说明句"],
  ["hero-foot", "声明"],
  ["hint", "数据行"],
  ["actions", "主行动"],
  ["chiprow", "胶囊"],
  ["subtypechips", "胶囊"],
  ["pdforms", "胶囊"],
  ["catgroup", "胶囊"],
  ["chip", "胶囊"],
];
const PROSE_REGIONS = new Set(["标题", "说明句", "其他"]);

function decodeEnt(s) {
  return s
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function splitBlocks(htmlText) {
  const out = [];
  const stack = [];
  const tagRe = /<!--[\s\S]*?-->|<\/([a-zA-Z][-\w]*)\s*>|<([a-zA-Z][-\w]*)((?:"[^"]*"|'[^']*'|[^>])*?)\/?>/g;
  const regionNow = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].region) return stack[i].region;
    return "其他";
  };
  // 收起的 details 里的字此刻在屏幕上看不见，但字还是写了——分开记两行，别让「折起来」冒充「减了字」
  const foldedNow = () => stack.some((s) => s.fold === "closed");
  let buf = "", bufRegion = null, bufFolded = false, last = 0, m;
  const emit = () => {
    const t = decodeEnt(buf).replace(/\s+/g, " ").trim();
    if (t) out.push({ region: bufRegion || "其他", text: t, folded: bufFolded });
    buf = "";
    bufRegion = null;
    bufFolded = false;
  };
  const add = (t) => { if (!bufRegion) { bufRegion = regionNow(); bufFolded = foldedNow(); } buf += t; };
  while ((m = tagRe.exec(htmlText))) {
    const chunk = htmlText.slice(last, m.index);
    last = tagRe.lastIndex;
    if (chunk) add(chunk);
    if (m[1] === undefined && m[2] === undefined) continue;   // 注释：不带文案
    if (m[1]) {   // 闭标签
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      if (BLOCK_TAGS.has(tag)) emit();
      continue;
    }
    const tag = m[2].toLowerCase();
    if (tag === "br") { emit(); continue; }
    if (VOID_TAGS.has(tag)) continue;
    if (tag === "script" || tag === "style") {   // 纸面里不该有，真出现了就整段跳过（里面的代码不是文案）
      const rest = htmlText.slice(tagRe.lastIndex).toLowerCase();
      const idx = rest.indexOf("</" + tag);
      tagRe.lastIndex += idx < 0 ? rest.length : idx;
      last = tagRe.lastIndex;
      emit();
      continue;
    }
    const cls = ((m[3] || "").match(/class\s*=\s*"([^"]*)"/i) || [,""])[1];
    let region = "";
    for (const token of cls.split(/\s+/)) {
      const hit = REGION_BY_CLASS.find((r) => r[0] === token);
      if (hit) { region = hit[1]; break; }
    }
    stack.push({ tag, region, fold: tag === "details" && !/\bopen\b/.test(m[3] || "") ? "closed" : "open" });
    if (BLOCK_TAGS.has(tag)) emit();
  }
  if (htmlText.length > last) add(htmlText.slice(last));
  emit();
  return out;
}

/* ---------------- 判定 ---------------- */

const CHARS = (s) => s.replace(/\s+/g, "").length;
const PIPELINE = "→";
const MECHANISM_WORDS = [
  "采分点", "点选即判", "加权均分", "逐条列出", "一轮 5 题", "一轮5题", "按你最近的练习情况",
  "出题和阅卷都要", "四步教程", "智能出题", "批改记录", "学习卡", "读材料", "归类成稿",
  "材料里挑", "评分口径", "经验闭环", "先填 API Key", "按采分点打分",
];
const DECLARE_OK = /没有账号|数据都在本地|不上传|本地保存/;

const clausesOf = (text) => text.split(/[。；！？，、;!,?…]+/).map((s) => s.trim()).filter((s) => CHARS(s) >= 4);

const rows = screens.map((sc) => {
  const blocks = splitBlocks(sc.html);
  const byRegion = {};
  for (const b of blocks) byRegion[b.region] = (byRegion[b.region] || 0) + CHARS(b.text);
  const prose = blocks.filter((b) => PROSE_REGIONS.has(b.region));
  const proseChars = prose.reduce((n, b) => n + CHARS(b.text), 0);
  const clauses = [];
  for (const b of prose) {
    for (const c of clausesOf(b.text)) {
      if (DECLARE_OK.test(c)) continue;
      const compact = c.replace(/\s+/g, "");
      clauses.push({
        region: b.region,
        text: c,
        pipeline: c.indexOf(PIPELINE) >= 0,
        mechanism: MECHANISM_WORDS.filter((w) => compact.indexOf(w.replace(/\s+/g, "")) >= 0),
      });
    }
  }
  return {
    name: sc.name, kind: sc.kind, subject: sc.subject, module: sc.module,
    totalChars: blocks.reduce((n, b) => n + CHARS(b.text), 0),
    foldedChars: blocks.filter((b) => b.folded).reduce((n, b) => n + CHARS(b.text), 0),
    proseChars, byRegion, clauses, blocks,
  };
});

// 重复口径：同一句出现在 3 个及以上入口屏，而且跨了屏型。
// 同一种屏（10 个模块落地页）共用一句标题是「三页共用一套骨架」的规矩，不算文案债。
const seenOn = new Map();
for (const r of rows) {
  const uniq = new Set(r.clauses.map((c) => c.text.replace(/\s+/g, "")));
  for (const key of uniq) {
    if (!seenOn.has(key)) seenOn.set(key, []);
    seenOn.get(key).push({ name: r.name, kind: r.kind });
  }
}
const repeats = new Map();
for (const [key, hits] of seenOn) {
  if (hits.length < 3) continue;
  if (new Set(hits.map((h) => h.kind)).size < 2) continue;
  repeats.set(key, hits.map((h) => h.name));
}
for (const r of rows) for (const c of r.clauses) c.repeat = repeats.has(c.text.replace(/\s+/g, "")) ? repeats.get(c.text.replace(/\s+/g, "")).length : 0;

const pipelineHits = rows.flatMap((r) => r.clauses.filter((c) => c.pipeline).map((c) => ({ screen: r.name, text: c.text })));
const mechanismHits = rows.flatMap((r) => r.clauses.filter((c) => c.mechanism.length).map((c) => ({ screen: r.name, text: c.text, words: c.mechanism })));
const overBudget = MAX_CHARS > 0 ? rows.filter((r) => r.proseChars > MAX_CHARS) : [];
const proseTotal = rows.reduce((n, r) => n + r.proseChars, 0);
const overTotal = MAX_TOTAL > 0 && proseTotal > MAX_TOTAL;

if (JSON_OUT) {
  console.log(JSON.stringify({
    screens: rows.map((r) => ({
      name: r.name, kind: r.kind, subject: r.subject, module: r.module,
      totalChars: r.totalChars, proseChars: r.proseChars, byRegion: r.byRegion,
      clauses: r.clauses.map((c) => ({ region: c.region, text: c.text, pipeline: c.pipeline, mechanism: c.mechanism, repeat: c.repeat })),
    })),
    tut,
    summary: {
      screenCount: rows.length,
      proseTotal,
      pipeline: pipelineHits, mechanism: mechanismHits,
      repeats: [...repeats].map(([text, names]) => ({ text, count: names.length })),
      overBudget: overBudget.map((r) => ({ name: r.name, proseChars: r.proseChars })),
      overTotal, maxChars: MAX_CHARS, maxTotal: MAX_TOTAL, strict: STRICT,
    },
  }, null, 2));
  process.exit((STRICT && (pipelineHits.length || mechanismHits.length)) || overBudget.length || overTotal ? 1 : 0);
}

const pad = (s, n) => s + " ".repeat(Math.max(0, n - [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)));
const regionLine = (r) => ["标题", "说明句", "主行动", "胶囊", "声明", "数据行", "其他"].map((k) => `${k} ${r.byRegion[k] || 0}`).join(" · ");
// 折叠里的字仍记账（字是写了的），但单独报一行——否则「把文案折起来」会冒充「把文案删掉」
const foldNote = (r) => (r.foldedChars ? `   其中折叠内 ${r.foldedChars} 字（收起时看不见）` : "");

console.log(`入口屏文案体检 · app/index.html（共 ${rows.length} 屏：首页 1 + 科目起始页 2 + 模块落地页 ${rows.length - 3}）`);
console.log("文案账只记 标题 / 说明句 / 其他；按钮是行动、胶囊是模块名、声明与数据行各有各的规矩，不背这个账。");
console.log("");
for (const r of rows) {
  console.log(`■ ${pad(r.name, 18)} 文案 ${String(r.proseChars).padStart(3)} 字 / 全页 ${String(r.totalChars).padStart(3)} 字   ${regionLine(r)}${foldNote(r)}`);
  for (const b of r.blocks) {
    if (!PROSE_REGIONS.has(b.region)) continue;
    console.log(`    ▸ [${b.region}] ${b.text}${b.folded ? "（折叠内）" : ""}`);
  }
  for (const c of r.clauses) {
    const tags = [];
    if (c.pipeline) tags.push("流程句");
    if (c.mechanism.length) tags.push("机制词:" + c.mechanism.join("/"));
    if (c.repeat) tags.push(`重复口径×${c.repeat}`);
    if (tags.length) console.log(`      ⚑ ${tags.join(" + ")} —「${c.text}」`);
  }
  if (MAX_CHARS > 0 && r.proseChars > MAX_CHARS) console.log(`      ✗ 超预算：${r.proseChars} > ${MAX_CHARS}`);
}

const tutByScreen = new Map();
for (const t of tut) {
  const key = t.scr;
  if (!tutByScreen.has(key)) tutByScreen.set(key, { n: 0, chars: 0 });
  const cur = tutByScreen.get(key);
  cur.n++;
  cur.chars += CHARS(t.text);
}
console.log("");
console.log("—— 引导气泡（TUT_SEQ，一次性但也在入口屏上挡路）——");
for (const [scr, v] of tutByScreen) console.log(`  ${pad(scr, 6)} ${v.n} 步 · ${v.chars} 字`);
console.log(`  合计 ${tut.length} 步 · ${tut.reduce((n, t) => n + CHARS(t.text), 0)} 字`);

console.log("");
console.log("—— 汇总 ——");
const foldedTotal = rows.reduce((n, r) => n + r.foldedChars, 0);
console.log(`  文案合计 ${proseTotal} 字（均值 ${(proseTotal / rows.length).toFixed(1)}）`
  + (MAX_TOTAL > 0 ? ` / 预算 ${MAX_TOTAL}` + (overTotal ? " ✗ 超了" : " ✔") : "")
  + (foldedTotal ? `；另有 ${foldedTotal} 字收在折叠里（收起时看不见，账仍记着）` : ""));
console.log(`  流程句 ${pipelineHits.length} 条 · 机制词命中 ${mechanismHits.length} 条 · 重复口径 ${repeats.size} 句`);
for (const [text, names] of repeats) console.log(`    「${text}」×${names.length}：${names.slice(0, 4).join("、")}${names.length > 4 ? "…" : ""}`);

const reasons = [];
if (overTotal) reasons.push(`文案合计 ${proseTotal} > 预算 ${MAX_TOTAL}`);
if (overBudget.length) reasons.push(overBudget.length + " 屏文案超 " + MAX_CHARS + " 字/屏");
if (STRICT && (pipelineHits.length || mechanismHits.length)) reasons.push(pipelineHits.length + " 条流程句 / " + mechanismHits.length + " 条机制词命中");
console.log("");
console.log(reasons.length ? "判定：FAIL — " + reasons.join("；") : "判定：PASS" + (STRICT ? "（strict：流程句与机制词也查了）" : "（未开 strict：只按字数预算判）"));
process.exit(reasons.length ? 1 : 0);
