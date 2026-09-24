/*
 * 场景：界面现状取景（一次性，看完即删）
 *   node tools/shot.mjs tools/scenes-ui.mjs _shots/ui
 *
 * 每个场景的 js 写成一个函数再 toString 注入页面，所以函数体里可以直接用
 * state / current / renderXxx 这些应用自己的全局（顶层 let 在同一个 realm 里可见）。
 */

// —— 页面侧公共依赖（注入时拼在每个场景前面）——
// 注意：这里的一切都必须自包含——注入的只有这个函数的源码，Node 侧的常量它看不到。
function PRELUDE() {
  var MATERIAL = [
    "近年来，某市持续推进政务服务标准化建设。市政务服务中心把分散在各部门的审批事项集中到一窗受理，平均办理时限由 12 个工作日压缩到 4 个。",
    "同时上线了「好差评」系统，办事群众扫码即可评价，评价结果直接与窗口考核挂钩。",
    "有企业反映，部分事项仍需线下重复提交纸质材料，跨部门数据没有真正打通。",
    "市里计划今年把标准化清单覆盖率提高到九成，并把企业开办的环节从 6 个压到 3 个。",
  ].join("");
  window.__q = {
    background: MATERIAL,
    requirements: "根据给定材料，概括该市推进政务服务标准化的主要做法。（20 分，不超过 300 字）",
    score: 20, ansLen: 300, difficulty: "适中",
  };
  window.__card = {
    title: "归纳概括 · 学习卡",
    points: ["先划出动词性表述（推进、上线、压缩），做法藏在动词后面", "同类合并：一件事的不同侧面归成一条，不要拆成两条", "概括句要写上位词（「优化流程」而不是「把 12 天压到 4 天」）"],
    pitfalls: ["把成效当做法写（4 个工作日是结果，不是动作）", "照抄材料长句，没有概括", "漏掉「问题」类信息——材料里的企业反映也是采分点"],
    templates: "一、优化办事流程。……\n二、强化监督评价。……\n三、推进数据共享。……",
    example: { scene: "某县推行「一网通办」，把 32 项高频事项搬到线上。", ask: "概括该县的主要做法。" },
  };
  window.__hist = function () {
    return [
      { ts: Date.now() - 3600e3, module: "sl.guina", subtype: "概括问题", question: __q, answer: "……", keyPoints: [], cardPeeks: 2, grade: { total: 79, scored: { got: 15.8, max: 20 }, scores: { 要点全面: 16, 归类准确: 17, 表述精炼: 15, 条理清晰: 16, 语言准确: 14 }, strengths: ["要点覆盖全"], weaknesses: ["归类粗"], comment: "要点抓得全。" } },
      { ts: Date.now() - 7200e3, module: "zy.gongwen", subtype: "通知", question: __q, answer: "……", keyPoints: [], cardPeeks: 1, grade: { total: 61, scored: { got: 12.2, max: 20 }, scores: { 格式规范: 10, 内容完整: 13, 语言得体: 12, 条理清晰: 13, 角色定位: 12 }, strengths: ["语言得体"], weaknesses: ["漏写落款"], comment: "格式欠规范。" } },
      { ts: Date.now() - 10800e3, module: "zy.guina", subtype: "概括原因", question: __q, answer: "……", keyPoints: [], cardPeeks: 0, grade: { total: 100, scored: { got: 20, max: 20 }, scores: { 要点全面: 20, 归类准确: 20, 表述精炼: 20, 条理清晰: 20, 语言准确: 20 }, strengths: ["要点全面"], weaknesses: [], comment: "很完整。" } },
      { ts: Date.now() - 14400e3, track: "pd", form: "fact-select", theme: "政务服务", items: [{ form: "fact-select", stem: "下列关于该市做法的说法哪一项准确", options: ["a", "b"], answer: 0, picked: 0, ok: true, trap: "", explain: "x" }, { form: "fact-select", stem: "……", options: ["a", "b"], answer: 1, picked: 0, ok: false, trap: "改数量时限", explain: "y" }], correct: 1, total: 2 },
    ];
  };
  window.__flow = function (step) {
    const q = JSON.parse(JSON.stringify(__q));
    q.ansLen = 300;
    const sig = qSig(q);
    const sents = sentenceTable(q);
    const sels = [];
    [0, 1, 2].forEach((sid) => { const s = sents[sid]; if (s) sels.push({ text: s.text, start: s.start, end: s.end, sentenceId: sid, valid: null, point: -1, free: false }); });
    const f = {
      id: "flow_demo", subject: "sl", module: "sl.guina", subtype: "概括问题", sig,
      question: q, keyPoints: [], createdAt: Date.now() - 600e3, closedAt: null, step,
      attempts: step === "draft" || step === "review" || step === "distill" ? [{ ts: Date.now() - 300e3, answer: "一、优化办事流程。把分散在各部门的审批事项集中到一窗受理。\n二、上线好差评系统，评价结果与窗口考核挂钩。\n三、推进数据共享，减少重复提交。", outline: "要点1：一窗受理", mode: "draft" }] : [],
      selections: sels,
      groups: [{ name: "优化办事流程", facts: [0] }, { name: "强化监督评价", facts: [1] }, { name: "推进数据共享", facts: [2] }],
      drafts: [],
    };
    state.flows = [f]; _flowId = f.id;
    state.settings.subject = "sl";
    current = { module: "sl.guina", subtype: "概括问题", question: q, keyPoints: [], studyCard: __card, cardPeeks: 1, phase: "card" };
    activeModule = "sl.guina";
    lastGrade = null;
    return f;
  };
  window.__grade = function () {
    return {
      hits: [
        { point: "把分散在各部门的审批事项集中到一窗受理", evidence: "材料第一句", status: "满分", score: 4, awarded: 4 },
        { point: "推动材料线上共享，减少重复提交", evidence: "材料只说企业反映，未写做法", status: "部分命中", score: 4, awarded: 2 },
        { point: "压缩平均办理时限", evidence: "12 个工作日压缩到 4 个", status: "满分", score: 4, awarded: 3 },
        { point: "上线好差评系统并与窗口考核挂钩", evidence: "上线了好差评系统，办事群众扫码即可评价", status: "满分", score: 4, awarded: 4 },
        { point: "把标准化清单覆盖率与开办环节写进计划", evidence: "覆盖率提高到九成、环节从 6 个压到 3 个", status: "未命中", score: 4, awarded: 0 },
      ],
      scores: { 要点全面: 13, 归类准确: 14, 表述精炼: 12, 条理清晰: 15, 语言准确: 13 },
      strengths: ["要点位置集中", "语言简洁"],
      weaknesses: ["把「企业反映」当做法写", "漏掉材料里的计划类信息"],
      comment: "要点抓得准，主要做法基本覆盖，但把「企业反映」当成做法写了，材料里的计划类信息也没接住。",
      modelAnswer: "一、优化办事流程。将分散在各部门的审批事项集中到一窗受理，平均办理时限由 12 个工作日压缩到 4 个。\n二、强化监督评价。上线「好差评」系统，群众扫码即可评价，结果与窗口考核挂钩。\n三、推进数据共享。针对企业反映的重复提交纸质材料问题，推进跨部门数据打通。\n四、明确提升目标。将标准化清单覆盖率提高到九成，企业开办环节由 6 个压到 3 个。",
    };
  };
  window.__reset = function (opts) {
    opts = opts || {};
    state.settings.apiKey = opts.key === false ? "" : "sk-demo0demo0demo0demo0demo0demo0";
    state.settings.model = "deepseek-chat";
    state.settings.subject = opts.subject || "zy";
    state.history = opts.history ? __hist() : [];
    state.flows = [];
    state.experiences = opts.exp ? [{ id: "e1", type: "失分点", title: "漏写落款文号", body: "公文类作答结尾必须写发文机关与日期，材料里给了就照抄。", scope: "", module: "zy.gongwen", subject: "zy", ts: Date.now(), disabled: false, sourceSig: "x" }] : [];
    state.profile = { lastModules: [], dims: {} };
    state.cache = state.cache || {};
    state.cache.studyCards = {}; state.cache.notes = {};
    _flowId = null; current = null; lastGrade = null; activeModule = null; pdActive = false; pdRound = null;
    closeModals();   // 取景器所有场景共用一个窗口：上一屏开着的弹层不关，会把后面的场景盖住
    banner("");
    renderTabs(); renderHeader();
  };
}

