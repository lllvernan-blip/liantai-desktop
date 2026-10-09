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
  /* 取景要能逐字节比对：种子历史里的 ts 都来自 Date.now()，渲染成「9/29 08:58」这种分钟数——
     两次跑只要跨了分钟，画像那几张图就必然不同。曾因此把「同一份代码连跑两次」当成界面改动查了一轮。
     把页面里的时钟钉在一个固定时刻，「重构不许动界面」才能用字节比对来验。真实等待（setTimeout）不受影响。 */
  var __FROZEN_NOW = new Date(2026, 8, 29, 9, 0, 0).getTime();
  Date.now = function () { return __FROZEN_NOW; };
  /* 另一个不稳定源：入场动画（弹层 / 正文首屏）。抓在不同进度上，整屏像素都不一样。
     这里把动画与过渡全关掉——「both」填充模式下动画播完的终态就是无动画态，所以画面不多不少。 */
  try {
    var __st = document.createElement("style");
    __st.textContent = "*{animation:none !important;transition:none !important;}";
    document.head.appendChild(__st);
  } catch (e) {}
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
      { ts: Date.now() - 3600e3, module: "sl.guina", subtype: "概括问题", question: __q, answer: "……", keyPoints: [], cardPeeks: 2, timeLimit: 30, usedSec: 1926, hits: [ { point: "推动材料线上共享，减少重复提交", score: 4, awarded: 2.5, kind: "表达" }, { point: "把分散审批事项集中到一窗受理", score: 4, awarded: 4, kind: "-" } ], grade: { total: 79, scored: { got: 15.8, max: 20 }, scores: { 要点全面: 16, 归类准确: 17, 表述精炼: 15, 条理清晰: 16, 语言准确: 14 }, strengths: ["要点覆盖全"], weaknesses: ["归类粗"], comment: "要点抓得全。" } },
      { ts: Date.now() - 7200e3, module: "zy.gongwen", subtype: "通知", question: __q, answer: "……", keyPoints: [], cardPeeks: 1, hits: [ { point: "结尾写发文机关与日期", score: 4, awarded: 0, kind: "格式" }, { point: "正文分条列明事项", score: 4, awarded: 4, kind: "-" } ], grade: { total: 61, scored: { got: 12.2, max: 20 }, scores: { 格式规范: 10, 内容完整: 13, 语言得体: 12, 条理清晰: 13, 角色定位: 12 }, strengths: ["语言得体"], weaknesses: ["漏写落款"], comment: "格式欠规范。" } },
      { ts: Date.now() - 10800e3, module: "zy.guina", subtype: "概括原因", question: __q, answer: "……", keyPoints: [], cardPeeks: 0, timeLimit: 45, usedSec: 1680, grade: { total: 100, scored: { got: 20, max: 20 }, scores: { 要点全面: 20, 归类准确: 20, 表述精炼: 20, 条理清晰: 20, 语言准确: 20 }, strengths: ["要点全面"], weaknesses: [], comment: "很完整。" } },
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
        { point: "把分散在各部门的审批事项集中到一窗受理", evidence: "材料第一句", status: "满分", score: 4, awarded: 4, kind: "-" },
        { point: "推动材料线上共享，减少重复提交", evidence: "材料只说企业反映，未写做法", status: "部分命中", score: 4, awarded: 2, kind: "材料" },
        { point: "压缩平均办理时限", evidence: "12 个工作日压缩到 4 个", status: "满分", score: 4, awarded: 3, kind: "漏点" },
        { point: "上线好差评系统并与窗口考核挂钩", evidence: "上线了好差评系统，办事群众扫码即可评价", status: "满分", score: 4, awarded: 4, kind: "-" },
        { point: "把标准化清单覆盖率与开办环节写进计划", evidence: "覆盖率提高到九成、环节从 6 个压到 3 个", status: "未命中", score: 4, awarded: 0, kind: "漏点" },
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
    state.tut = { home:true, zy:true, sl:true, pd:true };   // 老场景默认「已看过教程」，保持各屏原状；要看教程本身用 01b / 17 / 18 号场景
    state.history = opts.history ? __hist() : [];
    state.flows = [];
    state.experiences = opts.exp ? [{ id: "e1", type: "错因", kind: "格式", title: "漏写落款文号", body: "公文类作答结尾必须写发文机关与日期，材料里给了就照抄。", scope: "", module: "zy.gongwen", subject: "zy", ts: Date.now(), disabled: false, sourceSig: "x" }] : [];
    state.profile = { lastModules: [], dims: {} };
    state.cache = state.cache || {};
    state.cache.studyCards = {}; state.cache.notes = {};
    _flowId = null; current = null; lastGrade = null; activeModule = null; pdActive = false; pdRound = null;
    profPage = null;   // 画像的二级页也不跨场景留着：上一屏翻到哪一页，下一屏会直接从那页开始
    if (typeof tourEnd === "function") tourEnd(false);   // 上一场在播的引导先收掉，否则它会留在本场盖住画面（且本场不再播）
    closeModals();   // 取景器所有场景共用一个窗口：上一屏开着的弹层不关，会把后面的场景盖住
    banner("");
    renderTabs(); renderHeader();
  };
}

