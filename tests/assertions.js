/* ---- assertions against the app in the same scope ---- */
const el = s => document.querySelector(s);
const T = [];
const ok = (c, m) => T.push((c ? "PASS  " : "FAIL  ") + m);
// 画像从练习记录推导，测试统一用“往 history 里种成绩”的方式给数据
function scoresFor(k, v){ const sc={}; for(const d of MODULES[k].dims) sc[d]=v; return sc; }

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
ok(el("#profileBody").innerHTML.indexOf("短板·格式规范") >= 0, "画像: 短板由加权分推导");
ok(el("#profileBody").innerHTML.indexOf("强项·语言得体") >= 0, "画像: 强项由加权分推导");
// 文种统计同样近期加权：新 80、旧 60 → (80+60*0.85)/1.85 ≈ 71，而非终身平均 70
state.history = [ { module:"zy.gongwen", subtype:"通知", grade:{ total:80, scores: scoresFor("zy.gongwen",16) } },
                  { module:"zy.gongwen", subtype:"通知", grade:{ total:60, scores: scoresFor("zy.gongwen",12) } } ];
renderProfile();
ok(el("#profileBody").innerHTML.indexOf(">71<") >= 0, "画像: 文种统计近期加权 (71 而非 70)");

/* 4.5 总分口径唯一：模块「均分」必须吃 grade.total，不能被维度分带偏 */
state.history = [{ module:"zy.gongwen", subtype:"通知", grade:{ total:60, scores: scoresFor("zy.gongwen",15) } }];
ok(moduleAvg("zy.gongwen") === 60, "口径: 模块均分取总分（同一条记录维度分全是 15 也不改口）");
renderProfile();
ok(el("#profileBody").innerHTML.indexOf("均分 60") >= 0 && el("#profileBody").innerHTML.indexOf("均分 75") < 0,
   "口径: 画像显示「均分 60」，与练习记录表的总分是同一个数");
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
renderGrade({ scores:{}, strengths:["条理清楚"], weaknesses:["缺少主送机关"],
              hits:[ {point:"标题含事由",status:"命中",evidence:"考生写了标题"},
                     {point:"写明主送机关",status:"未命中",evidence:"缺主送机关"},
                     {point:"落款单位与日期",status:"部分命中",evidence:"有单位无日期"} ],
              comment:"继续加油" }, 60);
ok(el("#docBody").innerHTML.indexOf("采分点对照") >= 0, "阅卷页: 采分点对照表");
ok(el("#docBody").innerHTML.indexOf("hitline miss") >= 0, "阅卷页: 未命中标红");
ok(el("#docBody").innerHTML.indexOf("hitline part") >= 0, "阅卷页: 部分命中单独标记");
ok(el("#docBody").innerHTML.indexOf("继续加油") >= 0, "阅卷页: 点评渲染");

/* 4.5 采分点分值口径（满分/半分/零分三档 + 标注符号） */
ok(SCORING_RULES.indexOf("80%") >= 0 && SCORING_RULES.indexOf("40%") >= 0, "阅卷: prompt 写明三档阈值 (80% / 40%)");
ok(SCORING_RULES.indexOf("【缺：") >= 0 && SCORING_RULES.indexOf("△") >= 0 && SCORING_RULES.indexOf("✗") >= 0, "阅卷: prompt 写明三个标注符号");
ok(SCORING_RULES.indexOf("不倒扣") >= 0, "阅卷: prompt 写明不倒扣");
ok(GEN_POINT_RULES.indexOf("必须正好等于 question.score") >= 0, "出题: prompt 要求子项分值之和等于题目满分");
ok(GEN_POINT_RULES.indexOf("85%-95%") >= 0, "出题: prompt 要求子项长度落在字数上限的 85%-95%");
ok(JSON.stringify(pointsOf([{score:5,awarded:5},{score:5,awarded:2.5}])) === '{"got":7.5,"max":10}', "采分点: 实得分与满分求和");
ok(pointsOf([{score:5,awarded:99}]).got === 5, "采分点: 实得分夹在子项满分内（模型多给不算数）");
ok(pointsOf([{point:"没有分值的老数据"}]) === null, "采分点: 无分值信息时不冒充总分");
ok(hitClass({status:"满分"}) === "hit" && hitClass({status:"半分"}) === "part" && hitClass({status:"零分"}) === "miss", "采分点: 新档位名归类");
ok(hitClass({status:"命中"}) === "hit" && hitClass({status:"部分命中"}) === "part" && hitClass({status:"未命中"}) === "miss", "采分点: 旧档位名仍能归类");
renderGrade({ scores:{}, strengths:[], weaknesses:[], comment:"x", hits:[ {point:"标题含事由",score:5,awarded:5,status:"满分",evidence:"写了标题"},
                   {point:"落款单位与日期",score:5,awarded:0,status:"零分",evidence:"【缺：落款】"} ] }, 50);
ok(el("#docBody").innerHTML.indexOf("折合 50 分") >= 0, "阅卷页: 总分按采分点口径显示 (5 / 10 分)");
ok(el("#docBody").innerHTML.indexOf("5/5") >= 0 && el("#docBody").innerHTML.indexOf("0/5") >= 0, "阅卷页: 每个子项显示实得分/满分");
ok(el("#docBody").innerHTML.indexOf("不参与总分") >= 0, "阅卷页: 声明维度分不参与总分");
current.question.score = 20;   // 子项合计 15 ≠ 题目满分 20，必须明示而不是静默
renderGrade({ scores:{}, strengths:[], weaknesses:[], comment:"x", hits:[{point:"只列了一个子项",score:5,awarded:5,status:"满分"}] }, 33);
ok(el("#docBody").innerHTML.indexOf("与本题满分 20 分不一致") >= 0, "阅卷页: 子项合计与题目满分不一致时明示");