// —— 场景 ——
function s01_start_new() { __reset({ key: false }); banner("欢迎。点右上角「设置」，选一个服务商（推荐 DeepSeek）、填上 API Key，就能开始用了。"); renderStart(); }
function s02_start_ready() { __reset({ history: true }); state.flows = [{ id: "flow_keep", subject: "sl", module: "sl.guina", subtype: "概括问题", sig: "x", question: __q, keyPoints: [], createdAt: Date.now() - 600e3, closedAt: null, step: "draft", attempts: [{ ts: Date.now(), answer: "a", outline: "", mode: "draft" }], selections: [], groups: [], drafts: [] }]; renderStart(); }
function s03_landing() { __reset({ history: true }); renderModuleLanding("sl.guina"); }
function s04_zy_card() { __reset(); current = { module: "zy.guina", subtype: "概括做法", question: __q, keyPoints: [], studyCard: __card, cardPeeks: 0, phase: "card" }; activeModule = "zy.guina"; renderQuestion(); }
function s05_zy_answer() { __reset(); current = { module: "zy.guina", subtype: "概括做法", question: __q, keyPoints: [], studyCard: __card, cardPeeks: 1, phase: "answer" }; activeModule = "zy.guina"; renderQuestion(); }
function s06_flow_read() { __reset({ history: true }); __flow("read"); renderQuestion(); }
function s07_flow_organize() { __reset({ history: true }); __flow("organize"); renderQuestion(); }
function s08_flow_draft() { __reset({ history: true }); __flow("draft"); renderQuestion(); }
function s09_flow_review() { __reset({ history: true }); __flow("review"); lastGrade = { g: __grade(), total: 67 }; renderQuestion(); }
function s10_flow_distill() { __reset({ history: true, exp: true }); __flow("distill"); _lastDistilled = [{ id: "d1", type: "失分点", title: "把企业反映当做法", body: "材料里的第三方反映不是该主体的做法，概括时不能算作措施。", scope: "" }]; renderQuestion(); }
function s11_profile() { __reset({ history: true }); openModal("modalProfile"); renderProfile(); }
function s12_pd_landing() { __reset({ history: true }); enterPD(); }
function s13_pd_round() {
  __reset({ history: true }); pdActive = true; state.settings.subject = "zy";
  pdRound = { form: "fact-select", theme: "政务服务", idx: 0, correct: 1, done: false, items: [
    { form: "fact-select", context: __q.background.slice(0, 120), stem: "下列关于该市政务服务做法的说法，哪一项准确？", options: ["把分散在各部门的审批事项集中到一窗受理", "平均办理时限由 12 个工作日压缩到 1 个"], answer: 0, picked: null, trap: "", explain: "材料写的是压缩到 4 个工作日。", done: false, ok: false },
  ] };
  renderPDRound();
}
function s14_pd_summary() {
  __reset({ history: true }); pdActive = true; state.settings.subject = "zy";
  pdRound = { form: "fact-select", theme: "政务服务", idx: 2, correct: 1, done: true, items: [
    { form: "fact-select", context: "c", stem: "s1", options: ["a", "b"], answer: 0, picked: 0, trap: "", explain: "正确项在节选里能找到逐字出处。", done: true, ok: true },
    { form: "fact-select", context: "c", stem: "s2", options: ["a", "b"], answer: 1, picked: 0, trap: "改数量时限", explain: "把 4 个工作日说成 1 个，属于改数量时限。", done: true, ok: false },
    { form: "fact-select", context: "c", stem: "s3", options: ["a", "b"], answer: 0, picked: 0, trap: "", explain: "干扰项换了主体。", done: true, ok: true },
  ] };
  renderPDSummary();
}
function s15_settings() { __reset({ history: true }); openModal("modalSettings"); fillSettings(); setReasonUI(); }
function s16_settings_nokey() { __reset({ history: true, key: false }); openModal("modalSettings"); fillSettings(); setReasonUI(); }

const SCENES = [
  ["01-起始页-新用户", s01_start_new, true],
  ["02-起始页-已配置", s02_start_ready, true],
  ["03-模块落地页", s03_landing, true],
  ["04-综应A-学习卡", s04_zy_card, true],
  ["05-综应A-作答", s05_zy_answer, true],
  ["06-申论-读材料", s06_flow_read, true],
  ["07-申论-归类", s07_flow_organize, true],
  ["08-申论-一稿", s08_flow_draft, true],
  ["09-申论-批改", s09_flow_review, true],
  ["10-申论-沉淀", s10_flow_distill, true],
  ["11-画像", s11_profile, false],
  ["12-快判-落地页", s12_pd_landing, true],
  ["13-快判-作答", s13_pd_round, true],
  ["14-快判-小结", s14_pd_summary, true],
  ["15-设置", s15_settings, false],
  ["16-设置-无Key", s16_settings_nokey, false],
];

export const scenes = SCENES.map(([name, fn, full]) => ({
  name,
  full,
  js: "(" + PRELUDE.toString() + ")();\n(" + fn.toString() + ")();",
}));
