/* ---- assertions against the app in the same scope ---- */
const el = s => document.querySelector(s);
const T = [];
const ok = (c, m) => T.push((c ? "PASS  " : "FAIL  ") + m);
// 画像从练习记录推导，测试统一用“往 history 里种成绩”的方式给数据
function scoresFor(k, v){ const sc={}; for(const d of MODULES[k].dims) sc[d]=v; return sc; }
/* fetch 替身统一入口：真实 Response 的 body 只有一份文本，json() 只是把文本解开的糖。
   替身按同样口径造：成功体一律由对象序列化成 text()，这样「请求 + 读完 body」那条真链路（含整体超时）才被测到。
   只给 json() 不给 text() 的替身是在替一个现实中不存在的 Response。 */
const mockRes = o => Promise.resolve(Object.assign({ ok:true, status:200, headers:{ get:()=> "application/json" } }, o,
  o.text? null : { text: async()=> JSON.stringify(o.json ? await o.json() : null) }));

/* 参考答案（范文）是批改成功后单独一次调用（2026-09-29 从主请求里拆出）：
   默认在此短路——不短的话范文那次会把各处 callLLM 桩子里的 cap 顶掉；
   专门考这条链路的断言（9.5）再临时把真身装回去。 */
const realFetchModelAnswer = fetchModelAnswer;
fetchModelAnswer = async ()=> "";

/* 0. 启动顺序：页面脚本求值时，gw_history 里预置的练习记录必须已被 load() 读进内存（TDZ/顺序回归哨兵） */
ok(state.history.length === 1 && state.history[0].ts === 42, "启动顺序: 首次求值即从 gw_history 读回练习记录");
// 预置的是一条旧格式（裸模块键）记录：启动路径就得把它迁到科目前缀上
ok(state.history[0].module === "zy.gongwen", "启动顺序: 旧裸模块键在首次 load 时就补上科目前缀");

/* 0.5 科目骨架：模块键全局唯一、科目定义齐备 */
const ALL_MODULE_KEYS = SUBJECT_ORDER.reduce((a,s)=>a.concat(SUBJECTS[s].modules), []);
ok(new Set(ALL_MODULE_KEYS).size === ALL_MODULE_KEYS.length, "模块键: 全局唯一（" + ALL_MODULE_KEYS.length + " 个）");
ok(Object.keys(MODULES).length === ALL_MODULE_KEYS.length && Object.keys(MODULES).every(k=>ALL_MODULE_KEYS.indexOf(k)>=0),
   "模块键: MODULES 与 SUBJECTS 一一对应，无游离模块");
ok(ALL_MODULE_KEYS.every(k=>MODULES[k] && MODULES[k].name && MODULES[k].dims.length >= 4 && MODULES[k].matLen),
   "模块键: 每个模块都有名字、评分维度和材料长度档");
ok(ALL_MODULE_KEYS.every(k=>k.split(".").length === 2 && SUBJECTS[k.split(".")[0]]),
   "模块键: 都带科目前缀（科目.模块）");
ok(SUBJECT_ORDER.map(s=>SUBJECTS[s].modules.length).join(",") === "5,5",
   "科目: 综应A 五模块 / 申论 五模块（小题四类 + 申发论述）");
ok(SUBJECT_ORDER.every(s=>SUBJECTS[s].name && SUBJECTS[s].role && SUBJECTS[s].note), "科目: name / role / note 齐备");
ok(subjectOf("zy.gongwen") === "zy" && subjectOf("sl.guanche") === "sl" && subjectOf("gongwen") === null,
   "科目归属: 按模块键前缀解析，裸键不算任何科目");
ok(DEFAULT_STATE.settings.subject === "zy" && load().settings.subject === "zy", "科目: 默认科目是 zy");

/* 1. 纯函数 */
ok(JSON.stringify(parseJsonLoose('```json\n{"a":1,}\n```')) === '{"a":1}', "parseJsonLoose: 剥代码围栏 + 容尾逗号");
ok(parseJsonLoose('说明{"b":[1,2]}结尾').b.length === 2, "parseJsonLoose: 容忍前后噪音");
ok(parseJsonLoose("{'a':1}").a === 1, "parseJsonLoose: 单引号键值可修复");
ok(parseJsonLoose("{'a':'\"quoted\"'}").a === '"quoted"', "parseJsonLoose: 单引号内的双引号被转义");
ok(parseJsonLoose('{background:"材料",score:20}').score === 20, "parseJsonLoose: 忘加引号的键可修复");
ok(parseJsonLoose("{'a':1,'b':'x',}").b === "x", "parseJsonLoose: 单引号 + 尾逗号组合");
ok(parseJsonLoose('{"a":"don\'t break"}').a === "don't break", "parseJsonLoose: 双引号内的撇号不动");
ok(parseJsonLoose('{"a":"x, y: z"}').a === "x, y: z", "parseJsonLoose: 正文里的逗号冒号不被误改");
let threwBad = false; try{ parseJsonLoose("{完全不是 JSON"); }catch(e){ threwBad = true; }
ok(threwBad, "parseJsonLoose: 修不好时老实报格式异常，不硬编");
ok(dimTotal({ x:10, y:20 }, ["x","y"]) === 75, "dimTotal: 归一化为百分制");
ok(difficultyFor("zy.gongwen") === "适中", "难度: 未练过默认适中");
state.history = [{ module:"zy.gongwen", grade:{ scores: scoresFor("zy.gongwen",17) } }]; // 85%
ok(difficultyFor("zy.gongwen") === "较难", "难度: 高分加码到较难");
state.history = [{ module:"zy.gongwen", grade:{ scores: scoresFor("zy.gongwen",9) } }];  // 45%
ok(difficultyFor("zy.gongwen") === "简单", "难度: 低分退到简单");
state.history = [];
ok(wordLimit({ requirements:"以街道办名义写一份通知，不超过300字。" }) === 300, "字数上限: 不超过N字");
ok(wordLimit({ requirements:"写一份倡议书（350字以内）。" }) === 350, "字数上限: N字以内");
ok(wordLimit({ requirements:"写一份公开信，字数450左右。" }) === 450, "字数上限: 字数N左右");
ok(wordLimit({ requirements:"写一份函。" }) === null, "字数上限: 无要求返回 null");
ok(MODULES["zy.gongwen"].matLen[0] === 300 && MODULES["zy.guina"].matLen[1] === 900, "材料分档: 按模块给真实长度");
ok(!GONGWEN_TYPES.some(t=>t.type==="公文改错"), "题型: 公文改错不在池中 (综应A 不含改错类题型，改错属综应B 校阅改错)");
ok(GONGWEN_TYPES.length === 21, "题型: 公文写作池 = 21 个文种 (got " + GONGWEN_TYPES.length + ")");
/* 法定公文：《党政机关公文处理工作条例》第八条共 15 种，本池收 11 种 */
const GW_STATUTORY = GONGWEN_TYPES.filter(t=>t.cat === "法定公文").map(t=>t.type);
ok(GW_STATUTORY.length === 11 && GW_STATUTORY.indexOf("通告") >= 0,
   "题型: 法定公文 11 种且含通告 -> " + GW_STATUTORY.join("/"));
ok(["决议","命令","公报","议案"].every(t=>GONGWEN_TYPES.every(x=>x.type !== t)),
   "题型: 决议/命令/公报/议案 不收（高层级发文，综应A 命题场景出不到）");

/* 1.5 流式 */
ok(sseDelta('data: {"choices":[{"delta":{"content":"你好"}}]}') === "你好", "SSE: 增量解析");
ok(sseDelta('data: [DONE]') === "", "SSE: 结束标记返回空");
ok(sseDelta(': keep-alive') === "", "SSE: 心跳注释行返回空");
ok(sseDelta('data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}') === "", "SSE: 推理内容不计入正文");
ok(sseDelta('data: {broken') === "", "SSE: 坏行不炸");
ok(streamPeek('{"question":{"background":"第一段\\n\\n第二段","req') === "第一段\n\n第二段", "流式预览: 从半截 JSON 抠出背景材料并还原换行");
ok(streamPeek('{"hits":[{"point":"a","evidence":"e1"},{"point":"b","evidence":"e2"}],"comment":"x"', ["evidence"]) === "e2", "流式预览: 同类字段取最新一条");
ok(streamPeek('{"scores":{}}', ["background","point"]) === "", "流式预览: 没有可抠片段时返回空");

/* 2. 草稿保护 */
const q1 = { background:"甲材料", requirements:"写一份通知" };
ok(qSig(q1) === qSig({ background:"甲材料", requirements:"写一份通知" }), "qSig: 同题同签名");
ok(qSig(q1) !== qSig({ background:"乙材料", requirements:"写一份通知" }), "qSig: 换题换签名");
saveDraft(qSig(q1), "我的草稿");
ok(loadDraft(qSig(q1)) === "我的草稿", "草稿: 同题能恢复");
ok(loadDraft(qSig({ background:"别的题" })) === "", "草稿: 不串到别的题");
clearDraft();
ok(loadDraft(qSig(q1)) === "", "草稿: 答案提交后能清空");

/* 3. 自适应引擎 */
const seen = {};
for(let i=0;i<400;i++){ const k = weakestModule(); seen[k] = (seen[k]||0)+1; }
const counts = Object.values(seen);
ok(Object.keys(seen).length === 5 && Math.min.apply(null,counts) >= 40 && Math.max.apply(null,counts) <= 120,
   "冷启动: 五个模块均摊，而不是死守第一个 -> " + JSON.stringify(seen));
state.history = [ { module:"zy.gongwen", grade:{ scores: scoresFor("zy.gongwen",15) } },  // 最新：75%
                  { module:"zy.guina",   grade:{ scores: scoresFor("zy.guina",11) } } ];  // 更早：55%
state.profile.lastModules = ["zy.gongwen"];
ok(moduleScore("zy.guina") < moduleScore("zy.gongwen"), "更弱且没刚练过的模块优先");
let g = 0;
for(let i=0;i<200;i++){ if(weakestModule() === "zy.gongwen") g++; }
ok(g < 80, "刚练过的模块不再霸屏 (gongwen " + g + "/200)");
const tseen = {};
for(let i=0;i<400;i++){ tseen[pickSubtypeFor("zy.gongwen")] = 1; }
ok(Object.keys(tseen).length === GONGWEN_TYPES.length, "文种: " + GONGWEN_TYPES.length + " 个文种都不会被饿死 (" + Object.keys(tseen).length + "/" + GONGWEN_TYPES.length + ")");

/* 4. 渲染（画像从练习记录近期加权推导） */
state.history = [{ module:"zy.gongwen", grade:{ scores: scoresFor("zy.gongwen",15) } }]; // 75%
renderProfile();
ok(el("#profileBody").innerHTML.indexOf("width:75%") >= 0, "画像: 进度条按百分制铺满 (75%)");
ok(el("#profileBody").innerHTML.indexOf("均分 75") >= 0, "画像: 均分与进度条同一刻度");
// 同样两次练习（旧 5 分、新 15 分）：终身平均是 50%，近期加权应为 52% —— 画像必须偏向最近
state.history = [ { module:"zy.gongwen", grade:{ scores: scoresFor("zy.gongwen",15) } },
                  { module:"zy.gongwen", grade:{ scores: scoresFor("zy.gongwen",5)  } } ];
renderProfile();
ok(el("#profileBody").innerHTML.indexOf("width:52%") >= 0, "画像: 近期加权生效（52% 而非终身平均 50%）");
// 短板/强项由加权分推导：格式规范 25% → 短板，语言得体 95% → 强项
const mixed = scoresFor("zy.gongwen", 12); mixed["格式规范"] = 5; mixed["语言得体"] = 19;
state.history = [{ module:"zy.gongwen", grade:{ scores: mixed } }];
renderProfile();
ok(el("#profileBody").innerHTML.indexOf("短板·格式规范") >= 0, "画像: 短板由加权分推导（一级行上就挂着一条）");
profGo("mod", "zy.gongwen");
ok(el("#profileBody").innerHTML.indexOf("强项·语言得体") >= 0, "画像: 强项由加权分推导（点进模块才铺开）");
// 文种统计同样近期加权：新 80、旧 60 → (80+60*0.85)/1.85 ≈ 71，而非终身平均 70
state.history = [ { module:"zy.gongwen", subtype:"通知", grade:{ total:80, scores: scoresFor("zy.gongwen",16) } },
                  { module:"zy.gongwen", subtype:"通知", grade:{ total:60, scores: scoresFor("zy.gongwen",12) } } ];
profGo("mod", "zy.gongwen");
ok(el("#profileBody").innerHTML.indexOf(">71<") >= 0, "画像: 文种统计近期加权 (71 而非 70)");

/* 4.5 总分口径唯一：模块「均分」必须吃 grade.total，不能被维度分带偏 */
state.history = [{ module:"zy.gongwen", subtype:"通知", grade:{ total:60, scores: scoresFor("zy.gongwen",15) } }];
ok(moduleAvg("zy.gongwen") === 60, "口径: 模块均分取总分（同一条记录维度分全是 15 也不改口）");
profBack();
ok(el("#profileBody").innerHTML.indexOf("均分 60") >= 0 && el("#profileBody").innerHTML.indexOf("均分 75") < 0,
   "口径: 画像显示「均分 60」，与练习记录表的总分是同一个数");
profGo("mod", "zy.gongwen");
ok(el("#profileBody").innerHTML.indexOf("width:75%") >= 0, "口径: 维度条照旧按维度分铺 75%（诊断层不受影响）");

/* 4.6 recordTotal：有总分用总分，老记录才回退维度分，都没有就不计入 */
ok(recordTotal({ module:"zy.guina", grade:{ total:42, scores: scoresFor("zy.guina",20) } }) === 42,
   "recordTotal: 有总分就以总分为准");
ok(recordTotal({ module:"zy.guina", grade:{ scores: scoresFor("zy.guina",20) } }) === 100,
   "recordTotal: 老记录没存总分时，用维度分折算");
ok(recordTotal({ module:"zy.guina", grade:{} }) === null, "recordTotal: 总分与维度都没有，返回 null 而不是 0");
ok(recordTotal({ track:"pd", form:"fact-select", correct:3, total:5 }) === null,
   "recordTotal: 快判记录没有 module，天然不计入");

/* 4.7 维度缺失不再把折算分拉低 */
ok(dimTotal({ a:20, b:20 }, ["a","b"]) === 100 && dimTotal({ a:20, b:20 }, ["a","b","c"]) === 100,
   "dimTotal: 没给的维度不进分母（不再按 0 分算）");
ok(dimTotal({}, ["a","b"]) === 0, "dimTotal: 一个维度都没有时返回 0，不冒 NaN");

/* 4.8 调度：模块基准分与子类型基准分同刻度，不再一个掂维度、一个掂总分 */
ok(Math.round(moduleAvg("zy.gongwen")) === Math.round(subtypeStat("zy.gongwen","通知").avg),
   "调度: 同一批记录下模块基准分与子类型基准分是同一个数");

state.settings.orgName = "测试单位";
state.history = [];
current = { module:"zy.gongwen", subtype:"通知", question:q1, cardPeeks:0 };
saveDraft(qSig(q1), "恢复我");
el("#answer").value = "";
el("#draftNote").textContent = "";
renderQuestion();
ok(activeFlow() === null && el("#docBody").innerHTML.indexOf("flowRail") < 0, "综应A 两阶段: 渲染不建链、不渲染步骤条");
ok(el("#docBody").innerHTML.indexOf("我已学习，开始作答") >= 0, "综应A 两阶段: 学习卡阶段有「开始作答」入口");
ok(el("#docBody").innerHTML.indexOf("作答要求") < 0, "综应A 两阶段: 卡阶段不亮题面（题目等开始作答才出现）");
el("#btnZyAnswer").onclick();
ok(el("#docBody").innerHTML.indexOf("作答要求") >= 0, "综应A 两阶段: 点开始作答后题面亮出");
ok(el("#answer").value === "恢复我", "综应A 作答页: 自动恢复未提交草稿");
ok(el("#wordCount").innerHTML.indexOf("3") >= 0, "综应A 作答页: 字数统计");
current = { module:"zy.gongwen", subtype:"通知", question:{ background:"字数题", requirements:"写一份通知，不超过200字。" } };
saveDraft(qSig(current.question), "x");
el("#answer").value = "一二三四五六七八九十".repeat(25);   // 250 字，超出 200
syncAnswer(qSig(current.question), el("#answer"), wordLimit(current.question));
ok(el("#wordCount").innerHTML.indexOf("超出 50 字") >= 0 && el("#wordCount").innerHTML.indexOf("b class=\"over\"") >= 0, "题目页: 超出字数上限标红并给出超出量");
el("#answer").value = "一二三四五";
syncAnswer(qSig(current.question), el("#answer"), wordLimit(current.question));
ok(el("#wordCount").innerHTML.indexOf("/ 200 字") >= 0, "题目页: 未超出时显示 已写/上限");
current = { module:"zy.gongwen", subtype:"通知", question:q1 };
// 批改页的主体是「我的答案」：证据里带逐字原句，这里正好走一遍定位 -> 标分 / 标红
renderGrade({ scores:{}, strengths:["条理清楚"], weaknesses:["缺少主送机关"],
              hits:[ {point:"标题含事由",score:4,awarded:4,status:"满分",evidence:"答到：「关于调整作息的通知」"},
                     {point:"写明主送机关",score:4,awarded:0,status:"零分",evidence:"【缺：写明主送机关】"},
                     {point:"落款单位与日期",score:2,awarded:1,status:"半分",evidence:"答到：「遵照执行」只写了要求，【缺：成文日期】"} ],
              comment:"继续加油", modelAnswer:"关于调整作息的通知。各科室请遵照执行。" },
            60, null, null, "关于调整作息的通知。各科室请注意作息调整，请遵照执行。特此通知。");
ok(el("#docBody").innerHTML.indexOf(">我的答案</div>") >= 0 && el("#docBody").innerHTML.indexOf("asent got") >= 0,
   "批改页: 首屏就是带标注的「我的答案」（2026-10-13）");
ok(el("#docBody").innerHTML.indexOf("asent got") >= 0, "批改页: 有分的句子标色（拿满的焦橙、没拿满的红）");
ok(el("#docBody").innerHTML.indexOf('class="asent got full"') >= 0 && el("#docBody").innerHTML.indexOf('class="asc full">+4<') >= 0,
   "批改页: 拿满的句子标焦橙（跟没拿满的红分开）");
ok(el("#docBody").innerHTML.indexOf('class="asc full">+4<') >= 0 && el("#docBody").innerHTML.indexOf('class="asc">+1<') >= 0,
   "批改页: 凡有分的句子都在句末报分（满分句也报，2026-10-16）");
ok(el("#docBody").innerHTML.indexOf("+0<") < 0, "批改页: 没分的不标 +0（素色本身就是「这里没分」）");
const ascSum = (el("#docBody").innerHTML.match(/class="asc[^"]*">\+([\d.]+)</g) || [])
  .reduce((a, s)=> a + Number(s.replace(/[^\d.]/g, "")), 0);
ok(Math.abs(ascSum - 5) < 1e-9, "批改页: 句末分数加起来就是页头总分（5 = 4 + 1）");
ok(el("#docBody").innerHTML.indexOf("漏掉的采分点") < 0 && el("#docBody").innerHTML.indexOf("missline") < 0,
   "批改页: 旧版「漏答清单」的措辞没有回来（那时的清单不带分值也不带错因）");
ok(el("#docBody").innerHTML.indexOf("全部采分点对照") < 0 && el("#docBody").innerHTML.indexOf("先改这几条") < 0,
   "批改页: 旧版「全量对照表 / 先改这几条」的措辞没有回来");
/* 提炼（原「沉淀」步）结果就地补进批改页：它是异步跑的，跑完才填这一行 */
ok(el("#docBody").innerHTML.indexOf('id="expLine"') >= 0, "批改页: 留出「这次提炼了 N 条经验」的位置");
_lastDistilled = [{ type:"错因", title:"把反映当做法", body:"材料里的第三方反映不是做法。" }];
paintExpLine();
ok(el("#expLine").innerHTML.indexOf("这次提炼了 1 条经验") >= 0 && el("#expLine").innerHTML.indexOf("btnGoExp") >= 0,
   "批改页: 提炼结果就地补一行，并给去画像的入口");
_lastDistilled = []; paintExpLine();
ok(el("#expLine").innerHTML === "", "批改页: 这次没提炼出经验就不留空行");
/* 编号小标题的特判撤了（2026-10-16）：0 分不再有任何标记，「冤枉题头」这件事自然不存在 */
ok(answerReviewHtml({ hits:[{point:"点",score:4,awarded:4,status:"满分",evidence:"答到：「正文内容」"}] }, "一、开头小标题。正文内容到这里。").indexOf('class="asent got') >= 0,
   "逐句标注: 分落在哪一句就标哪一句（有分的标色）");
ok(answerReviewHtml({ hits:[{point:"点",score:4,awarded:0,status:"零分",evidence:"【缺：无】"}] }, "四、加强宣传引导。").indexOf("asent got") < 0,
   "逐句标注: 一分没得的句子不挂任何标记（含编号小标题）");
/* 定位三级：照抄走逐字、改标点走归一化、改编过走最长公共段（2026-10-16 改展示的底子） */
ok(locateFrag("各科室请遵照执行。特此通知。", "各科室请，遵照执行") >= 0, "定位: 只差标点也认");
ok(locateFrag("各科室请遵照执行。特此通知。", "各科室请遵照执行的落实情况") >= 0, "定位: 模型改写/加字也能落到最像的那句");
ok(locateFrag("各科室请遵照执行。", "与本卷毫无关系的另一段话") < 0, "定位: 真对不上的不许硬落（成段门槛挡住瞎标）");
ok(evidenceFrags("答到：关于调整作息的通知").length === 1, "证据片段: 模型没打引号时剥掉符号照用");
ok(evidenceFrags("【缺：成文日期】答到：关于调整作息的通知")[0] === "关于调整作息的通知",
   "证据片段: 【缺】写在前面时也剥掉「答到：」前缀");
ok(el("#docBody").innerHTML.indexOf('class="modelanswer"') >= 0, "批改页: 范文仍在页面上（现在收在可展开区里）");
ok(el("#docBody").innerHTML.indexOf("继续加油") >= 0, "阅卷页: 点评渲染");

/* 4.5 采分点分值口径（满分/半分/零分三档 + 标注符号） */
ok(SCORING_RULES.indexOf("数点不估百分比") >= 0 && SCORING_RULES.indexOf("need") >= 0 && SCORING_RULES.indexOf("全部答到") >= 0 && SCORING_RULES.indexOf("一条都没答到") >= 0,
   "阅卷: 三档判法是数点数（按子项自带的 need 逐条核），不再估 80%/40% 百分比阈值");
ok(SCORING_RULES.indexOf("没带 need") >= 0, "阅卷: 子项没带 need 时退回按子项文字拆点（老题/老记录仍能判）");
ok(SCORING_RULES.indexOf("【缺：") >= 0 && SCORING_RULES.indexOf("△") >= 0 && SCORING_RULES.indexOf("✗") >= 0, "阅卷: prompt 写明三个标注符号");
ok(SCORING_RULES.indexOf("不倒扣") >= 0, "阅卷: prompt 写明不倒扣");
ok(GEN_POINT_RULES.indexOf("必须正好等于 question.score") >= 0, "出题: prompt 要求子项分值之和等于题目满分");
/* 采分点分值校验（2026-10-15）。
   prompt 里写的要求不是保证：走查那天实测到模型拆出的子项合计 25 分、题目满分却是 20 分。
   既然这是纯算术，就不该交给模型的自觉——本地当场拉回，不重发请求。 */
(function(){
  const mk = (paper, ss)=>({ question:{score:paper}, keyPoints:ss.map(s=>({point:"p",score:s})) });
  const sumOf = d=> d.keyPoints.reduce((a,p)=>a+p.score, 0);
  const same = mk(20, [5,5,5,5]);
  alignPointScores(same);
  ok(sumOf(same) === 20 && same.keyPoints.every(p=>p.score === 5), "采分点校验: 合计与满分一致时不改动任何子项");
  const over = mk(20, [8,7,5,5]);
  alignPointScores(over);
  ok(sumOf(over) === 20, "采分点校验: 子项合计 25 分对满分 20 分，当场拉回 20 分（不再靠批改页事后提醒）");
  ok(over.keyPoints[0].score > over.keyPoints[3].score && over.keyPoints[0].score === 6.5,
     "采分点校验: 按比例重分，原大的仍大（8/7/5/5 对 20 分 → 6.5/5.5/4/4）");
  const under = mk(25, [4,4,4]);
  alignPointScores(under);
  ok(sumOf(under) === 25, "采分点校验: 合计不足满分时同样拉回");
  const odd = mk(15, [2,2,2,2,2,2,2]);
  alignPointScores(odd);
  ok(Math.abs(sumOf(odd) - 15) < 1e-9, "采分点校验: 除不尽的分配也能精确归到满分（不靠四舍五入碰运气）");
  const cramped = mk(1, new Array(12).fill(1));
  alignPointScores(cramped);
  ok(cramped.keyPoints.every(p=>p.score === 1), "采分点校验: 子项多到 0.5 分都分不下去时宁可不动（不编出 0 分项）");
  ok(alignPointScores(null) === null && alignPointScores({question:{score:20}}).keyPoints === undefined
     && alignPointScores({question:{score:"x"},keyPoints:[{score:5}]}).keyPoints[0].score === 5,
     "采分点校验: 缺字段与坏字值都安全放过，不炸也不乱改");
  ok(/return alignPointScores\(data\);/.test(PAGE_HTML),
     "采分点校验: gen() 返回前真的过了这道校验（测得到函数不等于拦得住题）");
})();
ok(GEN_POINT_RULES.indexOf("85%-95%") >= 0, "出题: prompt 要求子项长度落在字数上限的 85%-95%");
ok(GEN_POINT_RULES.indexOf("need") >= 0 && GEN_POINT_RULES.indexOf("能对着答案划勾") >= 0,
   "出题: prompt 要求每条子项附一份 need（必须答到的具体情形），且要具体到能划勾");
ok(GEN_POINT_RULES.indexOf("3-6 条") >= 0 && GEN_POINT_RULES.indexOf("只写一个可核对的事实") >= 0 && GEN_POINT_RULES.indexOf("拆成三条") >= 0,
   "出题: prompt 要求 need 原子化（3-6 条、一条只写一个可核对的事实、不得塞并列要件）");
ok(SCORING_RULES.indexOf("一条一条核") >= 0, "阅卷: prompt 要求 need 一条一条独立核，不许并起来判");
ok(JSON.stringify(pointsOf([{score:5,awarded:5},{score:5,awarded:2.5}])) === '{"got":7.5,"max":10}', "采分点: 实得分与满分求和");
ok(pointsOf([{score:5,awarded:99}]).got === 5, "采分点: 实得分夹在子项满分内（模型多给不算数）");
ok(pointsOf([{point:"没有分值的老数据"}]) === null, "采分点: 无分值信息时不冒充总分");
ok(hitClass({status:"满分"}) === "hit" && hitClass({status:"半分"}) === "part" && hitClass({status:"零分"}) === "miss", "采分点: 新档位名归类");
ok(hitClass({status:"命中"}) === "hit" && hitClass({status:"部分命中"}) === "part" && hitClass({status:"未命中"}) === "miss", "采分点: 旧档位名仍能归类");
renderGrade({ scores:{}, strengths:[], weaknesses:[], comment:"x", hits:[ {point:"标题含事由",score:5,awarded:5,status:"满分",evidence:"写了标题"},
                   {point:"落款单位与日期",score:5,awarded:0,status:"零分",evidence:"【缺：落款】"} ] }, 50);
ok(el("#docBody").innerHTML.indexOf("/ 10 分") >= 0 && el("#docBody").innerHTML.indexOf("折合") < 0,
   "阅卷页: 只报卷面分（5 / 10 分），折百分制不再显示（2026-10-16）");
ok(el("#docBody").innerHTML.indexOf("作答要求：") < 0 && el("#docBody").innerHTML.indexOf('id="btnSwitch"') >= 0,
   "批改页: 不重复题面（作答要求不出现），「换一题」落在分数那一行");
ok(el("#docBody").innerHTML.indexOf("丢 5 分") < 0 && el("#docBody").innerHTML.indexOf("gtag") < 0,
   "阅卷页: 打了分就不再另报「丢 N 分」（同一个数字不写两遍）");
ok(el("#docBody").innerHTML.indexOf("维度分") < 0,
   "阅卷页: 维度分不在批改页（画像的模块页里有一份完整的）");
current.question.score = 20;   // 子项合计 15 ≠ 题目满分 20，必须明示而不是静默
renderGrade({ scores:{}, strengths:[], weaknesses:[], comment:"x", hits:[{point:"只列了一个子项",score:5,awarded:5,status:"满分"}] }, 33);
ok(el("#docBody").innerHTML.indexOf("与本题满分 20 分不一致") >= 0, "阅卷页: 子项合计与题目满分不一致时明示");

/* 3.x 交互减法（2026-10-13）：批改页的流式渐显与「重放批改过程」整块下线——
   重放一遍等于让人把已经摆在眼前的东西再看一次 */
ok(el("#docBody").innerHTML.indexOf(">解析</div>") >= 0,
   "批改页: 解析直接渲染（不再逐句渐显）");
ok(PAGE_HTML.indexOf(".ai-line") < 0 && PAGE_HTML.indexOf("@keyframes stream") < 0
   && PAGE_HTML.indexOf("startGradeStream") < 0 && PAGE_HTML.indexOf("wireGradeStream") < 0
   && PAGE_HTML.indexOf("重放批改过程") < 0 && PAGE_HTML.indexOf("btnReplayGrade") < 0,
   "批改页: 渐显与重放整块下线（含 CSS 与计时器，不留死代码）");
ok(PAGE_HTML.indexOf("答得好的地方") < 0,
   "批改页: 「答得好的地方」那一行也下线（夸奖不改变下一步做什么）");

/* 4.9 划线随写随看 + 完整参考答案（2026-09-18 三改进；题目笔记已下线） */
const qMk = { background:"ABCDEFG", requirements:"R" };
saveMarks(qSig(qMk), new Set([1,2,6]));
ok(markedRuns(qMk).length === 2 && markedRuns(qMk)[0] === "BC" && markedRuns(qMk)[1] === "G", "划线随写随看: 字符级标记还原成句子（保持原文顺序）");
ok(marksRecapHtml(qMk).indexOf("我划的重点（2 处）") >= 0 && marksRecapHtml(qMk).indexOf("BC") >= 0, "划线随写随看: 列表渲染出划过的句子");
renderGrade({ scores:{}, strengths:[], weaknesses:[], comment:"x", modelAnswer:"第一，迅速核实情况。第二，按预案上报。", hits:[] }, 50);
ok(el("#docBody").innerHTML.indexOf('class="modelanswer"') >= 0 && el("#docBody").innerHTML.indexOf("按预案上报") >= 0,
   "阅卷页: 完整范文仍在页面上");
ok(el("#docBody").innerHTML.indexOf(">参考答案</div>") >= 0 && el("#docBody").innerHTML.indexOf("<details") < 0,
   "阅卷页: 范文平铺在「参考答案」题头下（不再折叠）");

/* 5. 失败路径 */
el("#docBody").innerHTML = "正在作答的题";
handleErr({ code:"API", status:400, text:"model not found" }, true);
ok(el("#docBody").innerHTML.indexOf("正在作答的题") >= 0, "出错时保留题目与答案（不再被清空）");
ok(el("#bannerSlot").innerHTML.indexOf("模型名") >= 0, "HTTP 400 给出模型名提示");
ok(el("#bannerSlot").innerHTML.indexOf("model not found") >= 0, "异常时透出接口原文");
handleErr({ code:"JSON" }, true);
ok(el("#bannerSlot").innerHTML.indexOf("格式异常") >= 0, "AI 吐坏 JSON 时提示重试（不再漏成裸异常）");
handleErr({ code:"TIMEOUT" }, false);
ok(el("#docBody").innerHTML.indexOf('data-start="subj"') >= 0, "无题可看时才回到起点");
handleErr({ code:"NO_KEY" }, true);
ok(el("#bannerSlot").innerHTML.indexOf("API Key") >= 0, "未配置 Key 有明确指引");

/* 6. 存储：练习记录单独 key（gw_history）+ 写满降级 */
state.history = Array.from({ length:200 }, (_,i)=>({ ts:i, module:"zy.gongwen", subtype:null, question:{}, answer:"", grade:{ total:60, scores:{}, strengths:[], weaknesses:[] } }));
state.cache.studyCards = { "zy.gongwen::通知": { title:"卡" } };
state.cache.notes = { "zy.gongwen::通知": "手写笔记，不能丢" };
const realSet = localStorage.setItem;
let n = 0;
localStorage.setItem = (k,v) => { if(k === "gw_state"){ n++; if(n <= 2) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } } realSet(k,v); };
let threw = false;
try{ save(); }catch(e){ threw = true; }
ok(!threw, "gw_state 写满时不再直接抛错崩掉");
ok(!state.cache.studyCards["zy.gongwen::通知"], "gw_state 写满时丢弃可再生的学习卡缓存");
ok(state.cache.notes["zy.gongwen::通知"] === "手写笔记，不能丢", "gw_state 写满时手写笔记分毫无损");
ok(state.history.length === 200, "save() 不再裁练习记录");
localStorage.setItem = realSet;
save();
const s1 = JSON.parse(localStorage.getItem("gw_state"));
ok(!("history" in s1), "gw_state 不再存放练习记录");
let m = 0;
localStorage.setItem = (k,v) => { if(k === "gw_history"){ m++; if(m <= 1) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } } realSet(k,v); };
threw = false;
el("#bannerSlot").innerHTML = "";
try{ saveHistory(); }catch(e){ threw = true; }
ok(!threw, "gw_history 写满时不再直接抛错崩掉");
ok(state.history.length === 40, "gw_history 写满时自动裁练习记录 (-> " + state.history.length + ")");
ok(el("#bannerSlot").innerHTML.indexOf("本地存储已满") < 0, "裁剪后重试成功时不误报存储已满");
localStorage.setItem = realSet;
saveHistory();
ok(load().history.length === 40, "练习记录写盘 + 读回往返一致");
ok(loadHistory() === null || Array.isArray(loadHistory()), "loadHistory 对坏数据返回 null 而不是抛错");

/* 6.1 history 拆 key 迁移 */
localStorage.clear();
localStorage.setItem("gw_state", JSON.stringify({ settings:{}, profile:{}, history:[{ ts:1, module:"zy.guina", grade:{ total:50, scores:{} } }], cache:{} }));
const stMig = load();
ok(stMig.history.length === 1 && stMig.history[0].ts === 1, "迁移: 旧 gw_state 里的练习记录被读出");
ok(Array.isArray(JSON.parse(localStorage.getItem("gw_history"))) && JSON.parse(localStorage.getItem("gw_history")).length === 1, "迁移: 当场写入 gw_history，中途关页不丢");
ok(!("history" in JSON.parse(localStorage.getItem("gw_state"))), "迁移: 旧副本从 gw_state 清除");
const stFresh = load();
ok(stFresh.history.length === 1 && stFresh.history[0].ts === 1, "迁移: 再次 load 从新 key 读，不重复迁移");
localStorage.clear();

/* 6.2 科目前缀迁移：旧裸模块键 -> zy.*，幂等且不丢数据 */
localStorage.clear();
localStorage.setItem("gw_state", JSON.stringify({
  settings:{ provider:"deepseek", apiKey:"sk-x" },   // 旧数据没有 subject 这一层
  profile:{ modules:{ gongwen:{ dims:{ "格式规范":{sum:34,n:2}, "语言得体":{sum:30,n:2} }, weakDims:["格式规范"], strongDims:[], types:{} },
                     guina:{ dims:{ "要点全面":{sum:20,n:1} } } },
            lastModules:["gongwen","guina"] },
  cache:{ studyCards:{ "gongwen::通知":{ title:"卡" } }, notes:{ "gongwen::通知":"手写笔记" } },
  history:[{ ts:7, module:"gongwen", subtype:"通知", grade:{ total:70, scores:{} } }]
}));
const m1 = load();
ok(m1.profile.modules["zy.gongwen"].dims["格式规范"].sum === 34 && m1.profile.modules["zy.gongwen"].dims["语言得体"].sum === 30,
   "迁移: 画像键补前缀且维度分值分毫未丢");
ok(m1.profile.modules["zy.guina"].dims["要点全面"].sum === 20, "迁移: 同科目其它模块一起迁");
ok(!m1.profile.modules["gongwen"] && !m1.profile.modules["guina"], "迁移: 裸模块键不再残留在画像里");
ok(m1.profile.lastModules[0] === "zy.gongwen" && m1.profile.lastModules[1] === "zy.guina", "迁移: 最近练过的模块键同样补前缀");
ok(m1.cache.studyCards["zy.gongwen::通知"] && !m1.cache.studyCards["gongwen::通知"], "迁移: 学习卡键只替换 :: 之前那段");
ok(m1.cache.notes["zy.gongwen::通知"] === "手写笔记", "迁移: 手写笔记原样保留");
ok(m1.history[0].module === "zy.gongwen", "迁移: 练习记录的模块键补前缀");
ok(m1.settings.subject === "zy", "迁移: 缺科目时补默认 zy");
const m2 = load();
ok(m2.profile.modules["zy.gongwen"].dims["格式规范"].sum === 34 && Object.keys(m2.profile.modules).indexOf("zy.zy.gongwen") < 0,
   "迁移: 二次 load 幂等（不叠前缀、不丢数据）");