/* 4.9 划线随写随看 + 作答笔记 + 完整参考答案（2026-09-18 三改进） */
const qMk = { background:"ABCDEFG", requirements:"R" };
saveMarks(qSig(qMk), new Set([1,2,6]));
ok(markedRuns(qMk).length === 2 && markedRuns(qMk)[0] === "BC" && markedRuns(qMk)[1] === "G", "划线随写随看: 字符级标记还原成句子（保持原文顺序）");
saveQNote(qSig(qMk), "这道题要先分主体");
ok(getQNote(qSig(qMk)) === "这道题要先分主体" && getQNote(qSig({ background:"别的材料", requirements:"R" })) === "", "作答笔记: 按题目签名存取、不串题");
renderGrade({ scores:{}, strengths:[], weaknesses:[], comment:"x", modelAnswer:"第一，迅速核实情况。第二，按预案上报。", hits:[] }, 50);
ok(el("#docBody").innerHTML.indexOf("参考答案（范文") >= 0 && el("#docBody").innerHTML.indexOf("按预案上报") >= 0, "阅卷页: 完整参考答案渲染");

/* 5. 失败路径 */
el("#docBody").innerHTML = "正在作答的题";
handleErr({ code:"API", status:400, text:"model not found" }, true);
ok(el("#docBody").innerHTML.indexOf("正在作答的题") >= 0, "出错时保留题目与答案（不再被清空）");
ok(el("#bannerSlot").innerHTML.indexOf("模型名") >= 0, "HTTP 400 给出模型名提示");
ok(el("#bannerSlot").innerHTML.indexOf("model not found") >= 0, "异常时透出接口原文");
handleErr({ code:"JSON" }, true);
ok(el("#bannerSlot").innerHTML.indexOf("格式异常") >= 0, "AI 吐坏 JSON 时提示重试（不再漏成裸异常）");
handleErr({ code:"TIMEOUT" }, false);
ok(el("#docBody").innerHTML.indexOf("开始今天的练习") >= 0, "无题可看时才回到起点");
handleErr({ code:"NO_KEY" }, true);
ok(el("#bannerSlot").innerHTML.indexOf("AI Key") >= 0, "未配置 Key 有明确指引");

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
el("#btnTpl").onclick();
ok(el("#wordCount").innerHTML.indexOf("<b>0<") < 0, "骨架: 插入后字数同步");
ok(loadDraft(qSig(current.question)).indexOf("关于") >= 0, "骨架: 插入后草稿已保存");
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
globalThis.fetch = () => Promise.resolve({ ok:true, status:200, json: async()=>({ data:[{id:"z-model"},{id:"a-flash-model"},{id:"m-chat"}] }), headers:{ get:()=>"application/json" }, text: async()=>"" });
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

/* 8.3 推理程度随模型适配：认得出的家族按各自发法，认不出的不带档位也不显三档 */
state.settings.apiKey = "sk-test";
const capBodies = [];
const realFetch8 = globalThis.fetch;
globalThis.fetch = (url, opt) => { capBodies.push(JSON.parse(opt.body));
  return Promise.resolve({ ok:true, status:200, json: async()=>({ choices:[{ message:{ content:"ok" } }] }), headers:{ get:()=>"application/json" }, text: async()=>"" }); };
state.settings.model = "deepseek-v4-pro"; state.settings.reasonLevel = "standard";
await callLLM("s","u",false);
ok(capBodies.at(-1).reasoning_effort === "medium", "适配: effort 家族标准档=reasoning_effort medium");
state.settings.reasonLevel = "deep";
await callLLM("s","u",false);
ok(capBodies.at(-1).reasoning_effort === "high", "适配: 深入档=high");
state.settings.model = "qwen3-32b"; state.settings.reasonLevel = "quick";
await callLLM("s","u",false);
ok(capBodies.at(-1).enable_thinking === false, "适配: qwen3 快速档=直接关闭思考");
state.settings.reasonLevel = "deep";
await callLLM("s","u",false);
ok(capBodies.at(-1).enable_thinking === true && capBodies.at(-1).thinking_budget === 24576, "适配: qwen3 深入档=大思考预算");
state.settings.model = "gpt-4o-mini"; state.settings.reasonLevel = "standard";
await callLLM("s","u",false);
ok(capBodies.at(-1).reasoning_effort === "medium" && capBodies.at(-1).temperature === 0.7,
   "适配: 未识别的模型也按思考强度试探，是否支持以实测为准");
el("#setModel").value = "deepseek-v4-pro"; setReasonUI();
ok(el("#segReason").style.display !== "none", "适配: 有档位的模型显示三档");
el("#setModel").value = "gpt-4o-mini"; setReasonUI();
ok(el("#segReason").style.display !== "none", "适配: 未识别的模型默认也显示三档（被拒才收）");
globalThis.fetch = realFetch8;

