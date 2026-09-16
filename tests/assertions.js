/* ---- assertions against the app in the same scope ---- */
const el = s => document.querySelector(s);
const T = [];
const ok = (c, m) => T.push((c ? "PASS  " : "FAIL  ") + m);
// 画像从练习记录推导，测试统一用“往 history 里种成绩”的方式给数据
function scoresFor(k, v){ const sc={}; for(const d of MODULES[k].dims) sc[d]=v; return sc; }

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
ok(difficultyFor("gongwen") === "适中", "难度: 未练过默认适中");
state.history = [{ module:"gongwen", grade:{ scores: scoresFor("gongwen",17) } }]; // 85%
ok(difficultyFor("gongwen") === "较难", "难度: 高分加码到较难");
state.history = [{ module:"gongwen", grade:{ scores: scoresFor("gongwen",9) } }];  // 45%
ok(difficultyFor("gongwen") === "简单", "难度: 低分退到简单");
state.history = [];
ok(wordLimit({ requirements:"以街道办名义写一份通知，不超过300字。" }) === 300, "字数上限: 不超过N字");
ok(wordLimit({ requirements:"写一份倡议书（350字以内）。" }) === 350, "字数上限: N字以内");
ok(wordLimit({ requirements:"写一份公开信，字数450左右。" }) === 450, "字数上限: 字数N左右");
ok(wordLimit({ requirements:"写一份函。" }) === null, "字数上限: 无要求返回 null");
ok(MODULES.gongwen.matLen[0] === 300 && MODULES.guina.matLen[1] === 900, "材料分档: 按模块给真实长度");
ok(GONGWEN_TYPES.some(t=>t.type==="公文改错"), "题型: 公文改错已入池");

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
state.history = [ { module:"gongwen", grade:{ scores: scoresFor("gongwen",15) } },  // 最新：75%
                  { module:"guina",   grade:{ scores: scoresFor("guina",11) } } ];  // 更早：55%
state.profile.lastModules = ["gongwen"];
ok(moduleScore("guina") < moduleScore("gongwen"), "更弱且没刚练过的模块优先");
let g = 0;
for(let i=0;i<200;i++){ if(weakestModule() === "gongwen") g++; }
ok(g < 80, "刚练过的模块不再霸屏 (gongwen " + g + "/200)");
const tseen = {};
for(let i=0;i<400;i++){ tseen[pickSubtypeFor("gongwen")] = 1; }
ok(Object.keys(tseen).length === GONGWEN_TYPES.length, "文种: " + GONGWEN_TYPES.length + " 个文种都不会被饿死 (" + Object.keys(tseen).length + "/" + GONGWEN_TYPES.length + ")");

/* 4. 渲染（画像从练习记录近期加权推导） */
state.history = [{ module:"gongwen", grade:{ scores: scoresFor("gongwen",15) } }]; // 75%
renderProfile();
ok(el("#profileBody").innerHTML.indexOf("width:75%") >= 0, "画像: 进度条按百分制铺满 (75%)");
ok(el("#profileBody").innerHTML.indexOf("均分 75") >= 0, "画像: 均分与进度条同一刻度");
// 同样两次练习（旧 5 分、新 15 分）：终身平均是 50%，近期加权应为 52% —— 画像必须偏向最近
state.history = [ { module:"gongwen", grade:{ scores: scoresFor("gongwen",15) } },
                  { module:"gongwen", grade:{ scores: scoresFor("gongwen",5)  } } ];
renderProfile();
ok(el("#profileBody").innerHTML.indexOf("width:52%") >= 0, "画像: 近期加权生效（52% 而非终身平均 50%）");
// 短板/强项由加权分推导：格式规范 25% → 短板，语言得体 95% → 强项
const mixed = scoresFor("gongwen", 12); mixed["格式规范"] = 5; mixed["语言得体"] = 19;
state.history = [{ module:"gongwen", grade:{ scores: mixed } }];
renderProfile();
ok(el("#profileBody").innerHTML.indexOf("短板·格式规范") >= 0, "画像: 短板由加权分推导");
ok(el("#profileBody").innerHTML.indexOf("强项·语言得体") >= 0, "画像: 强项由加权分推导");
// 文种统计同样近期加权：新 80、旧 60 → (80+60*0.85)/1.85 ≈ 71，而非终身平均 70
state.history = [ { module:"gongwen", subtype:"通知", grade:{ total:80, scores: scoresFor("gongwen",16) } },
                  { module:"gongwen", subtype:"通知", grade:{ total:60, scores: scoresFor("gongwen",12) } } ];
