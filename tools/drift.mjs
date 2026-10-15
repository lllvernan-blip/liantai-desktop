/*
 * 阅卷漂移探针 —— 同一道题 + 同一批采分点 + 同一份答卷，反复批改，量出总分摆动。
 *
 *   node tools/drift.mjs prepare      # 用真接口出一道题，落成 <临时目录>/liantai-drift-case.json
 *   # 打开那个 JSON，把 answers 里每一份答卷写好（clear = 覆盖清楚的，edge = 刻意骑在档位临界线上的）
 *   node tools/drift.mjs run 5        # 每份答卷批 5 次，打印每次得分、极差、以及哪几个子项在摆
 *
 * 环境变量：
 *   LIANTAI_KEY        不设也能跑——本机已填过 Key 时直接从应用数据目录里取（只读，不写仓库、不打印）。
 *   LIANTAI_MODEL      默认 deepseek-flash。
 *   LIANTAI_DRIFT_CASE 指定另一份 case.json，用来做两份对照（比如同一道题带 need / 不带 need）。
 *
 * 为什么要两份答卷：2026-09-29 第一次基线跑下来「覆盖清楚」那种答卷 5 次一字不差（11.5/20，极差 0），
 * 而 2026-09-27 真机又确实量到过摆动（折百分制 45/53/45）。差别在答卷——会摆的是**卡在档位临界点**的
 * 那份（某个子项一会儿算零分一会儿算半分）。所以基线必须两种都测：只测一种，结论会反过来骗人。
 *
 * 边界：真接口、真花钱（一次批改几分钱）。它走的是 app 里真实的 gen() / grade()（不是另写一份 prompt），
 * 所以在 DOM 桩子里把 app/index.html 的脚本抠出来跑，跟 tests/run.mjs 同一套路子。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir, homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const phase = (process.argv[2] || "").trim();
if (phase !== "prepare" && phase !== "run") {
  console.error("用法：node tools/drift.mjs prepare | run [次数]");
  process.exit(1);
}

/* Key 从三个地方按顺序找：环境变量 → 应用数据目录（测试副本优先，它更新得勤）。
   读本地存储是为了把「跑一次探针」的摩擦降到 0——要人先设环境变量，探针就永远不会被跑。 */
function keysFromLocal(){
  const out = [];
  let base = process.env.HOME ? join(homedir(), "Library", "Application Support") : "";
  if (base && existsSync(base)) {
    for (const app of ["liantai-desktop-test", "liantai-desktop"]) {
      const dir = join(base, app, "Local Storage", "leveldb");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".ldb") && !f.endsWith(".log")) continue;
        const s = readFileSync(join(dir, f)).toString("utf16le");
        const m = s.match(/sk-[A-Za-z0-9]{20,}/);
        if (m && !out.includes(m[0])) out.push(m[0]);
      }
    }
  }
  return out;
}
async function pickKey(){
  const explicit = process.env.LIANTAI_KEY || "";
  if (explicit) return explicit;
  const cands = keysFromLocal();
  for (const k of cands) {
    try {
      const r = await fetch("https://api.deepseek.com/v1/models", { headers: { Authorization: "Bearer " + k } });
      if (r.ok) { console.error("用本机已存的 Key（尾号 " + k.slice(-4) + "）"); return k; }
    } catch (e) { /* 换下一个 */ }
  }
  console.error("没找到能用的 Key（本机存了 " + cands.length + " 个，都不可用）：在环境变量里设 LIANTAI_KEY。");
  process.exit(1);
}
const key = await pickKey();
const times = Math.max(1, Number(process.argv[3]) || 5);
const model = process.env.LIANTAI_MODEL || "deepseek-flash";
const casePath = process.env.LIANTAI_DRIFT_CASE || join(tmpdir(), "liantai-drift-case.json");
if (phase === "run" && !existsSync(casePath)) {
  console.error("还没有 case：" + casePath + " —— 先跑 prepare 并写好 answers。");
  process.exit(1);
}

const html = readFileSync(join(here, "..", "app", "index.html"), "utf8");
const open = html.indexOf("<script>");
const close = html.lastIndexOf("</script>");
const app = html.slice(open + "<script>".length, close);