/* 8.4 档位实测记忆：被拒过就记住，之后不再白发被拒请求 */
const realFetch84 = globalThis.fetch;
capBodies.length = 0;
globalThis.fetch = (url, opt) => { const b = JSON.parse(opt.body); capBodies.push(b);
  if(b.reasoning_effort) return Promise.resolve({ ok:false, status:400, json: async()=>({}), headers:{ get:()=>"application/json" }, text: async()=>"bad param" });
  return Promise.resolve({ ok:true, status:200, json: async()=>({ choices:[{ message:{ content:"ok" } }] }), headers:{ get:()=>"application/json" }, text: async()=>"" }); };
state.settings.model = "deepseek-v4-pro"; state.settings.reasonLevel = "deep";
await callLLM("s","u",false);
ok(capBodies.filter(b=>b.reasoning_effort).length === 1 && state.modelCaps["deepseek-v4-pro"] === "rejected",
   "实测记忆: 参数被拒自动降级成功，并记住此模型拒收思考参数");
ok(el("#bannerSlot").innerHTML.indexOf("不收思考强度参数") >= 0,
   "实测记忆: 探针被拒有界面提示（不再是静默降级）");
const nB84 = capBodies.length;
await callLLM("s","u",false);
ok(capBodies.length === nB84 + 1 && !("reasoning_effort" in capBodies.at(-1)),
   "实测记忆: 之后直接按温度发，不再白发一次被拒请求");
el("#setModel").value = "deepseek-v4-pro"; setReasonUI();
ok(el("#segReason").style.display === "none" && el("#reasonNote").textContent.indexOf("拒收") >= 0,
   "实测记忆: 界面收起三档并说明原因");
globalThis.fetch = (url, opt) => { const b = JSON.parse(opt.body); capBodies.push(b);
  return Promise.resolve({ ok:true, status:200, json: async()=>({ choices:[{ message:{ content:"ok" } }] }), headers:{ get:()=>"application/json" }, text: async()=>"" }); };
state.settings.model = "deepseek-v4-flash";
await callLLM("s","u",false);
ok(state.modelCaps["deepseek-v4-flash"] === "ok" && "reasoning_effort" in capBodies.at(-1),
   "实测记忆: 参数被接受则记住 ok，一次请求就成功");
globalThis.fetch = realFetch84;

/* 8.5 档位有效性观测：思考量/耗时按模型×档位累计，两档对比给结论 */
state.modelProbe = {};
recordProbe("m-x","quick",100,10); recordProbe("m-x","quick",100,10); recordProbe("m-x","deep",2000,80);
let pn85 = probeNote("m-x");
ok(pn85.indexOf("快速≈思考100字/10s") >= 0 && pn85.indexOf("深入≈思考2000字/80s") >= 0 && pn85.indexOf("切换有效") >= 0,
   "档位观测: 两档思考量差距大 → 明确告知切换有效");
recordProbe("m-y","quick",500,10); recordProbe("m-y","deep",520,11);
ok(probeNote("m-y").indexOf("可能没真把档位当回事") >= 0,
   "档位观测: 两档几乎无差 → 如实提示存疑，不假装生效");
ok(probeNote("m-none") === "", "档位观测: 没有实测数据不下结论");
ok(sseReasonDelta('data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}') === "思考中"
   && sseDelta('data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}') === "",
   "档位观测: SSE 思考增量单独可提取，不混入正文");
state.modelProbe = {};
delete state.modelCaps["deepseek-v4-pro"];   // 清掉 8.4 记下的拒收，不然探测被跳过
const realFetch85 = globalThis.fetch;
globalThis.fetch = (url, opt) => Promise.resolve({ ok:true, status:200, json: async()=>({ choices:[{ message:{ content:"ok", reasoning_content:"思考思考思考思考" } }] }), headers:{ get:()=>"application/json" }, text: async()=>"" });
state.settings.model = "deepseek-v4-pro"; state.settings.reasonLevel = "deep";
await callLLM("s","u",false);
ok(state.modelProbe["deepseek-v4-pro"] && state.modelProbe["deepseek-v4-pro"].deep && state.modelProbe["deepseek-v4-pro"].deep.reason === 8,
   "档位观测: 响应中的思考内容按模型×档位累计");
globalThis.fetch = realFetch85;
ok(await (async()=>{   // 模型为空时不能拿写死的名字去撞接口
  const kk = state.settings.apiKey, mm = state.settings.model;
  state.settings.apiKey = "sk-test"; state.settings.model = "";
  let code = ""; try{ await callLLM("s","u",false); }catch(e){ code = e && e.code; }
  state.settings.apiKey = kk; state.settings.model = mm;
  return code;
})() === "NO_MODEL", "没有模型时: 直接报 NO_MODEL，不兜底成某个写死的名字");

/* 8.5 科目分叉：申论走七步链（读材料→找点→…→沉淀），综应A 走两阶段（学习卡 → 作答 → 批改） */
ok(usesFlowChain("sl.guina") && usesFlowChain("sl.guanche"), "分叉: 申论走七步链");
ok(!usesFlowChain("zy.gongwen") && !usesFlowChain("zy.guina"), "分叉: 综应A 走两阶段");
saveNote("sl.guina","概括原因","申论要点一：先找动词");
ok(getNote("sl.guina","概括原因") === "申论要点一：先找动词" && getNote("sl.guina","概括做法") === "", "笔记: 按模块+子类型键存取，不串味");
state.history = [{ module:"sl.guina", subtype:"概括原因", cardPeeks:2, grade:{ total:70, scores:{} } }];
current = { module:"sl.guina", subtype:"概括原因", question:{ background:"阶段题。第二句！", requirements:"不超过250字。" }, cardPeeks:0,
            studyCard:{ title:"概括原因·学习卡", points:["要点"], pitfalls:["坑"], templates:"框架文本" } };