renderProfile();
ok(el("#profileBody").innerHTML.indexOf(">71<") >= 0, "画像: 文种统计近期加权 (71 而非 70)");
state.settings.orgName = "测试单位";
state.history = [];
current = { module:"gongwen", subtype:"通知", question:q1, phase:"answer", cardPeeks:0 };
saveDraft(qSig(q1), "恢复我");
el("#answer").value = "";
el("#draftNote").textContent = "";
renderQuestion();
ok(el("#answer").value === "恢复我", "题目页: 自动恢复未提交草稿");
ok(el("#wordCount").innerHTML.indexOf("3") >= 0, "题目页: 字数统计");
current = { module:"gongwen", subtype:"通知", question:{ background:"字数题", requirements:"写一份通知，不超过200字。" } };
saveDraft(qSig(current.question), "x");
el("#answer").value = "一二三四五六七八九十".repeat(25);   // 250 字，超出 200
syncAnswer(qSig(current.question), el("#answer"), wordLimit(current.question));
ok(el("#wordCount").innerHTML.indexOf("超出 50 字") >= 0 && el("#wordCount").innerHTML.indexOf("b class=\"over\"") >= 0, "题目页: 超出字数上限标红并给出超出量");
el("#answer").value = "一二三四五";
syncAnswer(qSig(current.question), el("#answer"), wordLimit(current.question));
ok(el("#wordCount").innerHTML.indexOf("/ 200 字") >= 0, "题目页: 未超出时显示 已写/上限");
current = { module:"gongwen", subtype:"通知", question:q1 };
current = { module:"gongwen", subtype:"通知", question:q1 };
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

/* 6. 存储 */
state.history = Array.from({ length:200 }, (_,i)=>({ ts:i, module:"gongwen", subtype:null, question:{}, answer:"", grade:{ total:60, scores:{}, strengths:[], weaknesses:[] } }));
const realSet = localStorage.setItem;
let n = 0;
localStorage.setItem = (k,v) => { if(k === "gw_state"){ n++; if(n <= 2) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } } realSet(k,v); };
let threw = false;
try{ save(); }catch(e){ threw = true; }
ok(!threw, "写盘满时不再直接抛错崩掉");
ok(state.history.length === 40, "写盘满时自动裁历史 (-> " + state.history.length + ")");
ok(el("#bannerSlot").innerHTML.indexOf("本地存储已满") >= 0, "写盘满时给用户明确提示");
localStorage.setItem = realSet;
save();
ok(load().history.length === 40, "正常写盘 + 读回往返一致");

/* 7. 复查补测：多草稿槽 + 公文骨架同步 */
const qA = { background:"材料A", requirements:"要求A" };
const qB = { background:"材料B", requirements:"要求B" };
saveDraft(qSig(qA), "A 的草稿");
saveDraft(qSig(qB), "B 的草稿");
ok(loadDraft(qSig(qA)) === "A 的草稿" && loadDraft(qSig(qB)) === "B 的草稿", "草稿: 换题不覆盖（多槽）");
for(let i=0;i<10;i++){ saveDraft(qSig({ background:"t"+i, requirements:"r" }), "草稿"+i); }
ok(loadDraft(qSig(qA)) === "", "草稿: 超过 8 份时最旧的被挤出");
current = { module:"gongwen", subtype:"通知", question:{ background:"骨架题", requirements:"写一份通知" }, phase:"answer", cardPeeks:0 };
renderQuestion();
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
ok(el("#modelOptions").innerHTML.indexOf("a-flash-model") >= 0, "实拉: 下拉候选来自接口");
el("#setModel").value = "";
await fetchModels(true);
ok(el("#setModel").value === "a-flash-model", "实拉: 当前为空时自动补最快模型");
await fetchModels(false);
ok(el("#setMsg").textContent.indexOf("3 个模型") >= 0, "实拉: 手动拉取有反馈");
el("#setModel").value = "deepseek-v4-flash";
await fetchModels(false);
ok(el("#setModel").value === "a-flash-model", "实拉: 手动拉取时名单外名字被纠偏");
globalThis.fetch = realFetch;

/* 8.5 两阶段练习 + 翻卡计数 + 笔记 */
saveNote("gongwen","通知","要点一：格式完整");
ok(getNote("gongwen","通知") === "要点一：格式完整" && getNote("gongwen","函") === "", "笔记: 按文种键存取，不串味");
state.history = [{ module:"gongwen", subtype:"通知", cardPeeks:2, grade:{ total:70, scores:{} } }];
current = { module:"gongwen", subtype:"通知", question:{ background:"阶段题", requirements:"写一份通知。" }, phase:"card", cardPeeks:0,
            studyCard:{ title:"通知·学习卡", points:["要点"], pitfalls:["坑"], templates:"框架文本" } };