// —— 场景 ——
function s01_start_new() { __reset({ key: false }); banner("欢迎。填上 API Key 就能开始练；还没有 Key 的话，设置页里备了四步申请教程（推荐 DeepSeek，几分钱练一次）。" + OPEN_SETTINGS_BTN); renderHome(); }
// 首页的首次引导（2026-10-08）：首页是打开软件的第一屏，它自己一套引导
function s01b_home_tut() { __reset({ key: false }); state.tut.home = false; renderHome(); }
function s02_start_ready() { __reset({ history: true }); state.flows = [{ id: "flow_keep", subject: "sl", module: "sl.guina", subtype: "概括问题", sig: "x", question: __q, keyPoints: [], createdAt: Date.now() - 600e3, closedAt: null, step: "draft", attempts: [{ ts: Date.now(), answer: "a", outline: "", mode: "draft" }], selections: [], groups: [], drafts: [] }]; renderHome(); }
// 科目首页（点了综应A）：科目点灯 + 该科目的题型页签都在（与首页的「无选中态」对照）
function s02b_subject_home() { __reset({ history: true, subject: "zy" }); renderStart(); }
// 申论科目首页：红按钮跟着换名（开始申论练习），快判同样不在纸面上
function s02c_sl_subject_home() { __reset({ history: true, subject: "sl" }); renderStart(); }
// 没填 Key 的两套引导（2026-10-08 复查）：引导的话得跟「此刻真能做到什么」一致——
// 科目页第一步改指设置页，首页大题那句改成「都要先填 API Key」
function s01c_home_tut_nokey() { __reset({ key: false }); state.tut.home = false; renderHome(); }
function s02d_subj_tut_nokey() { __reset({ key: false, subject: "zy" }); state.tut.zy = false; renderStart(); }
// 没填 Key 的快判落地页：入口标签如实写成内置示例题（点了 A 得到 B 的另一半）
function s12b_pd_landing_nokey() { __reset({ key: false }); enterPD(); }
function s03_landing() { __reset({ history: true }); renderModuleLanding("sl.guina"); }
function s04_zy_card() { __reset(); current = { module: "zy.guina", subtype: "概括做法", question: __q, keyPoints: [], studyCard: __card, cardPeeks: 0, phase: "card" }; activeModule = "zy.guina"; renderQuestion(); }
function s05_zy_answer() { __reset(); current = { module: "zy.guina", subtype: "概括做法", question: __q, keyPoints: [], studyCard: __card, cardPeeks: 1, phase: "answer" }; activeModule = "zy.guina"; renderQuestion(); }
function s06_flow_read() { __reset({ history: true }); __flow("read"); renderQuestion(); }
function s06b_flow_read_drawer() { __reset({ history: true }); __flow("read"); renderQuestion(); document.querySelector("#btnCard").onclick(); }
function s07_flow_organize() { __reset({ history: true }); __flow("organize"); renderQuestion(); }
function s07b_flow_organize_done() { __reset({ history: true }); const f = __flow("organize"); f.orgIdx = 2; renderQuestion(); }
function s08_flow_draft() { __reset({ history: true }); __flow("draft"); renderQuestion(); }
function s09_flow_review() { __reset({ history: true, exp: true }); __flow("review"); lastGrade = { g: __grade(), total: 67, expCheck: { again: ["漏写落款文号"], fixed: [], at: Date.now() } }; renderQuestion(); }
function s10_flow_distill() { __reset({ history: true, exp: true }); __flow("distill"); _lastDistilled = [{ id: "d1", type: "失分点", title: "把企业反映当做法", body: "材料里的第三方反映不是该主体的做法，概括时不能算作措施。", scope: "" }]; renderQuestion(); }
function s11_profile() {
  __reset({ history: true, exp: true });
  // 种一条「复犯过」的错因：画像里要看得见经验状态那一行（已改掉/复犯/待验证）
  state.experiences[0].lastCheckAt = Date.now(); state.experiences[0].lastRecurAt = Date.now();
  state.experiences[0].cleared = false; state.experiences[0].recur = 2;
  openModal("modalProfile"); renderProfile();
}
function s11b_profile_module() {
  // 画像二级页（点进去的明细）：维度条 / 常错类型 / 短板强项 / 文种统计都在这页
  __reset({ history: true, exp: true });
  openModal("modalProfile");
  profGo("mod", "sl.guina");
}
function s11c_profile_hist() {
  // 画像二级页：练习记录（含用时列）
  __reset({ history: true, exp: true });
  openModal("modalProfile");
  profGo("hist");
}
function s11d_profile_exp() {
  // 画像二级页：经验（一条经验还没核过时的状态行）
  __reset({ history: true, exp: true });
  openModal("modalProfile");
  profGo("exp");
}
function s11e_profile_pd() {
  // 画像二级页：快判（三种形式各自的正确率 + 最该回头考的辨析点）
  __reset({ history: true, exp: true });
  state.history.unshift(
    { ts: Date.now() - 900e3, track: "pd", subject: "zy", form: "fact-select", theme: "政务服务", correct: 2, total: 3,
      items: [
        { form: "fact-select", trap: "", ok: true },
        { form: "fact-select", trap: "改数量时限", ok: false },
        { form: "fact-select", trap: "换主体", ok: false },
      ] },
    { ts: Date.now() - 3600e3, track: "pd", subject: "zy", form: PD_MIX, theme: "营商环境", correct: 3, total: 4,
      items: [
        { form: "fact-select", trap: "改数量时限", ok: false },
        { form: "group-summary", trap: "归并不同类", ok: false },
        { form: "expression", trap: "抹掉限定语", ok: false },
        { form: "expression", trap: "", ok: true },
      ] },
  );
  openModal("modalProfile");
  profGo("pd");
}
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
// 示例轮（2026-10-07「快判往上提」）：没填 Key 的人点「开始快判」应该落到这两屏——第一道题与小结点
function s14b_pd_sample() { __reset({ key: false }); startPDRound(PD_MIX); }
function s14c_pd_sample_done() {
  __reset({ key: false });
  startPDRound(PD_MIX);
  for (let i = 0; i < 5; i++) { pdResolve(i % 2); if (!pdRound.done) pdNext(); }
}
// 没填 Key 时点「只练一种形式」（2026-10-08 补）：一轮就应该是那个形式，抬头/纸面也要如实报它——
// 原来只有 5 道题，不管点哪个都给三种混着来的一轮（点了 A 得到 B）
function s14d_pd_sample_single() { __reset({ key: false }); enterPD(); startPDRound("fact-select"); }
function s15_settings() { __reset({ history: true }); openModal("modalSettings"); fillSettings(); setReasonUI(); }
function s16_settings_nokey() { __reset({ history: true, key: false }); openModal("modalSettings"); fillSettings(); setReasonUI(); }
function s15b_settings_mac_update() {
  // mac：壳自己查、自己下，但**下与换都要他点**——这一屏量的是「查到新版、还没下」的样子
  // （按钮得在视口里、文案得说清下一步；弹层里多一行就顶出窗口是踩过的坑）
  __reset({ history: true });
  __updatePush({ supported:true, autoDownload:false, phase:"available", currentVersion:"0.0.15", latestVersion:"0.0.16", releasesUrl:"https://github.com/lllvernan-blip/liantai-desktop/releases" });
  openModal("modalSettings"); fillSettings(); setReasonUI();
  renderUpdateNote();
  var pb = document.querySelector("#modalSettings .panel-body"); if (pb) pb.scrollTop = pb.scrollHeight;   // 「版本与更新」在面板最底：不滚下去就拍不到，白测一轮
}
function s15c_settings_mac_downloaded() {
  // 同一屏的另一个结局：已经下好、等他点重启（量 15b 时对照着看，免得只看一种状态就以为好了）
  __reset({ history: true });
  __updatePush({ supported:true, autoDownload:false, phase:"downloaded", currentVersion:"0.0.15", latestVersion:"0.0.16", releasesUrl:"https://github.com/lllvernan-blip/liantai-desktop/releases" });
  openModal("modalSettings"); fillSettings(); setReasonUI();
  renderUpdateNote();
  var pb = document.querySelector("#modalSettings .panel-body"); if (pb) pb.scrollTop = pb.scrollHeight;
}
function s15d_settings_win_downloading() {
  // Windows 那边是壳自己下（autoDownload），文案与按钮跟 mac 那条链不一样，也得看一眼
  __reset({ history: true });
  __updatePush({ supported:true, autoDownload:true, phase:"downloading", currentVersion:"0.0.15", latestVersion:"0.0.16", progress:{ percent:42, transferred:1048576*31, total:1048576*74 }, releasesUrl:"https://github.com/lllvernan-blip/liantai-desktop/releases" });
  openModal("modalSettings"); fillSettings(); setReasonUI();
  renderUpdateNote();
  var pb = document.querySelector("#modalSettings .panel-body"); if (pb) pb.scrollTop = pb.scrollHeight;
}
function s15e_start_update_notice() {
  // 首页那条小提示：查到新版后，不用先找到设置页也该看得见、点得到
  __reset({ history: true });
  __updatePush({ supported:true, autoDownload:false, phase:"available", currentVersion:"0.0.15", latestVersion:"0.0.16", releasesUrl:"https://github.com/lllvernan-blip/liantai-desktop/releases" });
  renderStartNotices();
}
function s17_landing_tut() { __reset({ history: true }); state.tut.zy = false; renderStart(); }
function s18_pd_tut() { __reset({ history: true }); state.tut.pd = false; enterPD(); }
function s19_tut_reset_replay() { __reset({ history: true }); state.settings.subject = "zy"; openModal("modalSettings"); fillSettings(); const b = $("#btnTutReset"); if (b && typeof b.onclick === "function") b.onclick(); }