renderQuestion();
ok(el("#docBody").innerHTML.indexOf("flowRail") >= 0 && el("#docBody").innerHTML.indexOf("读材料") >= 0, "申论七步链: 步骤条在场，落点是读材料");
ok(activeFlow() && activeFlow().module === "sl.guina", "申论七步链: 渲染即建链");
ok(el("#docBody").innerHTML.indexOf("题目（模块") >= 0, "读材料: 题目与材料同屏");
ok(el("#docBody").innerHTML.indexOf("解题要点") >= 0, "读材料: 学习卡折叠并入本步（展开可看）");
ok(el("#docBody").innerHTML.indexOf("申论要点一：先找动词") >= 0, "读材料: 笔记可见可续写（真实输入走 input 监听，真机另验）");
ok(el("#docBody").innerHTML.indexOf("上次练习翻了 2 次卡") >= 0, "熟悉度: 显示上次翻卡次数");
ok(el("#docBody").innerHTML.indexOf("btnFlowNext") < 0, "导航: read 步不摆 Next（靠「开始找点」推进）");
flowGoStep("draft");
ok(el("#docBody").innerHTML.indexOf("提交阅卷") >= 0, "一稿: 提交阅卷在场");
ok(el("#docBody").innerHTML.indexOf("btnFlowNext") < 0, "导航: draft 步不摆 Next（靠「提交阅卷」推进）");
ok(el("#docBody").innerHTML.indexOf("申论要点一：先找动词") >= 0, "一稿: 能看到自己的笔记");
ok(el("#docBody").innerHTML.indexOf("翻学习卡") >= 0, "一稿: 翻卡浮标在场");
el("#btnCard").onclick();
ok(current.cardPeeks === 1 && el("#cardDrawer").hidden === false, "抽屉: 打开即计次");
ok(el("#drawerBody").innerHTML.indexOf("解题要点") >= 0, "抽屉: 卡片原文只在抽屉里");
saveNote("sl.guina","概括原因","申论要点一：先找动词\n要点二：归类上位词");
el("#btnDrawerClose").onclick();
ok(el("#cardDrawer").hidden === true, "抽屉: 可关闭");
el("#btnCard").onclick();
ok(current.cardPeeks === 2, "抽屉: 再看再计");
const flowGate = activeFlow();
ok(flowGoStep("review") === false && flowGate.step === "draft", "批改门槛: 无批改结果不得进入批改步");
ok(el("#bannerSlot").innerHTML.indexOf("批改") >= 0, "批改门槛: 拒绝时有明确提示");

/* 综应A：两阶段——不建链、不渲染步骤条；学习卡（折叠+笔记+翻卡计数）→ 开始作答 → 作答页；翻卡计次照旧 */
saveNote("zy.gongwen","通知","综应要点：格式三件套");
state.history = [{ module:"zy.gongwen", subtype:"通知", cardPeeks:2, grade:{ total:70, scores:{} } }];
current = { module:"zy.gongwen", subtype:"通知", question:{ background:"综应阶段题。", requirements:"写一份通知。" }, cardPeeks:0,
            studyCard:{ title:"通知·学习卡", points:["要点"], pitfalls:["坑"], templates:"框架" } };
renderQuestion();
ok(!state.flows.some(x=>x.sig === qSig(current.question)) && (activeFlow() === null || activeFlow().module === "sl.guina"), "综应A: 渲染不建训练链");
ok(el("#docBody").innerHTML.indexOf("flowRail") < 0, "综应A: 不渲染七步步骤条");
ok(el("#docBody").innerHTML.indexOf("我已学习，开始作答") >= 0, "综应A: 学习卡阶段有「开始作答」入口");
ok(el("#docBody").innerHTML.indexOf("综应要点：格式三件套") >= 0, "综应A: 学习卡阶段笔记可见");
ok(el("#docBody").innerHTML.indexOf("上次作答中你翻了 2 次卡") >= 0, "综应A: 翻卡熟悉度提示照旧");
ok(el("#docBody").innerHTML.indexOf("展开可看") < 0 && el("#docBody").innerHTML.indexOf("解题要点") >= 0,
   "综应A: 卡阶段整页平铺不再折叠（页面就是给卡的）");
ok(cardHtml({points:["要点"],pitfalls:["失分"],templates:"框架",example:{scene:"燃气泄漏的示例场景。",ask:"你会怎么处置？"}}).indexOf("这类题长什么样") >= 0,
   "学习卡: example 栏目渲染（示例案例+典型问法）");
ok(cardHtml({points:[],pitfalls:[],templates:""}).indexOf("这类题长什么样") < 0,
   "学习卡: 旧卡没有 example 也不渲染空栏目");