renderQuestion();
ok(el("#docBody").innerHTML.indexOf("题目（模块") < 0, "卡片页: 不给看题，先学");
ok(el("#docBody").innerHTML.indexOf("要点一：格式完整") >= 0, "卡片页: 笔记可见可续写（真实输入走 input 监听，真机另验）");
ok(el("#docBody").innerHTML.indexOf("上次练习翻了 2 次卡") >= 0, "熟悉度: 卡片页显示上次翻卡次数");
el("#btnBegin").onclick();
ok(current.phase === "answer" && el("#docBody").innerHTML.indexOf("先学再练") < 0, "两阶段: 点开始作答后卡片退场");
ok(el("#docBody").innerHTML.indexOf("要点一：格式完整") >= 0, "作答页: 能看到自己的笔记");
ok(el("#docBody").innerHTML.indexOf("解题要点") < 0, "作答页: 卡片原文不再平铺");
ok(el("#docBody").innerHTML.indexOf("翻学习卡") >= 0, "作答页: 翻卡浮标在场");
el("#btnCard").onclick();
ok(current.cardPeeks === 1 && el("#cardDrawer").hidden === false, "抽屉: 打开即计次");
ok(el("#drawerBody").innerHTML.indexOf("解题要点") >= 0, "抽屉: 卡片原文只在抽屉里");
saveNote("gongwen","通知","要点一：格式完整\n要点二：主送机关");
el("#btnDrawerClose").onclick();
ok(el("#cardDrawer").hidden === true, "抽屉: 可关闭");
el("#btnCard").onclick();
ok(current.cardPeeks === 2, "抽屉: 再看再计");
ok(el("#docBody").innerHTML.indexOf("回学习卡") < 0, "作答页: 顶部回卡入口已删，只留抽屉");
current = { module:"guina", subtype:"概括原因", question:{ background:"x", requirements:"y" }, phase:"answer", cardPeeks:0 };
renderQuestion();
ok(el("#docBody").innerHTML.indexOf("插入公文骨架") < 0, "非公文: 骨架按钮与占位提示都不出现");
current = { module:"gongwen", subtype:"通知", question:{ background:"x", requirements:"y" }, phase:"answer", cardPeeks:0 };
renderQuestion();
ok(el("#docBody").innerHTML.indexOf("插入公文骨架") >= 0, "公文: 骨架按钮在场，占位提示与按钮一致");
current = { module:"gongwen", subtype:"通知", question:{ background:"x", requirements:"y", score:20 }, phase:"answer", cardPeeks:0 };
renderQuestion();
ok(el("#docBody").innerHTML.indexOf("分值：</b>20 分") >= 0, "作答页: 题目满分对考生可见");
state.history = [];

/* 8.6 翻卡次数参与出题调度 */
ok(recentPeeks("gongwen","通知") === null && recentPeeks("duice") === null, "翻卡: 无记录时返回 null");
state.history = [
  { module:"gongwen", subtype:"通知", grade:{ total:70, scores: scoresFor("gongwen",14) }, cardPeeks:3 },
  { module:"gongwen", subtype:"函",   grade:{ total:70, scores: scoresFor("gongwen",14) }, cardPeeks:0 }
];
ok(recentPeeks("gongwen","通知") === 3 && recentPeeks("gongwen","函") === 0, "翻卡: 近期翻卡次数可按文种查询");
const orRand = Math.random; Math.random = () => 0.9;   // 避开 20% 随机探索，走确定性分支
ok(pickSubtypeFor("gongwen") === "通知", "调度: 翻得多的卡对应文种优先再出 (got " + pickSubtypeFor("gongwen") + ")");
Math.random = orRand;
state.history = [
  { module:"guina", grade:{ scores: scoresFor("guina",14) }, cardPeeks:4 },
  { module:"fenxi", grade:{ scores: scoresFor("fenxi",14) }, cardPeeks:0 }
];
ok(moduleScore("guina") < moduleScore("fenxi"), "调度: 同分模块，翻卡多的更优先");
state.history = [];

/* 8.7 子类型扩展到全部题型 */
ok(subtypeListOf("gongwen").length === GONGWEN_TYPES.length && subtypeListOf("guina").indexOf("概括原因") >= 0, "子类型: 每个题型都有自己的细分");
tabClick("__all");
ok(el("#docBody").innerHTML.indexOf("智能推送下一题") >= 0, "综合入口: 页签直达智能推送起点");
tabClick("guina");
ok(el("#docBody").innerHTML.indexOf("概括原因") >= 0 && el("#docBody").innerHTML.indexOf("开始练习") >= 0, "落地页: 子类型芯片 + 显式开始按钮");
ok(el("#docBody").innerHTML.indexOf("还没练过") >= 0, "落地页: 无数据显示未练状态");
state.history = [{ module:"guina", subtype:"概括原因", grade:{ total:60, scores: scoresFor("guina",12) }, cardPeeks:4 }];
const orRand2 = Math.random; Math.random = () => 0.9;
ok(pickSubtypeFor("guina") === "概括原因", "调度: 非公文题型同样按翻卡优先 (got " + pickSubtypeFor("guina") + ")");
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

console.log(T.join("\n"));
const fails = T.filter(x => x.indexOf("FAIL") === 0);
console.log("\n== " + (T.length - fails.length) + "/" + T.length + " passed ==");
if(fails.length) process.exitCode = 1;