const probe = `
/* —— 探针：真接口下的漂移测量 —— */
const T = await import("node:timers");
globalThis.setTimeout = T.setTimeout; globalThis.clearTimeout = T.clearTimeout;
globalThis.setInterval = T.setInterval; globalThis.clearInterval = T.clearInterval;   // 桩子把定时器换成空函数，真连网要装回来
const fs = await import("node:fs");
const CASE = ${JSON.stringify(casePath)};
state.settings.apiKey = ${JSON.stringify(key)};
state.settings.baseUrl = "https://api.deepseek.com/v1";
state.settings.model = ${JSON.stringify(model)};
state.settings.reasonLevel = "standard";
state.history = []; state.experiences = []; state.modelCaps = {};
if (${JSON.stringify(phase)} === "prepare") {
  const r = await gen("zy.guina", "归纳概括", null, false);
  const c = { module: "zy.guina", subtype: "归纳概括", question: r.question, keyPoints: r.keyPoints, answers: { clear: "", edge: "" } };
  fs.writeFileSync(CASE, JSON.stringify(c, null, 2), "utf8");
  console.log("CASE " + JSON.stringify({ requirements: r.question.requirements, background: r.question.background, points: (r.keyPoints||[]).map(p => p.point + "（" + p.score + "分）") }));
} else {
  const c = JSON.parse(fs.readFileSync(CASE, "utf8"));
  const full = Number(c.question.score) || 20;
  const variants = Object.keys(c.answers || {}).filter(k => String(c.answers[k] || "").trim());
  if (!variants.length) console.log("DRIFT-ERR case 里的 answers 都是空的，先写答卷。");
  for (const v of variants) {
    const answer = c.answers[v];
    const rows = [];
    for (let i = 0; i < ${times}; i++) {
      const t0 = Date.now();
      let g = null, err = "";
      try { g = await grade(c.module, c.subtype, c.question, c.keyPoints, answer, null); }
      catch (e) { err = String((e && (e.code || e.message)) || e); }   // callLLM 会把「坏输出」当异常抛（code:JSON），别让它把整轮测量打断
      if (!g || !Array.isArray(g.hits)) { console.log("RUN " + JSON.stringify({ v: v, i: i + 1, fail: err || "没解出 hits" })); continue; }
      const scored = pointsOf(g.hits);          // { got, max }
      rows.push({ i: i + 1, sec: Math.round((Date.now() - t0) / 1000), got: scored.got,
        awarded: g.hits.map(h => Number(h.awarded) || 0), 折百: Math.round(scored.got / full * 100) });
      console.log("RUN " + JSON.stringify({ v: v, i: rows[rows.length - 1].i, sec: rows[rows.length - 1].sec, got: rows[rows.length - 1].got,
        hits: g.hits.map(h => h.point.slice(0, 10) + "=" + h.awarded + "/" + h.score + "(" + (h.status || "") + ")") }));
    }
    if (!rows.length) continue;
    const nums = rows.map(r => r.got);
    const flip = [];
    for (let j = 0; j < (c.keyPoints || []).length; j++) {
      const vals = rows.map(r => r.awarded[j]);
      if (vals.some(x => x !== vals[0])) flip.push((c.keyPoints[j].point || "").slice(0, 14) + "：" + vals.join("/"));
    }
    console.log("DRIFT " + JSON.stringify({ 答卷: v, 次数: rows.length, 满分: full, 各次得分: nums,
      极差: Math.max.apply(null, nums) - Math.min.apply(null, nums), 折百分制: rows.map(r => r.折百), 摆动的子项: flip }));
  }
  /* 思考量是“额度够不够”的关键变量（思考与正文共用一个输出上限）：按「模型×档位」累计的口径打出来，
     以后就知道这次跑的时候它到底想了多少字——只读，不改任何状态。 */
  const probe = state.modelProbe && state.modelProbe[state.settings.model];
  if(probe){
    const rows = Object.keys(probe).map(lv => ({ 档位: lv, 次数: probe[lv].n,
      思考字数均值: Math.round(probe[lv].reason / probe[lv].n), 平均秒: Math.round(probe[lv].secs / probe[lv].n) }));
    console.log("PROBE " + JSON.stringify({ 模型: state.settings.model, 档位: rows, 模型拒收过思考参数: state.modelCaps[state.settings.model] || "ok" }));
  }
}
`;

const src = [
  readFileSync(join(here, "..", "tests", "dom-stub.js"), "utf8"),
  app,
  probe,
].join("\n");

const b64 = Buffer.from(src, "utf8").toString("base64");
await import("data:text/javascript;base64," + b64);