el("#btnZyAnswer").onclick();
ok(el("#docBody").innerHTML.indexOf("提交阅卷") >= 0 && el("#docBody").innerHTML.indexOf("背景材料") >= 0, "综应A: 作答页 = 材料 + 作答区");
ok(el("#docBody").innerHTML.indexOf("翻学习卡") >= 0, "综应A: 作答页翻卡浮标在场");
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
ok(el("#docBody").innerHTML.indexOf("分值：</b>20 分") < 0, "题目页: 卡阶段不亮分值（题面未出）");
el("#btnZyAnswer").onclick();
ok(el("#docBody").innerHTML.indexOf("分值：</b>20 分") >= 0, "题目页: 题目满分对考生可见（作答阶段亮出）");
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
renderTabs();
ok(el("#modbar").innerHTML.indexOf("__all") < 0, "页签: 综合页签已撤（不选题型即综合推送，不设双入口）");
renderStart();
ok(el("#docBody").innerHTML.indexOf("智能推送下一题") >= 0 && el("#docBody").innerHTML.indexOf("按综合来推") >= 0, "起始页: 智能推送入口 + 「不选题型就按综合来推」明示");
tabClick("zy.guina");
ok(el("#docBody").innerHTML.indexOf("概括原因") >= 0 && el("#docBody").innerHTML.indexOf("开始练习") >= 0, "落地页: 子类型芯片 + 显式开始按钮");
ok(el("#docBody").innerHTML.indexOf("还没练过") >= 0, "落地页: 无数据显示未练状态");
state.history = [{ module:"zy.guina", subtype:"概括原因", grade:{ total:60, scores: scoresFor("zy.guina",12) }, cardPeeks:4 }];
const orRand2 = Math.random; Math.random = () => 0.9;
ok(pickSubtypeFor("zy.guina") === "概括原因", "调度: 非公文题型同样按翻卡优先 (got " + pickSubtypeFor("zy.guina") + ")");
Math.random = orRand2;
state.history = [];

/* 8.8 机关名默认值迁移 */
localStorage.setItem("gw_state", JSON.stringify({ settings:{ orgName:"综应练习台" }, profile:{}, history:[], cache:{} }));
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

/* 9. 科目切换：页签只列当前科目的模块 / 抬头跟科目 / 画像分组 / prompt 口径 */
state.history = [];
state.profile.lastModules = ["zy.shiwu", "sl.guanche"];   // 两个科目各有一个「上次练的模块」
renderTabs();
ok(el("#subjbar").innerHTML.indexOf("综应A") >= 0 && el("#subjbar").innerHTML.indexOf("申论") >= 0,
   "科目切换: 两个科目都在页签区");
ok(el("#modbar").innerHTML.indexOf("公文写作") >= 0 && el("#modbar").innerHTML.indexOf("贯彻执行") < 0,
   "页签: 当前科目（综应A）只列综应模块");
switchSubject("sl");
ok(curSubject() === "sl" && state.settings.subject === "sl", "科目: 切换后落盘 settings.subject");
ok(el("#modbar").innerHTML.indexOf("贯彻执行") >= 0 && el("#modbar").innerHTML.indexOf("公文写作") < 0
   && el("#modbar").innerHTML.indexOf("案例实务") < 0, "页签: 切到申论后只渲染申论模块");
ok(activeModule === null, "科目: 切到申论后落在综合起始页（不再暗记上次模块，抬头如实报综合推送）");
ok(el("#modLabel").textContent === "申论 · 综合推送", "抬头: 科目名 · 综合推送（起始页不再挂模块名）");
switchSubject("zy");
ok(el("#modbar").innerHTML.indexOf("公文写作") >= 0 && el("#modbar").innerHTML.indexOf("贯彻执行") < 0,
   "页签: 切回综应A 只留综应模块");
ok(activeModule === null, "科目: 切回综应A 同样落在综合起始页");
ok(el("#modLabel").textContent === "综应A · 综合推送", "抬头: 切回后科目名跟着走");

// 「综合」= 当前科目内综合
state.settings.subject = "sl"; renderTabs();
const slSeen = {};
for(let i=0;i<200;i++){ slSeen[weakestModule()] = 1; }
ok(Object.keys(slSeen).every(k=>k.indexOf("sl.")===0) && Object.keys(slSeen).length === SUBJECTS.sl.modules.length,
   "综合推送: 只在当前科目内选模块 -> " + Object.keys(slSeen).join(","));
state.settings.subject = "zy"; ensureActive(); renderTabs();

// 画像按科目分组 + 练习记录加科目列
state.history = [];
renderProfile();
const ph1 = el("#profileBody").innerHTML;
ok(ph1.indexOf("综应A") >= 0 && ph1.indexOf("申论") >= 0 && ph1.indexOf("综应A") < ph1.indexOf("申论"),
   "画像: 按科目分组渲染，综应A 在前申论在后");
ok(ph1.indexOf("公文写作") < ph1.indexOf("贯彻执行"), "画像: 科目组内按模块列出，下一科目接在后面");
state.history = [{ ts:1, module:"sl.guanche", subtype:"讲话稿", grade:{ total:66, scores:{}, weaknesses:["少落款"] } }];
renderProfile();
const ph2 = el("#profileBody").innerHTML;
ok(ph2.indexOf(">科目<") >= 0, "画像: 练习记录新增「科目」列");
ok(ph2.indexOf("申论</td><td>贯彻执行") >= 0, "画像: 记录行同时显示科目与模块");
state.history = [];