ok(m2.cache.studyCards["zy.gongwen::通知"] && !m2.cache.studyCards["zy.zy.gongwen::通知"], "迁移: 缓存键二次 load 幂等");
ok(m2.history[0].module === "zy.gongwen" && m2.history.length === 1, "迁移: 记录键二次 load 幂等");
const storedAfter = localStorage.getItem("gw_state");
ok(storedAfter.indexOf("zy.zy.") < 0 && storedAfter.indexOf('"gongwen"') < 0, "迁移: 回写后的状态里既无裸键也无叠前缀");
let legacy2 = JSON.parse(localStorage.getItem("gw_state"));
legacy2.settings.subject = "sl";
localStorage.setItem("gw_state", JSON.stringify(legacy2));
ok(load().settings.subject === "sl", "迁移: 已有科目不被改写");
legacy2.settings.subject = "bogus";
localStorage.setItem("gw_state", JSON.stringify(legacy2));
ok(load().settings.subject === "zy", "迁移: 非法科目落到默认");
// 独立的 gw_history 里也可能是裸键
localStorage.clear();
localStorage.setItem("gw_history", JSON.stringify([{ ts:9, module:"guina", grade:{ total:50, scores:{} } }]));
const m3 = load();
ok(m3.history[0].module === "zy.guina", "迁移: 独立 gw_history 里的裸键补前缀");
ok(load().history[0].module === "zy.guina" && load().history.length === 1, "迁移: gw_history 二次 load 幂等");
ok(!m3.cache.studyCards["zy.gongwen::通知"], "迁移: gw_state 缺失时从全新默认值开始");
localStorage.clear();

/* 7. 复查补测：多草稿槽 + 公文骨架同步 */
const qA = { background:"材料A", requirements:"要求A" };
const qB = { background:"材料B", requirements:"要求B" };
saveDraft(qSig(qA), "A 的草稿");
saveDraft(qSig(qB), "B 的草稿");
ok(loadDraft(qSig(qA)) === "A 的草稿" && loadDraft(qSig(qB)) === "B 的草稿", "草稿: 换题不覆盖（多槽）");
for(let i=0;i<10;i++){ saveDraft(qSig({ background:"t"+i, requirements:"r" }), "草稿"+i); }
ok(loadDraft(qSig(qA)) === "", "草稿: 超过 8 份时最旧的被挤出");
current = { module:"zy.gongwen", subtype:"通知", question:{ background:"骨架题", requirements:"写一份通知" }, cardPeeks:0 };
renderQuestion();
el("#btnZyAnswer").onclick();
el("#answer").value = "";
el("#btnTpl").onclick();
ok(el("#answer").value.indexOf("关于") > 0 && el("#wordCount").innerHTML.indexOf("<b>0<") < 0, "骨架: 空作答区首次点击直接插入并同步字数");
ok(loadDraft(qSig(current.question)).indexOf("关于") >= 0, "骨架: 插入后草稿已保存");
el("#btnTpl").onclick();
ok(el("#btnTpl").textContent === "再点一次确认覆盖" && loadDraft(qSig(current.question)).indexOf("关于") >= 0, "骨架: 有内容时点击只上膛不覆盖（页面内两步确认，不弹原生框）");
el("#btnTpl").onclick();
ok(el("#btnTpl").textContent === "插入公文骨架" && el("#answer").value.indexOf("主送机关") > 0, "骨架: 第二次点击确认后重插并复位按钮");
saveDraft(qSig(qB), "B 还在写");
clearDraft(qSig(current.question));
ok(loadDraft(qSig(current.question)) === "" && loadDraft(qSig(qB)) === "B 还在写", "草稿: 提交后只清当前题，别的草稿仍在");
clearDraft();

/* 8. 模型名单按实际拉取 */
ok(pickFast(["z-model","a-flash-model","m-chat"]) === "a-flash-model", "pickFast: 优先轻量款");
ok(pickFast(["zzz","aaa"]) === "zzz", "pickFast: 无轻量款取第一个");
el("#setBase").value = "https://api.test.com/v1";
el("#setKey").value = "sk-test";
el("#setModel").value = "deepseek-v4-flash";   // 不在名单里但实测能用的名字
const realFetch = globalThis.fetch;
globalThis.fetch = () => mockRes({ json: async()=>({ data:[{id:"z-model"},{id:"a-flash-model"},{id:"m-chat"}] }) });
await fetchModels(true);
ok(Array.isArray(state.modelCache["https://api.test.com/v1"]) && state.modelCache["https://api.test.com/v1"].length === 3, "实拉: 名单入库缓存");
ok(el("#setModel").value === "deepseek-v4-flash", "实拉: 静默模式不改写当前模型（名单可能不全）");
ok(el("#modelMenu").innerHTML.indexOf("a-flash-model") >= 0, "实拉: 候选菜单来自接口");
ok(el("#modelMenu").innerHTML.indexOf("z-model") >= 0 && el("#modelMenu").innerHTML.indexOf("m-chat") >= 0,
   "实拉: 展开候选时整份名单全量列出（不受已填文字过滤，自绘菜单替代原生 datalist）");
ok(PROVIDERS.every(p=>!p.models), "预设: 服务商只预设地址，模型名一个都不写死（手写的名字迟早过期）");
el("#setModel").value = "";
await fetchModels(true);
ok(el("#setModel").value === "a-flash-model", "实拉: 当前为空时自动补最快模型");
await fetchModels(false);
ok(el("#setMsg").textContent.indexOf("3 个模型") >= 0, "实拉: 手动拉取有反馈");
el("#setModel").value = "deepseek-v4-flash";
await fetchModels(false);
ok(el("#setModel").value === "a-flash-model", "实拉: 手动拉取时名单外名字被纠偏");
globalThis.fetch = realFetch;

/* 8.2 没有实拉结果时不编名字：候选可以空，模型名不可以瞎写 */
el("#setKey").value = "";   // 清掉 Key，避免换服务商时触发后台实拉，让本段只考验「没有名单时怎么办」
el("#setProvider").value = "kimi";
onProviderChange();
ok(el("#modelMenu").innerHTML === "" && el("#setModel").value === "",
   "换服务商: 这家没实拉缓存就不编候选，也不把上一家的模型名留在框里");
el("#setProvider").value = "deepseek";
onProviderChange();
ok(el("#setModel").value === "" && el("#modelMenu").innerHTML.indexOf("deepseek") < 0,
   "换服务商: 模型栏留空等实拉，不含任何写死的名字");

/* 8.3 档位→请求参数的映射（档位不再由用户选，改由每处调用内置并显式传 level） */
state.settings.apiKey = "sk-test";
const capBodies = [];
const realFetch8 = globalThis.fetch;
globalThis.fetch = (url, opt) => { capBodies.push(JSON.parse(opt.body));
  return mockRes({ json: async()=>({ choices:[{ message:{ content:"ok" } }] }) }); };
state.settings.model = "deepseek-v4-pro";
await callLLM("s","u",false, null, { level:"standard" });
ok(capBodies.at(-1).reasoning_effort === "medium", "适配: effort 家族标准档=reasoning_effort medium");
await callLLM("s","u",false, null, { level:"deep" });
ok(capBodies.at(-1).reasoning_effort === "high", "适配: 深入档=high");
state.settings.model = "qwen3-32b";
await callLLM("s","u",false, null, { level:"quick" });
ok(capBodies.at(-1).enable_thinking === false, "适配: qwen3 快速档=直接关闭思考");
await callLLM("s","u",false, null, { level:"deep" });
ok(capBodies.at(-1).enable_thinking === true && capBodies.at(-1).thinking_budget === 24576, "适配: qwen3 深入档=大思考预算");
state.settings.model = "gpt-4o-mini";
await callLLM("s","u",false, null, { level:"standard" });
ok(capBodies.at(-1).reasoning_effort === "medium" && capBodies.at(-1).temperature === 0.7,
   "适配: 未识别的模型也按思考强度试探，是否支持以实测为准");
await callLLM("s","u",false);
ok(capBodies.at(-1).reasoning_effort === "medium", "适配: 调用方不传 level 时按标准档走，不读用户设置");
globalThis.fetch = realFetch8;

/* 8.4 档位实测记忆：被拒过就记住，之后不再白发被拒请求 */
const realFetch84 = globalThis.fetch;
capBodies.length = 0;
globalThis.fetch = (url, opt) => { const b = JSON.parse(opt.body); capBodies.push(b);
  if(b.reasoning_effort) return mockRes({ ok:false, status:400, text: async()=>"bad param" });
  return mockRes({ json: async()=>({ choices:[{ message:{ content:"ok" } }] }) }); };
state.settings.model = "deepseek-v4-pro";
await callLLM("s","u",false, null, { level:"deep" });
ok(capBodies.filter(b=>b.reasoning_effort).length === 1 && state.modelCaps["deepseek-v4-pro"] === "rejected",
   "实测记忆: 参数被拒自动降级成功，并记住此模型拒收思考参数");
ok(el("#bannerSlot").innerHTML.indexOf("不接受思考参数") >= 0,
   "实测记忆: 探针被拒有界面提示（不再是静默降级）");
const nB84 = capBodies.length;
await callLLM("s","u",false, null, { level:"deep" });
ok(capBodies.length === nB84 + 1 && !("reasoning_effort" in capBodies.at(-1)),
   "实测记忆: 之后直接按温度发，不再白发一次被拒请求");
globalThis.fetch = (url, opt) => { const b = JSON.parse(opt.body); capBodies.push(b);
  return mockRes({ json: async()=>({ choices:[{ message:{ content:"ok" } }] }) }); };
state.settings.model = "deepseek-v4-flash";
await callLLM("s","u",false, null, { level:"deep" });
ok(state.modelCaps["deepseek-v4-flash"] === "ok" && "reasoning_effort" in capBodies.at(-1),
   "实测记忆: 参数被接受则记住 ok，一次请求就成功");
globalThis.fetch = realFetch84;

/* 8.5 档位实测累计：用户不再选档位，但数据照旧按模型×档位累计（调档位时看实况用） */
state.modelProbe = {};
recordProbe("m-x","quick",100,10); recordProbe("m-x","quick",100,10); recordProbe("m-x","deep",2000,80);
ok(state.modelProbe["m-x"].quick.n === 2 && state.modelProbe["m-x"].quick.reason === 200
   && state.modelProbe["m-x"].deep.n === 1 && state.modelProbe["m-x"].deep.secs === 80,
   "档位观测: 思考量与耗时按模型×档位分别累计");
ok(sseReasonDelta('data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}') === "思考中"
   && sseDelta('data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}') === "",
   "档位观测: SSE 思考增量单独可提取，不混入正文");
state.modelProbe = {};
delete state.modelCaps["deepseek-v4-pro"];   // 清掉 8.4 记下的拒收，不然探测被跳过
const realFetch85 = globalThis.fetch;
globalThis.fetch = (url, opt) => mockRes({ json: async()=>({ choices:[{ message:{ content:"ok", reasoning_content:"思考思考思考思考" } }] }) });
state.settings.model = "deepseek-v4-pro";
await callLLM("s","u",false, null, { level:"deep" });
ok(state.modelProbe["deepseek-v4-pro"] && state.modelProbe["deepseek-v4-pro"].deep && state.modelProbe["deepseek-v4-pro"].deep.reason === 8,
   "档位观测: 响应中的思考内容按模型×档位累计");
globalThis.fetch = realFetch85;

/* 8.6 档位内置：用户不再选档位（2026-10-15），每处调用必须自己带 level。
   这条是静态检查，防的是「新增了一个调用点忘了传」——那会静默落到 standard，
   而 standard 的思考量刚好在输出额度边缘（实测想过 1.8 万字），范文就是这么坏的。 */
{
  const lines = PAGE_HTML.split("\n").filter(l => l.indexOf("callLLM(") >= 0 && l.indexOf("function callLLM") < 0);
  const noLevel = lines.filter(l => l.indexOf("level") < 0);
  ok(lines.length >= 5, "档位: 找到全部 callLLM 调用点（漏查会让这条形同虚设）");
  ok(noLevel.length === 0, "档位: 每处 callLLM 调用都显式带 level" + (noLevel.length? " —— 漏了：" + noLevel[0].trim().slice(0, 60) : ""));
  ok([GEN_LEVEL, GRADE_LEVEL, ANSWER_LEVEL, DISTILL_LEVEL, PD_LEVEL].every(lv => lv in REASON_LEVELS),
     "档位: 内置的五个档位都是 REASON_LEVELS 认得的名字（写错会让请求发不出思考参数）");
  ok(state.settings.reasonLevel === undefined && state.settings.temperature === undefined,
     "档位: 用户设置里不再存档位与温度（旧字段已清）");
}
ok(await (async()=>{   // 模型为空时不能拿写死的名字去撞接口
  const kk = state.settings.apiKey, mm = state.settings.model;
  state.settings.apiKey = "sk-test"; state.settings.model = "";
  let code = ""; try{ await callLLM("s","u",false); }catch(e){ code = e && e.code; }
  state.settings.apiKey = kk; state.settings.model = mm;
  return code;
})() === "NO_MODEL", "没有模型时: 直接报 NO_MODEL，不兜底成某个写死的名字");

/* 8.5 科目分叉：申论走三步链（学习卡 → 读材料·找点 → 一稿 → 批改），综应A 走两阶段（学习卡 → 作答 → 批改） */
ok(usesFlowChain("sl.guina") && usesFlowChain("sl.guanche"), "分叉: 申论走训练链");
ok(!usesFlowChain("zy.gongwen") && !usesFlowChain("zy.guina"), "分叉: 综应A 走两阶段");
saveNote("sl.guina","概括原因","申论要点一：先找动词");
ok(getNote("sl.guina","概括原因") === "申论要点一：先找动词" && getNote("sl.guina","概括做法") === "", "笔记: 按模块+子类型键存取，不串味");
state.history = [{ module:"sl.guina", subtype:"概括原因", cardPeeks:2, grade:{ total:70, scores:{} } }];
current = { module:"sl.guina", subtype:"概括原因", question:{ background:"阶段题。第二句！", requirements:"不超过250字。" }, cardPeeks:0,
            studyCard:{ title:"概括原因·学习卡", points:["要点"], pitfalls:["坑"], templates:"框架文本" } };
renderQuestion();
// 链子从学习卡开头：先记知识点再动手（与综应A 同一形），还没进链
ok(el("#docBody").innerHTML.indexOf("btnChainStart") >= 0 && el("#docBody").innerHTML.indexOf("我已学习，开始读材料") >= 0,
   "链前学习卡: 打开这道题先给一整页卡");
ok(el("#docBody").innerHTML.indexOf("flowRail") < 0, "链前学习卡: 还没进链，不摆步骤条");
ok(el("#docBody").innerHTML.indexOf("阶段题。") < 0, "链前学习卡: 不亮题面（先看方法再看题）");
ok(activeFlow() && activeFlow().module === "sl.guina", "训练链: 渲染即建链");
ok(activeFlow().cardSeen === false, "链前学习卡: 新链记着「还没看过卡」");
el("#btnChainStart").onclick();
ok(activeFlow().cardSeen === true, "链前学习卡: 点过就记下来，这条链不再重复拦");
ok(el("#docBody").innerHTML.indexOf("flowRail") >= 0 && el("#docBody").innerHTML.indexOf("读材料") >= 0, "训练链: 步骤条在场，落点是读材料");
ok(el("#docBody").innerHTML.indexOf('class="sec-title">题目') >= 0 && el("#docBody").innerHTML.indexOf("阶段题。") >= 0 && el("#docBody").innerHTML.indexOf("第二句！") >= 0, "读材料: 题目与材料同屏（找点合并后材料按句分段）");
// 学习卡浮标挂在纸面之外：纸面里每个直接子元素都带入场动画，动画填充的 transform 会变成 fixed 的包含块
ok(el("#fabSlot").innerHTML.indexOf("看学习卡") >= 0 && el("#docBody").innerHTML.indexOf("看学习卡") < 0,
   "读材料: 学习卡浮标在纸面之外（否则滑到底才看得见）");
ok(el("#docBody").innerHTML.indexOf("申论要点一：先找动词") < 0, "读材料: 笔记不再摊在纸面上（收进抽屉）");
ok(el("#docBody").innerHTML.indexOf("btnFlowNext") < 0, "导航: 不再挂 Next（每一步自带主行动）");
ok(flowGoStep("organize") === false, "归类: 不再占一步（降级成一稿页上的入口）");
ok(el("#popSlot").innerHTML.indexOf("popPick") >= 0 && el("#docBody").innerHTML.indexOf("pt-seg") >= 0, "读材料·找点: 同一材料里点选找点与划线弹窗并存（弹窗挂在纸面外）");
// 与学习卡浮标同一条理由：纸面里的入场动画填充到最后那帧的 transform 是单位矩阵不是 none，
// 那个盒子就成了 absolute 子元素的定位基准，小窗会被再叠上一次它的偏移
ok(el("#popSlot").innerHTML.indexOf("markPop") >= 0 && el("#docBody").innerHTML.indexOf("markPop") < 0,
   "读材料: 划线小窗在纸面之外（纸面里的入场动画会抢走 absolute 的定位基准）");
ok(/mark\.ms\.on\{[^}]*box-shadow:inset 0 -2px 0/.test(PAGE_HTML) && /\.pt-seg\.picked\{[^}]*box-shadow:inset 0 -2px 0/.test(PAGE_HTML) && PAGE_HTML.indexOf("mark.ms.on.pt-seg.picked{") >= 0,
   "材料标记: 划线层与找点层是同一套「底色 + 2px 底边线」，叠在一句上时底色归划线、底边线归找点");
ok((PAGE_HTML.match(/不要自造「江城市」这类看着像真的具体名字/g) || []).length >= 2,
   "出题: 主观题与快判两条出题要求都写明地名虚化，不写看着像真的具体地名");
ok(flowGoStep("extract") === false, "找点: 单独找点步已并入读材料");
ok(el("#fabSlot").innerHTML.indexOf("btnCard") >= 0 && el("#fabSlot").innerHTML.indexOf("cardDrawer") >= 0,
   "读材料: 学习卡收成常驻浮标 + 抽屉（不再压在材料上方）");
flowGoStep("draft");
ok(el("#docBody").innerHTML.indexOf("提交阅卷") >= 0, "一稿: 提交阅卷在场");
ok(el("#docBody").innerHTML.indexOf("先归类再写") >= 0, "一稿: 归类是这一页上的入口");
ok(el("#docBody").innerHTML.indexOf('id="btnOpenOrg"') > el("#docBody").innerHTML.indexOf("作答区"),
   "一稿: 归类入口坐在「作答区」那一行的右侧（不孤零零占一行）");
el("#btnOpenOrg").onclick();
ok(activeFlow().orgOpen === true && el("#docBody").innerHTML.indexOf("回到一稿") >= 0 && el("#docBody").innerHTML.indexOf("提交阅卷") < 0,
   "归类入口: 点它才展开归类面板（链上不再有这一步）");
el("#btnFlowPrev").onclick();   // 从归类面板走开去读材料
el("#btnToDraft").onclick();    // 再回来
ok(activeFlow().orgOpen === false && el("#docBody").innerHTML.indexOf("提交阅卷") >= 0 && el("#docBody").innerHTML.indexOf("回到一稿") < 0,
   "归类入口: 走开再回到一稿，面板自动收起（不揣着上一屏的状态回来）");
ok(el("#docBody").innerHTML.indexOf("btnFlowNext") < 0, "导航: 一稿不摆 Next（靠「提交阅卷」推进）");
/* 归类两段的接线：点一步走一步（第一段归点、第二段命名） */
const wf = activeFlow();
wf.orgOpen = true; wf.selections = [{text:"甲点"},{text:"乙点"}]; wf.groups = []; wf.orgIdx = 0; wf.orgPhase = "group";
renderFlowStep();
ok(el("#docBody").innerHTML.indexOf("新建一组") >= 0 && el("#docBody").innerHTML.indexOf("newCatName") < 0,
   "归类接线: 第一段只给「新建一组」，不摆命名输入框");
el("#btnNewCat").onclick();
ok(wf.groups.length === 1 && wf.groups[0].name === "" && wf.groups[0].facts.join(",") === "0",
   "归类接线: 新建一组就把当前点归进去，组名还是空的");
el("#btnOrgNext").onclick();
el("#btnOrgNext").onclick();
ok(wf.orgPhase === "name" && el("#docBody").innerHTML.indexOf('data-ogname="0"') >= 0,
   "归类接线: 点走完进命名那一段，每组一行输入框");
el("#btnBackToGroup").onclick();
ok(wf.orgPhase === "group" && el("#docBody").innerHTML.indexOf("btnNewCat") >= 0,
   "归类接线: 能回第一段改分组");
el("#btnOrgNext").onclick();
el("#btnOrgDone").onclick();
ok(wf.orgOpen === false && el("#docBody").innerHTML.indexOf("提交阅卷") >= 0,
   "归类接线: 「写完了」收起面板回到一稿");
ok(el("#fabSlot").innerHTML.indexOf("翻学习卡") >= 0, "一稿: 翻卡浮标在场");
el("#btnCard").onclick();
ok(current.cardPeeks === 1 && el("#cardDrawer").hidden === false, "抽屉: 打开即计次");
ok(el("#drawerBody").innerHTML.indexOf("解题要点") >= 0, "抽屉: 卡片原文只在抽屉里");
ok(el("#drawerBody").innerHTML.indexOf("上次练习翻了 2 次卡") >= 0, "熟悉度: 抽屉里报出上次翻卡次数");
saveNote("sl.guina","概括原因","申论要点一：先找动词\n要点二：归类上位词");
el("#btnDrawerClose").onclick();
ok(el("#cardDrawer").hidden === true, "抽屉: 可关闭");
el("#btnCard").onclick();
ok(current.cardPeeks === 2, "抽屉: 再看再计");
ok(el("#drawerBody").innerHTML.indexOf("申论要点一：先找动词") >= 0 && el("#drawerBody").innerHTML.indexOf("drawerNote") >= 0,
   "抽屉: 笔记就在卡下面（边看边写，不用回读材料步）");
const flowGate = activeFlow();
ok(flowGoStep("review") === false && flowGate.step === "draft", "批改门槛: 无批改结果不得进入批改步");
ok(el("#bannerSlot").innerHTML.indexOf("批改") >= 0, "批改门槛: 拒绝时有明确提示");

/* 申论学习卡：内置资料库随出题注入，AI 生成卡（照综应口径缓存、可换一张）；AI 未带卡时回退资料库 */
state.history = []; state.flows = []; _flowId = null; current = null; state.cache.studyCards = {};
const realCallCard = callLLM;
let capCard = null; let genCallsCard = 0;
callLLM = async (sys, user)=>{ genCallsCard++; capCard = { sys, user }; return { question:{ background:"内置卡测试材料。第二句！", requirements:"不超过250字。" }, keyPoints:[] }; };
await loadQuestion("sl.guina","概括问题");
ok(genCallsCard === 1 && current && current.studyCard === SL_STUDY_CARDS["sl.guina"], "申论学习卡: AI 未带卡时回退内置资料库卡");
ok(JSON.parse(capCard.user).library && JSON.parse(capCard.user).library.points.length >= 5, "申论学习卡: 资料库随出题注入（library 字段在场）");
ok(el("#docBody").innerHTML.indexOf("我已学习，开始读材料") >= 0, "申论学习卡: 开链先摆一整页卡（与综应A 同一形）");
el("#btnChainStart").onclick();
ok(el("#fabSlot").innerHTML.indexOf("btnCard") >= 0, "申论学习卡: 读材料步给浮标入口（挂在纸面之外，一开始就看得见）");
el("#btnCard").onclick();
ok(el("#cardDrawerTitle").textContent.indexOf("归纳概括") >= 0 && el("#drawerBody").innerHTML.indexOf("btnNewCard") >= 0,
   "申论学习卡: 抽屉里写清是哪张卡，且照综应口径可「换一张」");
el("#btnDrawerClose").onclick();
ok(current.cardPeeks === 0, "读材料: 看卡不计次（翻卡计次只属作答阶段）");
const cachedCard = { title:"AI 生成的卡", points:["x"], pitfalls:[], templates:"" };
state.cache.studyCards["sl.guina::概括问题2"] = cachedCard;
await loadQuestion("sl.guina","概括问题2");
ok(current.studyCard === cachedCard, "申论学习卡: 有缓存用缓存（AI 卡优先）");
callLLM = realCallCard;
current = null; state.cache.studyCards = {};

/* 综应A：两阶段——不建链、不渲染步骤条；学习卡（折叠+笔记+翻卡计数）→ 开始作答 → 作答页；翻卡计次照旧 */
saveNote("zy.gongwen","通知","综应要点：格式三件套");
state.history = [{ module:"zy.gongwen", subtype:"通知", cardPeeks:2, grade:{ total:70, scores:{} } }];
current = { module:"zy.gongwen", subtype:"通知", question:{ background:"综应阶段题。", requirements:"写一份通知。" }, cardPeeks:0,
            studyCard:{ title:"通知·学习卡", points:["要点"], pitfalls:["坑"], templates:"框架" } };
renderQuestion();
ok(!state.flows.some(x=>x.sig === qSig(current.question)) && (activeFlow() === null || activeFlow().module === "sl.guina"), "综应A: 渲染不建训练链");
ok(el("#docBody").innerHTML.indexOf("flowRail") < 0, "综应A: 不渲染步骤条（它走学习卡 → 作答 → 批改）");
ok(el("#docBody").innerHTML.indexOf("我已学习，开始作答") >= 0, "综应A: 学习卡阶段有「开始作答」入口");
ok(el("#docBody").innerHTML.indexOf("综应要点：格式三件套") >= 0, "综应A: 学习卡阶段笔记可见");
ok(el("#docBody").innerHTML.indexOf("上次作答中你翻了 2 次卡") >= 0, "综应A: 翻卡熟悉度提示照旧");
ok(el("#docBody").innerHTML.indexOf("展开可看") < 0 && el("#docBody").innerHTML.indexOf("解题要点") >= 0,
   "综应A: 卡阶段整页平铺不再折叠（页面就是给卡的）");
ok(cardHtml({points:["要点"],pitfalls:["失分"],templates:"框架",example:{scene:"燃气泄漏的示例场景。",ask:"你会怎么处置？"}}).indexOf("这类题长什么样") >= 0,
   "学习卡: example 栏目渲染（示例案例+典型问法）");