function s26_gongwen_landing() {
  // 公文写作落地页
  __reset({ history: true });
  state.settings.subject = "zy";
  renderModuleLanding("zy.gongwen");
}




function s24_answer_limit() {
  // 限时开着、已经进最后 5 分钟：控件与剩余时间在作答区标题行右侧（焦橙）
  __reset();
  current = { module: "zy.guina", subtype: "概括做法", question: __q, keyPoints: [], studyCard: __card, cardPeeks: 1, phase: "answer" };
  activeModule = "zy.guina";
  current.limitMin = 30;
  current.limitFrom = Date.now() - 25 * 60 * 1000;
  renderZyPage();
  const ta = $("#answer");
  if (ta) ta.value = "一、集中受理。把分散在各部门的审批事项集中到一窗受理，平均办理时限由 12 个工作日压缩到 4 个。\n二、上线好差评系统，评价结果直接与窗口考核挂钩。";
  if (ta && typeof setWordCount === "function") setWordCount(ta.value.length, ansLimitFor("zy.guina", __q));
}

function s25_grade_limit() {
  // 批改页上的限时那一行：用时 32 分 06 秒，超时 2 分 06 秒（限时 30 分钟）
  __reset({ history: true });
  const dims = MODULES["zy.guina"].dims;
  const sc = {};
  dims.forEach((d, i) => { sc[d] = [16, 14, 15, 17, 13][i % 5]; });
  const g = { hits: [
    { point: "把分散审批事项集中到一窗受理", score: 4, awarded: 4, status: "满分", kind: "-" },
    { point: "上线「好差评」并与窗口考核挂钩", score: 4, awarded: 2, status: "半分", kind: "表达", evidence: "△ 只提到上线好差评，没说与考核挂钩" },
    { point: "跨部门数据共享（问题类信息）", score: 12, awarded: 0, status: "零分", kind: "漏点", evidence: "【缺：数据共享】" },
  ], scores: sc, strengths: ["结构分条清楚"], weaknesses: ["漏了材料里的问题类信息"], comment: "材料里那句「数据没有真正打通」没接住。" };
  const total = 30;
  current = { module: "zy.guina", subtype: "归纳概括", question: __q, keyPoints: [], cardPeeks: 0, phase: "grade" };
  state.history.unshift({ ts: Date.now(), module: "zy.guina", subtype: "归纳概括", question: __q, answer: "一、集中受理。……", keyPoints: [], hits: g.hits,
    timeLimit: 30, usedSec: 1926, grade: { total, scored: pointsOf(g.hits), scores: sc } });
  renderGrade(g, total, null, { min: 30, usedSec: 1926 });
}