/* 9.5 prompt 口径随模块所属科目走（拦下 callLLM，直接看真拼出来的 system prompt） */
const realCallLLM = callLLM;
let cap = null;
callLLM = async (sys, user)=>{ cap = { sys, user }; return { question:{ background:"b", requirements:"r" }, keyPoints:[] }; };
await gen("sl.guina", "概括原因", null, false);
ok(cap.sys.indexOf(SUBJECTS.sl.role) >= 0 && cap.sys.indexOf(SUBJECTS.zy.role) < 0, "出题 prompt: 申论模块用申论口径");
ok(cap.sys.indexOf("归纳概括") >= 0 && cap.sys.indexOf(GEN_POINT_RULES) >= 0, "出题 prompt: 保留模块说明与采分点规则");
await gen("zy.gongwen", "通知", null, false);
ok(cap.sys.indexOf(SUBJECTS.zy.role) >= 0 && cap.sys.indexOf(SUBJECTS.sl.role) < 0, "出题 prompt: 综应模块用综应A 口径");
ok(cap.sys.indexOf("不超过500字") >= 0, "出题 prompt: 公文写作把文种的字数上限写死进 prompt（通知 500），不再让模型自己编");
await grade("sl.guanche", "讲话稿", { background:"b" }, [], "答案");
ok(cap.sys.indexOf(SUBJECTS.sl.role) >= 0 && cap.sys.indexOf(SCORING_RULES) >= 0 && cap.sys.indexOf("80%") >= 0,
   "阅卷 prompt: 申论口径 + 三档计分规则原样保留");
await grade("zy.shiwu", null, { background:"b" }, [], "答案");
ok(cap.sys.indexOf(SUBJECTS.zy.role) >= 0 && cap.sys.indexOf("维度分只用于画像诊断") >= 0,
   "阅卷 prompt: 综应口径 + 维度锚定原样保留");
callLLM = realCallLLM;

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
   "申发论述: 归申论、走七步链，不套公文那套维度");

/* 11. 七步训练链：状态机 / 找点 / 归类 / 提纲进批改 / 迁移 / 裁剪 */
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
/* ② syncRail 三态 */
const rail = syncRail({ step:"organize" });
ok(rail.map(x=>x.state).join(",") === "done,done,active,pending,pending,pending,pending", "步骤条: i<cur done / = active / > pending");
ok(rail[2].label === "归类" && rail.length === FLOW_STEPS.length, "步骤条: 标签来自 FLOW_LABELS");

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
ok(toggleSentenceSelection(fB, 0, "") === true && fB.selections.some(sl=> !sl.free && sl.sentenceId === 0), "找点: 点选整句收入");
ok(toggleSentenceSelection(fB, 0, "s0") === true && !fB.selections.some(sl=> !sl.free && sl.sentenceId === 0), "找点: 再点取消整句，划选记录不受影响");