const cHtml = cardHtml({points:["要点一","要点二"],pitfalls:["失分"],templates:"框架",example:{scene:"场景",ask:"问法"}});
ok((cHtml.match(/<section class="csec/g)||[]).length === 4 && (cHtml.match(/<h4>/g)||[]).length === 4,
   "学习卡: 四节各自带节标题（要点 / 失分点 / 框架 / 示例）——起因就是四块内容同貌同重、没有分节");
ok((cHtml.match(/class="clist/g)||[]).length === 2 && cHtml.indexOf("<ul>") < 0,
   "学习卡: 要点与失分点改成顶线清单（一条一格），不再是无分隔的 bullet 长句堆");
ok(cHtml.indexOf('class="csec pit"') >= 0 && cHtml.indexOf("clist clist-pit") >= 0,
   "学习卡: 失分点那一节带 pit 语义标记（焦橙竖条 + 焦橙序号），和要点一眼分得开");
const fatHtml = cardHtml({points:["一","二","三","四","五","六"],pitfalls:["只有一条失分点"],templates:"一、优化办事流程。……",example:{scene:"某县推行「一网通办」。",ask:"概括该县的主要做法。"}});
ok(cHtml.indexOf("答题框架") < cHtml.indexOf("常见失分点") && fatHtml.indexOf("答题框架") > fatHtml.indexOf("常见失分点"),
   "学习卡: 内容量均衡时按意思分栏（左要点+框架 / 右失分点+示例），要点远多于失分点时改成按前后切一刀，两栏底部落差小");
ok(cardHtml({points:[],pitfalls:[],templates:""}).indexOf("这类题长什么样") < 0,
   "学习卡: 旧卡没有 example 也不渲染空栏目");
el("#btnZyAnswer").onclick();
ok(el("#docBody").innerHTML.indexOf("提交阅卷") >= 0 && el("#docBody").innerHTML.indexOf("背景材料") >= 0, "综应A: 作答页 = 材料 + 作答区");
ok(el("#fabSlot").innerHTML.indexOf("翻学习卡") >= 0, "综应A: 作答页翻卡浮标在场（与申论同一处，作答时随时能翻）");
el("#btnCard").onclick();
ok(current.cardPeeks === 1 && el("#cardDrawer").hidden === false, "综应A: 翻卡计次照旧（照旧参与调度）");
el("#btnDrawerClose").onclick();
current = { module:"zy.guina", subtype:"概括原因", question:{ background:"x", requirements:"y" }, cardPeeks:0 };
renderQuestion(); el("#btnZyAnswer").onclick();
ok(el("#docBody").innerHTML.indexOf("插入公文骨架") < 0, "非公文: 骨架按钮与占位提示都不出现");
current = { module:"zy.gongwen", subtype:"通知", question:{ background:"x", requirements:"y" }, cardPeeks:0 };
renderQuestion(); el("#btnZyAnswer").onclick();
ok(el("#docBody").innerHTML.indexOf("插入公文骨架") >= 0, "公文: 骨架按钮在场，占位提示与按钮一致");
current = { module:"zy.gongwen", subtype:"通知", question:{ background:"x", requirements:"y", score:20 }, cardPeeks:0 };
renderQuestion();
ok(el("#docBody").innerHTML.indexOf("<b>分值</b>20 分") < 0, "题目页: 卡阶段不亮分值（题面未出）");
el("#btnZyAnswer").onclick();
ok(el("#docBody").innerHTML.indexOf("<b>分值</b>20 分") >= 0, "题目页: 题目满分对考生可见（作答阶段亮出）");
state.history = [];

/* 8.6 翻卡次数参与出题调度 */
ok(recentPeeks("zy.gongwen","通知") === null && recentPeeks("zy.duice") === null, "翻卡: 无记录时返回 null");
state.history = [
  { module:"zy.gongwen", subtype:"通知", grade:{ total:70, scores: scoresFor("zy.gongwen",14) }, cardPeeks:3 },
  { module:"zy.gongwen", subtype:"函",   grade:{ total:70, scores: scoresFor("zy.gongwen",14) }, cardPeeks:0 }
];
ok(recentPeeks("zy.gongwen","通知") === 3 && recentPeeks("zy.gongwen","函") === 0, "翻卡: 近期翻卡次数可按文种查询");
const orRand = Math.random; Math.random = () => 0.9;   // 避开 20% 随机探索，走确定性分支
ok(pickSubtypeFor("zy.gongwen") === "通知", "调度: 翻得多的卡对应文种优先再出 (got " + pickSubtypeFor("zy.gongwen") + ")");
Math.random = orRand;
state.history = [
  { module:"zy.guina", grade:{ scores: scoresFor("zy.guina",14) }, cardPeeks:4 },
  { module:"zy.fenxi", grade:{ scores: scoresFor("zy.fenxi",14) }, cardPeeks:0 }
];
ok(moduleScore("zy.guina") < moduleScore("zy.fenxi"), "调度: 同分模块，翻卡多的更优先");
state.history = [];

/* 8.7 子类型扩展到全部题型 */
ok(subtypeListOf("zy.gongwen").length === GONGWEN_TYPES.length && subtypeListOf("zy.guina").indexOf("概括原因") >= 0, "子类型: 每个题型都有自己的细分");
renderHome();
ok(el("#docBody").innerHTML.indexOf('id="btnQuick">开始快判') >= 0
   && el("#docBody").innerHTML.indexOf("今天练什么？") >= 0
   && el("#docBody").innerHTML.indexOf('data-big="zy">综应A 练一轮') >= 0
   && el("#docBody").innerHTML.indexOf('data-big="sl">写一篇申论') >= 0,
   "首页: 居中 hero——大标题下主行动是快判，两枚 chips 各自点名科目");
/* 红头常显：首页也是一张公文纸（红头在卷首，hero 接在下方），进科目页照旧 */
ok(el(".redhead").style.display === "", "首页: 公文红头常显（抬头 / 红线 / 文号回到卷首）");
renderTabs(); renderStart();
ok(el(".redhead").style.display === "", "科目页: 公文红头照旧（卷面身份各屏一致）");
renderHome();
tabClick("zy.guina");
ok(el("#docBody").innerHTML.indexOf("概括原因") >= 0 && el("#docBody").innerHTML.indexOf("开始练习") >= 0, "落地页: 子类型芯片 + 显式开始按钮");
ok(el("#docBody").innerHTML.indexOf("开始练习（智能选") < 0, "落地页: 主按钮只写「开始练习」，不带机制后缀");
ok(el("#docBody").innerHTML.indexOf("还没练过") >= 0, "落地页: 无数据显示未练状态");
{
  const kk = state.settings.apiKey, mm = state.settings.model;
  state.settings.apiKey = ""; state.settings.model = "";
  renderModuleLanding("zy.guina");
  const landNo = el("#docBody").innerHTML;
  ok(landNo.indexOf('id="btnLandStart">先填 API Key（出题和阅卷都要）') >= 0 && landNo.indexOf("开始练习") < 0,
     "落地页（没 Key）: 主按钮改说「先填 API Key」，不承诺开始");
  el("#btnLandStart").onclick();
  ok(el("#modalSettings").hidden === false, "落地页（没 Key）: 主按钮真把人送到设置页");
  closeModals();
  state.settings.apiKey = kk; state.settings.model = mm;
}
state.history = [{ module:"zy.guina", subtype:"概括原因", grade:{ total:60, scores: scoresFor("zy.guina",12) }, cardPeeks:4 }];
const orRand2 = Math.random; Math.random = () => 0.9;
ok(pickSubtypeFor("zy.guina") === "概括原因", "调度: 非公文题型同样按翻卡优先 (got " + pickSubtypeFor("zy.guina") + ")");
Math.random = orRand2;
state.history = [];

/* 8.8 机关名默认值迁移 */
localStorage.setItem("gw_state", JSON.stringify({ settings:{ orgName:"综应" + "练习台" }, profile:{}, history:[], cache:{} }));
ok(load().settings.orgName === "模拟练习专用", "迁移: 旧默认机关名换成明显虚构的");
localStorage.clear();

/* 8.9 材料划线（自由选中，字符级） */
const mq = { background:"第一句。第二句！\n\n第二段只有一句？", requirements:"r" };
ok(materialHtml(mq).indexOf("第一句。第二句！") >= 0, "划线: 无高亮时整段自然呈现");
saveMarks(qSig(mq), new Set([0,1,2]));
ok((materialHtml(mq).match(/class="ms on"/g)||[]).length === 1 && materialHtml(mq).indexOf(">第一句</mark>") >= 0, "划线: 连续字符合并为一段高亮");
ok(materialHtml({ background:"<b>x</b>句。", requirements:"r" }).indexOf("&lt;b&gt;") >= 0, "划线: 句内内容仍然转义");
saveMarks(qSig(mq), new Set([0, 8]));
ok((materialHtml(mq).match(/class="ms on"/g)||[]).length === 2, "划线: 离散高亮分段呈现");
ok(loadMarks(qSig(mq)).has(0) && loadMarks(qSig(mq)).has(8) && loadMarks(qSig(mq)).size === 2, "划线: 保存与回读");
for(let i=0;i<9;i++){ saveMarks("mk"+i, new Set([i])); }
ok(!loadMarks("mk0").size, "划线: 超 8 份淘汰最旧");

/* 8.10 划线颜色自选 */
ok(MARK_COLORS.length === 5, "颜色: 预设五色");
state.settings.markColor = "#a7f3d0"; applyMarkColor(); renderMarkSwatches();
ok((el("#markSwatches").innerHTML.match(/swatch sel/g)||[]).length === 1, "颜色: 选中标记唯一");
ok(el("#markSwatches").innerHTML.indexOf("#fbcfe8") >= 0 && el("#markSwatches").innerHTML.indexOf("#fde68a") >= 0, "颜色: 黄色仍在备选，但非默认");
ok(document.documentElement.style["--mark"] === "#a7f3d0", "颜色: CSS 变量已应用");

/* 9. 科目切换：模块 chips 只列当前科目的模块（落在纸面，不在顶栏）/ 抬头跟科目 / 画像分组 / prompt 口径 */
state.history = [];
state.profile.lastModules = ["zy.shiwu", "sl.guanche"];   // 两个科目各有一个「上次练的模块」
state.settings.subject = "zy"; renderStart();
ok(el("#subjbar").innerHTML.indexOf("综应A") >= 0 && el("#subjbar").innerHTML.indexOf("申论") >= 0,
   "科目切换: 两个科目都在科目栏");
const zyChips = el("#docBody").innerHTML;
ok(zyChips.indexOf("data-mod=") >= 0
   && ["zy.gongwen","zy.guina","zy.fenxi","zy.duice","zy.shiwu"].every(k=> zyChips.indexOf(MODULES[k].name) >= 0),
   "科目起始页: 模块入口落进纸面 chips，五个模块名都在");
ok(zyChips.indexOf('data-mod="zy.gongwen"') >= 0 && zyChips.indexOf("贯彻执行") < 0,
   "科目起始页: chips 只列当前科目（综应A）的模块");
switchSubject("sl");
ok(curSubject() === "sl" && state.settings.subject === "sl", "科目: 切换后落盘 settings.subject");
ok(el("#docBody").innerHTML.indexOf("贯彻执行") >= 0 && el("#docBody").innerHTML.indexOf("公文写作") < 0
   && el("#docBody").innerHTML.indexOf("案例实务") < 0, "科目起始页: 切到申论后 chips 只渲染申论模块");
ok(activeModule === null, "科目: 切到申论后落在综合起始页（不再暗记上次模块，抬头如实报综合 · 智能出题）");
ok(el("#modLabel").textContent === "综合 · 智能出题", "抬头: 灰字只报综合 · 智能出题（科目名由科目栏和文号说，不重复）");
switchSubject("zy");
ok(el("#docBody").innerHTML.indexOf("公文写作") >= 0 && el("#docBody").innerHTML.indexOf("贯彻执行") < 0,
   "科目起始页: 切回综应A 只留综应模块");
ok(activeModule === null, "科目: 切回综应A 同样落在综合起始页");
ok(el("#modLabel").textContent === "综合 · 智能出题", "抬头: 切回后灰字仍是综合 · 智能出题，不跟着换科目名");

// 「综合」= 当前科目内综合
state.settings.subject = "sl"; renderTabs();
const slSeen = {};
for(let i=0;i<200;i++){ slSeen[weakestModule()] = 1; }
ok(Object.keys(slSeen).every(k=>k.indexOf("sl.")===0) && Object.keys(slSeen).length === SUBJECTS.sl.modules.length,
   "智能出题: 只在当前科目内选模块 -> " + Object.keys(slSeen).join(","));
state.settings.subject = "zy"; ensureActive(); renderTabs();

// 画像按科目分组 + 练习记录加科目列
state.history = [];
profBack();
const ph1 = el("#profileBody").innerHTML;
ok(ph1.indexOf("综应A") >= 0 && ph1.indexOf("申论") >= 0 && ph1.indexOf("综应A") < ph1.indexOf("申论"),
   "画像: 按科目分组渲染，综应A 在前申论在后");
ok(ph1.indexOf("公文写作") < ph1.indexOf("贯彻执行"), "画像: 科目组内按模块列出，下一科目接在后面");
state.history = [{ ts:1, module:"sl.guanche", subtype:"讲话稿", grade:{ total:66, scores:{}, weaknesses:["少落款"] } }];
profGo("hist");
const ph2 = el("#profileBody").innerHTML;
ok(ph2.indexOf(">科目<") >= 0, "画像: 练习记录新增「科目」列");
ok(ph2.indexOf("申论</td><td>贯彻执行") >= 0, "画像: 记录行同时显示科目与模块");
state.history = [];

/* 9.5 prompt 口径随模块所属科目走（拦下 callLLM，直接看真拼出来的 system prompt） */
const realCallLLM = callLLM;
let cap = null, answerCalls = 0;
const ANSWERASK = "只写一篇本题的完整参考答案";
fetchModelAnswer = realFetchModelAnswer;   // 这一段专考范文链路，把它装回真身
callLLM = async (sys, user)=>{
  if(sys.indexOf(ANSWERASK) >= 0){ answerCalls++; return "范文正文"; }   // 范文是另一次调用（纯文本），不让它把 cap 顶掉
  cap = { sys, user };
  return { question:{ background:"b", requirements:"r" }, keyPoints:[] };
};
await gen("sl.guina", "概括原因", null, false);
ok(cap.sys.indexOf(SUBJECTS.sl.role) >= 0 && cap.sys.indexOf(SUBJECTS.zy.role) < 0, "出题 prompt: 申论模块用申论口径");
ok(cap.sys.indexOf("归纳概括") >= 0 && cap.sys.indexOf(GEN_POINT_RULES) >= 0, "出题 prompt: 保留模块说明与采分点规则");
await gen("zy.gongwen", "通知", null, false);
ok(cap.sys.indexOf(SUBJECTS.zy.role) >= 0 && cap.sys.indexOf(SUBJECTS.sl.role) < 0, "出题 prompt: 综应模块用综应A 口径");
ok(cap.sys.indexOf("不超过500字") >= 0, "出题 prompt: 公文写作把文种的字数上限写死进 prompt（通知 500），不再让模型自己编");
ok(cap.sys.indexOf('"need"') >= 0 && cap.sys.indexOf("必须答到的具体情形1") >= 0,
   "出题 prompt: 采分点 schema 带 need（必须答到的具体情形）");
await grade("sl.guanche", "讲话稿", { background:"b" }, [], "答案");
ok(cap.sys.indexOf(SUBJECTS.sl.role) >= 0 && cap.sys.indexOf(SCORING_RULES) >= 0 && cap.sys.indexOf("数点不估百分比") >= 0,
   "阅卷 prompt: 申论口径 + 三档计分规则原样保留");
await grade("zy.shiwu", null, { background:"b" }, [], "答案");
ok(cap.sys.indexOf("modelAnswer") < 0,
   "阅卷 prompt: 主请求不再兼写参考答案（范文占输出大头，塞在里面会把请求顶到模型输出上限）");
ok(cap.sys.indexOf(SUBJECTS.zy.role) >= 0 && cap.sys.indexOf("维度分只用于画像诊断") >= 0,
   "阅卷 prompt: 综应口径 + 维度锚定原样保留");
const gWithAns = await grade("zy.guina", "归纳概括", { background:"b", score:20 }, [{point:"p1",score:5,need:["情形A","情形B"]}], "答案");
ok(cap.user.indexOf("情形A") >= 0 && cap.user.indexOf("情形B") >= 0 && cap.sys.indexOf("按 need 逐条核") >= 0,
   "阅卷 prompt: 采分点自带的 need 原样带进判分请求，且 prompt 要求照它逐条核");
ok(gWithAns && gWithAns.modelAnswer === "范文正文" && answerCalls >= 1,
   "阅卷: 范文由单独一次调用出，并合进批改结果（范文调用=" + answerCalls + " 次）");
/* 范文那一次炸了不影响批改：分数与采分点先拿到手，范文那一段不出现就行 */
callLLM = async (sys, user)=>{
  if(sys.indexOf(ANSWERASK) >= 0) throw {code:"EMPTY"};
  cap = { sys, user }; return {};
};
const gAnsFail = await grade("zy.guina", "归纳概括", { background:"b" }, [], "答案");
ok(gAnsFail && gAnsFail.modelAnswer === "" && cap.sys.indexOf(SCORING_RULES) >= 0,
   "阅卷: 范文那一次失败也不影响批改（modelAnswer 留空、不往外抛）");
callLLM = realCallLLM;
fetchModelAnswer = async ()=> "";

/* 10. 申论模块按申论阅卷口径写，不照抄综应A */
const SL_DIM_VOCAB = ["要点全面","归类准确","表述精炼","条理清晰","语言准确","问题对应","对策可行","针对性强","观点明确","分析深入","论证充分","结论稳妥","格式规范","内容完整","身份贴切","语言得体","立意准确","结构完整","语言规范","结合材料"];
for(const k of SUBJECTS.sl.modules){
  const m = MODULES[k];
  ok(m.dims.length >= 4 && m.dims.length <= 5 && m.dims.every(d=>SL_DIM_VOCAB.indexOf(d) >= 0),
     "申论维度: " + k + " 与题型匹配 -> " + m.dims.join("/"));
  ok(m.matLen[0] >= 600 && m.matLen[1] > m.matLen[0], "申论材料: " + k + " 长度按小题起 600+ -> " + m.matLen.join("-"));
  ok((m.subtypes||[]).length >= 2, "申论子类型: " + k + " 有细分 -> " + (m.subtypes||[]).join("/"));
}
ok(MODULES["sl.guanche"].dims.indexOf("格式规范") >= 0 && MODULES["sl.guanche"].subtypes.join("") === "讲话稿倡议书意见建议",
   "贯彻执行: 维度含格式规范，子类型是讲话稿 / 倡议书 / 意见建议");
ok(MODULES["sl.guina"].dims.indexOf("要点全面") >= 0 && MODULES["sl.fenxi"].dims.indexOf("观点明确") >= 0,
   "申论: 归纳概括重要点、综合分析重观点");
ok(MODULES["sl.guina"].dims.indexOf("文种适配") < 0 && MODULES["sl.shiwu"] === undefined && MODULES["gongwen"] === undefined,
   "申论: 不套用综应A 的维度与模块");
ok(MODULES["zy.gongwen"].dims.indexOf("文种适配") >= 0 && MODULES["zy.shiwu"].dims.indexOf("程序合规") >= 0,
   "综应A: 原模块口径加前缀后未被动过");

/* 10.5 作答上限与材料长度：以题型规范为准（本地表是唯一口径） */
ok(MODULES["sl.guina"].ansLen === 250 && MODULES["sl.fenxi"].ansLen === 300 && MODULES["sl.duice"].ansLen === 400 && MODULES["sl.guanche"].ansLen === 500 && MODULES["sl.zuowen"].ansLen === 1000,
   "作答上限: 申论五题型按题型规范 (250/300/400/500/1000)");
ok(MODULES["zy.guina"].ansLen === 300 && MODULES["zy.fenxi"].ansLen === 300 && MODULES["zy.duice"].ansLen === 300 && MODULES["zy.shiwu"].ansLen === 400,
   "作答上限: 综应A 按规范沿用 (300/300/300/400)");
ok(MODULES["zy.gongwen"].ansLen === undefined, "作答上限: 公文写作按文种定，不设单一上限");
const SL_SMALL = SUBJECTS.sl.modules.filter(k=>k !== "sl.zuowen");
ok(SL_SMALL.every(k=>MODULES[k].matLen[0] === 600 && MODULES[k].matLen[1] === 900), "材料长度: 申论小题四类统一 600-900");
ok(MODULES["sl.zuowen"].matLen[0] === 1200 && MODULES["sl.zuowen"].matLen[1] === 1800,
   "材料长度: 申发论述高一档 1200-1800（立意与分论点都得从材料里找）");

/* 10.6 申发论述：申论大纲「文字表达能力」对应的题型，真题里分值最高，不能缺 */
ok(MODULES["sl.zuowen"] && MODULES["sl.zuowen"].name === "申发论述", "申发论述: 模块在场");
ok(MODULES["sl.zuowen"].dims.join("/") === "立意准确/结构完整/论证充分/语言规范/结合材料",
   "申发论述: 维度是立意/结构/论证/语言/结合材料 -> " + MODULES["sl.zuowen"].dims.join("/"));
ok((MODULES["sl.zuowen"].subtypes||[]).length >= 2, "申发论述: 有细分 -> " + (MODULES["sl.zuowen"].subtypes||[]).join("/"));
ok(usesFlowChain("sl.zuowen") && MODULES["sl.zuowen"].dims.indexOf("文种适配") < 0,
   "申发论述: 归申论、走训练链，不套公文那套维度");

/* 11. 训练链：状态机 / 找点 / 归类 / 提纲进批改 / 迁移 / 裁剪 */
/* ① 同题复用 / 换题关闭且草稿保留 */
const fqA = { background:"流程题甲", requirements:"要求甲" };
saveDraft(qSig(fqA), "甲还没交的草稿");
const fA = ensureFlow("zy.guina", "概括问题", fqA, []);
const fA2 = ensureFlow("zy.guina", "概括问题", fqA, []);
ok(fA2 === fA && fA.step === "read", "flow: 同题复用同一条训练链");
const fqB = { background:"流程题乙", requirements:"要求乙" };
const fB = ensureFlow("zy.guina", "概括原因", fqB, []);
ok(fA.closedAt && fA.step === "done", "flow: 换题收口旧链（只置标记，不删内容）");
ok(loadDraft(qSig(fqA)) === "甲还没交的草稿", "flow: 收口后未提交草稿原样保留");
ok(fB.sig === qSig(fqB) && fB.step === "read" && fB.subject === "zy", "flow: 新链从读材料开始并带科目");
/* ③ 无 attempts 进 review 被拒 */
ok(flowGoStep("review") === false && activeFlow().step === "read", "批改门槛: 无批改结果进批改步被拒");
/* ② 链子只剩三步：归类降级成一稿页上的入口、沉淀并进批改页 */
ok(FLOW_STEPS.join(",") === "read,draft,review" && flowGoStep("distill") === false && flowGoStep("organize") === false,
   "训练链: 只剩读材料 / 一稿 / 批改三步（归类和沉淀都不再占一步）");
const migFlows = sanitizeFlows([
  { id:"f1", question:{ background:"x", requirements:"r" }, step:"organize" },
  { id:"f2", question:{ background:"x", requirements:"r" }, step:"distill" },
  { id:"f3", question:{ background:"x", requirements:"r" }, step:"read" },
]);
ok(migFlows[0].step === "draft" && migFlows[1].step === "review" && migFlows[2].step === "read",
   "迁移: 停在归类 / 沉淀的老链落到一稿 / 批改，不整条消失");
ok(migFlows.every(f=> f.cardSeen === true), "迁移: 老链算「看过学习卡」，不让进行中的题被一张卡拦住");
ok(sanitizeFlows([{ id:"f4", question:{ background:"x", requirements:"r" }, step:"乱写的" }]).length === 0,
   "迁移: 真非法的 step 照样丢弃");

/* ② syncRail 三态 */
const rail = syncRail({ step:"draft" });
ok(rail.map(x=>x.state).join(",") === "done,active,pending", "步骤条: i<cur done / = active / > pending（三步）");
ok(rail[1].label === "一稿" && rail.length === FLOW_STEPS.length, "步骤条: 标签来自 FLOW_LABELS");

/* ④ 句子表切分与选区偏移 */
const sq2 = { background:"第一句。第二句！\n\n第二段只有一句？", requirements:"r" };
const sents2 = sentenceTable(sq2);
ok(sents2.length === 3 && sents2.map(s=>s.text).join("|") === "第一句。|第二句！|第二段只有一句？", "句子表: 按句切分、跨段不断句");
ok(sents2.every(s=> sq2.background.slice(s.start, s.end) === s.text), "句子表: start/end 偏移可还原原句");
ok(snapSentence(sents2, 0, 3) === 0 && snapSentence(sents2, sents2[2].start, sents2[2].start+2) === 2, "吸附: 有重叠时取重叠最大的句子");
ok(snapSentence(sents2, 8, 9) === 1, "吸附: 无重叠时取最近句");
ok(addFreeSelectionRecord(fB, 0, 3) === false, "找点: 不足 4 字的划选不收");
ok(addFreeSelectionRecord(fB, 0, 8) === true, "找点: ≥4 字的划选收入");
const frec = fB.selections[0];
ok(frec.free === true && frec.valid === null && frec.point === -1 && typeof frec.sentenceId === "number" && frec.text === "流程题乙",
   "找点: 选区记录同构 {text,start,end,sentenceId,valid,point,free}");
ok(addFreeSelectionRecord(fB, 0, 8) === false, "找点: 同一选区不重复收");

/* ④.1 局部重铺必须与整块渲染同源：划线后按段重铺，重铺出的那段仍要能点句子找点 */
const mq2 = { background:"第一句。第二句。第三句", requirements:"r" };
const mf2 = { step:"read", sig:qSig(mq2), selections:[], groups:[], attempts:[] };
const full2 = mergedMaterialRange(mq2, mf2, 0, mq2.background.length);
ok(full2.indexOf("pt-seg") >= 0 && full2.indexOf('data-sid="2"') >= 0, "读材料: 整块渲染的每句都是可点片段");
const part2 = mergedMaterialRange(mq2, mf2, 4, 7);
ok(part2.indexOf("pt-seg") >= 0 && part2.indexOf("data-sid") >= 0, "读材料: 局部重铺仍带句子点选标记");
ok(materialRangeHtml.toString().indexOf("mergedMaterialRange") >= 0, "读材料: 局部重铺走同一套分段（不另写一套）");
ok(toggleSentenceSelection(fB, 0, "") === true && fB.selections.some(sl=> !sl.free && sl.sentenceId === 0), "找点: 点选整句收入");
ok(toggleSentenceSelection(fB, 0, "s0") === true && !fB.selections.some(sl=> !sl.free && sl.sentenceId === 0), "找点: 再点取消整句，划选记录不受影响");

/* 归类：提纲按类聚合（类从哪来已改成「逐个点建」，面板那边的断言在 12.8） */
fB.groups = [];
const outlineDemo = buildOrganizeOutline(
  [{ name:"格式要求", facts:[0] }, { name:"", facts:[1] }],
  [{ text:"有抬头有落款" }, { text:"语言要得体" }]);
ok(outlineDemo === "格式要求：有抬头有落款\n要点2：语言要得体", "归类: 一行一组的纯文本提纲 -> " + JSON.stringify(outlineDemo));

/* ⑤ 归类提纲进批改请求体（拦 callLLM 检查） */
current = { module:"sl.guina", subtype:"概括问题", question:{ background:"提纲题材料。", requirements:"不超过250字。" }, cardPeeks:0 };
renderQuestion();   // 让 flow 与 current 对齐
const fCur = activeFlow();
fCur.selections = [{ text:"要点甲", start:0, end:3, sentenceId:0, valid:null, point:-1, free:false }];
fCur.groups = [{ name:"甲类", facts:[0] }];
flowGoStep("draft");
el("#answer").value = "这是一段超过二十个字的作答内容，用于验证批改请求体。";
const realCall3 = callLLM;
let cap3 = null;
callLLM = async (sys, user)=>{ cap3 = { sys, user }; return { hits:[{point:"p",score:10,awarded:8,status:"满分",evidence:"e"}], scores:{}, strengths:[], weaknesses:[], comment:"x" }; };
await submitAnswer();
callLLM = realCall3;
const sent3 = JSON.parse(cap3.user);
ok(sent3.organizeOutline === "甲类：要点甲", "批改请求体: 归类提纲随卷上报");
ok(cap3.sys.indexOf("organizeOutline") >= 0 && cap3.sys.indexOf("不参与计分") >= 0, "批改 prompt: 提纲只供诊断的口径写明");
ok(cap3.sys.indexOf(SCORING_RULES) >= 0, "批改 prompt: SCORING_RULES 一字未动");
ok(fCur.attempts.length === 1 && fCur.step === "review", "批改: 提交后进入批改步并留痕 attempt");
ok(state.history[0].answer.indexOf("二十个字") >= 0 && state.history[0].grade.total === 80, "批改: 练习记录已写入且计分口径不变");

/* ⑦ 超字数不阻断提交；作答上限来自本地表 */
ok(enforceWordLimit("sl.guina", { requirements:"概括主要问题，不超过300字。" }).requirements.indexOf("不超过250字") >= 0,
   "本地口径: 模型给的 300 被纠正为本地表 250");
ok(ansLimitFor("sl.guina", { requirements:"不超过300字" }) === 250 && ansLimitFor("zy.gongwen", { requirements:"不超过300字" }) === 300,
   "作答上限: 模块表优先，公文没有模块上限时回落到题干解析");

/* ②.2 公文写作按文种定上限：本地表给数字 → 盖在题目上 → 模型写的字数被纠偏 */
ok(GONGWEN_TYPES.every(t=>t.ansLen > 0), "作答上限: " + GONGWEN_TYPES.length + " 个文种每个都有 ansLen（不再交给模型自己编）");
ok(localAnsLen("zy.gongwen","讲话稿") === 800 && localAnsLen("zy.gongwen","编者按") === 250,
   "作答上限: 文种表优先于模块表（讲话稿 800 / 编者按 250）");
const gwQ = { requirements:"以街道办名义写一份讲话稿，不超过300字。" };
enforceWordLimit("zy.gongwen", gwQ, "讲话稿");
ok(gwQ.ansLen === 800 && gwQ.requirements.indexOf("不超过800字") >= 0 && ansLimitFor("zy.gongwen", gwQ) === 800,
   "作答上限: 公文按文种把模型给的 300 纠成 800，下游读的也是本地表那个数");
const gwQ2 = { requirements:"写一份编者按。" };
enforceWordLimit("zy.gongwen", gwQ2, "编者按");
ok(gwQ2.ansLen === 250 && gwQ2.requirements.indexOf("不超过250字") >= 0,
   "作答上限: 题干没写字数时按文种补上（编者按 250）");
current = { module:"sl.guina", subtype:"概括问题", question:{ background:"超字数材料。", requirements:"概括主要问题，不超过250字。" }, cardPeeks:0 };
renderQuestion(); flowGoStep("draft");
el("#answer").value = "字".repeat(300);   // 超出 250 上限 50 字
el("#btnSubmit").disabled = false;   // DOM 桩按选择器缓存元素：真机每次重渲染都是新按钮，这里手动复位
const realCall4 = callLLM;
callLLM = async (sys, user)=>{ return { hits:[], scores:{}, strengths:[], weaknesses:[], comment:"x" }; };
await submitAnswer();
callLLM = realCall4;
ok(el("#bannerSlot").innerHTML.indexOf("出错了") < 0 && state.history[0] && state.history[0].answer.length === 300,
   "超字数: 只提示不阻断，作答照常入记录");
ok(state.history[0].flowId, "记录: 练习记录带上 flowId");

/* ⑥ flows 迁移 + 幂等 */
localStorage.clear();
localStorage.setItem("gw_history", JSON.stringify([{ ts:42, module:"zy.guina", grade:{ total:50, scores:{} } }]));
localStorage.setItem("gw_state", JSON.stringify({ settings:{}, profile:{}, history:[], cache:{},
  flows:[ { id:"flow_1", subject:"zy", module:"zy.guina", subtype:null, sig:"q1", question:{background:"b"}, keyPoints:[], createdAt:1, closedAt:null, step:"read", attempts:[], selections:[], groups:[] },
          { id:"flow_bad", step:"bogus", question:{background:"x"} },
          { id:"flow_done", step:"done", closedAt:5, question:{background:"c"} } ] }));
const lf1 = load();
ok(lf1.flows.length === 2 && lf1.flows[0].id === "flow_1" && lf1.flows[1].step === "done", "flow 迁移: 非法 step 丢弃该项，其余保留（含已关闭）");
ok(Array.isArray(lf1.flows[1].attempts) && Array.isArray(lf1.flows[1].selections), "flow 迁移: 缺失字段补默认");
ok(JSON.parse(localStorage.getItem("gw_history"))[0].flowId === "legacy-42", "history 迁移: 旧记录补 flowId=legacy-ts");
const lf2 = load();
ok(lf2.flows.length === 2 && lf2.flows[0].id === "flow_1", "flow 迁移: 二次 load 幂等");
ok(JSON.parse(localStorage.getItem("gw_history"))[0].flowId === "legacy-42", "history 迁移: flowId 幂等不重复");
localStorage.clear();

/* flow 裁剪：上限 20 条，有未提交草稿的永不裁 */
state.flows = []; _flowId = null;
const keepQ = { background:"保留题", requirements:"r" };
saveDraft(qSig(keepQ), "还没写完的草稿");
ensureFlow("zy.guina", null, keepQ, []);
for(let i=0;i<25;i++){ ensureFlow("zy.guina", null, { background:"裁剪题" + i, requirements:"r" }, []); }
ok(state.flows.length === MAX_OPEN_FLOWS, "flow 裁剪: 只留最近 " + MAX_OPEN_FLOWS + " 条 -> " + state.flows.length);
ok(state.flows.some(x=>x.sig === qSig(keepQ)), "flow 裁剪: 有未提交草稿的 flow 永不自动裁剪");
clearDraft(qSig(keepQ));
state.flows = []; _flowId = null;

/* ============ 12. 第二批：回滚 / 经验闭环 / 恢复现场 ============ */
const realCall = callLLM;   // 本节里各段都会把自己的桩塞给 callLLM，用完要换回应用里那个实现（后面几节要真跑 callLLM 的重发逻辑）

/* 12.3 回滚（rollbackFlowFrom）已退役：界面上没有任何入口调用它，留着就是死代码，整套断言随之退役。
   这里只钉住「它确实不在了」——以后谁再把它抄回来，会在这里被拦一次。 */
ok(typeof rollbackFlowFrom === "undefined", "回滚: rollbackFlowFrom 已删除（无入口的死代码）");
closeActiveFlow();
clearDraft(qSig(current.question));
state.history = []; state.flows = []; _flowId = null; current = null;

/* 12.4 经验闭环：提炼入库 / 字段 / 去重 / EXP_MAX 裁剪 disabled 优先 */
state.experiences = [];
callLLM = async ()=>({ experiences:[ {type:"胡说", title:"x", body:"y"}, {type:"错因", title:"漏写落款", body:"公文先查抬头、文号、落款。"} ] });
const outE1 = await distillExperience("sl.guina","概括问题",{ hits:[], weaknesses:["少落款"], comment:"x" }, { background:"经验题材料。", requirements:"r" });
ok(outE1.length === 1 && outE1[0].title === "漏写落款", "经验: type 不合法的丢弃");
callLLM = async ()=>({ experiences:[ {type:"错因",title:"漏写落款",body:"b1"}, {type:"表达",title:"语言口语化",body:"b2"}, {type:"规则",title:"第三条",body:"b3"} ] });
const outE2 = await distillExperience("sl.guina","概括问题",{ hits:[], weaknesses:[], comment:"" }, { background:"经验题二。", requirements:"r" });
ok(outE2.length === 2, "经验: 一次最多提炼 2 条");
ok(state.experiences.length === 2 && state.experiences[0].title === "语言口语化", "经验: 入库（新的在前，同名去重不新增）");
ok(state.experiences[0].module === "sl.guina" && state.experiences[0].subject === "sl" && state.experiences[0].disabled === false && state.experiences[0].sourceSig && state.experiences[0].id, "经验: 字段齐备（id/type/title/body/scope/module/subject/ts/disabled/sourceSig）");
callLLM = async ()=>({ experiences:[ {type:"规则", title:"语言口语化", body:"更新后的表述规则。"} ] });
await distillExperience("sl.guina","概括问题",{ hits:[], weaknesses:[], comment:"" }, { background:"另一题材料。", requirements:"r" });
ok(state.experiences.length === 2 && state.experiences[0].title === "语言口语化" && state.experiences[0].body === "更新后的表述规则。", "经验: 同模块同名去重（更新内容不新增）");
callLLM = async ()=>({ experiences:[ {type:"规则", title:"标".repeat(40), body:"b".repeat(300)} ] });
const outE3 = await distillExperience("sl.guina",null,{ hits:[], weaknesses:[], comment:"" }, { background:"截断题。", requirements:"r" });
ok(outE3.length === 1 && outE3[0].title.length === 30 && outE3[0].body.length === 220, "经验: title≤30/body≤220 超长截断");
state.experiences = [];
for(let i=0;i<EXP_MAX;i++) state.experiences.unshift({ id:"e"+i, type:"规则", title:"t"+i, body:"b", scope:"module", module:"sl.guina", subject:"sl", ts:i, disabled:(i%2===0), sourceSig:"s" });
storeExperiences([{ type:"规则", title:"新经验", body:"b" }], "sl.guina", null, { background:"裁剪题材料。", requirements:"r" });
ok(state.experiences.length === EXP_MAX, "经验: 超出 EXP_MAX 即裁剪 -> " + state.experiences.length);
ok(!state.experiences.some(e=>e.title==="t0") && state.experiences.some(e=>e.title==="t1") && state.experiences.some(e=>e.title==="t59"), "经验: 裁掉的是最旧的停用条目，启用条目保留");
ok(state.experiences.some(e=>e.title==="新经验"), "经验: 新经验正常入库");

/* 12.5 经验注入：出题与阅卷 prompt，两科都带，停用不带（拦 callLLM） */
let capI = null;
callLLM = async (sys, user)=>{ capI = { sys, user }; return { question:{ background:"b", requirements:"r" }, keyPoints:[] }; };
state.experiences = [
  { id:"x1", type:"错因", title:"漏写落款", body:"b1", module:"sl.guina", subject:"sl", ts:2, disabled:false, sourceSig:"s" },
  { id:"x2", type:"表达", title:"语言口语化", body:"b2", module:"sl.guina", subject:"sl", ts:1, disabled:false, sourceSig:"s" }
];
await gen("sl.guina","概括问题",null,false);
ok(capI.user.indexOf("漏写落款") >= 0 && capI.user.indexOf("语言口语化") >= 0, "注入: 未停用经验进入申论出题请求");
state.experiences[1].disabled = true;
await gen("sl.guina","概括问题",null,false);
ok(capI.user.indexOf("语言口语化") < 0 && capI.user.indexOf("漏写落款") >= 0, "注入: 停用的经验不再出现");
await grade("sl.guina","概括问题",{ background:"b" },[],"答案");
ok(capI.user.indexOf("漏写落款") >= 0, "注入: 阅卷请求同样带经验（请它盯防再犯）");
state.experiences = [ { id:"z1", type:"规则", title:"综应格式三件套", body:"b", module:"zy.gongwen", subject:"zy", ts:1, disabled:false, sourceSig:"s" } ];
await gen("zy.gongwen","通知",null,false);
ok(capI.user.indexOf("综应格式三件套") >= 0, "注入: 综应A 出题同样带经验（两科共用机制）");
await grade("zy.gongwen","通知",{ background:"b" },[],"答案");
ok(capI.user.indexOf("综应格式三件套") >= 0, "注入: 综应A 阅卷同样带经验");
await gen("sl.guina","概括问题",null,false);
ok(capI.user.indexOf("综应格式三件套") < 0, "注入: 经验按模块归属，不跨科目串味");
callLLM = realCall;

/* 12.6 提炼失败静默：不影响批改展示、不弹错、不写半条数据 */
_lastDistilled = [];
const expCnt = state.experiences.length;
let rejectedE = false;
callLLM = async ()=>{ throw { code:"API", status:500, text:"boom" }; };
await distillExperience("sl.guina",null,{ hits:[], weaknesses:[], comment:"" }, { background:"失败题。", requirements:"r" }).catch(()=>{ rejectedE = true; });
ok(rejectedE, "提炼失败: 异常可被调用方吞掉（submitAnswer 里 fire-and-forget）");
ok(state.experiences.length === expCnt && _lastDistilled.length === 0, "提炼失败: 不写半条经验");
ok(el("#bannerSlot").innerHTML === "", "提炼失败: 静默，不弹任何错误横幅");
callLLM = realCall;

/* 12.7 恢复现场：有 24h 内未关闭的链时给入口，点了才跳，不自动跳转 */
state.flows = []; _flowId = null; current = null;
const rq12 = { background:"恢复题材料。", requirements:"r" };
const rFlow = ensureFlow("sl.guina", "概括问题", rq12, []);
rFlow.step = "read"; rFlow.cardSeen = true;
renderStart();
ok(el("#docBody").innerHTML.indexOf("继续上次没做完的题") >= 0, "恢复现场: 有未关闭的链时首页给入口");
ok(el("#docBody").innerHTML.indexOf("materialBox") < 0, "恢复现场: 不自动跳进链里");
el("#btnResume").onclick();
ok(_flowId === rFlow.id && current && current.module === "sl.guina", "恢复现场: 点击后才回到链上");
ok(el("#docBody").innerHTML.indexOf("materialBox") >= 0, "恢复现场: 进入链停下的那一步");
rFlow.createdAt = Date.now() - 25*3600*1000;
current = null; _flowId = null;
renderStart();
ok(el("#docBody").innerHTML.indexOf("继续上次没做完的题") < 0, "恢复现场: 超 24h 的链不再提示");
state.flows = []; _flowId = null;

/* 12.7b 批改结果只从记录派生：重开页面后重进「批改」要有东西看，不能是一页空白 */
{
  state.flows = []; _flowId = null; state.history = []; lastGrade = null;
  const qR = { background:"恢复批改的材料。", requirements:"r", score:20 };
  const fR = ensureFlow("sl.guina", "概括问题", qR, []);
  fR.cardSeen = true; fR.step = "review";
  state.history.unshift({ ts:Date.now(), module:"sl.guina", subtype:"概括问题", flowId:fR.id,
    question:qR, answer:"我的答案原话", keyPoints:[],
    hits:[{ point:"p", score:20, awarded:18, status:"部分命中", evidence:"" }],
    usedSec:120, timeLimit:30,
    grade:{ total:90, scores:{}, strengths:[], weaknesses:[], comment:"解析一句。" } });
  current = { module:"sl.guina", subtype:"概括问题", question:qR, keyPoints:[], cardPeeks:0 };
  renderFlowStep();
  const rHtml = el("#docBody").innerHTML;
  ok(rHtml.indexOf("还没有批改结果") < 0, "恢复: 没有 lastGrade 也不留那句空页提示");
  ok(rHtml.indexOf("18") >= 0 && rHtml.indexOf("/ 20 分") >= 0, "恢复: 分数从记录里捞回来渲染");
  ok(rHtml.indexOf('id="btnSwitch"') >= 0, "恢复: 批改页照样有「换一题」");
  ok(rHtml.indexOf('id="btnDone"') >= 0, "恢复: 批改页照样有「完成」出口");

  /* 入口判据：批改过的链不是「没做完」，不进首页那个入口（点不点「完成」都一样） */
  ok(resumableFlow() === null, "入口: 已批改的链不再叫「上次没做完」");

  /* 「完成」收口：回首页、入口消失、记录一条不少 */
  const beforeCnt = state.history.length;
  el("#btnDone").onclick();
  ok(_view === "home", "完成: 点完回首页");
  ok(resumableFlow() === null, "完成: 收口后首页没有「继续」入口");
  ok(state.history.length === beforeCnt && state.history[0].answer === "我的答案原话",
     "完成: 收口只影响入口，记录与答案原样留着");
  fR.closedAt = null; fR.step = "review";   // 再验一次「没点完成也不进入口」
  ok(resumableFlow() === null, "入口: 没点「完成」但已批改，也不进入口");
}

/* 12.7c 取不到批改结果就退回一稿，不把人留在空页上 */
{
  state.flows = []; _flowId = null; state.history = []; lastGrade = null;
  const qN = { background:"没有批改结果的链。", requirements:"r" };
  const fN = ensureFlow("sl.guina", "概括问题", qN, []);
  fN.cardSeen = true; fN.step = "review";
  current = { module:"sl.guina", subtype:"概括问题", question:qN, keyPoints:[], cardPeeks:0 };
  renderFlowStep();
  ok(fN.step === "draft", "批改步: 记录里也没有结果 -> 退回一稿");
  ok(el("#docBody").innerHTML.indexOf("还没有批改结果") < 0, "批改步: 退回一稿后不再摆空页提示");
}

/* 12.7d 缺按钮不许掀翻整屏接线 */
{
  state.flows = []; _flowId = null; state.history = []; lastGrade = null;
  const qW = { background:"缺按钮的材料。", requirements:"r" };
  const fW = ensureFlow("sl.guina", "概括问题", qW, []);
  fW.cardSeen = true; fW.step = "review";
  current = { module:"sl.guina", subtype:"概括问题", question:qW, keyPoints:[], cardPeeks:0 };
  const realQS = document.querySelector;
  document.querySelector = (sel)=> sel === "#btnSwitch" ? null : realQS(sel);
  let wErr = null;
  try { wireStep("review", fW); } catch(e){ wErr = e; }
  document.querySelector = realQS;
  ok(!wErr, "接线: #btnSwitch 取不到时 wireStep 不抛（抛了后面全没人接）");
  ok(typeof el("#btnFlowPrev").onclick === "function", "接线: 上一步照旧接上");
}

/* 12.7e 自述要真的落进 gw_history（save() 写的是 gw_state，那条路不含记录） */
{
  state.flows = []; _flowId = null; state.history = [];
  const qS = { background:"自述材料。", requirements:"r" };
  current = { module:"sl.guina", subtype:"概括问题", question:qS, cardPeeks:0 };
  state.history = [{ ts:Date.now(), module:"sl.guina", subtype:"概括问题", question:qS, answer:"a",
    grade:{ total:80, scores:{}, comment:"c" }, hits:[] }];
  el("#selfBox").dataset.kind = "how";
  el("#selfNote").value = "我先看要求再找点";
  wireSelfNote();
  el("#btnSelfSave").onclick();
  const rec = JSON.parse(localStorage.getItem("gw_history") || "[]");
  ok(rec[0] && rec[0].selfNote === "我先看要求再找点" && rec[0].selfKind === "how",
     "自述: 「已记下」真的写进 gw_history，重开还在");
  /* 存储写满：磁盘上没写进去，界面就不许说「已记下」 */
  const _realSetSelf = localStorage.setItem;
  localStorage.setItem = ()=>{ throw new Error("quota"); };
  el("#selfNote").value = "这句写不进磁盘";
  el("#btnSelfSave").onclick();
  localStorage.setItem = _realSetSelf;
  ok(el("#selfState").textContent.indexOf("已记下") < 0 && el("#selfState").textContent.indexOf("没能保存") >= 0,
     "自述: 存储写满时不说「已记下」");
  /* DOM 桩是全文件共用的：dataset 改了要还原，否则后面的自述用例会拿到这里的 kind */
  el("#selfBox").dataset.kind = "";
  el("#selfNote").value = "";
  el("#selfState").textContent = "";
  state.history[0].selfNote = "我先看要求再找点"; state.history[0].selfKind = "how";
}

/* 12.7e2 范文随批改结果入库：批改页从记录派生时「参考答案」还在 */
{
  state.flows = []; _flowId = null; state.history = []; lastGrade = null;
  state.settings.apiKey = "sk-test"; state.settings.model = "m";
  const qM = { background:"范文材料。", requirements:"不超过250字。", score:20 };
  current = { module:"sl.guina", subtype:"概括问题", question:qM, keyPoints:[], cardPeeks:0 };
  renderQuestion();
  const fM = activeFlow(); fM.cardSeen = true; flowGoStep("draft");
  el("#answer").value = "这是一段超过二十个字的作答内容，用来验证范文入库。";
  el("#btnSubmit").disabled = false;
  const realGradeM = grade;
  grade = async ()=>({ hits:[{point:"p",score:20,awarded:18,status:"部分命中",evidence:"「这是一段超过二十个字的作答内容」"}],
    scores:{}, strengths:[], weaknesses:[], comment:"解析。", modelAnswer:"范文正文。" });
  await submitAnswer();
  grade = realGradeM;
  ok(state.history[0] && state.history[0].grade.modelAnswer === "范文正文。", "记录: 范文随批改结果入库");
  const gM = gradeForFlow(activeFlow() || fM);
  ok(gM && gM.g.modelAnswer === "范文正文。", "恢复: 从记录派生时范文还在");
  state.flows = []; _flowId = null; state.history = []; lastGrade = null; current = null;
}

/* 12.7f 恢复现场要把学习卡一起带回来（卡缓存在 cache 里，没搬过来卡页就说「本题没有学习卡」） */
{
  state.flows = []; _flowId = null;
  state.cache.studyCards["sl.guina::概括问题"] = { title:"缓存卡", points:["a"] };
  const qC = { background:"卡恢复材料。", requirements:"r" };
  const fC = ensureFlow("sl.guina", "概括问题", qC, []);
  fC.cardSeen = true; fC.step = "read";
  renderStart();
  el("#btnResume").onclick();
  ok(current && current.studyCard && current.studyCard.title === "缓存卡",
     "恢复: 「继续上次没做完的题」把学习卡一起带回来");
  delete state.cache.studyCards["sl.guina::概括问题"];
}

/* 12.7g 迁移：gw_history 是空数组时也要把 gw_state 里的旧记录迁过去（空数组 = 没有数据） */
{
  localStorage.setItem("gw_history", "[]");
  localStorage.setItem("gw_state", JSON.stringify({ history:[{ ts:1, module:"zy.guina",
    question:{ background:"旧副本题", requirements:"r" }, answer:"a", grade:{ total:60, scores:{} } }] }));
  const sM = load();
  ok(sM.history.length === 1 && sM.history[0].answer === "a",
     "迁移: gw_history 为空数组时也把 gw_state 里的旧记录迁过去（不能一条不迁就清掉）");
  localStorage.setItem("gw_history", "[]");
  localStorage.removeItem("gw_state");
}

/* 12.7h 交卷清草稿：只清「还是刚才交的那份」 */
{
  saveDraft("sigA", "交上去的那一份");
  ok(clearDraftIfSubmitted("sigA", "交上去的那一份") === true && loadDraft("sigA") === "",
     "草稿: 内容没变就清掉");
  saveDraft("sigA", "等待期间又补了一句");
  ok(clearDraftIfSubmitted("sigA", "交上去的那一份") === false && loadDraft("sigA") === "等待期间又补了一句",
     "草稿: 阅卷期间补写过就保留（那些字不在记录里）");
  clearDraft("sigA");
}
state.flows = []; _flowId = null; state.history = []; lastGrade = null; current = null;

/* 12.8 归类：分两段 —— 第一段把点归成组（组名先空着），第二段给每组写上位概括词 */
const fOrg = { selections:[{text:"甲点"},{text:"乙点"}], groups:[], question:{background:"x"} };
const orgHtml = organizePanelHtml(fOrg);
const curBlock = h => (String(h).match(/<div class="ogcur">[\s\S]*?<\/div>/) || [""])[0];
ok(curBlock(orgHtml).indexOf("甲点") >= 0 && curBlock(orgHtml).indexOf("乙点") < 0,
   "归类: 当前点区只摆这一个点的原文");
ok(orgHtml.indexOf("已归 0 / 2 个点") >= 0, "归类: 报出已归进度");
ok(orgHtml.indexOf("+ 新建一组") >= 0 && orgHtml.indexOf("data-og=") < 0,
   "归类: 一个组都没建时只给「+ 新建一组」");
ok(orgHtml.indexOf('id="ogCats"') < orgHtml.indexOf('class="ogcur"'),
   "归类: 规范词在句子上面（先看归到哪，再看这个点）");
ok(PAGE_HTML.indexOf(".ogcard .ptag,.ogname .ptag{background:var(--paper)") >= 0,
   "归类: 卡里的「整句」标签换成纸色（不再跟后面的句子糊在一起）");
ok(orgHtml.indexOf("上位概括词") < 0,
   "归类: 第一段不问上位概括词（问它就是「先填词再点材料」那个读反）");
ok(orgHtml.indexOf('data-jump="1"') >= 0, "归类: 已找的点收在折叠清单里，能跳回去重归");
ok(organizePanelHtml({ selections:[], groups:[] }).indexOf("回到一稿") >= 0, "归类: 没有找到点时给回到一稿的出口");
// 选中态跟着当前点走
const orgHtml1 = organizePanelHtml({ selections:[{text:"甲点"},{text:"乙点"}], groups:[{name:"政务服务效能",facts:[0]}], orgIdx:0 });
ok(orgHtml1.indexOf('class="ogcat on"') >= 0 && orgHtml1.indexOf("政务服务效能") >= 0, "归类: 已归入的类显示为选中");
ok(organizePanelHtml({ selections:[{text:"甲点"},{text:"乙点"}], groups:[{name:"甲类",facts:[0]}], orgIdx:1 }).indexOf('class="ogcat on"') < 0,
   "归类: 换到下一个点时选中态跟着换");
// 一个点能同时归进两类：两颗胶囊同时选中
const orgHtml2 = organizePanelHtml({ selections:[{text:"甲点",free:true}], groups:[{name:"甲类",facts:[0]},{name:"乙类",facts:[0]}], orgIdx:0 });
ok((orgHtml2.match(/class="ogcat on"/g) || []).length === 2 && orgHtml2.indexOf("划选") >= 0,
   "归类: 一个点能同时归进两类，且保留划选/整句标记");
ok(orgHtml2.indexOf("已归 1 / 1 个点") >= 0, "归类: 归好后进度跟上");
// 走完最后一个点：主动作是去命名，不是回一稿（回一稿永远在角落那个链接上）
const orgEnd = organizePanelHtml({ selections:[{text:"甲点"},{text:"乙点"}], groups:[], orgIdx:1 });
ok(orgEnd.indexOf("分组完毕，去命名") >= 0, "归类: 点走完的主动作是「去命名」");
ok(orgEnd.indexOf("btnCloseOrg") >= 0 && (orgEnd.match(/回到一稿/g) || []).length === 1,
   "归类: 哪一段都能收起来（角落的「回到一稿」只写一遍）");
const orgMid = organizePanelHtml({ selections:[{text:"甲点"},{text:"乙点"}], groups:[], orgIdx:0 });
ok(orgMid.indexOf("btnCloseOrg") >= 0, "归类: 没走到末点也能随时收起来");
ok(orgHtml.indexOf("下一个点") >= 0, "归类: 没走完时给「下一个点」");
// 第二段：一屏给每一组写上位概括词，组里的点先摆出来
const orgName = organizePanelHtml({ selections:[{text:"甲点"},{text:"乙点"}], groups:[{name:"",facts:[0,1]}], orgPhase:"name" });
ok(orgName.indexOf('data-ogname="0"') >= 0 && orgName.indexOf("甲点") >= 0 && orgName.indexOf("乙点") >= 0,
   "归类: 命名那一段把整组的内容摆出来（概括才有的放矢）");
ok(orgName.indexOf("btnNewCat") < 0 && orgName.indexOf("btnBackToGroup") >= 0,
   "归类: 命名那一段不再归点，给「回去改分组」的路");
ok(orgName.indexOf("提纲预览") < 0 && orgName.indexOf("outlinePrev") < 0 && orgName.indexOf("outlineBox") < 0,
   "归类: 提纲不在归类页（产地在这里，摆的地方是一稿页）");
const orgName2 = organizePanelHtml({ selections:[{text:"甲点"},{text:"乙点"}], groups:[{name:"甲",facts:[0]},{name:"乙",facts:[1]}], orgPhase:"name" });
ok(orgName2.indexOf('class="ognames"') >= 0, "归类: 命名页的组卡共用一个容器（组间留出间距）");
ok(PAGE_HTML.indexOf('id="newCatName"') < 0, "归类: 「新建一组」不再要求当场写名字");
ok(orgPhaseOf({}) === "group" && orgPhaseOf({orgPhase:"name"}) === "name" && orgPhaseOf({orgPhase:"乱写"}) === "group",
   "归类: 老链没有段位字段时按第一段算");

// 主次与形状：点卡是主角、新建与已有的组同排、命名卡走圆角口径
ok(orgHtml.indexOf('class="ogcard"') >= 0 && orgHtml.indexOf('class="ogcur"') > orgHtml.indexOf('class="ogcard"'),
   "归类: 当前点装进点卡（点与它要归的组是这一屏的主角）");
ok(/<div class="ogcats" id="ogCats">[\s\S]*class="ogcat ognew"/.test(orgHtml1),
   "归类: 「新建一组」与已有的组同排（同一排才读成「归到这里，或新建一个」）");
ok(PAGE_HTML.indexOf(".ogcat.ognew{border-style:dashed") >= 0, "归类: 新建一组是虚线样（看得出现在是「加一个」）");
ok(PAGE_HTML.indexOf(".ogname{background:var(--wash);border-radius:var(--r-card)") >= 0
   && PAGE_HTML.indexOf(".ogname .ogh .ogin{flex:1 1 auto") >= 0
   && PAGE_HTML.indexOf("font-size:var(--fs-title);font-weight:600;") >= 0,
   "归类: 命名卡走 --r-card、组名输入做成标题（整行、字大一号）");
ok(orgName.indexOf("可跳过，不计分") >= 0 && orgHtml.indexOf("可跳过，不计分") < 0,
   "归类: 「可跳过、不计分」只在命名那一段说一次");

// 提纲落在一稿页：默认收起、摆在作答区标题行下方
current = { module:"sl.guina", subtype:"概括问题", question:{ background:"x", requirements:"r" }, keyPoints:[], cardPeeks:0 };
const draftF = { groups:[{name:"甲组",facts:[0]}], selections:[{text:"甲点"}] };
const dHtml = draftPanelHtml(draftF);
const iTitle = dHtml.indexOf("作答区"), iBox = dHtml.indexOf('id="outlineBox"'), iTa = dHtml.indexOf('id="answer"');
ok(iTitle >= 0 && iBox > iTitle && iBox < iTa, "提纲: 摆在作答区标题行下方、文本框之前");
ok(dHtml.indexOf("我归的提纲") >= 0 && dHtml.indexOf("甲组：甲点") >= 0, "提纲: 一稿页看得到归出来的那一行");
ok(!/id="outlineBox"[^>]*\bopen\b/.test(dHtml), "提纲: 默认收起（要用时点开）");
ok(draftPanelHtml({ groups:[], selections:[] }).indexOf("outlineBox") < 0, "提纲: 一组都没有时不摆空框");
current = null;

// 命名卡：组名就是卡片的标题（在句子上方），一个词只出现一次
const orgNamed = organizePanelHtml({ selections:[{text:"甲点"}], groups:[{name:"窗口下移",facts:[0]}], orgPhase:"name" });
ok((orgNamed.match(/窗口下移/g) || []).length === 1, "归类: 组名只在标题输入框里出现一次");
ok(orgNamed.indexOf("给第 1 组起个名") >= 0, "归类: 空组靠 placeholder 报「第 N 组」");
const iIn = orgNamed.indexOf('data-ogname="0"'), iPts = orgNamed.indexOf("甲点");
ok(iIn >= 0 && iIn < iPts, "归类: 组名（标题）在句子上面");
ok(orgNamed.indexOf("第 1 组</span>") < 0, "归类: 不再另起一行「第 N 组」标签");

// 归类是「一稿」的子工具：步骤条报「一稿 · 归类」，纸面不再起「归类」标题
ok(railHtml({ step:"draft", orgOpen:true }).indexOf("一稿 · 归类") >= 0,
   "归类屏: 步骤条当前步报「一稿 · 归类」");
ok(orgHtml.indexOf('class="sec-title">归类') < 0 && orgName.indexOf('class="sec-title">归类') < 0,
   "归类屏: 纸面不再重复「归类」标题（步骤条已报）");

// 归类屏不再摆题面：题目行与换一题都撤掉，但限时留在这一行（归类的用时算作答）
{
  state.flows = []; _flowId = null; state.history = [];
  const qO = { background:"归类屏材料。", requirements:"请概括。", score:20 };
  const fO = ensureFlow("sl.guina", "概括问题", qO, []);
  fO.cardSeen = true; fO.step = "draft"; fO.orgOpen = true;
  fO.selections = [{ text:"甲点" }, { text:"乙点" }];
  fO.groups = []; fO.orgIdx = 0;
  current = { module:"sl.guina", subtype:"概括问题", question:qO, keyPoints:[], cardPeeks:0 };
  renderFlowStep();
  const oHtml = el("#docBody").innerHTML;
  ok(oHtml.indexOf("btnSwitch") < 0 && oHtml.indexOf("作答要求") < 0, "归类屏: 不再摆题面与「换一题」");
  ok(oHtml.indexOf('id="inpLimit"') >= 0, "归类屏: 限时照常可见（归类的用时算作答）");
  state.flows = []; _flowId = null; current = null;
}
// 归属反查表：一个点被哪几类收着
const sel3 = [{text:"甲点",free:true},{text:"乙点"}];
const grp3 = [{name:"甲组",facts:[0]},{name:"",facts:[0,1]}];
const h3 = holderOf(grp3, sel3);
ok(h3[0].length === 2 && h3[1].length === 1, "归类: 归属反查表记录一个点被哪几类收着 -> " + JSON.stringify(h3));
ok(groupLabel([{name:""}], 0) === "要点1" && groupLabel([{name:"甲组"}], 0) === "甲组", "归类: 没命名时按「要点N」称呼");
ok(buildOrganizeOutline(grp3, sel3).indexOf("甲组：甲点") >= 0 && buildOrganizeOutline(grp3, sel3).indexOf("要点2：甲点；乙点") >= 0,
   "归类: 提纲按类聚合，跨类重复的点两类都出现");

current = null;

/* ============ 13. 快判（第三入口）：事实选择 / 分组概括 / 表达比较 ============ */

/* ① 入口唯一：快判只有首页红按钮（2026-10-12 拍板「只留主页这一个入口」），落地页/形式选择/自选主题整块撤 */
renderTabs();
ok(el("#subjbar").innerHTML.indexOf("快判") < 0 && el("#subjbar").innerHTML.indexOf('data-s="__pd"') < 0
   && el("#subjbar").innerHTML.indexOf("subjdiv") < 0,
   "快判: 顶栏没有快判入口——科目栏只剩综应A/申论");
switchSubject("zy");
ok(el("#docBody").innerHTML.indexOf('data-mod="zy.gongwen"') >= 0, "快判: 作答轨模块 chips 照旧（综应A）");
ok(PAGE_HTML.indexOf("renderPDLanding") < 0 && PAGE_HTML.indexOf("enterPD") < 0
   && PAGE_HTML.indexOf("pdIntroSeen") < 0 && PAGE_HTML.indexOf("自选主题") < 0,
   "快判: 落地页函数、一次性说明与自选主题的代码零残留");
ok(startPDRound.toString().indexOf("pdActive = true") >= 0 && startPDRound.toString().indexOf("genPDRound(form") >= 0,
   "快判: startPDRound 进判别轨并直接出题（首页红按钮一线直达，无中间页）");
ok(PD_FORMS[PD_MIX] && PD_FORM_ORDER.every(id=> PD_FORMS[id] && PD_FORMS[id].spec),
   "快判引擎: PD_MIX 综合判别保留，三种形式的出题规范保留（混在一轮里出，不再单挑）");

/* ①b 返回综合：再点当前科目按钮 = 回起始页，不用绕道切科目再切回来 */
renderModuleLanding("zy.gongwen");
ok(el("#docBody").innerHTML.indexOf("data-start=") < 0,
   "返回综合: 前置——人在公文写作落地页");
backToStart();
ok(el("#docBody").innerHTML.indexOf('data-start="subj"') >= 0,
   "返回综合: 再点当前科目回到综合起始页，纸面不挂模块 chips");
ok(el("#modLabel").textContent === "综合 · 智能出题", "返回综合: 灰字如实报综合 · 智能出题，不再挂上次练的模块名");

/* ② 出题：三种形式 prompt 各自成形，带主题与相关经验（拦 callLLM） */
const realCallPD = callLLM;
let capPD = null;
callLLM = async (sys, user)=>{ capPD = { sys, user }; return { items:[ { context:"甲材料节选，含数字与限定语。", stem:"哪一项准确？", options:["对","错"], answer:0, trap:"换主体", explain:"先看主体。" } ] }; };
state.experiences = [ { id:"p1", type:"规则", title:"基层治理要盯主体", body:"先看动作主体是谁", module:"zy.gongwen", subject:"zy", ts:1, disabled:false, sourceSig:"s" },
                      { id:"p2", type:"规则", title:"停用的不带走", body:"x", module:"sl.guina", subject:"sl", ts:0, disabled:true, sourceSig:"s" } ];
await genPDRound("fact-select", "基层治理");
ok(capPD.sys.indexOf("事实选择") >= 0 && capPD.sys.indexOf("换主体") >= 0 && capPD.sys.indexOf("2 个选项") >= 0,
   "判别出题: fact-select 规范成形（含干扰项口径）");
const pdUser1 = JSON.parse(capPD.user);
ok(pdUser1.theme === "基层治理" && pdUser1.count === 5 && Array.isArray(pdUser1.experiences) && pdUser1.experiences.some(e=>e.title==="基层治理要盯主体"),
   "判别出题: 主题 + 5 题 + 相关经验进请求，停用经验不带");
await genPDRound("group-summarize", "基层治理");
ok(capPD.sys.indexOf("分组概括") >= 0 && capPD.sys.indexOf("以偏概全") >= 0,
   "判别出题: group-summarize 规范成形");
await genPDRound("expression-compare", "基层治理");
ok(capPD.sys.indexOf("表达比较") >= 0 && capPD.sys.indexOf("原意") >= 0,
   "判别出题: expression-compare 规范成形");
ok(capPD.sys.indexOf("采分点") < 0 && capPD.sys.indexOf(SCORING_RULES) < 0,
   "判别出题: 不套作答轨的采分点口径");
state.experiences = [];
await genPDRound("fact-select", "生态环保");
ok(!JSON.parse(capPD.user).experiences, "判别出题: 无经验时不带 experiences 键");

/* ②.5 选项个数：散文规范与 JSON 示例同源，不能一个说 2 个、示例却给 3 个 */
ok(pdOptSample(PD_FORMS["fact-select"]) === '["选项1","选项2"]',
   "判别出题: fact-select 的 JSON 示例只给 2 个选项 (got " + pdOptSample(PD_FORMS["fact-select"]) + ")");
ok(pdSchema(PD_FORMS["fact-select"]).indexOf("选项3") < 0 && pdSchema(PD_FORMS["group-summarize"]).indexOf("选项3") > 0,
   "判别出题: 示例的选项个数跟着形式走（fact-select 2 个 / 另两个最多 3 个）");
ok(PD_FORMS["fact-select"].spec.indexOf("2 个选项") < 0,
   "判别出题: 规范散文里不再重复写个数（个数只在 optCount 一处）");
ok(capPD.sys.indexOf("选项个数：固定 2 个选项") >= 0 && capPD.sys.indexOf("选项3") < 0,
   "判别出题: 系统提示里 fact-select 只说 2 个，示例里也不再有第 3 项");

/* ③ 判分：命中 / 误选 / 未答三态，不套三档 */
ok(pdScoreOf({answer:1}, 1) === "hit" && pdScoreOf({answer:1}, 0) === "miss" && pdScoreOf({answer:1}, null) === "skip",
   "判分: 命中/误选/未答三态");
pdRound = { form:"fact-select", theme:"测试", items:[
  { context:"c1", stem:"s1", options:["对","错"], answer:0, trap:"换主体", explain:"e1" },
  { context:"c2", stem:"s2", options:["甲","乙"], answer:1, trap:"改范围", explain:"e2" } ], idx:0, correct:0, done:false };
pdResolve(0);
ok(pdRound.items[0].done && pdRound.items[0].picked === 0 && pdRound.items[0].ok === true && pdRound.correct === 1,
   "判分: 点选即判（命中立计，不等整组）");
const pdDoc1 = el("#docBody").innerHTML;
ok(pdDoc1.indexOf("pdopt good") >= 0 && pdDoc1.indexOf("答对了") >= 0 && pdDoc1.indexOf("e1") >= 0,
   "判分: 判完对的标绿 + 一句解析上屏");
pdNext();
pdResolve(0);
ok(pdRound.items[1].done && pdRound.items[1].ok === false && pdRound.correct === 1
   && el("#docBody").innerHTML.indexOf("pdopt bad") >= 0 && el("#docBody").innerHTML.indexOf("pdopt good") >= 0,
   "判分: 误选标红且正解标绿");

/* ⑤+④ 轮次收尾：记录入 gw_history，不写 dims / lastModules / 不触发提炼；小结与画像 */
const realDistillPD = distillExperience;
let distilledPD = false;
distillExperience = async ()=>{ distilledPD = true; return []; };
const pdDimsBefore = JSON.stringify(state.profile.modules);
const pdLMBefore = state.profile.lastModules.length;
state.history = [];
pdNext();   // 最后一题 → 收卷
ok(pdRound.done === true && el("#docBody").innerHTML.indexOf("本轮小结") >= 0
   && el("#docBody").innerHTML.indexOf("再来一轮") >= 0 && el("#docBody").innerHTML.indexOf("回首页") >= 0,
   "轮次: 收卷后一屏小结，含再来一轮 / 回首页");
ok(state.history.length === 1 && state.history[0].track === "pd" && state.history[0].form === "fact-select"
   && state.history[0].theme === "测试" && state.history[0].correct === 1 && state.history[0].total === 2,
   "轮次: 记录写入 history（track/form/theme/correct/total）");
ok(JSON.stringify(state.history[0].items) === JSON.stringify([
  { form:"fact-select", stem:"s1", options:["对","错"], answer:0, picked:0, ok:true, trap:"换主体", explain:"e1" },
  { form:"fact-select", stem:"s2", options:["甲","乙"], answer:1, picked:0, ok:false, trap:"改范围", explain:"e2" } ]),
   "轮次: items 带 form/stem/options/answer/picked/ok");
ok(JSON.parse(localStorage.getItem("gw_history"))[0].track === "pd", "轮次: 落盘 gw_history");
ok(JSON.stringify(state.profile.modules) === pdDimsBefore, "隔离: 快判不写维度画像 dims");
ok(state.profile.lastModules.length === pdLMBefore, "隔离: 快判不进 lastModules（不影响作答轨调度）");
ok(distilledPD === false, "隔离: 快判不触发经验提炼");
profGo("pd");
const phPD = el("#profileBody").innerHTML;
ok(phPD.indexOf("快判（只看正确率") >= 0 && phPD.indexOf("事实选择") >= 0, "画像: 快判单独一节（点进去才有）");

/* ③ 综合快判：每题自带形式，统计按题归属（一轮里三种都有，按轮算会混成一笔） */
const pdSan = sanitizePDItems([
  { form:"group-summarize", context:"c", stem:"s", options:["a","b"], answer:0 },
  { form:"乱填的", context:"c2", stem:"s2", options:["a","b"], answer:1 },
  { context:"c3", stem:"s3", options:["a","b"], answer:0 } ], PD_MIX);
ok(pdSan.length === 3 && pdSan[0].form === "group-summarize" && pdSan[1].form === "fact-select" && pdSan[2].form === "fact-select",
   "综合快判: 认每题自带的 form；认不出的退回「事实选择」（形状最通用，不误导）");
const __pdHistKeep = state.history;
state.history = [ { ts:Date.now(), track:"pd", form:PD_MIX, theme:"t", correct:2, total:3,
  items:[ { form:"fact-select", ok:true }, { form:"group-summarize", ok:false }, { form:"expression-compare", ok:true } ] } ];
const __pdSt = pdFormStats();
ok(__pdSt.st["fact-select"].q === 1 && __pdSt.st["fact-select"].c === 1 && __pdSt.st["group-summarize"].q === 1
   && __pdSt.st["group-summarize"].c === 0 && __pdSt.st["expression-compare"].c === 1 && __pdSt.mixRounds === 1,
   "综合快判: 统计按每题形式归属（不被按轮算混成一笔）");
state.history = __pdHistKeep;
ok(pdFormStats().st["fact-select"].q >= 1, "综合快判: 统计函数可重复调用（不污染 state）");
ok(phPD.indexOf("正确率 50%") >= 0, "画像: 快判正确率 (1/2 = 50%)");
profGo("hist");
ok(el("#profileBody").innerHTML.indexOf(">快判</td>") >= 0 && el("#profileBody").innerHTML.indexOf(">1/2<") >= 0,
   "画像: 记录表识别快判行（对/总题数）");
distillExperience = realDistillPD;
pdRound = null; pdForm = null;

/* ⑥ 迁移幂等：旧记录无 track 字段不报错，快判记录原样保留 */
pdActive = false;
localStorage.clear();
localStorage.setItem("gw_history", JSON.stringify([
  { ts:1, module:"zy.gongwen", grade:{ total:60, scores:{} } },
  { ts:2, track:"pd", form:"group-summarize", theme:"养老托育", items:[{ stem:"s", options:["a","b"], answer:0, picked:1, ok:false }], correct:0, total:1 }
]));
const lmPD = load();
ok(lmPD.history.length === 2 && lmPD.history[0].module === "zy.gongwen" && !lmPD.history[0].track,
   "迁移: 旧记录无 track 字段照常读回，不报错");
ok(lmPD.history[1].track === "pd" && lmPD.history[1].form === "group-summarize" && lmPD.history[1].correct === 0,
   "迁移: 快判记录原样保留");
const lmPD2 = load();
ok(lmPD2.history.length === 2 && lmPD2.history[1].track === "pd" && lmPD2.history[1].form === "group-summarize",
   "迁移: 快判与旧记录二次 load 幂等");
profGo("pd");
ok(el("#profileBody").innerHTML.indexOf("分组概括") >= 0 && el("#profileBody").innerHTML.indexOf("0%") >= 0,
   "迁移: 新旧混合记录渲染不报错，画像统计正确");
localStorage.clear();
state.history = [];

/* ============ 13.5 快判成第一入口（示例题整块下线：无 Key 的主行动如实变成「先填 API Key」） ============ */

/* ① 入口顺序：快判无顶栏入口（唯一入口在首页红按钮），科目栏只剩科目 */
renderTabs();
const sbUp = el("#subjbar").innerHTML;
ok(sbUp.indexOf("快判") < 0 && sbUp.indexOf("subjdiv") < 0,
   "快判往上提(已收拢): 科目栏无快判入口与分隔线");

/* ② 首页：没填 Key 时红按钮如实说「先填 API Key」，两句大题各自点名科目；填了 Key 红按钮是「开始快判」
     （这两句曾经连科目首页也照抄一份，结果综应A 里最大的红按钮写着「开始快判」） */
const apiKeyBeforeUp = state.settings.apiKey;   // 后面几步要改 Key：用完原样还回去（14.11 那条要验「导入不动本机 Key」）
state.settings.apiKey = "";
renderHome();
const startUp = el("#docBody").innerHTML;
ok(startUp.indexOf('class="primary big" id="btnSetup">先填 API Key（出题和阅卷都要）') >= 0
   && startUp.indexOf("开始快判") < 0 && startUp.indexOf("btnSample") < 0,
   "快判往上提: 首页没填 Key 时红按钮是「先填 API Key」——出题这条路走不通，就不说「开始快判」");
ok(startUp.indexOf("填好 API Key 就能开始 · 没有账号，数据都在本地") >= 0,
   "首页（没填 Key）: 脚注说清要先填 Key，必备声明照在");
ok(el(".redhead").style.display === "" && el("#docBody").innerHTML.indexOf("今天练什么？") >= 0,
   "首页: 公文红头回到卷首，hero（今天练什么？）接在下方——两张皮合成一张纸");
el("#btnSetup").onclick();
ok(el("#modalSettings").hidden === false,
   "首页（没填 Key）: 那颗按钮真把人送到设置页（说完「先填 API Key」就得真能填）");
closeModals();
ok(startUp.indexOf('data-big="zy">去综应A') >= 0 && startUp.indexOf('data-big="sl">去申论') >= 0
   && startUp.indexOf("练一道大题（综应 / 申论）") < 0,
   "快判往上提: 没 Key 时两枚 chips 只承诺「去某科」，不承诺出题");
ok(wireStartBox.toString().indexOf("canStart()") >= 0,
   "首页大题: 没 Key 时 chip 只切科目、不进加载态");
state.settings.apiKey = "sk-test";
renderHome();
ok(el("#docBody").innerHTML.indexOf('class="primary big" id="btnQuick">开始快判') >= 0
   && el("#docBody").innerHTML.indexOf("今天练什么？") >= 0
   && el("#docBody").innerHTML.indexOf("按你最近的练习情况出题，写完就有分") >= 0
   && el("#docBody").innerHTML.indexOf("没有账号，数据都在本地") >= 0
   && el("#docBody").innerHTML.indexOf("填好 API Key 就能开始") < 0
   && el("#docBody").innerHTML.indexOf("btnSample") < 0,
   "首页 hero: 大标题 / 副题 / 主按钮 / 脚注都住；填了 Key 后脚注不再说「填好 Key 就能开始」");
state.settings.apiKey = "";
/* ②b 科目首页（综应A / 申论）：红按钮是本科目的主行动，快判不在纸面上抢红
     （快判入口常驻顶栏最左那颗胶囊，科目页再放一遍就是同一条路开两个门） */
state.settings.subject = "zy"; renderStart();
const subjStart = el("#docBody").innerHTML;
ok(subjStart.indexOf('class="primary big" id="btnSetup">先填 API Key') >= 0
   && subjStart.indexOf("data-start=\"subj\"") >= 0,
   "科目页（没填 Key）: 红按钮改说「先填 API Key」——出题这条路当下走不通，就不说「开始练习」");
ok(subjStart.indexOf("开始快判") < 0,
   "科目页: 不出现「开始快判」（快判是顶栏最左那颗胶囊的事）");
const zyFlowOrder = ["综应A 练什么？","学习卡","作答","批改","写完就有分"].map(s=> subjStart.indexOf(s));
ok(zyFlowOrder.every((p,i)=> p >= 0 && (i === 0 || p > zyFlowOrder[i-1])),
   "综应A布局: 主按钮下预览真实流程，顺序为学习卡→作答→批改");
ok(subjStart.indexOf("data-big") < 0,
   "科目页: 不放两句大题——点它们和点红按钮是同一个动作（startSmart）");
ok(el("#subjbar").innerHTML.indexOf("快判") < 0,
   "科目页: 顶栏无快判入口（快判只从首页红按钮进）");
ok(el("#btnSetup").onclick !== startSmart,
   "科目页（没填 Key）: 红按钮接的不是出题那条路（它此刻走不通）");
el("#btnSetup").onclick();
ok(el("#modalSettings").hidden === false,
   "科目页（没填 Key）: 那颗按钮真把人送到设置页（说完「先填 API Key」就得真能填）");
closeModals();
state.settings.subject = "sl"; renderStart();
const slNoKeyStart = el("#docBody").innerHTML;
ok(slNoKeyStart.indexOf('id="btnSetup">先填 API Key') >= 0,
   "科目页（没填 Key）: 换到申论也是同一个形态，不为某个科目开特例");
const slNoKeyFlowOrder = ["申论 练什么？","学习卡","读材料找点","一稿","批改"].map(s=> slNoKeyStart.indexOf(s));
ok(slNoKeyFlowOrder.every((p,i)=> p >= 0 && (i === 0 || p > slNoKeyFlowOrder[i-1])),
   "申论布局（没填 Key）: 仍预览真实的学习卡→读材料找点→一稿→批改流程");

/* ②c 填了 Key 的科目首页：红按钮回到本科目的主行动 */
state.settings.apiKey = "sk-test"; state.settings.subject = "zy"; renderStart();
ok(el("#docBody").innerHTML.indexOf('class="primary big" id="btnSmart">开始综应练习') >= 0,
   "科目页（填了 Key）: 红按钮是「开始综应练习」（本科目的主行动）");
ok(el("#btnSmart").onclick === startSmart && el("#btnQuick").onclick !== startSmart,
   "科目页（填了 Key）: 红按钮接的是 startSmart（与「练一道综应大题」同一个动作，不是快判那条）");
state.settings.subject = "sl"; renderStart();
const slStart = el("#docBody").innerHTML;
ok(slStart.indexOf('id="btnSmart">开始申论练习') >= 0,
   "科目页（填了 Key）: 换到申论，红按钮跟着换名（开始申论练习）");
const slFlowOrder = ["申论 练什么？","学习卡","读材料找点","一稿","批改","写完就有分"].map(s=> slStart.indexOf(s));
ok(slFlowOrder.every((p,i)=> p >= 0 && (i === 0 || p > slFlowOrder[i-1])),
   "申论布局（填了 Key）: 流程预览包含读材料找点和一稿");
state.settings.apiKey = ""; state.settings.subject = "zy";
// 一键出题不能带着空主题走：起始页没有 #pdTheme 输入框，pdThemeValue 得退到随机主题
const startThemes = Array.from({length: 20}, ()=> pdThemeValue());
ok(startThemes.every(t=> PD_TOPICS.indexOf(t) >= 0),
   "快判往上提: 起始页没主题输入框时退回随机主题（不会带着空主题出题）");

/* 主题权重：权重表跟主题表一一对应；加权抽不该退化成等概率（对 Math.random 打点，免抽样噪声） */
ok(Object.keys(PD_TOPIC_WEIGHT).length === PD_TOPICS.length
   && PD_TOPICS.every(t=> typeof PD_TOPIC_WEIGHT[t] === "number"),
   "快判权重: 权重表不多不少，跟主题表一一对应");
const wtReal = Math.random, wtHit = {}, wtN = 6000;
try {
  for (let i = 0; i < wtN; i++){ Math.random = ()=> (i + 0.5) / wtN; const t = pdThemeValue(); wtHit[t] = (wtHit[t] || 0) + 1; }
} finally { Math.random = wtReal; }
ok(PD_TOPICS.every(t=> wtHit[t] > 0),
   "快判权重: 每个主题都抽得到（没有权重漏填导致永不出现的）");
const wtHeavy = PD_TOPICS.filter(t=> PD_TOPIC_WEIGHT[t] === 3).map(t=> wtHit[t] || 0);
const wtLight = PD_TOPICS.filter(t=> PD_TOPIC_WEIGHT[t] === 1).map(t=> wtHit[t] || 0);
ok(wtHeavy.length > 0 && wtLight.length > 0 && Math.min(...wtHeavy) > Math.max(...wtLight),
   `快判权重: 超高频主题出现次数多于冷门主题（高频最低 ${Math.min(...wtHeavy)} > 冷门最高 ${Math.max(...wtLight)}）`);

/* ③ 一键到题：填了 Key 点「开始快判」直接进 AI 出题；没 Key 被 entryBlocked 拦在原地（不进加载态、不调 AI） */
const pdStubPrev = callLLM; let pdCalls = 0;
callLLM = async (...a)=>{ pdCalls++; return pdStubPrev(...a); };
const realGenPD = genPDRound; const genCalls = [];
genPDRound = async (form, theme)=>{ genCalls.push([form, theme]); };
state.settings.apiKey = "sk-test";
startPDRound(PD_MIX);
ok(genCalls.length === 1 && genCalls[0][0] === PD_MIX && pdCalls === 0,
   "快判: 填了 Key 点「开始快判」直接进 AI 出题");
state.settings.apiKey = "";
startPDRound(PD_MIX);
ok(genCalls.length === 1 && pdCalls === 0 && pdRound === null,
   "快判: 没填 Key 点快判被 entryBlocked 拦在原地（不出题、不调 AI、不换屏）");

genPDRound = realGenPD;

/* ④ 判分与小结：手工装一轮真渲染走完（不调 AI），练习页 / 小结 / 入账都照真轮走 */
const histBeforePd = state.history.length;
const lsBeforePd = localStorage.getItem("gw_history");
const pdFakeItem = { form:"fact-select", context:"某县 2024 年起在乡镇开办乡村夜校，运行经费由县财政拨付，主要面向返乡青年。", stem:"下列关于该县乡村夜校的说法，哪一项准确？",
  options:["面向全县所有青年开放", "课程由县农业农村局与本地职业学校共同设计"], answer:1, trap:"改范围", explain:"解析。" };
pdActive = true; pdForm = "fact-select";
pdRound = { form:"fact-select", theme:"测试主题", items:[pdFakeItem], idx:0, correct:0, done:false };
renderPDRound();
ok(el("#docBody").innerHTML.indexOf("material") >= 0 && el("#docBody").innerHTML.indexOf("pdopt") >= 0
   && el("#pdState").textContent.indexOf("主题「测试主题」") >= 0,
   "快判练习页: 一进来就是第一道题（材料 + 选项；主题与进度落红头中段）");
ok(el("#docBody").innerHTML.indexOf("快判练的是从材料里辨认说法") < 0,
   "快判一轮页: 不再写「快判和大题是什么关系」那句说明");
/* 进度在红头中段：翻到第二题要跟着往前走 */
pdRound.items.push(Object.assign({}, pdFakeItem, { stem:"第二题：下列哪项说法与材料相符？" }));
pdRound.idx = 1;
renderPDRound();
ok(el("#pdState").textContent.indexOf("第 2/2 题") >= 0,
   "快判一轮页: 翻到第二题，红头中段的进度跟着往前走");
pdRound.items.pop(); pdRound.idx = 0;
renderPDRound();
pdResolve(0); pdNext();
ok(pdRound.done === true && state.history.length === histBeforePd + 1 && localStorage.getItem("gw_history") !== lsBeforePd
   && el("#docBody").innerHTML.indexOf("本轮小结") >= 0,
   "快判小结: 答完照常出小结并计入练习记录");
ok(el("#docBody").innerHTML.indexOf("再来一轮") >= 0 && el("#docBody").innerHTML.indexOf("回首页") >= 0,
   "快判小结: 收尾按钮是「再来一轮 / 回首页」");
ok(el("#docBody").innerHTML.indexOf("下次出题会在这些辨析点上再考你") >= 0,
   "快判小结: 答错的承诺「下次再考你」（记录已入账，那条链能兑得现）");
state.history = state.history.filter(h=> h.track !== "pd"); saveHistory();
pdActive = false; pdRound = null; pdForm = null; state.settings.apiKey = apiKeyBeforeUp; callLLM = pdStubPrev;


/* ============ 13.6 首页（谁都没选）与两句大题各自点名科目 ============ */

/* ① 首页：科目按钮一个都不亮，纸面不摆模块 chips，抬头不挂科目名 */
localStorage.clear();
state.history = []; state.flows = []; state.settings.subject = "zy";
renderHome();
ok(_view === "home" && el("#modLabel").textContent === "首页",
   "首页: 灰字只报首页（科目名不预挂，也不重复文号里的「练习台”）");
ok(el("#subjbar").innerHTML.indexOf("active") < 0, "首页: 三个入口一个都不预选（快判也不亮）");
ok(el("#docBody").innerHTML.indexOf("data-mod=") < 0, "首页: 不摆任何科目的模块 chips");
ok(el("#docBody").innerHTML.indexOf('data-big="zy"') >= 0 && el("#docBody").innerHTML.indexOf('data-big="sl"') >= 0,
   "首页: 两句大题都在（综应 / 申论各自点名）");

/* ② 点了科目按钮才进那个科目的首页：抬头、点灯、模块 chips 一起回来 */
switchSubject("sl");
ok(_view === "start" && el("#modLabel").textContent.indexOf("综合 · 智能出题") === 0
   && el("#subjbar").innerHTML.indexOf('class="subjbtn active" data-s="sl"') >= 0
   && el("#docBody").innerHTML.indexOf("贯彻执行") >= 0,
   "首页: 点申论才进申论的首页（科目点灯 + 它的模块 chips）");
ok(el("#docBody").innerHTML.indexOf('data-mod="sl.guanche"') >= 0,
   "科目页: 模块 chips 真在纸面上（进科目页才有）");

/* ③ 左上角品牌名 = 回首页（首页不属于任何科目，得有个不挑科目的落点） */
ok(PAGE_HTML.indexOf('id="btnHome"') >= 0 && PAGE_HTML.indexOf('$("#btnHome").onclick = ()=> renderHome();') >= 0,
   "首页: 左上角「练习台」是回家的入口");
/* 品牌位是应用图标（SPEC 3.0：禁止单字印章式代标），图标 data URI 内联，悬浮提示走同一套 [data-tip] */
ok(/id="btnHome"[^>]*data-tip="首页"[^>]*><img src="data:image\/png;base64,/.test(PAGE_HTML)
   && PAGE_HTML.indexOf(".toolbar .brand::before") < 0 && PAGE_HTML.indexOf('title="回到起始页"') < 0,
   "品牌位: 应用图标 data URI + 「首页」悬浮提示；红竖条代标与旧 title 双份提示都撤了");
renderHome();
ok(_view === "home" && el("#subjbar").innerHTML.indexOf("active") < 0,
   "首页: 从科目页回得来，回到的是无选中态");
ok(el("#docBody").innerHTML.indexOf("data-mod=") < 0, "首页: 回来的路上模块 chips 也不残留");

/* ④ 大题入口：点哪句就把科目切到哪边，并直接出题（一步到题） */
const realLoadQ = loadQuestion; const loadBigCalls = [];
loadQuestion = async (k, st)=>{ loadBigCalls.push([k, st]); };
state.settings.subject = "zy";
startSubjectTask("sl");
ok(state.settings.subject === "sl" && loadBigCalls.length === 1 && subjectOf(loadBigCalls[0][0]) === "sl",
   "大题入口: 「练一道申论大题」把科目切到申论，并直接出题");
startSubjectTask("zy");
ok(state.settings.subject === "zy" && loadBigCalls.length === 2 && subjectOf(loadBigCalls[1][0]) === "zy",
   "大题入口: 「练一道综应大题」切回综应，并直接出题");
ok(JSON.parse(localStorage.getItem("gw_state")).settings.subject === "zy",
   "大题入口: 科目切换落盘（与点科目按钮同一处口径）");
loadQuestion = realLoadQ;

/* ②c 废话与重复（原来上下一句话写两遍：上面「开始今天的练习」、下面「开始综应练习」）：
   纸面上不再写标题（抬头已经报了「你在哪」），也不再写「我按 XX 出题」这类机制说明。 */
state.settings.subject = "zy"; renderStart();
const subjPlain = el("#docBody").innerHTML;
ok(subjPlain.indexOf("开始今天的练习") < 0 && subjPlain.indexOf("AI 按你最近") < 0,
   "废话精简: 科目页既没有重复的标题，也没有「我按你最近表现出题」这句机制说明");
ok(subjPlain.indexOf('data-start="subj"') >= 0, "废话精简: 科目页带 data-start=\"subj\"（两形在断言里分得开）");
renderHome();
const homePlain = el("#docBody").innerHTML;
ok(homePlain.indexOf("开始今天的练习") < 0 && homePlain.indexOf('data-start="home"') >= 0,
   "废话精简: 首页也不再写「开始今天的练习」——主行动自己就是标题");
ok(homePlain.indexOf("按你最近的练习情况出题，写完就有分") >= 0,
   "废话精简: 首页副题那行留着——它是「这是什么」，不是重复");
renderModuleLanding("zy.guina");
const landPlain = el("#docBody").innerHTML;
ok(landPlain.indexOf("<h2>") < 0 && landPlain.indexOf("概括问题 / 原因") < 0,
   "废话精简: 归纳概括落地页不写模块名标题，也不写与胶囊重复的那句名单");
ok(landPlain.indexOf("近期加权均分") >= 0 || landPlain.indexOf("还没练过") >= 0,
   "废话精简: 但成绩那行留着（是数据，不是废话）");
renderModuleLanding("zy.duice");
ok(el("#docBody").innerHTML.indexOf("针对问题提出解决措施") >= 0
   && el("#docBody").innerHTML.indexOf("<h2>") < 0,
   "废话精简: 真在描述「这是什么」的 note（提出对策）还留着，只去掉重复的标题");
renderHome();

/* ⑤ 首页是快判唯一入口；科目仍从顶栏切换。 */
state.settings.subject = "zy";
renderHome();
const homeOnly = el("#docBody").innerHTML;
ok(homeOnly.indexOf('id="btnQuick"') >= 0 && homeOnly.indexOf('data-pdform') < 0 && homeOnly.indexOf("换个形式") < 0,
   "快判布局: 首页红按钮是唯一快判入口，纸面无形式选择残留");
switchSubject("sl");
ok(pdActive === false && state.settings.subject === "sl",
   "快判布局: 仍可从顶栏进入申论");
renderHome();

/* ⑤ 顶栏结构：科目入口在第一行；模块与快判形式入口落进纸面 chips，顶栏只有一行。 */
ok(/id="btnHome"[^>]*><img [^>]*>练习台<\/button>\s*<span class="subjbar" id="subjbar">/.test(PAGE_HTML),
   "顶栏: 科目入口紧跟在品牌后面（同一行）");
ok(PAGE_HTML.indexOf('id="modbar"') < 0 && PAGE_HTML.indexOf(".modbar{") < 0,
   "顶栏: 第二行页签带已整体撤掉（modbar 容器与样式都不在）");
ok(PAGE_HTML.indexOf("--h-modbar") < 0 && renderTabs.toString().indexOf("modbar") < 0,
   "顶栏: 题型行高度变量与 renderTabs 里的第二行渲染逻辑一并撤掉");
ok(PAGE_HTML.indexOf("综合 · 智能出题") >= 0 && PAGE_HTML.indexOf("综合推送") < 0,
   "灰字: 综合起始页的抬头口径是「综合 · 智能出题」（旧字样「综合推送」不留在源码里）");
ok((function(){ state.settings.subject = "zy"; renderStart(); return el("#docBody").innerHTML; })().indexOf("data-mod=") >= 0,
   "入口归一: 科目起始页有模块 chips（不在顶栏）；快判无单独落地页，入口只在首页红按钮");
pdActive = false; renderHome();   // 上面那条动过全局态，还原回首页，别把 pdActive 漏进后面的章节

/* ⑤ 顶栏工具区（SPEC 3.2 桌面质感）：图标无框、悬浮才现文字，图标自身不带可见文字 */
["btnProfile","btnSettings","btnExport","btnImport"].forEach(id=>{
  const m = PAGE_HTML.match(new RegExp('<button class="iconbtn" id="' + id + '"[^>]*>([\\s\\S]*?)</button>'));
  ok(m && m[0].indexOf('aria-label=') >= 0 && m[0].indexOf('data-tip="') >= 0
     && m[0].indexOf('<svg') >= 0 && !/>[^<\s][^<]*</.test(m[0].replace(/<svg[\s\S]*?<\/svg>/, "")),
     "顶栏: " + id + " 是带悬浮提示与无障碍名的图标按钮（不靠裸文字）");
});
ok(PAGE_HTML.indexOf('class="foot"') < 0,
   "顶栏: 页脚式说明行不进主界面（数据仅存本地说在设置页，SPEC 3.2）");
ok(PAGE_HTML.indexOf('border-radius:var(--r-card)') >= 0,
   "质感: 弹层卡片走统一大圆角 token（SPEC 3.2）");
ok(/--r-ctl:8px;/.test(PAGE_HTML) && !/border-radius:\s*[0-9]/.test(PAGE_HTML),
   "圆润化: 圆角一律走 token，规则里不落裸数字（2026-10-15 收敛：原来散着 8 处，尖准的 6px/12px/1px 没人说得出来）");
ok((function(){ const m = PAGE_HTML.match(/\.railwrap\{[^}]*\}/); return m && m[0].indexOf('sticky') < 0; })(),
   "训练链: 步骤条不吸顶，跟纸一起滚");
ok((function(){ const m = PAGE_HTML.match(/\.doc\{[^}]*\}/); return m && m[0].indexOf('border') < 0 && m[0].indexOf('box-shadow') < 0 && m[0].indexOf('border-radius') < 0 && m[0].indexOf('overflow:clip') >= 0 && m[0].indexOf('zoom:var(--paper-scale)') >= 0 && m[0].indexOf('min-height:calc((100vh - 50px)/var(--paper-scale) - 48px)') >= 0; })(),
   "纸面纪律: .doc 光板——不描边不投影不圆角，靠 --paper 对底板的色差与按窗口等比放大撑满视口（clip 只裁不接管滚动）");
ok((function(){ const m = PAGE_HTML.match(/\.modal \.box\{[^}]*\}/); return m && m[0].indexOf('overflow:hidden') >= 0; })(),
   "圆润化: 弹层 .box 裁掉内部直角（抬头 / 面板底角不露方角）");
ok((function(){ const m = PAGE_HTML.match(/\.tour-tip\{[^}]*\}/); return m && m[0].indexOf('background:var(--ink)') >= 0 && m[0].indexOf('border-radius:var(--r-ctl)') >= 0; })()
   && PAGE_HTML.indexOf('.tour-tip button{border-radius:var(--r-ctl);}') >= 0,
   "圆润化: 引导气泡与高亮框同档圆角，气泡内按钮跟界面按钮同档（不是胶囊）");