function s29_flow_read_limit() {
  // 申论读材料步的限时：时钟从这一步就起算（控件与剩余时间在题目行右侧）
  __reset({ history: true });
  __flow("read");
  const f = activeFlow();
  if (f) { f.limitMin = 30; f.limitFrom = Date.now() - (17 * 60 + 30) * 1000; }
  state.settings.timeLimit = 30;
  renderQuestion();
}

const SCENES = [
  ["01-起始页-新用户", s01_start_new, true],
  ["01b-起始页-首次引导", s01b_home_tut, true],
  ["02-起始页-已配置", s02_start_ready, true],
  ["02b-综应A-综合推送", s02b_subject_home, true],
  ["02c-申论-科目首页", s02c_sl_subject_home, true],
  ["01c-首页首次引导-没填Key", s01c_home_tut_nokey, true],
  ["02d-科目首页首次引导-没填Key", s02d_subj_tut_nokey, true],
  ["12b-快判-落地页-没填Key", s12b_pd_landing_nokey, true],
  ["03-模块落地页", s03_landing, true],
  ["04-综应A-学习卡", s04_zy_card, true],
  ["05-综应A-作答", s05_zy_answer, true],
  ["06-申论-读材料", s06_flow_read, true],
  ["06b-申论-读材料-学习卡抽屉", s06b_flow_read_drawer, true],
  ["07-申论-归类", s07_flow_organize, true],
  ["07b-申论-归类-走完", s07b_flow_organize_done, true],
  ["08-申论-一稿", s08_flow_draft, true],
  ["09-申论-批改", s09_flow_review, true],
  ["10-申论-沉淀", s10_flow_distill, true],
  ["11-画像", s11_profile, false],
  ["11b-画像-模块详情", s11b_profile_module, false],
  ["11c-画像-练习记录", s11c_profile_hist, false],
  ["11d-画像-经验", s11d_profile_exp, false],
  ["11e-画像-快判", s11e_profile_pd, false],
  ["12-快判-落地页", s12_pd_landing, true],
  ["13-快判-作答", s13_pd_round, true],
  ["14-快判-小结", s14_pd_summary, true],
  ["14b-快判-示例题", s14b_pd_sample, true],
  ["14c-快判-示例小结", s14c_pd_sample_done, true],
  ["14d-快判-示例题-只练一种形式", s14d_pd_sample_single, true],
  ["15-设置", s15_settings, false],
  ["15b-设置-mac查到新版", s15b_settings_mac_update, false],
  ["15c-设置-mac已下好", s15c_settings_mac_downloaded, false],
  ["15d-设置-win后台下载中", s15d_settings_win_downloading, false],
  ["15e-首页-有新版本小提示", s15e_start_update_notice, false],
  ["16-设置-无Key", s16_settings_nokey, false],
  ["17-综应起始-首次引导", s17_landing_tut, true],
  ["18-快判-首次引导", s18_pd_tut, true],
  ["19-设置-重置后当场重播", s19_tut_reset_replay, true],
  ["24-作答-限时", s24_answer_limit, true],
  ["25-批改-限时用时", s25_grade_limit, true],
  ["26-公文写作-落地页", s26_gongwen_landing, false],
  ["29-申论-读材料-限时", s29_flow_read_limit, true],
];

export const scenes = SCENES.map(([name, fn, full, extra]) => Object.assign({
  name,
  full,
  js: "(" + PRELUDE.toString() + ")();\n(" + fn.toString() + ")();",
}, extra || {}));