/* 归类：组数与提纲 */
fB.groups = groupAutoSplit(fB.selections);
ok(fB.groups.length === Math.min(Math.max(fB.selections.length,1),8), "归类: 组数 = clamp(选区数,1,8)");
ok(fB.groups.every(g=> Array.isArray(g.facts)), "归类: 每组有归属数组");
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
  flows:[ { id:"flow_1", subject:"zy", module:"zy.guina", subtype:null, sig:"q1", question:{background:"b"}, keyPoints:[], createdAt:1, closedAt:null, step:"read", attempts:[], selections:[], groups:[], drafts:[] },
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

/* ============ 12. 第二批：回改 / 回滚 / 经验闭环 / 恢复现场 ============ */

/* 12.1 行级 LCS diff */
ok(JSON.stringify(diffLCS("", "")) === "[]", "diff: 空 vs 空 = 无差异");
ok(diffLCS("a\nb", "a\nb").every(op=>op.t==="same") && diffLCS("a\nb","a\nb").length === 2, "diff: 全等 = 全 same");
const dAB = diffLCS("a\nb", "a\nc");
ok(dAB.some(op=>op.t==="del"&&op.text==="b") && dAB.some(op=>op.t==="add"&&op.text==="c") && dAB.some(op=>op.t==="same"&&op.text==="a"), "diff: 单行改动 = 一删一增一保留");
const dXY = diffLCS("a\nb\nc", "x\ny\nz");
ok(dXY.filter(op=>op.t==="del").length === 3 && dXY.filter(op=>op.t==="add").length === 3, "diff: 全异 = 全删全增");
ok(diffHtml("a\nb", "a\nc").indexOf("dline add") >= 0 && diffHtml("a\nb","a\nc").indexOf("dline del") >= 0, "diff: HTML 标出新增与删除");
ok(diffHtml("同\n稿", "同\n稿").indexOf("没有行级差异") >= 0, "diff: 无差异时轻提示");

/* 12.2 回改 revise：预填上一稿 + drafts 压栈 + rewrite 提交带 mode+previousReview */
state.history = []; state.experiences = []; _lastDistilled = [];
current = { module:"sl.guina", subtype:"概括问题", question:{ background:"回改题材料。", requirements:"不超过250字。" }, cardPeeks:0 };
renderQuestion();
const fR = activeFlow();
flowGoStep("draft");
el("#answer").value = "第一稿的作答内容，字数肯定超过二十个字了，没有问题。";
el("#btnSubmit").disabled = false;
const realCall12 = callLLM;
let cap12 = null;
callLLM = async (sys, user)=>{ cap12 = { sys, user }; return { hits:[ {point:"要点一",score:10,awarded:5,status:"半分",evidence:"△ 表述不准"}, {point:"要点二",score:10,awarded:0,status:"零分",evidence:"【缺：关键对策】"} ], scores:{}, strengths:[], weaknesses:[], comment:"x" }; };
await submitAnswer();
ok(fR.step === "review" && fR.attempts.length === 1, "回改: 一稿提交进入批改步");
ok(JSON.parse(cap12.user).mode === undefined, "回改: 一稿提交不带 rewrite 标记");
flowGoStep("revise");
ok(fR.drafts.length === 1 && fR.drafts[0].step === "revise" && fR.drafts[0].text.indexOf("第一稿") >= 0, "回改: 上一稿压栈 flow.drafts");
ok(el("#answer").value.indexOf("第一稿") >= 0, "回改: 作答区预填上一稿");
ok(el("#docBody").innerHTML.indexOf("要点一") >= 0 && el("#docBody").innerHTML.indexOf("【缺：关键对策】") >= 0, "回改: 回改清单列出 ✗/◐ 子项与缺失标注");
ok(el("#docBody").innerHTML.indexOf("diffBox") >= 0, "回改: 行级差异对照框在场");
el("#answer").value = "第一稿的作答内容，字数肯定超过二十个字了，没有问题。\n补上关键对策的一行。";
el("#btnSubmit").disabled = false;
await submitAnswer();
const sent12 = JSON.parse(cap12.user);
ok(sent12.mode === "rewrite" && Array.isArray(sent12.previousReview) && sent12.previousReview.length === 2 && sent12.previousReview[0].point === "要点一", "回改: 提交带 mode=rewrite + previousReview");
ok(fR.attempts.length === 2 && fR.attempts[1].mode === "rewrite", "回改: attempts 追加并标记 rewrite");
ok(state.history[0].answer.indexOf("补上关键对策") >= 0, "回改: 回改稿照常入练习记录（总分口径不变）");
ok(cap12.sys.indexOf("previousReview") >= 0 && cap12.sys.indexOf("计分口径不变") >= 0, "回改: prompt 说明回改背景，计分口径一字不动");

/* 12.3 rollbackFlowFrom：回滚 history 与 lastModules，保留 drafts/selections/groups */
const lmBefore = state.profile.lastModules.filter(x=>x==="sl.guina").length;
const histBefore = state.history.length;
ok(rollbackFlowFrom("review") === true, "回滚: 从批改页可回滚");
ok(state.history.length === histBefore - 1, "回滚: 移除该 flow 最近一次的练习记录");
ok(state.history[0].answer.indexOf("补上关键对策") < 0, "回滚: 被回滚的那稿不再在记录里");
ok(fR.attempts.length === 1 && fR.step === "draft", "回滚: attempts 退一位，step 落到目标步前一步（一稿）");
ok(fR.drafts.length === 1 && Array.isArray(fR.selections) && Array.isArray(fR.groups), "回滚: drafts/selections/groups 原样保留");
ok(loadDraft(qSig(current.question)).indexOf("第一稿") >= 0, "回滚: 保留稿放回草稿槽，回一稿能恢复");
ok(state.profile.lastModules.filter(x=>x==="sl.guina").length === lmBefore - 1, "回滚: lastModules 同步退一位");
ok(lastGrade === null, "回滚: 过期批改结果不再展示");
el("#answer").value = "重新写的一稿，字数肯定超过二十个字了，没有问题。";
el("#btnSubmit").disabled = false;
await submitAnswer();
ok(fR.attempts.length === 2, "回滚: 回到一稿后可重新提交");
ok(rollbackFlowFrom("review", { attemptIndex:0 }) === true && fR.attempts.length === 0, "回滚: attemptIndex=0 清空全部尝试");
ok(!state.history.some(h=>h.flowId === fR.id), "回滚: attemptIndex=0 移除该 flow 全部记录");
ok(rollbackFlowFrom("draft") === false, "回滚: 批改之前的步无可回滚");
closeActiveFlow("test-done");
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
callLLM = realCall12;

/* 12.6 提炼失败静默：不影响批改展示、不弹错、不写半条数据 */
_lastDistilled = [];
const expCnt = state.experiences.length;
let rejectedE = false;
callLLM = async ()=>{ throw { code:"API", status:500, text:"boom" }; };
await distillExperience("sl.guina",null,{ hits:[], weaknesses:[], comment:"" }, { background:"失败题。", requirements:"r" }).catch(()=>{ rejectedE = true; });
ok(rejectedE, "提炼失败: 异常可被调用方吞掉（submitAnswer 里 fire-and-forget）");
ok(state.experiences.length === expCnt && _lastDistilled.length === 0, "提炼失败: 不写半条经验");
ok(el("#bannerSlot").innerHTML === "", "提炼失败: 静默，不弹任何错误横幅");
callLLM = realCall12;

/* 12.7 恢复现场：有 24h 内未关闭的链时给入口，点了才跳，不自动跳转 */
state.flows = []; _flowId = null; current = null;
const rq12 = { background:"恢复题材料。", requirements:"r" };
const rFlow = ensureFlow("sl.guina", "概括问题", rq12, []);
rFlow.step = "extract";
renderStart();
ok(el("#docBody").innerHTML.indexOf("继续上次没做完的题") >= 0, "恢复现场: 有未关闭的链时首页给入口");
ok(el("#docBody").innerHTML.indexOf("extractBox") < 0, "恢复现场: 不自动跳进链里");
el("#btnResume").onclick();
ok(_flowId === rFlow.id && current && current.module === "sl.guina", "恢复现场: 点击后才回到链上");
ok(el("#docBody").innerHTML.indexOf("extractBox") >= 0, "恢复现场: 进入链停下的那一步");
rFlow.createdAt = Date.now() - 25*3600*1000;
current = null; _flowId = null;
renderStart();
ok(el("#docBody").innerHTML.indexOf("继续上次没做完的题") < 0, "恢复现场: 超 24h 的链不再提示");
state.flows = []; _flowId = null;

/* 12.8 小修：organize 未入组提示 + 提纲/找点不自动重排 */
const fOrg = { selections:[{text:"甲点"},{text:"乙点"}], groups:[{name:"",facts:[0]}], question:{background:"x"} };
ok(organizePanelHtml(fOrg).indexOf("1 个新找的点还没进组") >= 0, "organize: 有未入组的点时轻提示");
ok(organizePanelHtml({ selections:[{text:"甲点"}], groups:[{name:"",facts:[0]}], question:{background:"x"} }).indexOf("还没进组") < 0, "organize: 全部入组时不提示");

current = null;

/* ============ 13. 快判（第三入口）：事实选择 / 分组概括 / 表达比较 ============ */

/* ① 入口：科目栏第三个按钮，进入快判落地页；作答轨两科目不受影响 */
renderTabs();
ok(el("#subjbar").innerHTML.indexOf("快判") >= 0 && el("#subjbar").innerHTML.indexOf('data-s="__pd"') >= 0,
   "快判: 科目栏有第三入口");
switchSubject("zy");
ok(el("#modbar").innerHTML.indexOf("公文写作") >= 0, "快判: 切回作答轨后模块页签照旧（综应A）");
enterPD();
ok(pdActive === true && el("#subjbar").innerHTML.indexOf('class="subjbtn active" data-s="__pd"') >= 0
   && el("#subjbar").innerHTML.indexOf('class="subjbtn active" data-s="zy"') < 0,
   "快判: 进入后高亮快判按钮、作答轨科目按钮不高亮");
ok(el("#modLabel").textContent.indexOf("快判") === 0, "快判: 抬头不挂科目名");
ok(el("#modbar").innerHTML.indexOf("公文写作") < 0 && el("#modbar").innerHTML.indexOf("综合") < 0,
   "快判: 不渲染综应/申论的模块页签");
const pdLand = el("#docBody").innerHTML;
ok(PD_FORM_ORDER.every(id=> pdLand.indexOf(PD_FORMS[id].name) >= 0) && pdLand.indexOf("开始") >= 0,
   "快判: 落地页三种形式各有说明与开始入口");
ok(pdLand.indexOf("综合快判") >= 0 && pdLand.indexOf(`data-pdform="${PD_MIX}"`) >= 0,
   "快判: 落地页给「综合快判」一个窗口（三种形式混在一轮），单练入口仍在");
switchSubject("sl");
ok(pdActive === false && el("#modbar").innerHTML.indexOf("贯彻执行") >= 0 && el("#modbar").innerHTML.indexOf("公文写作") < 0,
   "快判: 从快判切申论，作答轨页签正常恢复");
switchSubject("zy");
ok(el("#modbar").innerHTML.indexOf("公文写作") >= 0 && el("#subjbar").innerHTML.indexOf("快判") >= 0,
   "快判: 切回综应A，页签齐全且快判入口仍在");

/* ①b 返回综合：再点当前科目按钮 = 回起始页，不用绕道切科目再切回来 */
renderModuleLanding("zy.gongwen");
ok(el("#docBody").innerHTML.indexOf("开始今天的练习") < 0,
   "返回综合: 前置——人在公文写作落地页");
backToStart();
ok(el("#docBody").innerHTML.indexOf("开始今天的练习") >= 0 && tabActiveKey === null,
   "返回综合: 再点当前科目回到综合推送，页签全灭");
ok(el("#modLabel").textContent === "综应A · 综合推送", "返回综合: 抬头如实报「科目 · 综合推送」，不再挂上次练的模块名");

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
   && el("#docBody").innerHTML.indexOf("再来一轮") >= 0 && el("#docBody").innerHTML.indexOf("换个形式") >= 0,
   "轮次: 收卷后一屏小结，含再来一轮 / 换个形式");
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
renderProfile();
const phPD = el("#profileBody").innerHTML;
ok(phPD.indexOf("快判（点选即判") >= 0 && phPD.indexOf("事实选择") >= 0, "画像: 快判单独一节");

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
ok(phPD.indexOf(">50%<") >= 0, "画像: 快判正确率 (1/2 = 50%)");
ok(phPD.indexOf(">快判</td>") >= 0 && phPD.indexOf(">1/2<") >= 0, "画像: 记录表识别快判行（对/总题数）");
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
renderProfile();
ok(el("#profileBody").innerHTML.indexOf("分组概括") >= 0 && el("#profileBody").innerHTML.indexOf("0%") >= 0,
   "迁移: 新旧混合记录渲染不报错，画像统计正确");
localStorage.clear();
state.history = [];

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
enterPD();
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
state.flows.push({ id:"f_draft", subject:"zy", module:"zy.guina", sig:qSig(pq14), question:pq14, keyPoints:[], createdAt:1, closedAt:9, step:"done", attempts:[], selections:[], groups:[], drafts:[] });
for(let i=0;i<25;i++) state.flows.push({ id:"f"+i, subject:"zy", module:"zy.guina", sig:"sig"+i, question:{background:"b"+i}, keyPoints:[], createdAt:2+i, closedAt:9, step:"done", attempts:[], selections:[], groups:[], drafts:[] });
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

console.log(T.join("\n"));
const fails = T.filter(x => x.indexOf("FAIL") === 0);
console.log("\n== " + (T.length - fails.length) + "/" + T.length + " passed ==");
if(fails.length) process.exitCode = 1;