/* 引导浮层是整屏唯一的深色面，它的遮罩 / 柔影 / 灰字以前散成四条 rgba，
   而且不在「:root 外的 hex」那条断言的射程里——那条只认 #hex，rgba 直接漏过。 */
ok(!/\.tour-tip\{[^}]*rgba\(|\.tour-tip \.tstep\{[^}]*rgba\(|\.tour-tip \.tourskip\{[^}]*rgba\(/.test(PAGE_HTML),
   "引导: 气泡的遮罩 / 柔影 / 灰字都走 token，不散落 rgba");
/* 设置保存后要当场重画当前页：首页与科目页那颗红按钮是按「有没有 Key」渲染的，
   不重画就得切一次页面才更新（2026-10-13 报的就是这个）。 */
ok(PAGE_HTML.indexOf("applyForm(); const saved = save(); renderHeader(); renderCurrentView();") >= 0,
   "设置: 保存后立刻重渲染当前页（填完 Key 当场见效，不用切页面）");
ok(/function renderCurrentView\(\)\{[\s\S]{0,420}?_view === "q"\) return false/.test(PAGE_HTML),
   "设置: 重渲染跳过正在作答的题页（不能清掉他刚写的东西）");
ok((function(){ const m = PAGE_HTML.match(/\.seg button\.active\{[^}]*\}/); return m && m[0].indexOf('var(--red-wash)') >= 0; })(),
   "圆润化: 分段控件（推理程度）选中态是淡红底红字，不是整块实红");
ok((function(){ const m = PAGE_HTML.match(/\.fab\{[^}]*\}/); return m && m[0].indexOf('border-radius:var(--r-ctl)') >= 0 && m[0].indexOf('box-shadow:var(--sh-paper)') >= 0; })(),
   "圆润化: FAB 圆角收进 8px 档、阴影用纸面同档柔影");

/* 13 节用完 PD 出题桩就把真身装回去：
   以前漏了这一步，从 13 节往后 callLLM 一直是这个桩，
   后面的用例看着「拦到了请求」，其实拦的是上一节的返回值——18 节的真实网络用例就是这么被蒙过去的。 */
callLLM = realCallPD;

/* ============ 14. review 修复批次：小修 / 安全 / 经验去重 / 导入加固 ============ */

/* 14.1 migrateHistory：快判记录（track:'pd'）不补 legacy- 占位 flowId */
const mhPD = migrateHistory([
  { ts:1, module:"zy.gongwen", grade:{ total:60, scores:{} } },
  { ts:2, track:"pd", form:"fact-select", theme:"养老", correct:1, total:2 }
]);
ok(mhPD.list[0].flowId === "legacy-1" && mhPD.list[1].flowId === undefined,
   "history 迁移: 快判记录（track:'pd'）不补 legacy- 占位 flowId");

/* 14.2 showLoading：传入文本统一转义后再上屏 */
showLoading('<img src=x onerror=alert(1)>养老主题');
ok(el("#docBody").innerHTML.indexOf("<img") < 0 && el("#docBody").innerHTML.indexOf("&lt;img") >= 0,
   "showLoading: 传入文本统一 esc 再拼 innerHTML（堵 genPDRound 主题/模型输出注入）");
showLoading("");

/* 14.3 switchSubject：从快判回当前科目不收链；真切到另一科目才收链 */
state.flows = []; _flowId = null; current = null;
state.settings.subject = "sl"; renderTabs();
const swFlow = ensureFlow("sl.guina", "概括问题", { background:"切科题目材料。", requirements:"r" }, []);
pdActive = true;   // 模拟快判一轮进行中（入口已归首页，这里只验「判别轨中点科目」的收口规则）
switchSubject("sl");
ok(pdActive === false && swFlow.closedAt == null && _flowId === swFlow.id,
   "切科目: 从快判点回当前科目，进行中的申论链不被收口");
switchSubject("zy");
ok(swFlow.closedAt != null && swFlow.step === "done", "切科目: 真正切到另一科目才收链");
state.flows = []; _flowId = null; current = null;

/* 14.4 恢复现场：链的科目与当前抬头不同时，先把 settings.subject 对齐再进入 */
state.settings.subject = "zy"; save(); renderTabs(); renderHeader();
const alFlow = ensureFlow("sl.guina", "概括问题", { background:"对齐题目材料。", requirements:"r" }, []);
_flowId = null; current = null;
renderStart();
el("#btnResume").onclick();
ok(state.settings.subject === "sl" && current && current.module === "sl.guina" && _flowId === alFlow.id,
   "恢复现场: 点击恢复先把 settings.subject 对齐到链的科目，再进入（杜绝张冠李戴）");
state.flows = []; _flowId = null; current = null;

/* 14.5 sanitizePDItems：重复选项去重 + answerKey 按文本重映射 / 越界丢弃 / 缺 context 丢弃 / 不足 2 项丢弃 */
const dedupIt = sanitizePDItems([{ context:"c", stem:"s", options:["甲","乙","甲"], answer:2 }])[0];
ok(dedupIt && dedupIt.options.join("|") === "甲|乙" && dedupIt.answer === 0,
   "判别净化: 重复选项去重，answerKey 按选项文本重映射 (2->0)");
ok(sanitizePDItems([{ context:"c", stem:"s", options:["甲","甲","乙"], answer:0 }])[0].answer === 0,
   "判别净化: answerKey 指向被合并的重复项时仍指向原正确文本");
ok(sanitizePDItems([{ context:"c", stem:"s", options:["甲","乙"], answer:5 }]).length === 0,
   "判别净化: answerKey 越界丢弃整题");
ok(sanitizePDItems([{ context:"", stem:"s", options:["甲","乙"], answer:0 }]).length === 0,
   "判别净化: 缺 context 丢弃整题");
ok(sanitizePDItems([{ context:"c", stem:"s", options:["甲"], answer:0 }]).length === 0,
   "判别净化: 去重后不足 2 个选项丢弃整题");

/* 14.6 sanitizeFlows：非法 step 丢弃（直接调用） */
const sfBad = sanitizeFlows([ { id:"a", step:"bogus", question:{background:"b"} }, { id:"b", step:"read", question:{background:"c"} } ]);
ok(sfBad.length === 1 && sfBad[0].id === "b", "flow 净化: 非法 step 丢弃该项（直接调用）");

/* 14.7 pruneFlows：裁剪次序——有草稿的最旧项永不裁，先裁其后的无草稿已关闭项 */
state.flows = []; _flowId = null;
const pq14 = { background:"裁剪次序题材料。", requirements:"r" };
saveDraft(qSig(pq14), "还没交的草稿");
state.flows.push({ id:"f_draft", subject:"zy", module:"zy.guina", sig:qSig(pq14), question:pq14, keyPoints:[], createdAt:1, closedAt:9, step:"done", attempts:[], selections:[], groups:[] });
for(let i=0;i<25;i++) state.flows.push({ id:"f"+i, subject:"zy", module:"zy.guina", sig:"sig"+i, question:{background:"b"+i}, keyPoints:[], createdAt:2+i, closedAt:9, step:"done", attempts:[], selections:[], groups:[] });
pruneFlows();
ok(state.flows.length === MAX_OPEN_FLOWS && state.flows.some(x=>x.id==="f_draft") && state.flows.some(x=>x.id==="f24") && !state.flows.some(x=>x.id==="f0"),
   "flow 裁剪: 裁剪次序正确——有草稿的最旧项保留，先裁其后的无草稿项 (剩 " + state.flows.length + ")");
clearDraft(qSig(pq14));
state.flows = []; _flowId = null;

/* 14.8 normalizeExpTitle + 归一化判重（措辞不同但语义相同 → 更新不新增） */
ok(normalizeExpTitle("漏写 落款、文号！") === "漏写落款文号",
   "经验去重: normalizeExpTitle 去标点/空白 -> " + normalizeExpTitle("漏写 落款、文号！"));
ok(normalizeExpTitle("Ｌogin ＩＤ") === "loginid", "经验去重: 全角折半角 + 小写");
state.experiences = [];
storeExperiences([{ type:"错因", title:"漏写落款", body:"b1" }], "sl.guina", null, { background:"判重题一。", requirements:"r" });
storeExperiences([{ type:"错因", title:"总是漏写落款和文号", body:"b2" }], "sl.guina", null, { background:"判重题二。", requirements:"r" });
ok(state.experiences.length === 1 && state.experiences[0].body === "b2",
   "经验去重: 措辞不同但语义相同（一方完整包含另一方）→ 更新已有条目不新增");
storeExperiences([{ type:"规则", title:"对策要落到具体主体", body:"b3" }], "sl.guina", null, { background:"判重题三。", requirements:"r" });
ok(state.experiences.length === 2, "经验去重: 语义不同的照常新增");

/* 14.9 distillExperience：prompt 带当前模块已有 titles + 防换措辞指令 */
const realCall14 = callLLM;
let cap14 = null;
callLLM = async (sys, user)=>{ cap14 = { sys, user }; return { experiences: [] }; };
await distillExperience("sl.guina", null, { hits:[], weaknesses:[], comment:"" }, { background:"prompt题。", requirements:"r" });
ok(cap14.user.indexOf('"existingTitles"') >= 0 && cap14.user.indexOf("漏写落款") >= 0,
   "经验去重: prompt 带当前模块已有经验 titles（≤10）");
ok(cap14.sys.indexOf("title 原文") >= 0 && cap14.sys.indexOf("不要换措辞") >= 0,
   "经验去重: prompt 明确「本质相同就返回已有 title 原文，不要换措辞」");
callLLM = realCall14;

/* 14.10 expBlock：注入上限 3 条 */
state.experiences = [1,2,3,4,5].map(i=>({ id:"m"+i, type:"错因", title:"t"+i, body:"b", module:"sl.guina", subject:"sl", ts:i, disabled:false, sourceSig:"s" }));
ok(expBlock("sl.guina").length === 3, "注入: expBlock 上限 3 条");
state.experiences = [];

/* 14.11 importJSON：类型加固 + 危险键过滤 */
globalThis.FileReader = class { readAsText(f){ this.result = f; if(this.onload) this.onload(); } };
const __keyAtImport = state.settings.apiKey;   // 本机已填的 Key（导入不得改动它）
importJSON('{"settings":{"apiKey":"sk-x","__proto__":{"polluted":1}},"profile":{"modules":{"sl.guina":{"dims":{}}},"lastModules":["sl.guina"]},"cache":{"studyCards":{"sl.guina::概括问题":{"title":"卡"}},"notes":{}},"experiences":[{"title":"t","body":"b"},{"bad":1}],"flows":[{"id":"f1","step":"read","question":{"background":"b"}}],"history":[]}');
ok(state.settings.apiKey === __keyAtImport && __keyAtImport !== "" && ({}).polluted === undefined,
   "导入: __proto__ 键被过滤，不污染原型；文件里的 Key 不被采用且本机 Key 原样保留");
ok(state.profile.lastModules[0] === "sl.guina", "导入: profile 合法字段收下");
ok(state.cache.studyCards["sl.guina::概括问题"] && state.cache.studyCards["sl.guina::概括问题"].title === "卡", "导入: cache 合法字段收下且键保留");
ok(state.experiences.length === 1, "导入: experiences 逐条校验，坏条目丢弃");
ok(state.flows.length === 1 && state.flows[0].id === "f1", "导入: flows 走 sanitizeFlows");
importJSON('{"settings":"bad","profile":[1,2],"cache":"x","flows":"y","experiences":"z","modelCache":5,"history":"no"}');
ok(state.settings.provider === "deepseek" && state.settings.apiKey === __keyAtImport, "导入: settings 非对象丢用默认值，不整包失败（本机 Key 不受影响）");
ok(JSON.stringify(state.profile.modules) === "{}" && JSON.stringify(state.profile.lastModules) === "[]", "导入: profile 非对象丢用默认值");
ok(state.cache.studyCards && typeof state.cache.studyCards === "object", "导入: cache 非对象丢用默认值");
ok(Array.isArray(state.experiences) && Array.isArray(state.flows) && Array.isArray(state.history), "导入: experiences/flows/history 非数组丢用默认值");

/* 14.11b 导入时草稿与划线同口径：本机已有的那份不被旧备份覆盖 */
saveDraft("qImpDraft", "本机较新的草稿");
importJSON('{"drafts":{"qImpDraft":{"text":"备份里的旧草稿"}}}');
ok(loadDraft("qImpDraft") === "本机较新的草稿", "导入: 本机已有的草稿不被旧备份覆盖");
clearDraft("qImpDraft");

/* 14.11c 选完文件清空 input.value：同一个文件再选一次仍会触发 change */
const _fakeFile = { files: ["这不是 JSON"], value: "C:\\fakepath\\a.json" };
el("#fileImport").onchange({ target: _fakeFile });
ok(_fakeFile.value === "", "导入: 选完就清空 input.value（同一份备份能连着导第二次）");

/* 14.12 输入防抖：笔记输入即时进内存，persistFlush 立即落盘（失焦/关页兜底） */
saveNote("zy.gongwen", "通知", "防抖笔记");
ok(getNote("zy.gongwen","通知") === "防抖笔记", "输入防抖: 笔记输入即时进内存");
persistFlush();
ok((JSON.parse(localStorage.getItem("gw_state")).cache.notes||{})["zy.gongwen::通知"] === "防抖笔记",
   "输入防抖: persistFlush 立即落盘（失焦/关页兜底）");

/* 15.3 构建标识：唯一来源 app/build.json（打包时由 tools/stamp-build.mjs 写入），读不到就是源码直跑的开发版 */
ok(!!el("#buildNote"), "构建标识: 设置面板底部有承载元素");
ok(el("#buildNote").textContent.indexOf("开发版") >= 0,
   "构建标识: 读不到 build.json 时显示开发版 -> " + el("#buildNote").textContent);
ok(typeof loadBuildNote === "function", "构建标识: 有独立装载函数（init 里调用，失败静默不影响启动）");

/* 15.4 备份文件的 Key 政策（之前这里是个真漏洞：导出整包 state，apiKey 明文跟着备份走） */
const __keyCanary = "sk-canary-绝不能出现在备份里";
const __keyBefore = state.settings.apiKey;
state.settings.apiKey = __keyCanary;
let __blobText = "";
globalThis.Blob = class { constructor(parts){ __blobText = parts.join(""); } };
globalThis.URL.createObjectURL = () => "blob:stub";
exportJSON();
ok(__blobText.length > 0 && __blobText.indexOf(__keyCanary) < 0 && __blobText.indexOf("apiKey") < 0,
   "导出: 备份 JSON 既不携带 Key 值，也不留 apiKey 字段");
ok(state.settings.apiKey === __keyCanary, "导出: 只读操作，不动内存里的本机 Key");
importJSON(JSON.stringify({ settings:{ apiKey:"sk-attacker" }, history:[] }));
ok(state.settings.apiKey === __keyCanary, "导入: 不采用文件里的 Key（别人的备份换不掉你的 Key）");
importJSON(JSON.stringify({ settings:{}, history:[] }));
ok(state.settings.apiKey === __keyCanary, "导入: 文件没带 Key 也不清空本机 Key");
state.settings.apiKey = __keyBefore;

/* 15.5 版本与更新：文案与入口都是纯函数，不需要真壳就能核 */
_view = "start"; banner("");
ok(typeof __updatePush === "function" && typeof updateNoteText === "function" && typeof initUpdateUi === "function",
   "更新: 页面暴露壳状态入口（__updatePush / updateNoteText / initUpdateUi）");
ok(updateNoteText(null).indexOf("正在读取") >= 0, "更新: 状态未到时给占位文案，不报错");
ok(updateNoteText({ supported:false, reason:"dev" }).indexOf("开发版") >= 0, "更新: 开发版不检查更新");
ok(updateNoteText({ supported:false, reason:"portable" }).indexOf("免安装版不自动更新") >= 0,
   "更新: 免安装版明确说明不自动更新（并告诉用户数据不受影响）");
ok(updateNoteText({ supported:true, phase:"up-to-date", currentVersion:"1.0.0" }).indexOf("1.0.0") >= 0, "更新: 已最新时报当前版本");
ok(updateNoteText({ supported:true, phase:"downloading", latestVersion:"1.0.1", progress:{ percent:42, transferred:1048576*3, total:1048576*8 } }).indexOf("42%") >= 0,
   "更新: 下载中显示百分比与进度");
ok(updateNoteText({ supported:true, phase:"downloaded", latestVersion:"1.0.1" }).indexOf("重启并更新") >= 0, "更新: 下载完成给出重启入口");
ok(updateNoteText({ supported:true, phase:"error", error:"ERR_CONNECTION_REFUSED" }).indexOf("不影响使用") >= 0,
   "更新: 失败文案不吓人且说明会自动重试");
__updatePush({ supported:true, phase:"downloaded", latestVersion:"9.9.9", currentVersion:"1.0.0", releasesUrl:"https://example.invalid" });
ok(el("#bannerSlot").innerHTML.indexOf("9.9.9") >= 0, "更新: 下载完成后顶栏提示一次（带版本号）");
ok(el("#updateNote").textContent.indexOf("9.9.9") >= 0, "更新: 设置面板同步显示下载完成状态");
ok(updateInfo && updateInfo.phase === "downloaded", "更新: 壳推来的状态落在 updateInfo 里");
__updatePush(null);
ok(updateInfo && updateInfo.phase === "downloaded", "更新: 非法推送不抛错也不清状态");

/* 15.6 更新：mac 那条链（查/下/换都在壳里）——页面只管把状态说成人话、把入口给对。
   status.autoDownload === false 是分界线：那种构建「点更新它才拉、点重启它才换」。 */
const __macBase = { supported:true, autoDownload:false, currentVersion:"0.0.15", releasesUrl:"https://example.invalid/releases" };
__updatePush(Object.assign({}, __macBase, { phase:"available", latestVersion:"0.0.16" }));
ok(updateNoteText(updateInfo).indexOf("发现新版本 v0.0.16") >= 0 && updateNoteText(updateInfo).indexOf("更新到 v0.0.16") >= 0,
   "更新: 查到新版时说清「点哪个按钮、它自己下」，不是让他自己去网页找");
ok(el("#btnPullUpdate").hidden === false && el("#btnPullUpdate").textContent === "更新到 v0.0.16",
   "更新: 有新版就给「更新到 v0.0.16」按钮（点了壳才开始拉）");
/* 拿不到版本号就不渲染：横幅与按钮上都不许出现「更新到 v」残句 */
__updatePush(Object.assign({}, __macBase, { phase:"available", latestVersion:"" }));
ok(el("#bannerSlot").innerHTML.indexOf("发现新版本") < 0 && el("#btnPullUpdate").hidden === true,
   "更新: 拿不到版本号就不出提示、不亮按钮（不出「更新到 v」残句）");
__updatePush(Object.assign({}, __macBase, { phase:"available", latestVersion:"0.0.16" }));
ok(el("#btnCheckUpdate").hidden === true, "更新: 待下载时不再并排一个「检查更新」");
ok(el("#bannerSlot").innerHTML.indexOf("发现新版本 v0.0.16") >= 0 && el("#bannerSlot").innerHTML.indexOf("bnrUpdate") >= 0,
   "更新: 首页同时出一条小提示，里面直接带「更新」按钮");

__updatePush(Object.assign({}, __macBase, { phase:"downloading", latestVersion:"0.0.16", progress:{ percent:42, transferred:1048576*3, total:1048576*8 } }));
ok(el("#updateNote").textContent.indexOf("42%") >= 0 && el("#updateNote").textContent.indexOf("3MB") >= 0,
   "更新: 下载中报百分比与已下/总量");

__updatePush(Object.assign({}, __macBase, { phase:"downloaded", latestVersion:"0.0.16" }));
ok(el("#updateNote").textContent.indexOf("重启并更新") >= 0 && el("#updateNote").textContent.indexOf("不点它就不会自己换") >= 0,
   "更新: 下好后明确「不点就不会自己换」（不把「已下好」说成「已更新」）");
ok(el("#btnInstallUpdate").hidden === false, "更新: 下好了才有「重启并更新」");
ok(el("#bannerSlot").innerHTML.indexOf("bnrInstall") >= 0, "更新: 首页小提示里也给重启入口");

__updatePush(Object.assign({}, __macBase, { phase:"error", errorStage:"download", latestVersion:"0.0.16", error:"HTTP 404" }));
ok(updateNoteText(updateInfo).indexOf("下载失败：HTTP 404") >= 0 && updateNoteText(updateInfo).indexOf("检查更新失败") < 0,
   "更新: 下载失败与检查失败分开说（走错一步也别让他以为全都坏了）");

__updatePush(Object.assign({}, __macBase, { phase:"error", errorStage:"install", latestVersion:"0.0.16", error:"没有权限替换 /Applications/练习台.app" }));
ok(updateNoteText(updateInfo).indexOf("换包没成") >= 0 && updateNoteText(updateInfo).indexOf("v0.0.15") >= 0,
   "更新: 换包没成时说清「现在用的还是哪一版」");

__updatePush(Object.assign({}, __macBase, { phase:"error", error:"HTTP 403" }));
ok(updateNoteText(updateInfo).indexOf("检查更新失败：HTTP 403") >= 0 && updateNoteText(updateInfo).indexOf("不影响使用") >= 0,
   "更新: 检查失败照实说并说明会重试，不谎报已最新");
ok(updateNoteText(updateInfo).indexOf("已是最新") < 0, "更新: 失败时绝不显示「已是最新」（那会让他以为没事）");

__updatePush(Object.assign({}, __macBase, { phase:"up-to-date" }));
ok(updateNoteText(updateInfo).indexOf("已是最新版本 v0.0.15") >= 0, "更新: 真没有新版才说已最新");
ok(el("#btnPullUpdate").hidden === true && el("#btnCheckUpdate").hidden === false, "更新: 已最新时回到「检查更新」");

/* 壳灌进来的启动提示（端口退让 / 上次换包失败）要能并列渲染出来，而不是只躺在日志里 */
globalThis.window = { __otaStartupNotices: ["<b>上次自动更新没成功：</b>包内版本不符。"], open(){}, addEventListener(){} };
state.settings.apiKey = "sk-test-key";
renderStartNotices();
ok(el("#bannerSlot").innerHTML.indexOf("上次自动更新没成功") >= 0,
   "提示: 壳说的话会出现在首页提示区（换包失败不再只是一行日志）");
delete globalThis.window;

/* 15.7 设置：填完 Key 保存，首页那条「还没填 Key」当场收掉（以前要重启才消失） */
const __baseBefore = state.settings.baseUrl;
const __realFetch = globalThis.fetch;   // 15.7 要让 saveSettings 里的拉模型请求注定失败：先留一份真的，事后还回去
state.settings.apiKey = "";
state.settings.keyNoticeDismissed = false;
renderStartNotices();
ok(el("#bannerSlot").innerHTML.indexOf("填上 API Key 就能练大题与快判") >= 0 && el("#bannerSlot").innerHTML.indexOf("btnKeyNoticeOff") >= 0,
   "提示: 没填 Key 时，首页的欢迎提示如实只讲填 Key（示例轮已下线，不再说「不用 Key 也能练」）");
/* 欢迎条可关：点「关闭」当场收掉这条，之后没 Key 也不再弹；其他提示（小更新/预览窗警告）不受它影响 */
el("#btnKeyNoticeOff").onclick();
ok(state.settings.keyNoticeDismissed === true && el("#bannerSlot").innerHTML.indexOf("填上 API Key 就能练大题与快判") < 0
   && el("#bannerSlot").innerHTML.indexOf("btnKeyNoticeOff") < 0,
   "提示: 欢迎条点「关闭」当场收掉，之后没 Key 也不再弹（其他提示照旧）");
ok(DEFAULT_STATE.settings.keyNoticeDismissed === false,
   "提示: 关闭标记有默认值（老数据经 load 的 settings 合并自动补上 false）");
globalThis.fetch = () => Promise.reject(new Error("net down"));
el("#setKey").value = "sk-test-key";
saveSettings();
ok(el("#bannerSlot").innerHTML.indexOf("填上 API Key 就能开始练") < 0, "提示: 填完 Key 保存后当场收掉，不用重启");
ok(state.settings.apiKey === "sk-test-key", "提示: 保存真的写进了 settings（提示不是靠碰巧消失的）");
ok(state.settings.keyNoticeDismissed === false, "提示: 刚填上 Key 保存后，关闭标记复位（下次没 Key 欢迎条照常出现）");
globalThis.fetch = __realFetch;
state.settings.baseUrl = __baseBefore;

/* ---- 静态 HTML：设置页的 API Key 申请教程（新用户的第一道坎）---- */
ok(PAGE_HTML.includes("还没有 API Key？四步拿到"), "设置页: 无 Key 用户的 API Key 申请教程入口存在");
ok(PAGE_HTML.includes("platform.deepseek.com") && PAGE_HTML.includes("「API keys」"), "设置页: 教程含 DeepSeek 平台地址与创建入口");
ok(PAGE_HTML.indexOf("kh.open = !state.settings.apiKey") >= 0, "设置页: 无 Key 时自动展开教程，有 Key 保持折叠");

/* ---- 使用引导：一条首次引导序列（SPEC 4.4），按屏分组 home→pd→zy→sl，随屏接续，设置可重置 ---- */
ok(Array.isArray(TUT_SEQ) && TUT_SEQ.length > 0 && TUT_SEQ.every(s=> s.scr && s.sel && s.text),
   "使用引导: 每一步都写明在哪一屏、落点元素与说明文字");
ok(["home","zy","sl"].every(k=> TUT_SEQ.some(s=> s.scr === k)) && TUT_SEQ[0].scr === "home",
   "使用引导: 三个屏都有组，home 在最前（打开软件第一屏就是它；快判不进序列，首轮说明在快判页页内）");
const tutGrpFirst = k => TUT_SEQ.find(s=> s.scr === k);
ok(tutGrpFirst("home").sel === "#btnQuick" && TUT_SEQ.every(s=> s.scr !== "pd")
   && tutGrpFirst("zy").sel === "#btnSmart" && tutGrpFirst("sl").sel === "#btnSmart",
   "使用引导: 每组先讲主行动（首页快判按钮 / 科目页红按钮），快判不进引导序列（SPEC 4.2）");
ok(PAGE_HTML.indexOf("tour-hole") >= 0 && PAGE_HTML.indexOf("跳过引导") >= 0, "使用引导: 聚光层与跳过入口存在");
ok(PAGE_HTML.indexOf("重置使用引导") >= 0 && PAGE_HTML.indexOf("btnTutReset") >= 0, "使用引导: 设置里有重置入口");
ok(DEFAULT_STATE.tut && DEFAULT_STATE.tut.seq === 0 && DEFAULT_STATE.tut.done === false && DEFAULT_STATE.tutVersion === 3,
   "使用引导: state.tut 是 { seq, done }（seq=游标，done=序列已完结），tutVersion=3");
ok(migrateTut({ home:true, zy:false, sl:false, pd:false }).done === true
   && migrateTut({ home:false, zy:false, sl:false, pd:false }).done === false
   && migrateTut(undefined).seq === 0 && migrateTut(null).done === false,
   "使用引导: 迁移——旧四标记里看过任何一套 → done:true（老用户不再被弹），全没看过 → 从头播");
ok(openModal.toString().indexOf("tourPause()") >= 0 && closeModals.toString().indexOf("tourResume()") >= 0,
   "使用引导: 弹层打开时引导暂歇、关掉恢复（气泡不叠在弹层之上）");
ok(renderStart.toString().indexOf('_view = "start"') >= 0 && renderModuleLanding.toString().indexOf('_view = "landing"') >= 0
   && renderQuestion.toString().indexOf('_view = "q"') >= 0,
   "使用引导: 记录当前页面形态，重置后能判断能不能就地重播");
ok(PAGE_HTML.indexOf("state.tutVersion = DEFAULT_STATE.tutVersion") >= 0 && PAGE_HTML.indexOf("回到首页或科目页时会重新显示引导") >= 0,
   "使用引导: 重置后当场重播（作答中不打断；科目页现在也会弹，横幅不写窄）");
ok(tourEnd.toString().indexOf("markSeen") >= 0 && PAGE_HTML.indexOf("tourEnd(false)") >= 0,
   "使用引导: 中途被切走不算完结也不推进游标（暂停），下次进入同屏再弹");
ok(tourShow.toString().indexOf("tourPrev") >= 0 && tourShow.toString().indexOf("tour.i--") >= 0,
   "使用引导: 有上一步（组内回退重读）");
ok(maybeTour.toString().indexOf("steps[i0].raw > state.tut.seq") >= 0,
   "使用引导: 跳屏落下的步骤不再回头补弹（游标只进不退）");
ok(renderStart.toString().indexOf("maybeTour(curSubject())") >= 0, "使用引导: 进入综应或申论科目时在综合起始页触发");
ok(renderModuleLanding.toString().indexOf("maybeTour") < 0, "使用引导: 不必先点进具体模块才触发");

/* ---- 陌生用户看得见的那些事：形式的说明不藏着、强项不穿红、备份有出处、提示能直接点到设置 ---- */
ok(PD_FORM_ORDER.every(id=> PD_FORMS[id].desc) && PD_FORMS[PD_MIX].spec.indexOf("form 字段") >= 0,
   "快判引擎: 三类形式的规范与说明保留在 PD_FORMS 数据里（综合轮混着出题仍依赖它们）");
ok(PAGE_HTML.indexOf(".pdtab") < 0 && PAGE_HTML.indexOf('class="tab ') < 0,
   "快判布局: 顶部页签行已撤，单形式入口不再用 .tab 样式");
ok(PAGE_HTML.indexOf(".mrow .mweak.good{color:var(--success);}") >= 0 && PAGE_HTML.indexOf('class="mweak${head? head.cls : ""}"') >= 0,
   "画像: 强项不再与短板共用红色");
ok(PAGE_HTML.indexOf('id="btnExport2"') >= 0 && PAGE_HTML.indexOf('id="btnImport2"') >= 0 && PAGE_HTML.indexOf("换电脑前先「导出备份」") >= 0,
   "设置页: 数据与备份有导出/导入入口与说明");
ok(PAGE_HTML.indexOf('id="bnrOpenSettings"') >= 0 && PAGE_HTML.indexOf("bo.onclick") >= 0,
   "提示横幅: 无 Key 时横幅里能直接点开设置");
ok(PAGE_HTML.indexOf("未配置 API Key") >= 0 && PAGE_HTML.indexOf("点右上角「设置」") < 0,
   "提示横幅: 不再让用户自己去右上角找设置");

/* ---- 文案口径：屏幕上的叫法只留一套，不写内部机制，不复述已写着的字 ---- */
ok(PAGE_HTML.indexOf("AI Key") < 0 && PAGE_HTML.indexOf("这台电脑") < 0, "文案: 统一说「API Key」与「本地」");
ok(PAGE_HTML.indexOf("使用指南") < 0 && PAGE_HTML.indexOf("分步使用引导") < 0, "文案: 统一叫「使用引导」");
ok(PAGE_HTML.indexOf("会挑你最弱的模块") < 0 && PAGE_HTML.indexOf("提交后 AI 按本模块维度评分") < 0,
   "文案: 不写「挑最弱」「按维度评分」这类机制");
ok(PAGE_HTML.indexOf("写得太少了：至少写满一段再交卷") >= 0 && PAGE_HTML.indexOf("～") < 0, "文案: 交卷提示去掉语气词");
ok(TUT_SEQ.every(s=> s.scr !== "pd") && TUT_SEQ.every(s=> s.text.indexOf("题型") < 0),
   "文案: 快判不进引导序列，引导与全部步骤不说「题型」");
ok(PAGE_HTML.indexOf("快判一轮 5 题") < 0 && PAGE_HTML.indexOf('id="pdIntroOk"') < 0 && PAGE_HTML.indexOf('id="pdWhat"') < 0,
   "快判/首轮说明: 随落地页一并撤，页面无残留口径");

/* ---- 在途请求：换页与进快判都要作废在途请求，旧结果不许回来顶掉当前页 ---- */
ok(tabClick.toString().indexOf("reqSeq++") >= 0 && genPDRound.toString().indexOf("++reqSeq") >= 0,
   "在途请求: 换页与快判出题都作废在途请求");
ok(submitAnswer.toString().indexOf("Array.isArray(g.hits)") >= 0, "批改: 采分点不是数组时先夹平再渲染");

/* ---- 计分口径一字不动：hits 形状不对就等同没有采分点，交回维度分折算 ---- */
ok(pointsOf(null) === null && pointsOf({ point:"x" }) === null && pointsOf("x") === null, "计分: hits 非数组交回维度分折算");

/* ---- 入库形状：hits/total 写歪就地归一；缺字段的老记录一字不动 ---- */
const mBad = migrateHistory([{ ts:7, module:"zy.gongwen", subtype:null, answer:"a", grade:{ total:"68分", hits:{ point:"x" } } }]).list;
ok(mBad.length === 1 && Array.isArray(mBad[0].grade.hits) && mBad[0].grade.hits.length === 0 && mBad[0].grade.total === null,
   "入库: hits/total 形状不对就地归一（不留到渲染时炸）");
const mGood = migrateHistory([{ ts:8, module:"zy.gongwen", subtype:null, answer:"a", grade:{ total:60, scores:{}, hits:[{ score:10, awarded:5 }] } }]).list;
ok(mGood[0].grade.total === 60 && mGood[0].grade.hits.length === 1, "入库: 形状正常的记录一字不动");
const mOld = migrateHistory([{ ts:9, module:"zy.gongwen", subtype:null, answer:"a", grade:{ total:60, scores:{} } }]).list;
ok(mOld[0].grade.hits === undefined, "入库: 缺 hits 的老记录不补字段（沿用原有回退口径）");

/* ---- revise 已下线：旧数据停在 revise 的链降级到一稿，不整条丢 ---- */
const sfRev = sanitizeFlows([{ id:"r1", step:"revise", question:{ background:"b" } }]);
ok(sfRev.length === 1 && sfRev[0].step === "draft", "flow 净化: 旧数据里的 revise 链降级到一稿，不整条丢");

/* ---- 16. 闭环回执：错因这次犯没犯，以及快判的辨析点 ---- */

/* 16.1 错因回执：批改里判定「带进去的错因这次犯没犯」，写回经验本身 */
state.history = [];
state.experiences = [
  { id:"c1", type:"错因", title:"漏写落款", body:"b", module:"sl.guina", subject:"sl", ts:3, disabled:false, sourceSig:"s" },
  { id:"c2", type:"错因", title:"要点不全", body:"b", module:"sl.guina", subject:"sl", ts:2, disabled:false, sourceSig:"s" },
  { id:"c3", type:"规则", title:"并列要同层", body:"b", module:"sl.guina", subject:"sl", ts:1, disabled:false, sourceSig:"s" }
];
const chk1 = applyExperienceChecks("sl.guina", { experienceChecks:[
  { title:"漏写落款", status:"fixed" }, { title:"要点不全", status:"again" },
  { title:"不存在的经验", status:"again" }, { title:"并列要同层", status:"na" }
]}, 1700000000000);
const ce1 = state.experiences.find(e=>e.id==="c1"), ce2 = state.experiences.find(e=>e.id==="c2"), ce3 = state.experiences.find(e=>e.id==="c3");
ok(chk1.fixed.length === 1 && chk1.fixed[0] === "漏写落款" && chk1.again.length === 1 && chk1.again[0] === "要点不全",
   "错因回执: 分列已改掉与又犯了");
ok(ce1.cleared === true && ce1.lastCheckAt === 1700000000000 && expState(ce1) === "cleared", "错因回执: fixed -> 已改掉");
ok(ce2.recur === 1 && ce2.cleared === false && expState(ce2) === "recur", "错因回执: again -> 复犯计数");
ok(ce3.lastCheckAt === undefined && ce3.recur === undefined && expState(ce3) === "fresh", "错因回执: na 与对不上的 title 都不改状态");
ok(expStatusText(ce1).indexOf("已改掉") >= 0 && expStatusText(ce2).indexOf("复犯 1 次") >= 0 && expStatusText(ce3) === "还没考到",
   "错因回执: 三种状态各自说法");
applyExperienceChecks("sl.guina", { experienceChecks:[{ title:"要点不全", status:"again" }] }, 1700000001000);
ok(ce2.recur === 2 && ce2.lastCheckAt === 1700000001000, "错因回执: 再犯一次就累加");
applyExperienceChecks("sl.guina", {});
ok(ce2.recur === 2 && expState(ce1) === "cleared", "错因回执: 模型没给结果时什么都不动");

/* 16.2 注入顺序：复犯的优先带上去接着考；已改掉的让位，但过了一周要回来复测 */
const nowT = Date.now(), HOUR = 3600e3, DAY = 86400e3;
state.experiences = [
  { id:"o1", type:"错因", title:"刚核过且已改", body:"b", module:"sl.guina", subject:"sl", ts:5, disabled:false, lastCheckAt: nowT - HOUR, lastClearAt: nowT - HOUR, cleared:true, sourceSig:"s" },
  { id:"o2", type:"错因", title:"复犯的", body:"b", module:"sl.guina", subject:"sl", ts:4, disabled:false, lastCheckAt: nowT - 2*HOUR, cleared:false, recur:2, sourceSig:"s" },
  { id:"o3", type:"错因", title:"没核过的", body:"b", module:"sl.guina", subject:"sl", ts:3, disabled:false, sourceSig:"s" },
  { id:"o4", type:"错因", title:"复犯更多的", body:"b", module:"sl.guina", subject:"sl", ts:2, disabled:false, lastCheckAt: nowT - 3*HOUR, cleared:false, recur:3, sourceSig:"s" },
  { id:"o5", type:"错因", title:"一周前核过的", body:"b", module:"sl.guina", subject:"sl", ts:1, disabled:false, lastCheckAt: nowT - 8*DAY, lastClearAt: nowT - 8*DAY, cleared:true, sourceSig:"s" }
];
const inj2 = activeExperiences("sl.guina").map(e=>e.id);
ok(inj2[0] === "o4" && inj2[1] === "o2", "注入顺序: 复犯次数多的排前面");
ok(inj2.indexOf("o1") < 0, "注入顺序: 刚核过且已改掉的让位（名额留给更该考的）");
ok(expDueRetest({ cleared:true, lastCheckAt: nowT - 8*DAY }, nowT) === true
   && expDueRetest({ cleared:true, lastCheckAt: nowT - HOUR }, nowT) === false
   && expDueRetest({}, nowT) === true && expDueRetest({ cleared:false, lastCheckAt: nowT }, nowT) === true,
   "错因复测: 已改掉的一周后回来复测；没核过、还在犯的都算该考");
state.experiences = [
  { id:"s1", type:"错因", title:"甲", body:"b", module:"sl.guina", subject:"sl", ts:3, disabled:false, lastCheckAt: nowT - HOUR, cleared:true, sourceSig:"s" },
  { id:"s2", type:"错因", title:"乙", body:"b", module:"sl.guina", subject:"sl", ts:2, disabled:false, lastCheckAt: nowT - HOUR, cleared:false, recur:1, sourceSig:"s" },
  { id:"s3", type:"错因", title:"丙", body:"b", module:"sl.guina", subject:"sl", ts:1, disabled:false, sourceSig:"s" }
];
ok(experienceListHtml().indexOf("已改掉 1 条 · 复犯 1 条 · 待验证 1 条") >= 0, "经验列表: 三个状态可数");
ok(experienceListHtml().indexOf("错因状态：") >= 0, "经验列表: 每条带错因状态");

/* 16.3 批改页：回执一行说清这次犯没犯（不报数字，数字在「我的经验」里） */
state.experiences = [{ id:"g1", type:"错因", title:"漏写落款", body:"b", module:"sl.guina", subject:"sl", ts:1, disabled:false, sourceSig:"s" }];
current = { module:"sl.guina", subtype:"概括问题", question:{ background:"b", requirements:"r", score:20 }, cardPeeks:0 };
const gExec = { hits:[{ point:"p", score:20, awarded:20, status:"满分", evidence:"" }], scores:{}, strengths:[], weaknesses:[], comment:"c" };
const chkExec = applyExperienceChecks("sl.guina", { experienceChecks:[{ title:"漏写落款", status:"again" }] }, 1700000002000);
lastGrade = { g:gExec, total:100, expCheck:chkExec };
const execHtml = gradeHtml(gExec, 100);
ok(execHtml.indexOf("记过的错因：") >= 0 && execHtml.indexOf("「漏写落款」又犯了") >= 0, "批改页: 漏写落款又犯了——回执落到页面上");
lastGrade = { g:gExec, total:100, expCheck:null };
ok(gradeHtml(gExec, 100).indexOf("记过的错因：") < 0, "批改页: 没有回执就不摆空行");
lastGrade = null; current = null;

/* 16.3b 推送归出题引擎底层（SPEC 4.6）：批改页没有「智能推送下一题」，nextrow 只剩两颗按钮 */
ok(PAGE_HTML.indexOf("智能推送下一题") < 0 && PAGE_HTML.indexOf("btnNext") < 0,
   "批改页: 「智能推送下一题」按钮下线，页面上没有推送入口（选题是引擎在出题时做的事）");
ok(PAGE_HTML.indexOf('id="btnRetry"') >= 0 && PAGE_HTML.indexOf('id="btnSeeProfile"') >= 0
   && PAGE_HTML.indexOf('id="btnDone"') >= 0,
   "批改页: nextrow 保留「完成」「同模块再来一道」与「看我的画像」");
ok(PAGE_HTML.indexOf('bn2 = $("#btnNext")') < 0,
   "批改页: btnNext 的旧接线一并撤净（两处 wiring 都不再钉它）");

/* 16.4 快判辨析点：自由文本同类归并 → 按类统计 → 下次出题优先考错得多的那几类 */
state.history = [
  { ts:3, track:"pd", form:PD_MIX, theme:"t", correct:1, total:3, items:[
    { form:"fact-select", ok:false, trap:"换主体（村集体出资说成镇政府出资）" },
    { form:"fact-select", ok:false, trap:"把主体换掉" },
    { form:"group-summarize", ok:true, trap:"抹掉限定语（基本解决说成彻底解决）" } ] },
  { ts:2, track:"pd", form:PD_MIX, theme:"t", correct:1, total:2, items:[
    { form:"expression-compare", ok:false, trap:"改数量时限（5 个工作日说成 15 个）" },
    { form:"expression-compare", ok:true, trap:"抹掉限定语" } ] }
];
ok(pdTrapKind("换主体（村集体出资说成镇政府出资）") === "换主体" && pdTrapKind("把主体换掉") === "换主体",
   "快判辨析点: 两种说法的同一类错处归成一类");
ok(pdTrapKind("以偏概全（只取其中一类）") === "改范围" && pdTrapKind("改数量时限（5 个工作日说成 15 个）") === "改数量时限",
   "快判辨析点: 按关键词归到标准类");
ok(pdTrapKind("从没见过的一种说法") === "从没见过的一种说法" && pdTrapKind("") === "", "快判辨析点: 认不出的原样留着，空的不算");
const tst = pdTrapStats();
ok(tst["换主体"] && tst["换主体"].q === 2 && tst["换主体"].c === 0, "快判辨析点: 归并后同类累计到一笔");
ok(tst["改数量时限"].q === 1 && tst["改数量时限"].c === 0 && tst["抹掉限定语"].q === 2 && tst["抹掉限定语"].c === 2,
   "快判辨析点: 答对答错都按题计");
const wt2 = pdWeakTraps(3);
ok(wt2[0] === "换主体" && wt2.indexOf("改数量时限") >= 0, "快判辨析点: 错过就排进来，错得多的靠前");
ok(pdWeakTraps(99).indexOf("抹掉限定语") < 0, "快判辨析点: 全对的类不排进来");
let capWT = null;
const realCallWT = callLLM;
callLLM = async (sys, user)=>{ capWT = { sys, user }; return { items:[{ context:"c", stem:"s", options:["a","b"], answer:0, trap:"换主体", explain:"e" }] }; };
await genPDRound("fact-select", "基层治理");
ok(capWT && capWT.user.indexOf("weakTraps") >= 0 && capWT.user.indexOf("换主体") >= 0,
   "快判辨析点: 小结答应「还会再考」，出题请求里确实带上这几类");
callLLM = realCallWT;
const many21 = [];
for(let i=0;i<25;i++) many21.push({ form:"fact-select", ok:false, trap:"改关系" });
state.history = [{ ts:1, track:"pd", form:PD_MIX, theme:"t", correct:0, total:25, items:many21 }];
ok(pdTrapStats()["改关系"].q === PD_TRAP_WINDOW,
   "快判辨析点: 统计只看最近 " + PD_TRAP_WINDOW + " 题（旧账不背） -> " + pdTrapStats()["改关系"].q);
state.history = []; state.experiences = []; pdRound = null; pdForm = null;

/* 16.5 阅卷校准：分布先验 + 长度不代理质量（模型偏宽松是最大风险）；阅卷固定低温保重测稳定 */
let capG = null;
const realCallG = callLLM;
callLLM = async (sys, user, expectJson, onDelta, opts)=>{ capG = { sys, user, opts }; return { hits:[], scores:{}, strengths:[], weaknesses:[], comment:"" }; };
await grade("sl.guina", "概括问题", { background:"b", requirements:"r", score:20 }, [], "答", null);
ok(capG && capG.sys.indexOf("评分校准") >= 0 && capG.sys.indexOf("中间档") >= 0 && capG.sys.indexOf("堆篇幅") >= 0,
   "阅卷: 分布校准与长度不加分写进系统提示");
ok(capG.opts && capG.opts.temp === GRADE_TEMP && GRADE_TEMP <= 0.3, "阅卷: 固定低温（同文重测要稳）");
callLLM = realCallG;

/* ---- 17. 错因标签：把每次失分归到有限几类，统计与出题共用同一份 ---- */
ok(GRADE_TAG_KEYS.length === 6 && GRADE_TAG_KEYS.indexOf("漏点") >= 0 && GRADE_TAG_KEYS.indexOf("材料") >= 0,
   "错因标签: 固定六类，全在一张表里");
ok(gradeTagOf({ kind:"漏点" }) === "漏点" && gradeTagOf({ kind:"没见过的类" }) === "" && gradeTagOf({}) === ""
   && gradeTagOf({ kind:"  格式  " }) === "格式",
   "错因标签: 只认闭集里的一类，认不出的当没给（自由文本会把统计摊平）");

/* 17.1 统计：只数没拿满分的子项；按模块分开；窗口只看最近 20 题 */
state.history = [
  { ts:3, module:"sl.guina", hits:[ { point:"a", score:5, awarded:5, kind:"-" }, { point:"b", score:5, awarded:0, kind:"漏点" } ] },
  { ts:2, module:"sl.guina", hits:[ { point:"c", score:5, awarded:2.5, kind:"表达" }, { point:"d", score:5, awarded:5, kind:"漏点" } ] },
  { ts:1, track:"pd", form:PD_MIX, correct:1, total:2, items:[] }
];
const gts17 = gradeTagStats("sl.guina");
ok(gts17["漏点"] && gts17["漏点"].n === 1 && gts17["表达"] && gts17["表达"].n === 1,
   "错因统计: 满分不算错因，半分与零分都算");
ok(weakGradeTags("sl.guina", 3).length === 2 && Object.keys(gradeTagStats("zy.gongwen")).length === 0
   && Object.keys(gradeTagStats()).length === 2,
   "错因统计: 按模块分开算，不传模块就全局算");
const manyTags = [];
for(let i=0;i<25;i++) manyTags.push({ ts:i, module:"sl.guina", hits:[ { point:"p", score:5, awarded:0, kind:(i<GRADE_TAG_WINDOW? "漏点" : "材料") } ] });
state.history = manyTags;   // 新在前：前 20 条是「漏点」，更早的旧账是「材料」
ok(gradeTagStats("sl.guina")["漏点"].n === GRADE_TAG_WINDOW && !gradeTagStats("sl.guina")["材料"],
   "错因统计: 只看最近 " + GRADE_TAG_WINDOW + " 题（旧账不背）");

/* 17.2 出题带着它：画像里说「常错类型」，出题就得真按这几类出 */
state.history = [ { ts:1, module:"sl.guina", hits:[ { point:"p", score:5, awarded:0, kind:"漏点" } ] } ];
let capTagG = null;
const realCallTagG = callLLM;
callLLM = async (sys, user)=>{ capTagG = { sys, user }; return { question:{ background:"b", requirements:"r", score:20 }, keyPoints:[] }; };
await gen("sl.guina", null, null, false);
ok(capTagG && capTagG.user.indexOf("weakTags") >= 0 && capTagG.user.indexOf("漏点") >= 0,
   "错因标签: 出题请求带上最常丢分的几类");
state.history = [];
await gen("sl.guina", null, null, false);
ok(capTagG && capTagG.user.indexOf("weakTags") < 0, "错因标签: 没统计出任何一类时不摆空字段");
callLLM = realCallTagG;

/* 17.3 阅卷要给 kind，且明说它不进计分 */
let capKindG = null;
const realCallKindG = callLLM;
callLLM = async (sys, user)=>{ capKindG = { sys, user }; return { hits:[], scores:{}, strengths:[], weaknesses:[], comment:"" }; };
await grade("sl.guina", "概括问题", { background:"b", requirements:"r", score:20 }, [], "答", null);
ok(capKindG && capKindG.sys.indexOf("kind") >= 0 && capKindG.sys.indexOf("漏点") >= 0 && capKindG.sys.indexOf("不参与计分") >= 0,
   "错因标签: 阅卷逐条给 kind，同时封死「拿它改分」");
callLLM = realCallKindG;

/* 17.4 页面：丢分处贴类型，满分项不贴；画像看得到「常错类型」 */
current = { module:"sl.guina", subtype:"概括问题", question:{ background:"b", requirements:"r", score:20 }, cardPeeks:0 };
state.history = [ { ts:1, module:"sl.guina", subtype:"概括问题", grade:{ total:50, scores:{} }, hits:[
  { point:"落款", score:5, awarded:0, kind:"格式", evidence:"【缺：落款】" },
  { point:"做法", score:5, awarded:5, kind:"-", evidence:"" } ] } ];
const gTag = { hits: state.history[0].hits, scores:{}, strengths:[], weaknesses:[], comment:"c" };
lastGrade = { g:gTag, total:50, expCheck:null };
// 批改页不再单独列丢分处（主体换成逐句批注的答卷），错因类型只在画像的「常错类型」里体现
const tagHtml2 = gradeHtml(gTag, 50);
ok(tagHtml2.indexOf("kindtag") < 0 && tagHtml2.indexOf("漏掉的采分点") < 0,
   "错因标签: 批改页不单列错因（kind 只在画像的「常错类型」里统计）");
ok(gradeTagOf({kind:"格式"}) === "格式" && gradeTagOf({kind:"-"}) === "" && gradeTagOf({}) === "",
   "错因标签: 归类函数照旧（kind 在词表内才认，画像按它统计）");
lastGrade = null;
profGo("mod", "sl.guina");
ok(el("#profileBody").innerHTML.indexOf("常错类型：格式 1 处") >= 0,
   "错因标签: 画像里看得到常错类型（在模块页里）");
current = null; state.history = [];

/* 17.5 经验继承标签：提炼时归一次类，之后一直跟着这条经验走 */
state.experiences = [];
storeExperiences([{ type:"错因", kind:"格式", title:"漏写落款", body:"b" }], "sl.guina", "公文", { background:"b", requirements:"r" });
ok(state.experiences.length === 1 && state.experiences[0].kind === "格式", "错因标签: 经验继承类型");
ok(experienceListHtml().indexOf("错因类型：格式") >= 0, "错因标签: 经验展开里看得到类型");
storeExperiences([{ type:"错因", kind:"", title:"漏写落款", body:"b2" }], "sl.guina", "公文", { background:"b", requirements:"r" });
ok(state.experiences.length === 1 && state.experiences[0].kind === "格式" && state.experiences[0].body === "b2",
   "错因标签: 这次没给类型时不把已有的冲掉（正文照旧更新）");
storeExperiences([{ type:"规则", kind:"漏点", title:"并列要同层", body:"b" }], "sl.guina", "公文", { background:"b", requirements:"r" });
ok(state.experiences.find(e=>e.title === "并列要同层").kind === "",
   "错因标签: 规则类经验不分错因类型（入库这一层就卡住）");
state.experiences = [];

/* ---- 18. 网络抖动与分差口径：传输层失败重发一次；不给模型写兑现不了的分差承诺 ---- */

/* 18.1 传输层失败：同一档静默重发一次就成，不让一次练习作废 */
const realFetch18 = globalThis.fetch;
state.settings.apiKey = "sk-test"; state.settings.model = "m-chat"; state.settings.baseUrl = "https://x/v1";
state.modelCaps = {};
let calls18 = 0;
globalThis.fetch = () => {
  calls18++;
  if(calls18 === 1) return Promise.reject(new TypeError("fetch failed"));
  return mockRes({ json: async()=>({ choices:[{ message:{ content:'{"a":1}' } }] }) });
};
let okNet18 = null, err18 = null;
try{ okNet18 = await callLLM("sys", "user", true); }catch(e){ err18 = e; }
ok(calls18 === 2 && okNet18 && okNet18.a === 1,
   "网络抖动: 传输失败后静默重发一次就成功（第 1 次炸、第 2 次成） -> calls=" + calls18 + " res=" + JSON.stringify(okNet18)
   + " err=" + (err18 ? (err18.code || err18.status || err18.message || String(err18)) : "无"));

/* 18.2 一直抖：重发一次就认输，不无限重试（阶梯也不能被重发绕过） */
let calls18b = 0;
globalThis.fetch = () => { calls18b++; return Promise.reject(new TypeError("fetch failed")); };
let threwNet = null;
try{ await callLLM("sys", "user", true); }catch(e){ threwNet = e; }
ok(calls18b === 2 && threwNet && String(threwNet.message).indexOf("fetch failed") >= 0,
   "网络抖动: 一直失败就重发一次后认输 -> 实际发了 " + calls18b + " 次");

/* 18.3 HTTP 错误不重发：401 是事实（Key 不对），重发只会再花一次钱 */
let calls18c = 0;
globalThis.fetch = () => { calls18c++; return mockRes({ ok:false, status:401, text: async()=>"unauthorized" }); };
let threwHttp = null;
try{ await callLLM("sys", "user", true); }catch(e){ threwHttp = e; }
ok(calls18c === 1 && threwHttp && threwHttp.status === 401, "网络抖动: 401 不重发（HTTP 错误走另一条路）");
globalThis.fetch = realFetch18;

/* 18.4 输出坏了（content 在但解不出 JSON）也重发一次：真机连撞两次的那种坏法 */
let calls18d = 0;
globalThis.fetch = () => {
  calls18d++;
  const body = calls18d === 1 ? "这不是 JSON" : '{"a":2}';
  return mockRes({ json: async()=>({ choices:[{ message:{ content:body } }] }) });
};
let okJson18 = null, errJson18 = null;
try{ okJson18 = await callLLM("sys", "user", true); }catch(e){ errJson18 = e; }
ok(calls18d === 2 && okJson18 && okJson18.a === 2,
   "网络抖动: 吐坏 JSON 也重发一次（重发成则正常返回） -> calls=" + calls18d + " res=" + JSON.stringify(okJson18));

/* 18.5 一直吐坏：重发两次就认输，不能无限重发 */
let calls18e = 0;
globalThis.fetch = () => { calls18e++; return mockRes({ json: async()=>({ choices:[{ message:{ content:"坏" } }] }) }); };
let threwJson = null;
try{ await callLLM("sys", "user", true); }catch(e){ threwJson = e; }
ok(calls18e === 3 && threwJson && threwJson.code === "JSON",
   "网络抖动: 一直吐坏 JSON 就重发两次后报格式异常 -> 发了 " + calls18e + " 次");

/* 18.6 一直空输出：也重发两次，报的是 EMPTY（不是笼统的「格式异常」） */
let calls18f = 0;
globalThis.fetch = () => { calls18f++; return mockRes({ json: async()=>({ choices:[{ message:{ content:'' }, finish_reason:"stop" }] }) }); };
let threwEmpty = null;
try{ await callLLM("sys", "user", true); }catch(e){ threwEmpty = e; }
ok(calls18f === 3 && threwEmpty && threwEmpty.code === "EMPTY",
   "网络抖动: 一直空输出就重发两次后报 EMPTY -> 发了 " + calls18f + " 次 code=" + (threwEmpty && threwEmpty.code));
handleErr({ code:"EMPTY" }, true);
ok(el("#bannerSlot").innerHTML.indexOf("答案还在") >= 0, "网络抖动: 空输出的提示告诉用户答案没丢、再点一次就行");

/* 18.7 空输出 + finish=length（额度被思考吃光）：重发时动态翻倍额度（16384 → 32768），不是原样再问一遍 */
let calls18g = 0, bodies18g = [];
globalThis.fetch = (u, opt) => {
  calls18g++; bodies18g.push(JSON.parse(opt.body));
  const ok = calls18g >= 2;
  return mockRes({ json: async()=>({ choices:[{ message:{ content: ok? '{"a":3}' : '' }, finish_reason: ok? "stop" : "length" }] }) });
};
let okEmpty18 = null;
try{ okEmpty18 = await callLLM("sys", "user", true); }catch(e){ okEmpty18 = e; }
ok(calls18g === 2 && okEmpty18 && okEmpty18.a === 3,
   "网络抖动: 空输出重发一次就好 -> calls=" + calls18g + " res=" + JSON.stringify(okEmpty18));
ok(bodies18g[0].max_tokens === MAX_OUT_TOKENS && bodies18g[1].max_tokens === MAX_OUT_TOKENS * 2,
   "网络抖动: finish=length 时第二次重发把额度翻倍（" + bodies18g[0].max_tokens + " → " + bodies18g[1].max_tokens + "）");

/* 18.8 同样的坏法一直重：额度翻两下就到顶，不无限翻；封顶值就是 MAX_OUT_TOKENS_HARD */
let calls18h = 0, caps18h = [];
globalThis.fetch = (u, opt) => {
  calls18h++; caps18h.push(JSON.parse(opt.body).max_tokens);
  return mockRes({ json: async()=>({ choices:[{ message:{ content:'' }, finish_reason:"length" }] }) });
};
let threw18h = null;
try{ await callLLM("sys", "user", true); }catch(e){ threw18h = e; }
ok(calls18h === 3 && threw18h && threw18h.code === "EMPTY" && caps18h.join("/") === [MAX_OUT_TOKENS, MAX_OUT_TOKENS*2, MAX_OUT_TOKENS*4].join("/"),
   "网络抖动: 一直撞上限就重发两次、额度逐次翻倍（" + caps18h.join(" → ") + "），仍失败报 EMPTY");

globalThis.fetch = realFetch18;

/* 18.6 口径：prompt 里不许再有「分差控制在±3」这种模型兑现不了的数字承诺 */
let capSys18 = null;
const realCall18 = callLLM;
callLLM = async (sys)=>{ capSys18 = sys; return { hits:[], scores:{}, strengths:[], weaknesses:[], comment:"" }; };
await grade("sl.guina", "概括问题", { background:"b", requirements:"r", score:20 }, [], "答", null);
ok(capSys18.indexOf("±3") < 0 && capSys18.indexOf("分差") < 0,
   "口径: prompt 里不再写「分差控制在±3」——它做不到，写进去只是自欺");
ok(capSys18.indexOf("半分") >= 0 && capSys18.indexOf("evidence") >= 0,
   "口径: 改成要求「判半分要写得出依据」，治的正是那次 0↔半 的摆动");
callLLM = realCall18;

/* ---- 19. 作答限时：从「开始作答」起算（剩余 / 超时 / 用时进记录与批改页） ---- */
const dtHtml = ()=> el("#docBody").innerHTML;
state.history = [];
state.settings.timeLimit = 0;
localStorage.clear();
current = { module:"sl.guina", subtype:"概括问题", question:{ background:"材".repeat(120), requirements:"不超过250字。" }, keyPoints:[], cardPeeks:0 };
renderQuestion();
activeFlow().cardSeen = true;   // 这一段量的是限时，不重复走链前的学习卡
flowGoStep("read");
ok(dtHtml().indexOf('id="inpLimit"') >= 0 && dtHtml().indexOf('placeholder="不限时"') >= 0 && dtHtml().indexOf('value=""') >= 0,
   "限时: 读材料步就有控件（时钟从开始作答起算），默认留空 = 不限时");
ok(el("#timeLeft").textContent === "", "限时: 不限时不显示任何时间");

/* 19.2 填了就起算：锚点落在链上，切步不重置（读材料那几行也算在里面） */
el("#inpLimit").value = "30"; el("#inpLimit").onchange();
ok(curLimitMin() === 30 && curLimitFrom() > 0, "限时: 填 30 分钟后起算");
const tlAnchor = curLimitFrom();
flowGoStep("draft");
ok(curLimitFrom() === tlAnchor && activeFlow().limitFrom === tlAnchor,
   "限时: 读材料 → 一稿 用的是同一个时钟（切步不重置）");
ok(activeFlow().limitMin === 30, "限时: 时长也在链上（跨步与刷新都不丢）");
ok(state.settings.timeLimit === 30, "限时: 选择被记住，下一题按同样时长起");
ok(/^剩余 (30:0\d|29:5\d)$/.test(el("#timeLeft").textContent), "限时: 立刻显示剩余 -> " + el("#timeLeft").textContent);

/* 19.2b 时长不分档：写多少分钟就是多少；空 / 0 / 乱填 = 不限时，小数取整，超上限按上限 */
el("#inpLimit").value = "45"; el("#inpLimit").onchange();
ok(curLimitMin() === 45 && curLimitFrom() === tlAnchor, "限时: 改时长沿用同一起算点（从开始作答起算）");
el("#inpLimit").value = "12.7"; el("#inpLimit").onchange();
ok(curLimitMin() === 13 && el("#inpLimit").value === "13", "限时: 小数取整并回写进框 -> " + el("#inpLimit").value);
el("#inpLimit").value = "9999"; el("#inpLimit").onchange();
ok(curLimitMin() === 600 && el("#inpLimit").value === "600", "限时: 手滑写太大按上限收（要真不限时就留空）");
el("#inpLimit").value = "abc"; el("#inpLimit").onchange();
ok(curLimitMin() === 0 && el("#inpLimit").value === "" && el("#timeLeft").textContent === "",
   "限时: 填不出数的内容按不限时（不让框里留着看不懂的字）");
el("#inpLimit").value = ""; el("#inpLimit").onchange();
ok(curLimitMin() === 0 && curLimitFrom() === 0 && state.settings.timeLimit === 0, "限时: 清空 = 不限时，时钟跟着停");
el("#inpLimit").value = "30"; el("#inpLimit").onchange();
ok(curLimitMin() === 30 && curLimitFrom() > 0, "限时: 重新填值即重新起算");

/* 19.3 最后 5 分钟转焦橙；超时只报一声，不自动交卷 */
setLimitState(30, Date.now() - 25*60*1000);
paintTimeLeft(el("#timeLeft"));
ok(el("#timeLeft").className.indexOf("warn") >= 0 && el("#timeLeft").textContent.indexOf("剩余 5:0") === 0,
   "限时: 剩最后 5 分钟转焦橙 -> " + el("#timeLeft").textContent);
el("#answer").value = "写到一半的内容，超时也不该被动。";
el("#bannerSlot").innerHTML = "";
setLimitState(30, Date.now() - 31*60*1000);
paintTimeLeft(el("#timeLeft"));
ok(el("#timeLeft").textContent.indexOf("已超时 1:0") === 0 && el("#bannerSlot").innerHTML.indexOf("时间到") >= 0,
   "限时: 超时后报「已超时」并提示一声（不自动交卷）");
ok(el("#answer").value.indexOf("写到一半") >= 0, "限时: 超时不打断作答（已写的内容不动）");

/* 19.4 交卷：用时进记录，批改页报用时与超时；交卷即停表 */
el("#answer").value = "这是一段超过二十个字的作答内容，用来验证限时记录的用时与超时口径。";
el("#btnSubmit").disabled = false;   // 桩不会重渲按钮，前面用例交过卷后这个标志会留着
const realCallTL = callLLM;
callLLM = async ()=>({ hits:[{ point:"p", score:20, awarded:16, status:"满分", evidence:"e" }], scores:{}, strengths:[], weaknesses:[], comment:"x" });
await submitAnswer();
callLLM = realCallTL;
const recTL = state.history[0];
ok(recTL.timeLimit === 30 && recTL.usedSec >= 31*60 && recTL.usedSec <= 31*60 + 5,
   "限时: 记录存下限时与用时 -> " + JSON.stringify({ limit: recTL.timeLimit, used: recTL.usedSec }));
ok(curLimitFrom() === 0, "限时: 交卷即停表（再进一稿是下一次尝试，重新起算）");
ok(dtHtml().indexOf("本题限时 30 分钟 · 用时 31 分") >= 0 && dtHtml().indexOf("（超时 1 分") >= 0,
   "限时: 批改页报出用时与超时");

/* 19.5 不限时：记录不带字段，批改页不报用时；综应A 与申论共用同一处控件 */
state.settings.timeLimit = 0;
current = { module:"zy.guina", subtype:"概括做法", question:{ background:"材".repeat(120), requirements:"不超过300字。" }, keyPoints:[], cardPeeks:0, phase:"answer" };
renderZyPage();
ok(dtHtml().indexOf('class="sec-title">题目</div>') >= 0 && dtHtml().indexOf("作答要求：") >= 0,
   "作答页: 「换一题」与题头同行（不独占一行，作答要求不被顶低一格）");
ok(dtHtml().indexOf("作答要求：") < 0 || dtHtml().indexOf("作答要求：") < dtHtml().indexOf("背景材料"),
   "作答页: 题面在材料之前（先看要求再看材料）");
ok(dtHtml().indexOf('id="inpLimit"') >= 0 && dtHtml().indexOf('value=""') >= 0,
   "限时: 综应A 作答页也有控件（与申论共用同一处渲染）");
el("#answer").value = "综应A 的一段作答内容，用来验证不限时的时候什么也不报。";
el("#btnSubmit").disabled = false;
callLLM = async ()=>({ hits:[{ point:"p", score:20, awarded:20, status:"满分", evidence:"e" }], scores:{}, strengths:[], weaknesses:[], comment:"x" });
await submitAnswer();
callLLM = realCallTL;
ok(state.history[0].timeLimit === undefined && state.history[0].usedSec === undefined, "限时: 不限时不写限时字段");
ok(dtHtml().indexOf("本题限时") < 0, "限时: 不限时批改页不报用时");

/* 19.6 记录表：用时单独一列，超时的行把超了多少一并写出来 */
profGo("hist");
ok(el("#profileBody").innerHTML.indexOf('<th class="num">用时</th>') >= 0, "记录表: 有「用时」列");
ok(el("#profileBody").innerHTML.indexOf("超 1:0") >= 0,
   "记录表: 超时的行写出超了多少 -> " + ((el("#profileBody").innerHTML.match(/[\d:]+ <small>超 [\d:]+/)||["(没找到)"])[0]));
ok(el("#profileBody").innerHTML.indexOf('<td class="num">—</td>') >= 0, "记录表: 没计时的记录用时留「—」，不臆造 0");
state.history.unshift({ ts: Date.now(), module:"zy.guina", subtype:"概括做法", grade:{ total:70 }, timeLimit:45, usedSec:1680 });
profGo("hist");
ok(el("#profileBody").innerHTML.indexOf('<td class="num dur">28:00</td>') >= 0, "记录表: 没超时就只写用时（不写「超 0:00」）");

/* 19.7 画像分两级：一级只列入口行，明细在二级（入口少字，点进去再密） */
state.history = [{ ts: Date.now(), module:"zy.gongwen", subtype:"通知", grade:{ total:70, scores: scoresFor("zy.gongwen", 14) } }];
profBack();
const pRoot2 = el("#profileBody").innerHTML;
ok(["mod:zy.gongwen","mod:sl.guina","pd","exp","hist"].every(k=> pRoot2.indexOf(`data-prof="${k}"`) >= 0),
   "画像: 一级每行都是可点的入口行（模块 / 快判 / 经验 / 记录）");
ok(pRoot2.indexOf("barline") < 0 && pRoot2.indexOf('class="hist"') < 0 && pRoot2.indexOf("expline") < 0,
   "画像: 一级不铺维度条 / 记录表 / 经验列表（那些都在二级）");
profGo("mod", "zy.gongwen");
const pMod = el("#profileBody").innerHTML;
ok(pMod.indexOf("barline") >= 0 && pMod.indexOf('id="profBack"') >= 0, "画像: 点进模块才有维度条，并给一个返回");
profGo("hist");
ok(el("#profileBody").innerHTML.indexOf('id="profBack"') >= 0 && el("#profileBody").innerHTML.indexOf('class="hist"') >= 0,
   "画像: 记录在二级页，带返回");
profBack();
ok(el("#profileBody").innerHTML.indexOf('data-prof="hist"') >= 0, "画像: 点返回回到一级");
state.history = [];
state.settings.timeLimit = 0;

/* 19.8 没填 Key 时不许先演「正在出题」（2026-10-08 复查发现的会说谎）
   现场：点「练一道综应大题」→ 先出「AI 正在为「公文写作 · 通报」准备学习卡与仿真题…」→ 一秒后才报错，
   人还被从首页拽进了综应A。现在三条出题路（首页大题 / 科目页红按钮 / 模块落地页）都在加载态之前过 entryBlocked。 */
const _lqSrc = loadQuestion.toString();
ok(_lqSrc.indexOf("entryBlocked()") >= 0 && _lqSrc.indexOf("entryBlocked()") < _lqSrc.indexOf("showLoading"),
   "没 Key 不进加载态: 出题的兜底口先判 entryBlocked，再 showLoading");
ok(startSmart.toString().indexOf("entryBlocked()") >= 0 && startSubjectTask.toString().indexOf("entryBlocked()") >= 0,
   "没 Key 不进加载态: 首页大题与科目页红按钮先判，不切科目也不点灯");
ok(startSubjectTask.toString().indexOf("entryBlocked()") < startSubjectTask.toString().indexOf("pdActive = false"),
   "没 Key 不进加载态: 先判再动状态（不然人被挪到科目页，当前抬头还被换掉）");
const _eb = entryBlocked.toString();
ok(_eb.indexOf("canStart()") >= 0 && _eb.indexOf("OPEN_SETTINGS_BTN") >= 0 && _eb.indexOf("banner(") >= 0
   && canStart.toString().indexOf("s.apiKey && s.model") >= 0,
   "没 Key 不进加载态: 提示里带「打开设置」的去路，且模型没选也拦");
ok(renderPDSummary.toString().indexOf("本轮小结 · ") < 0,
   "快判小结: 纸面不再把形式名写第二遍（抬头已报「快判 · 综合快判」）");

/* 19.9 画像/快判空态：没练过就照直说（示例轮回声已随示例题下线一起删掉） */
const _histKeep = state.history.slice();
state.history = [];
pdRound = null;
ok(profilePdHtml().indexOf("还没练过快判") >= 0, "画像/快判: 没练过就写「还没练过快判」");
state.history = _histKeep;

/* 19.10 顶栏与纸面间距：纸面与真实顶栏始终间隔 24px（第二行已撤，不用任何空白补位）。 */
ok(renderTabs.toString().indexOf("gap-modbar") < 0 && PAGE_HTML.indexOf(".wrap.gap-modbar") < 0
   && /\.wrap\{[^}]*margin:calc\(24px \* var\(--paper-scale\)\) auto/.test(PAGE_HTML),
   "顶栏: 不用额外空白补题型入口行高度，纸面统一距真实顶栏 24px（随纸面比例）");
ok(PAGE_HTML.indexOf("--h-modbar") < 0, "顶栏: 题型行高度变量已随第二行撤掉");
/* 首页文号跟着抬头走：首页不属于任何科目，落款不能挂某个科目的前缀 */
renderHome();
const homeNo = el("#docNo").textContent;
ok(homeNo.indexOf("练习台〔") === 0, "首页文号: 首页写「练习台〔年〕第 N 号」（" + homeNo + "）");
/* 19.12 文号跟抬头一一对应（申论轨写「申论」、快判轨写「快判」）——
   原先申论轨抬头写「申论」、落款却挂设置里的「综应练」，两项对不上。
   前缀能从头推出来，设置里的「文号前缀」就是死开关，已撤掉（界面不留不起作用的控件）。 */
function noPrefixOf(track){
  const before = _view, beforePD = pdActive, beforeSubj = state.settings.subject;
  if(track === "pd"){ pdActive = true; _view = "pd"; }
  else { pdActive = false; _view = "start"; state.settings.subject = track; }
  renderHeader();
  const t = el("#docNo").textContent;
  _view = before; pdActive = beforePD; state.settings.subject = beforeSubj;
  return t;
}
const noZy = noPrefixOf("zy"), noSl = noPrefixOf("sl"), noPd = noPrefixOf("pd");
ok(noZy.indexOf("综应A〔") === 0 && noSl.indexOf("申论〔") === 0 && noPd.indexOf("快判〔") === 0,
   "文号: 综应轨写「综应A」、申论轨写「申论」、快判轨写「快判」，跟抬头第一个词一致（" + [noZy, noSl, noPd].join(" / ") + "）");
ok(PAGE_HTML.indexOf(">文号前缀</label>") < 0 && PAGE_HTML.indexOf('id="setNo"') < 0
   && !("noPrefix" in state.settings),
   "设置: 「文号前缀」这个死开关已撤掉（文号前缀由抬头推出来，留着就是个不起作用的控件）");

/* 19.11 同一家族的第二轮：还有两处在「先演再报错」（2026-10-08 再复查）
   ① 有 Key 但没选模型时，点快判（综合或单形式）会先演「AI 正在出「综合快判」快判题…」，
      一秒后才弹「还没选定模型」；提交阅卷也一样先把按钮按成「阅卷中…」。
   ② 出题等待页第二行写死「长文阅卷通常 10-60 秒」——此刻在等出题，屏幕上却在说阅卷。
   ③ 没填 Key 的人看到的第一套引导（科目页）说「不选模块也可以，直接点这里开始」，
      照做就被「出题和阅卷都要用 API Key」拦下来：引导在承诺做不到的事。 */
const _spd = startPDRound.toString();
ok(_spd.indexOf("entryBlocked()") >= 0 && _spd.indexOf("entryBlocked()") < _spd.indexOf("genPDRound("),
   "没 Key 不进加载态: 快判出题也要先判（上一轮只补了大题那条路，快判这条漏了）");
const _sa = submitAnswer.toString();
ok(_sa.indexOf("entryBlocked()") >= 0 && _sa.indexOf("entryBlocked()") < _sa.indexOf('btn.textContent="阅卷中'),
   "没 Key 不进加载态: 提交阅卷先判，别先把按钮按成「阅卷中…」再报错");
// 真渲染一遍等待页：出题页不能说阅卷的话（用行为验，不看源码里的注释）
showLoading("AI 正在为「归纳概括」准备学习卡与仿真题…");
const _load = el("#docBody").innerHTML;
ok(_load.indexOf("长文阅卷通常") < 0 && _load.indexOf("AI 出题通常") >= 0,
   "出题等待页: 不再说「长文阅卷通常 10-60 秒」（那是阅卷的话，出题页说它是另一件事）");
showLoading("慢的调用", "这轮可能要一分钟。");
ok(el("#docBody").innerHTML.indexOf("这轮可能要一分钟。") >= 0,
   "出题等待页: 时间预期可以按场景给（第二行是参数，不是写死的）");
// 引导：有 Key 讲「点这里开始」，没 Key 讲「先填 Key」——两套话都得跟当时真能做到的事对上
state.settings.apiKey = "";
const tutNoKeySteps = visibleSteps();
const tutZyNoKey = tutNoKeySteps.find(s=> s.scr === "zy");
ok(tutZyNoKey.sel === "#btnSetup" && tutZyNoKey.text.indexOf("API Key") >= 0
   && tutNoKeySteps.every(s=> s.scr !== "zy" || s.text.indexOf("直接点这里开始") < 0),
   "引导/无 Key: 科目页第一步指纸面上那颗「先填 API Key」（他此刻真该点的那颗），不承诺「点了就能开始」");
ok(tutNoKeySteps.every(s=> !TUT_SEQ[s.raw].onlyKey) && tutNoKeySteps.length === TUT_SEQ.length - 2
   && tutNoKeySteps.every(s=> !TUT_SEQ[s.raw].nk || s.text.indexOf("API Key") >= 0),
   "引导/无 Key: onlyKey 的步整步跳过（科目页末尾讲 Key 的那步不再重复），nk 变体的文本讲 Key");
const tutHomeNoKey = tutNoKeySteps.filter(s=> s.scr === "home");
ok(tutHomeNoKey.length === 3 && tutHomeNoKey[0].sel === "#btnSetup"
   && tutHomeNoKey[0].text.indexOf("API Key") >= 0,
   "引导/无 Key: home 组 3 步，第一步指那颗「先填 API Key」，如实讲填 Key");
ok(tutNoKeySteps.every(s=> s.text.indexOf("不填 Key 也能练") < 0),
   "引导/无 Key: 不再说「不填 Key 也能练」（快判出题也要 Key 了）");
ok(tutNoKeySteps.every(s=> s.scr !== "pd" || s.text.indexOf("示例") < 0)
   && TUT_SEQ.every(s=> s.text.indexOf("示例题") < 0 && (!s.nk || s.nk.text.indexOf("示例题") < 0)),
   "引导: 快判页与全部引导步骤都不再有示例题的口径");
state.settings.apiKey = "sk-demo0demo0demo0demo0demo0demo0";   // gate-allow: 演示用假 Key，不是真凭据
const tutKeySteps = visibleSteps();
ok(tutKeySteps.length === TUT_SEQ.length && tutKeySteps.every((s,i)=> s.raw === i && s.sel === TUT_SEQ[i].sel),
   "引导/有 Key: 序列原样（onlyKey 步在，nk 变体不生效；科目页还是 4 步、第一步指红按钮）");
/* 19.12 入口标签得对应到真去处，产出反馈不能夸口（2026-10-08 再复查） */
state.settings.apiKey = "";
renderHome();
const pdHomeNoKey = el("#docBody").innerHTML;
ok(pdHomeNoKey.indexOf('id="btnSetup">先填 API Key（出题和阅卷都要）') >= 0
   && pdHomeNoKey.indexOf('id="btnQuick"') < 0,
   "快判入口/没 Key: 首页主按钮如实写成「先填 API Key」，不出现出题按钮");
el("#btnSetup").onclick();
ok(el("#modalSettings").hidden === false,
   "快判入口/没 Key: 主按钮真把人送到设置页（说完「先填 API Key」就得真能填）");
closeModals();
startPDRound(PD_MIX);
ok(el("#bannerSlot").innerHTML.indexOf("出题和阅卷都要用 API Key") >= 0 && pdRound === null && pdActive === false,
   "快判入口/没 Key: 被 entryBlocked 拦在原地（不出题、不进判别轨）");
state.settings.apiKey = "sk-demo0demo0demo0demo0demo0demo0";   // gate-allow: 演示用假 Key，不是真凭据
renderHome();
const pdHomeKey = el("#docBody").innerHTML;
ok(pdHomeKey.indexOf('id="btnQuick">开始快判') >= 0
   && pdHomeKey.indexOf("先试一轮示例题") < 0 && pdHomeKey.indexOf("也是内置示例题") < 0,
   "快判入口/有 Key: 首页红按钮「开始快判」是唯一入口；示例题残留为零");
/* 示例题整块下线：池子、取题函数、入口与「不用 Key 也能练」的口径一律不留残留（CHANGELOG 是面向用户的历史记录，不在禁止范围） */
const _pageNoLog = PAGE_HTML.slice(0, PAGE_HTML.indexOf("const CHANGELOG"));
ok(PAGE_HTML.indexOf("PD_SAMPLE_ITEMS") < 0 && PAGE_HTML.indexOf("pdSampleItems") < 0
   && PAGE_HTML.indexOf("startPDSampleRound") < 0 && PAGE_HTML.indexOf("btnSample") < 0
   && _pageNoLog.indexOf("示例题") < 0 && _pageNoLog.indexOf("不用 Key") < 0 && _pageNoLog.indexOf("不用填") < 0,
   "示例题下线: 页面不再有示例题池、示例入口与「不用 Key 也能练」的口径（CHANGELOG 除外）");
state.settings.apiKey = "";
renderStartNotices();
ok(exportHelpText().indexOf("已生成备份") >= 0 && exportHelpText().indexOf("取消就等于没导出") >= 0
   && exportHelpText().indexOf("已导出备份 ✓") < 0,
   "导出: 只报「已生成备份 + 文件名」，不夸口「已导出 ✓」（浏览器/应用可能弹保存框，他取消了我们无从得知）");
/* 19.13 存档说「不上传」可当不住真话：草稿与划线在批改那一步是要发给服务商的（2026-10-08 再复查） */
state.settings.apiKey = "";
ok(PAGE_HTML.indexOf("只存在本地，不上传") < 0
   && PAGE_HTML.indexOf("我们的服务器不碰") >= 0 && PAGE_HTML.indexOf("发给你上面填的服务商") >= 0,
   "设置/数据与备份: 不说「不上传」这种笼统话，写明「存本地 + 批改时发给服务商」（那是给分必须看的）");
/* 存不进去就不许说「已保存」（模式：界面上每一句成功都得有一个为真的依据） */
ok(save.toString().indexOf("return true") >= 0 && save.toString().indexOf("return false") >= 0,
   "保存: save() 把「到底写进去了没有」回给调用方");
ok(saveSettings.toString().indexOf("saved? \"已保存 ✓\"") >= 0
   && saveSettings.toString().indexOf("没保存上") >= 0,
   "保存: 存储写满时设置页不写「已保存 ✓」（同一屏的 banner 已在报「未能保存」，两边不能打架）");
/* ---- 空态给去处 + 学习卡页收紧（阶段 5 修包）---- */
state.experiences = [];
ok(experienceListHtml().indexOf("先去练一轮") >= 0,
   "空态: 经验页 0 条时指去处（练完一轮批改后自动归档，先去练一轮）");
state.history = [];
const __histEmpty = profileHistHtml();
ok(__histEmpty.indexOf("还没有练习记录") >= 0 && __histEmpty.indexOf("<table") < 0,
   "空态: 记录页 0 条时给一句去处，不摆空表格");
state.history = [{ ts: Date.now(), module:"zy.gongwen", subtype:"通知", grade:{ total:70, scores:{} } }];
ok(profileHistHtml().indexOf("<table") >= 0, "空态: 有记录时记录页照常摆表格");
ok(PAGE_HTML.indexOf(".noteedit{width:100%;min-height:84px") >= 0 && PAGE_HTML.indexOf(".card-body h4.noteh{margin-top:16px") >= 0
   && PAGE_HTML.indexOf(".cardcol>.csec+.csec{margin-top:24px") >= 0,
   "学习卡页: 笔记框/标题/分节间距收紧（整卡目标 ≤900 可视高）");
/* ---- 20. 全项目 review 后修下的四条：按钮接线、判别轨抬头、出题失败落点、超时与静默失败 ---- */
/* 20.1 画像二级页的经验行：停用/删除两颗按钮只长在二级页上，一级页那条路接了线不算数。
   DOM 桩子的 querySelectorAll 恒空，「点不动按钮」自身测不出来，只能钉住「二级页也接了线」这一句。 */
ok(PAGE_HTML.indexOf("profilePageHtml(profPage); wireProfileNav(); wireExperiences();") >= 0,
   "画像: 二级页也接经验行的停用/删除（漏了就是两颗点不动的死按钮）");

/* 20.2 判别轨的抬头：文号报「快判」，灰字不许按首页那支报「首页」——进快判就得挂 _view="pd" */
ok(startPDRound.toString().indexOf('_view = "pd"') >= 0,
   "快判: 进判别轨要挂 _view=pd（不挂的话灰字报「首页」，与文号的「快判」自相矛盾）");
const _v20 = _view, _pd20 = pdActive, _form20 = pdForm;
_view = "pd"; pdActive = true; pdForm = PD_MIX; renderHeader();
const pdNo20 = el("#docNo").textContent, pdLabel20 = el("#modLabel").textContent;
_view = _v20; pdActive = _pd20; pdForm = _form20; renderHeader();
ok(pdNo20.indexOf("快判") >= 0 && pdLabel20 === PD_FORMS[PD_MIX].name,
   "快判: 抬头文号与灰字同口径 -> 文号「" + pdNo20 + "」灰字「" + pdLabel20 + "」");

/* 20.3 出题失败：上一轮已收尾时必须回到小结——回到那道题的「看本轮小结」上，那颗按钮的翻页守卫会把人钉死 */
const realCall20 = callLLM;
callLLM = async ()=>{ throw {code:"JSON"}; };
pdRound = { form:PD_MIX, theme:"主题", done:true, idx:0, correct:1,
  items:[{ context:"材料", stem:"题干", options:["对的说法","错的说法"], answer:0, done:true, picked:0, ok:true, trap:"", explain:"解析" }] };
pdActive = true;
await genPDRound(PD_MIX, "主题");
const failBody20 = el("#docBody").innerHTML;
callLLM = realCall20;
ok(failBody20.indexOf('id="pdAgain"') >= 0 && failBody20.indexOf('id="pdNext"') < 0,
   "快判: 出题失败回到小结，不落在「看本轮小结」那颗点不动的按钮上");

/* 20.4 计时器得盖住「读完 body」那一段：只包 fetch 的话，回了头却停住 body 会永远挂着（阅卷按钮一直转） */
const realST20 = globalThis.setTimeout, realFetch20 = globalThis.fetch;
let aborter20 = null, bodyRead20 = false;
globalThis.setTimeout = fn => { aborter20 = fn; return 1; };
globalThis.fetch = (u, opt) => Promise.resolve({ ok:true, status:200, headers:{ get:()=>"application/json" },
  text: async()=>{ bodyRead20 = true;
    return await new Promise((_, rej)=>{ opt.signal.addEventListener("abort", ()=>{ const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); Promise.resolve().then(()=>aborter20()); }); } });
let toCode20 = "";
try{ await fetchWithTimeout("http://x/v1", {}, 50); }catch(e){ toCode20 = e && e.code; }
globalThis.setTimeout = realST20; globalThis.fetch = realFetch20;
ok(bodyRead20 && toCode20 === "TIMEOUT",
   "超时: 计时器盖住读完 body 那一段（body 停住也中止，不会永远挂着）");

/* 20.6 导入：引导游标与划线颜色都要跟着备份走（以前导入只重建了 state 的默认部分，这两样都丢掉） */
state.tut = { seq: 4, done: true };
importJSON(JSON.stringify({ settings:{ markColor:"#bfdbfe" }, tutVersion: DEFAULT_STATE.tutVersion,
                            tut:{ seq:2, done:false }, history:[] }));
ok(state.tut.seq === 2 && state.tut.done === false,
   "导入: 备份里的引导进度跟着恢复（导入一份自己走完过的备份，不该从头再教一遍）");
ok(state.settings.markColor === "#bfdbfe" && document.documentElement.style["--mark"] === "#bfdbfe",
   "导入: 划线颜色按备份恢复，并当场刷新 CSS 变量（不然划过线的题看着像没生效）");

/* 导入的那一刻不能因为一个颜色就惊动用户：形状不对的取值一律回落，不写进 state */
importJSON(JSON.stringify({ settings:{ markColor:"red; background:url(x)" }, history:[] }));
ok(state.settings.markColor === DEFAULT_STATE.settings.markColor,
   "导入: 不是自己那几个颜色 -> 回落到默认（废值会让 --mark 变成一句空 CSS）");

/* 旧代结构（tutVersion 不同）不能硬搬游标：宁可重放一遍，也不能把一个对不上的游标当成进度 */
importJSON(JSON.stringify({ settings:{}, tutVersion: 2, tut:{ seq:5, done:true }, history:[] }));
ok(state.tut.seq === 0 && state.tut.done === false,
   "导入: tutVersion 不是当前这一代 -> 不采用那份游标（结构不同，重放比错位好）");

/* 20.5 草稿落盘失败要出声：手写的东西静默消失，是最不该不出声的一类失败（save() 会出声，草稿和划线反而不会） */
const realSetItem20 = localStorage.setItem;
localStorage.setItem = ()=>{ throw new Error("QuotaExceededError"); };
el("#bannerSlot").innerHTML = "";
_storageWarned = false;
saveDraft("sig-20", "写到一半的字");
localStorage.setItem = realSetItem20;
ok(el("#bannerSlot").innerHTML.indexOf("没能存到本地") >= 0,
   "草稿: 落盘失败当场出声（本地存储满了不许静默丢字）");

/* ============ 21. 字段地基：思路自述 / 材料主题 / 跨题归纳缓存 ============ */

/* 21.1 归纳缓存：缺省是空对象，形状只能是「模块键 -> {at, basedOn, data}」 */
ok(DEFAULT_STATE.digests && typeof DEFAULT_STATE.digests === "object" && !Array.isArray(DEFAULT_STATE.digests)
   && Object.keys(DEFAULT_STATE.digests).length === 0,
   "字段地基: digests 默认是空对象");

/* 21.2 归纳缓存是可再生的（记录没变就复用、记录变了重算）：坏项直接丢，裸模块键补上科目前缀。
   取值里特意留一个 null：那一行挡不住的话，下一行读 .at 就抛，整个 load() 会掉进兜底分支。 */
let dg21 = null, dg21err = "";
try{
  dg21 = normDigests({
    gongwen: { at:1, basedOn:20, data:{ pattern:"x" } },
    "zy.guina": { at:2, basedOn:20, data:{ pattern:"y" } },
    "zy.fenxi": { at:3, basedOn:20 },
    "zy.duice": { at:"昨天", basedOn:20, data:{} },
    "not.a.module": { at:4, basedOn:20, data:{} },
    "zy.shiwu": null,
    "zy.guanche": { at:5, basedOn:20, data:[1,2] }
  });
}catch(e){ dg21err = String((e && e.message) || e); }
ok(!dg21err && Object.keys(dg21).join(",") === "zy.gongwen,zy.guina" && dg21["zy.gongwen"].data.pattern === "x",
   "字段地基: 归纳缓存的坏项丢掉（null 不炸、data 不是对象也挡），裸模块键补上科目前缀");

/* 21.3 思路自述只认字符串与闭集里的 kind：坏值丢掉，但记录本体必须留着 */
const mh21 = migrateHistory([
  { ts:1, module:"zy.gongwen", selfNote: 12345, selfKind:"how" },
  { ts:2, module:"zy.gongwen", selfNote:"   ", selfKind:"猜的" },
  { ts:3, module:"zy.guina", selfNote:"先看问法再回材料找主体", selfKind:"stuck" }
]).list;
ok(mh21.length === 3, "字段地基: 自述不合格也不丢整条记录（记录本体比自述值钱）");
ok(mh21[0].selfNote === undefined && mh21[0].selfKind === "how",
   "字段地基: 自述不是字符串 -> 只丢自述，kind 照留");
ok(mh21[1].selfNote === undefined && mh21[1].selfKind === undefined,
   "字段地基: 空白自述与闭集外的 kind 一并丢掉");
ok(mh21[2].selfNote === "先看问法再回材料找主体" && mh21[2].selfKind === "stuck",
   "字段地基: 合法自述原样留下（how=凭什么确定 / stuck=卡在哪）");

/* 21.4 自述是给人看的一句话：超长截到上限，不整条丢；改过一遍的记录再跑一次不再变化（幂等） */
const mh21b = migrateHistory([{ ts:9, module:"zy.gongwen", selfNote: "字".repeat(500) }]).list;
ok(mh21b[0].selfNote.length === SELF_NOTE_MAX,
   "字段地基: 超长自述截到 " + SELF_NOTE_MAX + " 字（不是整条丢）");
ok(migrateHistory(mh21b).changed === false,
   "字段地基: 自述归一后二次迁移不再改动（幂等，不会每启动一次就回写一遍）");

/* 21.5 归纳缓存跟着备份走：换了机器不用从零再攒一遍；缺字段的坏项挡在门外 */
importJSON(JSON.stringify({ settings:{}, history:[],
  digests:{ "zy.gongwen":{ at:7, basedOn:22, data:{ pattern:"先看选项再回材料" } }, "zy.fenxi":{ at:8 } } }));
ok(state.digests["zy.gongwen"] && state.digests["zy.gongwen"].basedOn === 22 && !state.digests["zy.fenxi"],
   "字段地基: 导入恢复归纳缓存（缺字段的坏项被挡在门外）");

/* 21.6 出题顺手给材料主题标签：归纳与去重要用它（本步只落盘，不参与出题行为） */
const realCall21 = callLLM;
let sys21 = "";
callLLM = async sys => { sys21 = String(sys||"");
  return { question:{ background:"某市…", requirements:"…", suggestedFormat:"…", difficulty:"适中", score:20, theme:"基层治理" }, keyPoints:[] }; };
const q21 = await gen("zy.gongwen");
callLLM = realCall21;
ok(sys21.indexOf('"theme"') >= 0, "字段地基: 出题 schema 要求材料主题标签");
ok(q21 && q21.question && q21.question.theme === "基层治理",
   "字段地基: 主题标签随题目一起回来（历史记录整条存 question，不另开字段）");
/* 出题 schema 有两条分支（要学习卡 / 不要学习卡），两条都得带 theme：
   只改一条分支的话，另一条路上的题永远没有主题标签（单跑一条 gen 看不出来，所以查页面原文） */
ok((PAGE_HTML.match(/,"theme":"材料主题/g) || []).length === 2,
   "字段地基: 出题 schema 两条分支都带 theme（漏一条分支 = 那条路上的题没标签）");

/* ============ 22. 批改页结构：我的答案（逐句标注）· 参考答案 · 解析 ============ */
current = { module:"zy.gongwen", subtype:"通知", question:{ background:"x", requirements:"y", score:20 } };
renderGrade({ scores:{}, strengths:["条理清楚"], weaknesses:[], comment:"先写主送机关再写正文。",
  modelAnswer:"第一段内容。\n第二段内容。",
  hits:[ {point:"标题含事由",score:4,awarded:4,status:"满分",kind:"-",evidence:"答到：「关于调整作息的通知」"},
         {point:"写明主送机关",score:4,awarded:0,status:"零分",kind:"漏点",evidence:"【缺：写明主送机关】"},
         {point:"落款单位与日期",score:2,awarded:1,status:"半分",kind:"格式",evidence:"答到：「遵照执行」，【缺：成文日期】"} ] },
  78, null, null, "关于调整作息的通知。各科室请遵照执行。特此通知。");
const H22 = el("#docBody").innerHTML;
ok(H22.indexOf(">我的答案</div>") >= 0 && H22.indexOf(">参考答案</div>") >= 0 && H22.indexOf(">解析</div>") >= 0,
   "批改页: 三段并列——我的答案 / 参考答案 / 解析");
ok(H22.indexOf(">我的答案</div>") < H22.indexOf(">参考答案</div>")
   && H22.indexOf(">参考答案</div>") < H22.indexOf(">解析</div>"),
   "批改页: 次序是我的答案 → 参考答案 → 解析");
ok(H22.indexOf("asent got") >= 0 && H22.indexOf('class="asc">+1<') >= 0 && H22.indexOf('class="asc full">+4<') >= 0,
   "批改页: 逐句标注标的是得分处（满分句也报分，加起来＝页头总分）");
ok(H22.indexOf('class="sec-title">我的答案</div>') >= 0 && H22.indexOf('class="sec-title lite">参考答案</div>') >= 0
   && H22.indexOf('class="sec-title lite">解析</div>') >= 0,
   "批改页: 只有「我的答案」用重题头，参考答案与解析降一级");
ok(H22.indexOf("第一段内容。\n第二段内容。") >= 0,
   "批改页: 范文按原文换行渲染（pre-wrap，不再折成一坨）");
ok(H22.indexOf("先写主送机关再写正文。") >= 0, "批改页: 解析照常渲染");
ok(H22.indexOf("<details") < 0 && H22.indexOf("丢分清单") < 0 && H22.indexOf("loseline") < 0,
   "批改页: 折叠区与丢分清单都不在（2026-10-13 回退到平铺三段）");
ok((PAGE_HTML.match(/\.ghead\{[^}]*\}/) || [""])[0].indexOf("sticky") < 0
   && (PAGE_HTML.match(/\.ghead\{[^}]*\}/) || [""])[0].length > 0,
   "批改页: 分数不吸顶（往下看文章时它不该浮在字上面）");
ok(PAGE_HTML.indexOf("loselist") < 0 && PAGE_HTML.indexOf("loseDetail") < 0 && PAGE_HTML.indexOf("MISS_RE") < 0
   && PAGE_HTML.indexOf("clipTxt") < 0,
   "批改页: 丢分清单整块删净（含 CSS 与取值函数，不留死代码）");
ok(PAGE_HTML.indexOf("white-space:pre-wrap;-webkit-text-stroke") >= 0,
   "批改页: 范文容器自带 pre-wrap（不再靠折叠体兜）");
ok(PAGE_HTML.indexOf('"comment":"解析（100 字以内）') >= 0,
   "阅卷 prompt: comment 改口径为「解析」（只讲这题怎么答，不评价答卷）");
ok(PAGE_HTML.indexOf("一句话（40 字内）") < 0,
   "阅卷 prompt: 一句话点评的口径不在了（它撑不起「解析」这个位置）");
/* 句末分数与页头同口径：模型多给的分也夹住；有采分项定位不到时不宣称「相加＝总分」 */
ok(answerMarks([{score:5,awarded:8,evidence:"答到：「关于调整作息的通知」"}], "关于调整作息的通知。").got.reduce((a,b)=>a+b,0) === 5,
   "逐句标注: 句末分按子项满分夹住（与页头同一口径）");
renderGrade({ scores:{}, strengths:[], weaknesses:[], comment:"x",
  hits:[{point:"a",score:5,awarded:8,evidence:"答到：「关于调整作息的通知」"},
        {point:"b",score:5,awarded:5,evidence:"答到：「答卷里没有的句子」"}] }, 10, null, null, "关于调整作息的通知。");
const H22b = el("#docBody").innerHTML;
ok(H22b.indexOf("相加＝总分") < 0 && H22b.indexOf("是本句得分") >= 0,
   "批改页: 有采分项定位不到时不宣称「相加＝总分」");
ok(H22b.indexOf('class="asc full">+5<') >= 0, "批改页: 模型多给分时句末按满分显示（+5 不是 +8）");
renderGrade({ hits:[{point:"a",score:5,awarded:5,evidence:"答到：「关于调整作息的通知」"}] }, 5, null, null, "关于调整作息的通知。");
ok(el("#docBody").innerHTML.indexOf("相加＝总分") >= 0, "批改页: 全部定位成功时才说「相加＝总分」");
/* 全满分：三段照常，不留空块 */
renderGrade({ scores:{}, strengths:[], weaknesses:[], comment:"x",
  hits:[{point:"a",score:5,awarded:5,status:"满分",evidence:"答到：「a」"}] }, 50, null, null, "我答了一句。");
ok(el("#docBody").innerHTML.indexOf(">我的答案</div>") >= 0 && el("#docBody").innerHTML.indexOf(">解析</div>") >= 0
   && el("#docBody").innerHTML.indexOf("loseline") < 0,
   "批改页: 全满分时三段照常（没有清单可列，也不留空块）");

/* ============ 23. 第 3 步：作答前的规则展示位 + 批改页思路自述 ============ */
{
  const _exp0 = state.experiences, _hist0 = state.history;
  const _mk = (id, type, title, ts, extra)=> Object.assign({ id, type, kind:"", title, body:"正文 "+id,
    scope:"module", module:"zy.gongwen", subject:"zy", ts, disabled:false }, extra || {});
  state.experiences = [ _mk("e1","错因","错因条",100), _mk("e2","规则","规则条A",200), _mk("e3","表达","表达条",300),
    _mk("e4","规则","规则条B",50), _mk("e5","规则","停用的规则",999,{ disabled:true }) ];
  const _pr = prepRules("zy.gongwen");
  ok(_pr.length === 3, "规则展示位: 最多摆 3 条");
  ok(_pr[0].title === "规则条A" && _pr[1].title === "规则条B",
     "规则展示位: 规则类排最前（同一类里新的在前）");
  ok(_pr[2].title === "表达条" && _pr.map(e=>e.id).indexOf("e1") < 0,
     "规则展示位: 表达往后排，错因排最后（摊不到 3 条时才轮到它）");
  ok(_pr.map(e=>e.id).indexOf("e5") < 0, "规则展示位: 停用的经验不摆出来");
  const _ph = prepRulesHtml("zy.gongwen");
  ok(_ph.indexOf("动笔前") >= 0 && _ph.indexOf("规则条A") >= 0 && _ph.indexOf("另有 1 条") >= 0,
     "规则展示位: 摆出前 3 条，其余只报个数");
  state.experiences = [];
  ok(prepRulesHtml("zy.gongwen") === "", "规则展示位: 这个模块没经验时整块不出现，不留空框");
  state.experiences = _exp0;
  ok(PAGE_HTML.indexOf("let html = prepRulesHtml(module);") >= 0,
     "规则展示位: 作答区上方接上了它（申论一稿页与综应A 作答页共用 draftPanelHtml）");

  /* 自述：先问什么，再落到哪条记录上 */
  ok(selfAskKind({ hits:[{score:10,awarded:9}] }, 90) === "how", "思路自述: 得高分的题问「凭什么确定」");
  ok(selfAskKind({ hits:[{score:10,awarded:8}] }, 80) === "how", "思路自述: 八成分数就算高分");
  ok(selfAskKind({ hits:[{score:10,awarded:4}] }, 40) === "stuck", "思路自述: 丢分的题问「卡在哪一步」");
  ok(selfAskKind({ hits:[] }, 80) === "how" && selfAskKind({ hits:[] }, 60) === "stuck",
     "思路自述: 没有采分点的老记录退回总分判");
  state.history = [{ ts:Date.now(), module:"zy.gongwen", question:current.question, answer:"x", hits:[], grade:{} }];
  renderGrade({ hits:[{score:10,awarded:9}], comment:"x" }, 90, null, null, "我答了一句。");
  const _H = el("#docBody").innerHTML;
  ok(_H.indexOf('id="selfBox"') >= 0 && _H.indexOf("凭什么确定") >= 0 && _H.indexOf("卡在哪一步") < 0,
     "思路自述: 高分题在批改页上摆出「凭什么确定」（另一问不同时出现）");
  renderGrade({ hits:[{score:10,awarded:3}], comment:"x" }, 30, null, null, "我答了一句。");
  ok(el("#docBody").innerHTML.indexOf("卡在哪一步") >= 0, "思路自述: 丢分的题换成「卡在哪一步」");
  ok(_H.indexOf('id="btnSelfSkip"') >= 0, "思路自述: 旁边就是跳过");
  /* 记下 → 写进记录；跳过 → 两个字段都不写 */
  el("#selfNote").value = "  看到主送机关就知道这是通知  ";
  el("#btnSelfSave").onclick();
  ok(state.history[0].selfNote === "看到主送机关就知道这是通知" && state.history[0].selfKind === "stuck",
     "思路自述: 记下落进当前这条记录（去掉首尾空白）");
  el("#btnSelfSkip").onclick();
  ok(!("selfNote" in state.history[0]) && !("selfKind" in state.history[0]),
     "思路自述: 跳过不写字段（归纳时不硬凑）");
  /* 回填：已写过的再次渲染要带回来；问法不同则不回填，免得两句话串味 */
  state.history[0].selfNote = "先分层再落笔"; state.history[0].selfKind = "how";
  ok(selfNoteHtml({ hits:[{score:10,awarded:9}] }, 90).indexOf("先分层再落笔") >= 0,
     "思路自述: 同一问法再次渲染时回填原文");
  ok(selfNoteHtml({ hits:[{score:10,awarded:1}] }, 10).indexOf("先分层再落笔") < 0,
     "思路自述: 换了一问就不带上一问的原文");
  state.history = [{ ts:Date.now(), module:"zy.gongwen", question:{ background:"别的题", requirements:"别的", score:20 }, answer:"x" }];
  ok(selfNoteHtml({ hits:[{score:10,awarded:9}] }, 90) === "",
     "思路自述: 记录不是当前这道题时不出现（不把自述写到别人头上）");
  state.history = _hist0;
  ok(PAGE_HTML.indexOf("html += selfNoteHtml(g, total);") >= 0, "思路自述: 接在解析后面（两科共用 gradeHtml）");
  ok(PAGE_HTML.indexOf("function wireSelfNote(){") >= 0 && (PAGE_HTML.match(/wireSelfNote\(\);/g) || []).length === 2,
     "思路自述: 申论批改步与综应A 结果页都接了线（两处调用 + 一处定义）");
}

/* ============ 24. 排版尺子：字号五档 / 间距无中间值 / 屏级层级 ============ */
{
  // 字号：全站只剩五档变量，字面值只留给红头与纸上的字
  ok(PAGE_HTML.indexOf("--fs-display:30px") > 0 && PAGE_HTML.indexOf("--fs-hero:26px") > 0
     && PAGE_HTML.indexOf("--fs-title:16px") > 0 && PAGE_HTML.indexOf("--fs-body:14px") > 0
     && PAGE_HTML.indexOf("--fs-note:12.5px") > 0,
     "尺子: :root 里五档字号都在");
  const _lit = (PAGE_HTML.match(/font-size:[0-9.]+px/g) || []);
  ok(_lit.length === 6 && _lit.every(x=> x === "font-size:16px" || x === "font-size:30px"),
     "尺子: 字面字号只剩 6 处（红头机关名 30 + 纸上的字 16×5），其余全走变量");
  ok((PAGE_HTML.match(/var\(--fs-note\)/g) || []).length >= 40
     && (PAGE_HTML.match(/var\(--fs-body\)/g) || []).length >= 35,
     "尺子: 字号确实被用上了（不是定义了没人用）");
  // 间距：只允许五档 + 几个大留白，中间值一个不剩
  const _spOK = [0,1,4,8,12,16,24,32,36,38,40,42,48,54,56,58,84,100,760];
  const _spVals = new Set();
  for(const m of PAGE_HTML.matchAll(/(?:margin|padding|gap)(?:-[a-z]+)?\s*:\s*([^;}]+)/g))
    for(const d of m[1].matchAll(/(\d+)px/g)) _spVals.add(Number(d[1]));
  const _spBad = Array.from(_spVals).filter(v => _spOK.indexOf(v) < 0);
  ok(_spBad.length === 0,
     "尺子: 间距没有中间值（2/3/5/6/7/9/10/11/13/14/18/20/22/26/28/30 一个不剩）");
  ok(_spVals.has(4) && _spVals.has(8) && _spVals.has(12) && _spVals.has(16) && _spVals.has(24),
     "尺子: 五档间距确实在用（4 / 8 / 12 / 16 / 24）");
  // 层级：标题只有两档；题头比容器标签重
  ok(PAGE_HTML.indexOf(".sec-title{font-family:var(--hei);font-weight:700;font-size:var(--fs-title)") >= 0,
     "层级: 区块标题只有一档（16px 红竖线）");
  ok(PAGE_HTML.indexOf(".sec-title.plain{border-left:none;padding-left:0;font-size:var(--fs-body)") >= 0,
     "层级: 次级标题降一档（14px 灰、不缩进）");
  ok(PAGE_HTML.indexOf('<div class="sec-title plain">作答区</div>') >= 0,
     "层级: 「作答区」是容器标签，不比「题目」重");
  ok(PAGE_HTML.indexOf('<div class="sec-title">题目</div>') >= 0,
     "层级: 两科的题头同一档（综应A 与申论不再各写一套）");
  ok(PAGE_HTML.indexOf('<div class="secrow"><div class="sec-title">快判</div>') < 0
     && PAGE_HTML.indexOf('<div class="pdstate" id="pdState"') >= 0,
     "层级: 快判一轮页不另起标题行（「快判」已由红头说），主题与进度落红头中段");
  ok(PAGE_HTML.indexOf("红＝这句没拿满") >= 0 && PAGE_HTML.indexOf("标红＝这句没对上任何采分点") < 0,
     "层级: 批改页的标注图例挪进标题行（不再每题占一行）");
  ok(PAGE_HTML.indexOf('<div class="secrow"><div class="sec-title">我的答案</div>') >= 0,
     "层级: 「我的答案」也是标题行带右侧图例");
  // 尺子本身不许有“定义了没人用”的死 token
  const _cssVars = Array.from(new Set(Array.from(PAGE_HTML.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)).map(m=>m[1])));
  const _deadVars = _cssVars.filter(v=> PAGE_HTML.indexOf("var(" + v + ")") < 0);
  ok(_deadVars.length === 0, "尺子: 没有定义了却没人用的 CSS 变量" + (_deadVars.length? "（" + _deadVars.join("、") + "）" : ""));
  ok(paperScaleFor(1040) === 1 && Math.abs(paperScaleFor(1470) - 1.4) < 0.01 && paperScaleFor(1920) === 1.5 && paperScaleFor(0) === 1
     && Math.abs(paperScaleFor(1470, 800) - 1.2) < 0.01 && Math.abs(paperScaleFor(1470, 756) - 1.15) < 0.01,
     "纸面: 按窗口宽度等比放大（≤1050 不放大 / 1470 约 1.4 / 超宽封顶 1.5）；矮窗再收一档");
  // :root 外不写设计色 hex（用户可选的划线色是运行时变量，另算）
  const _css = PAGE_HTML.slice(PAGE_HTML.indexOf("<style>"), PAGE_HTML.indexOf("</style>"));
  const _rootEnd = _css.indexOf("}", _css.indexOf(":root{"));
  const _hexOutside = (_css.slice(_rootEnd).match(/#[0-9a-fA-F]{3,8}\b/g) || [])
     .filter(h=> ["#a7f3d0"].indexOf(h.toLowerCase()) < 0);
  ok(_hexOutside.length === 0, "尺子: CSS 里 :root 外的设计色都进了 token" + (_hexOutside.length? "（" + _hexOutside.join(" ") + "）" : ""));
  // 文字用色的对比度：WCAG 2.2 的 1.4.3（AA）要求正文文字 ≥ 4.5:1。这一条是 2026-10-14 拿标准逐条
  // 对出来的——此前 --muted-2 是 4.03:1、--ink-faint 是 2.69:1，肉眼完全看不出问题。
  const _ri = c => c/255 <= 0.03928 ? (c/255)/12.92 : Math.pow(((c/255)+0.055)/1.055, 2.4);
  const _lum = h => { const a = [1,3,5].map(i=>parseInt(h.substr(i,2),16)).map(_ri);
                      return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2]; };
  const _contrast = (f,b) => { const x=_lum(f), y=_lum(b);
                               const hi=Math.max(x,y), lo=Math.min(x,y); return (hi+0.05)/(lo+0.05); };
  const _tok = n => { const m = PAGE_HTML.match(new RegExp("--" + n + ":\\s*(#[0-9a-fA-F]{6})")); return m ? m[1] : ""; };
  const _paper = _tok("paper");
  const _textToks = ["ink","muted","muted-2","gov-red","gov-red-dark","warn","chip-ink","success","danger"];
  const _lowTok = _textToks.filter(n => { const v = _tok(n); return !v || _contrast(v, _paper) < 4.5; })
                           .map(n => n + "=" + _tok(n) + "(" + _contrast(_tok(n), _paper).toFixed(2) + ":1)");
  ok(_paper === "#fffdf8" && _lowTok.length === 0,
     "对比度: 纸面上每个文字用色都过 WCAG 1.4.3 AA（≥ 4.5:1）" + (_lowTok.length ? "；不达标的：" + _lowTok.join("、") : ""));
  // 守住 --ink-faint 不再回来：它只有 2.69:1，用途却全是必须看清的正文（脚注、分组小标题、输入框说明字）
  ok(PAGE_HTML.indexOf("--ink-faint") < 0,
     "对比度: 2.69:1 的 --ink-faint 已并入 --muted-2，不再回来");
}

/* 0.1 启动顺序：load() 引用的每个顶层常量都必须声明在它之前。
   load() 在模块顶层就被调用；撞 TDZ 时它自己的 catch 会把 ReferenceError 吞成「整份回默认」，
   界面上只表现为「数据全没了」（2026-10-13 真丢过一次：MARK_COLORS 落到了 load() 后面）。
   函数声明会提升，不列入检查。 */
{
  const _src = PAGE_HTML.slice(PAGE_HTML.indexOf("<script>") + 8, PAGE_HTML.lastIndexOf("</script>"));
  const _at = _src.indexOf("let state = load();");
  const _deps = ["DEFAULT_STATE","LEGACY_ORG","DEFAULT_SUBJECT","SUBJECTS","MODULES","MARK_COLORS",
                 "HISTORY_KEY","SELF_KINDS","SELF_NOTE_MAX","FLOW_STEPS"];
  const _late = _deps.filter(n => {
    const m = new RegExp("^(?:const|let|var) " + n + "\\b", "m").exec(_src);
    return m && m.index > _at;
  });
  ok(_at >= 0 && _late.length === 0,
     "启动顺序: load() 引用的顶层常量都声明在 let state = load() 之前"
     + (_late.length ? "；落在后面的：" + _late.join("、") : ""));
}

/* 0.2 有据出题：材料由骨架改写。
   这一节的断言守的是「硬约束有没有落地」——光写在 prompt 里不算，
   （2026-10-15 实测栽过几次：三条约束互相打架、代号合并造出假事实、建议拄成答案） */
{
  const _spec = groundedSpec("## 背景\n- 一小事", { matLen: [600, 900] });
  ok(_spec.indexOf("600-900") >= 0 && _spec.indexOf("决定项") >= 0,
     "有据: 字数档写进 prompt，且声明它是决定项（骨架装不下可以不用）");
  ok(_spec.indexOf("一个代号只能代表一个地方") >= 0,
     "有据: 一个代号只能代表一个地方（实测被并成「D市干了两件事」）");
  ok(_spec.indexOf("骨架之外的事实一律不许添加") >= 0,
     "有据: 不许在骨架之外补事实");
  ok(_spec.indexOf("还没发生") >= 0 && _spec.indexOf("建议性质") >= 0,
     "有据: 骨架里的建议不许写成已做到的事");
  ok(_spec.indexOf("印象") >= 0 && _spec.indexOf("纳闷") >= 0,
     "有据: 限定语不许改（带两次抽检实测的反例）");
  ok(_spec.indexOf("material") >= 0, "有据: 明说骨架在 user 的 material 字段");
  ok(_spec.indexOf("骨架里没有主语的") >= 0,
     "有据: 骨架里没主语的不许给它安一个（实测被写成「有专家提出」）");
  // 对策题的材料里不许把建议整段抄进去——那等于把答案写在题面上。
  // 判据挂题干不挂模块名：归纳概括模块也会出「概括问题并提出建议」（实测就是它漏的）
  ok(_spec.indexOf("答案写在题面上") >= 0 && _spec.indexOf("看的是题干，不是模块名") >= 0,
     "有据: 题干要考生提建议时，材料不许整段抄建议");
  ok(PAGE_HTML.indexOf("groundedSpec(skel, m, /对策/") < 0,
     "有据: 这条不挂在模块名上（挂了就会漏掉归纳概括里的「并提出建议」）");

  // 事前限量：素材量是材料档的三倍（一条条目实测 41 字），不限就会写出超档的材料
  const _sk = "## 背景\n" + Array.from({length: 40}, (_, i) => "- 背景事" + i).join("\n")
    + "\n## 做法（已经发生的）\n" + Array.from({length: 30}, (_, i) => (i + 1) + ". 做法事" + i).join("\n")
    + "\n## 建议 / 主张（还没发生的）\n" + Array.from({length: 20}, (_, i) => (i + 1) + ". 建议事" + i).join("\n");
  const _t = trimSkeleton(_sk, 900);
  const _n = _t.split("\n").filter(Boolean).length;
  ok(_n === Math.floor(900 / 41), "有据: 按材料档反推最多喂几条（900 字档 → " + _n + " 条）");
  ok(_t.indexOf("建议事0") >= 0 && _t.indexOf("做法事0") >= 0 && _t.indexOf("背景事0") >= 0,
     "有据: 限量按栏轮流取，每栏都留得下人（不被背景栏占满）");
  ok(trimSkeleton("## 背景\n- 事\n", 100).indexOf("事") >= 0 && trimSkeleton("", 900) === "",
     "有据: 条目少或者没骨架都不报错（下界与空输入都退得住）");
  ok(trimSkeleton("## 成效\n- （原文未提及）\n", 900).indexOf("原文未提及") < 0,
     "有据: 占位行不当成事实喂进去");
  ok(/trimSkeleton\(skel, m\.matLen\[1\]\)/.test(PAGE_HTML),
     "有据: 限量真的接在 gen 上（写了不接等于没写）");

  // 取不到就必须回落，而不是报错：池子空 / 不在桌面壳里都是常态
  const _savedWin = globalThis.window;
  globalThis.window = {};
  const _p = await poolPick();
  ok(_p === null, "有据: 没有池子通道时 poolPick 回 null（由调用方回落编材料，不报错）");
  globalThis.window = { liantai: { poolPick: () => { throw new Error("boom"); } } };
  ok((await poolPick()) === null, "有据: 取骨架抛错也回 null，不让出题挂掉");
  globalThis.window = { liantai: { poolPick: async () => ({ name: "x.md", title: "x", text: "## 背景\n- a" }) } };
  const _r = await poolPick();
  ok(_r && _r.text === "## 背景\n- a", "有据: 取得到就把骨架递回给 gen");
  globalThis.window = _savedWin;

  // 「据材料」标：挂在题上，跟着题目一起存、一起导入导出
  ok(fromMatTag({ fromPool: "某篇" }).indexOf("据材料") > 0, "有据: 题上有来源就出「据材料」小标");
  ok(fromMatTag({}) === "" && fromMatTag(null) === "", "有据: 编材料的题不挂标（不混淆两种材料）");
  ok(PAGE_HTML.indexOf('class="from-mat"') >= 0, "有据: 小标有样式（加了类却没写样式就是白加）");
  const _tags = (PAGE_HTML.match(/\$\{fromMatTag\(/g) || []).length;
  ok(_tags === 2, "有据: 两处材料标题都挂了标（综应A 作答页 + 申论读材料页，当前 " + _tags + " 处）");
}

/* 0.4 材料来源标注：有 src 说三样，老记录不追加，没证据就说仿真编写 */
{
  const qSrc = { background:"材料", requirements:"r", fromPool:"标题",
    src:{ media:"人民网", date:"2026-10-11", topics:["就业服务","民生保障","数字经济"] } };
  ok(matSrcTag(qSrc).indexOf("素材：人民网") >= 0 && matSrcTag(qSrc).indexOf("2026-10-11") >= 0
     && matSrcTag(qSrc).indexOf("主题：就业服务、民生保障") >= 0 && matSrcTag(qSrc).indexOf("等") >= 0,
     "材料来源: 媒体 / 日期 / 主题都出，主题最多两个、多的用「等」收");
  ok(matSrcTag({ background:"b", requirements:"r", fromPool:"标题" }) === "",
     "材料来源: 老记录只有「据材料」，不追加来源（不把真材料说成仿真）");
  ok(matSrcTag({ background:"b", requirements:"r" }).indexOf("仿真编写") >= 0,
     "材料来源: 没有证据就明说仿真编写");
  ok(PAGE_HTML.indexOf("matSrcTag(current.question)") >= 0 && PAGE_HTML.indexOf("matSrcTag(question)") >= 0,
     "材料来源: 两处材料行都接了（综应A 作答页 + 申论读材料页）");
  ok(PAGE_HTML.indexOf("matSrcTag(it") < 0,
     "材料来源: 快判那行「材料节选」不标（它不是池子素材，是逐题生成的）");
  ok(PAGE_HTML.indexOf(".material .from-src{") >= 0,
     "材料来源: 小标有样式（加了类却没写样式就是白加）");
  ok(fromMatTag({ fromPool:"标题", src:{ media:"人民网", date:"2026-10-15", topics:["乡村振兴"] } }) === "",
     "材料来源: 有来源明细时不再重复挂「据材料」");
  ok(fromMatTag({ fromPool:"标题", src:{ media:"", date:"", topics:[] } }).indexOf("据材料") >= 0,
     "材料来源: 空 src 不吞掉「据材料」（来源行不会显示）");
  ok(PAGE_HTML.indexOf('class="mathint"') >= 0 && PAGE_HTML.indexOf('class="mathelp"') < 0 && PAGE_HTML.indexOf('class="mathead"') < 0,
     "材料头: 划线说明写在材料块外，材料块里只有来源");
  ok(PAGE_HTML.indexOf('<span class="hint">（选中几个字即可划线') < 0,
     "材料头: 划线说明不再拼在来源行里");
}

/* 学习卡页：卡有容器与标题；弹层容器不带浏览器焦点环；几处视觉细节 */
{
  const _cur = current, _phase = _view;
  state.cache.studyCards["zy.guina::概括问题"] = { title:"卡", points:["a"] };
  current = { module:"zy.guina", subtype:"概括问题", question:{ background:"b", requirements:"r", score:20 }, keyPoints:[], cardPeeks:0, phase:"card", studyCard:{ title:"卡", points:["a"] } };
  renderZyPage();
  const HC = el("#docBody").innerHTML;
  ok(HC.indexOf('<div class="card">') >= 0 && HC.indexOf('class="sec-title">学习卡</div>') >= 0 && HC.indexOf('id="btnSwitch"') >= 0,
     "学习卡页: 卡有容器，标题行报「学习卡」，换一题同行");
  ok((PAGE_HTML.match(/\.card\{background:var\(--wash\)/) || [""])[0].length > 0, "学习卡: .card 有浅底与圆角规则");
  current = _cur; _view = _phase;
  delete state.cache.studyCards["zy.guina::概括问题"];
}
ok(PAGE_HTML.indexOf(".modal .box:focus{outline:none") >= 0, "弹层: 容器被聚焦时不画浏览器默认焦点环");
ok((PAGE_HTML.match(/\.answerreview \.asc\{[^}]*margin:0 8px 0 4px/) || [""])[0].length > 0, "批改页: 句末分数与下一句之间留出间距");
ok(PAGE_HTML.indexOf("这道题卡在哪一步") >= 0 && PAGE_HTML.indexOf('"这道卡在哪一步') < 0, "批改页: 自述问句是「这道题卡在哪一步？」");
ok(PAGE_HTML.indexOf('<span class="mathint">选中文字即可划线') >= 0
   && PAGE_HTML.indexOf('<span class="mathint">选中文字即可划线') < PAGE_HTML.indexOf('<div class="material mat-scroll">'),
   "材料头: 划线说明与分值同一行，在材料之前");
ok(PAGE_HTML.indexOf('class="metarow"') >= 0 && PAGE_HTML.indexOf("<b>分值</b>") >= 0 && PAGE_HTML.indexOf("分值：</b>") < 0,
   "题面: 分值与难度同一行、标签紧贴值（不再用 5em 悬挂缩进拉开）");
ok(PAGE_HTML.indexOf("这类题怎么练？") >= 0 && PAGE_HTML.indexOf("${esc(m.name)} 练什么？") < 0,
   "落地页: 标题只说「这类题怎么练」，不复述抬头里的模块名");
ok(renderHeader.toString().indexOf('_view === "q"') >= 0, "抬头: 子类型只在作答页报，落地页不带上一题的子类型");
ok(PAGE_HTML.indexOf("@keyframes breathe") < 0 && PAGE_HTML.indexOf("animation:breathe") < 0,
   "加载页: 去掉循环呼吸线（全应用没有循环主动效）");
ok(PAGE_HTML.indexOf('class="actions savebar"') >= 0, "设置: 保存是弹层底部固定条，滚到哪都够得着");
ok(TUT_SEQ[1] && TUT_SEQ[1].sel === ".chiprow" && TUT_SEQ.every(s2 => String(s2.sel).indexOf(".chip[data-mod]") < 0),
   "引导: 整排 chip 一起挖孔，不再只罩第一颗");
ok(PAGE_HTML.indexOf(".material .label .from-mat,.material .label .from-src{") >= 0, "材料头: 抬头与来源之间用细线分开");
ok(PAGE_HTML.indexOf("--ink-soft") < 0 && PAGE_HTML.indexOf("var(--ink-soft)") < 0, "颜色: 灰收回三档（--ink-soft 已并进 --muted）");
{
  const _c = current; current = { cardPeeks: 2 };
  ok(cardFabHtml("翻学习卡", true).indexOf('class="fabcount"') >= 0 && PAGE_HTML.indexOf(".fab .fabcount{display:none") >= 0,
     "窄窗: 浮标只留动作名（仍挂在纸外）");
  current = _c;
}
ok(limitRowHtml().indexOf(">限时<") >= 0 && PAGE_HTML.indexOf(".tlin{width:62px;height:var(--h-ctl-sm)") >= 0,
   "限时: 控件带「限时」标签，与同行按钮同高");
{
  const _h = state.history.slice();
  state.history = [];
  openModal("modalProfile"); renderProfile();
  const pe = el("#profileBody").innerHTML;
  ok(pe.indexOf("还没练习记录") < 0 && pe.indexOf("还没有练习记录") >= 0 && pe.indexOf("回首页练一道") >= 0,
     "画像: 空态直接给下一步");
  ok(pe.indexOf("快判") >= 0 && pe.indexOf("快判") < pe.indexOf("综应A ·"), "画像: 汇总入口排在模块之前");
  state.history = _h;
  closeModals();
}
{
  const _h = state.history.slice();
  state.history = [{ ts:Date.now(), module:"zy.guina", subtype:"概括问题", question:{ background:"b", requirements:"r", score:20 }, answer:"我的答案。", keyPoints:[],
    hits:[{ point:"p", score:20, awarded:18, status:"部分命中", evidence:"答到：「我的答案」" }],
    grade:{ total:90, scores:{}, comment:"解析。", modelAnswer:"范文。" } }];
  openModal("modalProfile"); renderProfile(); profGo("hist");
  ok(el("#profileBody").innerHTML.indexOf('data-hist="0"') >= 0 && el("#profileBody").innerHTML.indexOf("点一行打开那次批改") >= 0,
     "记录页: 行可点开那次批改");
  openHistRecord(state.history[0]);
  ok(_view === "q" && el("#modalProfile").hidden === true && el("#docBody").innerHTML.indexOf("/ 20 分") >= 0,
     "记录页: 点行打开那次批改（不重调 AI）");
  state.history = _h; current = null; lastGrade = null; _flowId = null;
}

/* ============ 收尾修复回归 ============ */

/* 判别轨退出：renderStart 必须复位 pdActive，否则整场抬头挂「快判」 */
state.flows = []; _flowId = null; current = null;
pdActive = true; pdRound = null;
renderStart();
ok(pdActive === false, "判别轨: renderStart 复位 pdActive（抬头不再挂「快判」）");

/* 删点后归类组的下标同步前移 */
const fDrop = { selections:[{text:"甲"},{text:"乙"},{text:"丙"}], groups:[{facts:[0]},{facts:[1,2]}], orgIdx:2 };
dropSelections(fDrop, (_sl,i)=> i === 1);
ok(fDrop.selections.length === 2 && fDrop.selections[1].text === "丙"
   && fDrop.groups[0].facts.join(",") === "0" && fDrop.groups[1].facts.join(",") === "1"
   && fDrop.orgIdx === 1,
   "归类: 删点后组里的下标同步前移（不再指向别的句子）");
dropSelections(fDrop, (_sl,i)=> i === 1);
ok(fDrop.groups[1].facts.length === 0, "归类: 删到末尾时组里不会留下越界下标");

/* 删当前点之前的点：当前点跟着前移，不跳到下一个点 */
const fDrop2 = { selections:[{text:"甲"},{text:"乙"},{text:"丙"}], groups:[{facts:[2]}], orgIdx:2 };
dropSelections(fDrop2, (_sl,i)=> i === 0);
ok(fDrop2.orgIdx === 1 && fDrop2.selections[fDrop2.orgIdx].text === "丙" && fDrop2.groups[0].facts.join(",") === "1",
   "归类: 删当前点之前的点，当前点不跳格");

/* 老记录的 legacy-* 占位按题目签名回退到批改结果 */
state.flows = []; _flowId = null; state.history = []; lastGrade = null;
const qLeg = { background:"老记录材料。", requirements:"r", score:20 };
const fLeg = ensureFlow("sl.guina", "概括问题", qLeg, []);
state.history = migrateHistory([{ ts:1, module:"sl.guina", subtype:"概括问题", question:qLeg, answer:"老答案",
  hits:[{ point:"p", score:20, awarded:18, status:"部分命中", evidence:"答到：「老答案」" }],
  grade:{ total:90, scores:{}, comment:"c" } }]).list;
ok(gradeForFlow(fLeg) && gradeForFlow(fLeg).total === 90, "恢复: legacy flowId 的老记录按题目签名回退");
state.flows = []; _flowId = null; state.history = []; current = null;

/* 停用经验不被同义提炼重新启用 */
state.experiences = [{ id:"e_dis", type:"错因", kind:"", title:"漏写落款", body:"旧", scope:"module", module:"sl.guina", subject:"sl", ts:1, disabled:true, sourceSig:"s" }];
storeExperiences([{ type:"错因", title:"漏写落款", body:"新" }], "sl.guina", null, { background:"停用题。", requirements:"r" });
ok(state.experiences[0].disabled === true && state.experiences[0].body === "新",
   "经验: 停用之后同义提炼只更新正文，不偷偷重新启用");
state.experiences = [];

/* 分值缺一条就整块不动，不造 0 分项 */
const noScore = { question:{ score:20 }, keyPoints:[{ score:5 }, { title:"缺分值" }, { score:5 }] };
alignPointScores(noScore);
ok(noScore.keyPoints[1].score === undefined && noScore.keyPoints[0].score === 5,
   "采分点: 有一条没分值就整块不动（不把缺的那条写成 0 分项）");

/* 首页提示区只有一个写手：壳的告警与更新提示并列；按钮重画时复位 */
const _savedWinUpd = globalThis.window;
globalThis.window = { __otaStartupNotices: ["<b>端口告警</b>"] };
state.settings.apiKey = "sk-test";
updateInfo = null;
_view = "start"; banner("");
__updatePush({ supported:true, phase:"downloaded", latestVersion:"9.9.9", currentVersion:"1.0.0", autoDownload:false });
const _bhtml = el("#bannerSlot").innerHTML;
ok(_bhtml.indexOf("端口告警") >= 0 && _bhtml.indexOf("已下载完成") >= 0,
   "更新: 壳的启动提示与更新提示并列，不互相覆盖");
el("#bnrInstall").disabled = true;
__updatePush({ supported:true, phase:"available", latestVersion:"9.9.10", currentVersion:"1.0.0", autoDownload:false });
ok(el("#bnrUpdate").disabled === false && el("#bannerSlot").innerHTML.indexOf("bnrUpdate") >= 0,
   "更新: 重新推送时按钮复位（不会点过一次就永久卡死）");
ok(updateNoticeHtml({ supported:true, phase:"downloaded", latestVersion:"1.0.1", autoDownload:true }).indexOf("bnrInstall") >= 0,
   "更新: Windows 下载完成后首页也给「重启并更新」");

/* 更新状态不覆盖页面自己的横幅；题目页上的横幅归页面 */
banner("本地存储已满，这次练习记录没能保存。", "error");
__updatePush({ supported:true, phase:"up-to-date", currentVersion:"1.0.0" });
ok(el("#bannerSlot").innerHTML.indexOf("本地存储已满") >= 0,
   "更新: 推送不覆盖页面自己的错误横幅");
_view = "q"; banner("答题页的提示");
__updatePush({ supported:true, phase:"downloaded", latestVersion:"9.9.9", currentVersion:"1.0.0", autoDownload:false });
ok(el("#bannerSlot").innerHTML.indexOf("答题页的提示") >= 0 && el("#bannerSlot").innerHTML.indexOf("9.9.9") < 0,
   "更新: 题目页上的横幅归页面，更新状态不写");
_view = "start"; banner("");

/* 更新动作失败：失败原因保留到界面上，按钮能再点 */
const _realPost = postUpdateAction;
postUpdateAction = async ()=>({ ok:false, status:{ supported:true, phase:"downloaded", latestVersion:"9.9.9", currentVersion:"1.0.0", autoDownload:true } });
__updatePush({ supported:true, phase:"downloaded", latestVersion:"9.9.9", currentVersion:"1.0.0", autoDownload:true });
el("#btnInstallUpdate").disabled = false;
el("#btnInstallUpdate").onclick();
await null; await null;
ok(el("#btnInstallUpdate").disabled === false, "更新: 换包失败后「重启并更新」能再点");
ok(el("#updateNote").textContent.indexOf("没能开始换包") >= 0, "更新: 换包失败时保留失败原因，不被状态文案覆盖");
__updatePush({ supported:true, phase:"downloaded", latestVersion:"9.9.9", currentVersion:"1.0.0", autoDownload:true });
ok(el("#updateNote").textContent.indexOf("没能开始换包") >= 0, "更新: 失败原因留到下一次动作，后续状态推送不冲掉它");
postUpdateAction = async ()=>({ ok:false, status:{ supported:true, phase:"available", latestVersion:"9.9.10", currentVersion:"1.0.0", autoDownload:false } });
updateInfo = { supported:true, phase:"available", latestVersion:"9.9.10", currentVersion:"1.0.0", autoDownload:false };
pullUpdate();
await null; await null;
ok(el("#updateNote").textContent.indexOf("没能开始下载") >= 0, "更新: 下载失败时保留失败原因，不被状态文案覆盖");
postUpdateAction = _realPost;
globalThis.window = _savedWinUpd;

console.log(T.join("\n"));
const fails = T.filter(x => x.indexOf("FAIL") === 0);
console.log("\n== " + (T.length - fails.length) + "/" + T.length + " passed ==");
if(fails.length) process.exitCode = 1;
