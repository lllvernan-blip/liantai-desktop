# 项目协作规则

只写「下次不照做就会犯错」的约束，不是设计文档、也不是开发日志。**尺寸是硬约束：目标 ≤32 KiB**（Codex 系项目指令链默认上限就是 32 KiB，超了按字节截断——写长了等于把后面的规矩删掉）。使用方式与边界写 `README.md`，历史与实测过程进 git（压缩前全文可 `git log -- AGENTS.md` 翻到，压缩发生在 2026-10-08）。

## 边界

- 形态是「Electron 桌面壳 + 零依赖单文件应用本体」：业务代码全在 `app/index.html`，不要引入 npm 依赖、构建步骤或框架。
- 壳 `main.js` 只用 electron + Node 标准库；**唯一例外是 electron-updater**（差量更新非它不可）。加依赖前先问。
- API Key、答案、练习记录、本地笔记不进 Git；Key 只由用户在设置界面填。
- **备份永不携带 API Key**：`exportJSON` 走 `exportPayload()`（克隆 state 后删 `settings.apiKey`）；导入不吃文件里的 Key，也不因文件没带而清空本机 Key。理由一句话：备份会被分享。哨兵在 `tests/assertions.js` 15.4 节。
- 用户答案是不可再生资产：异步失败、换题、渲染不得无故清空题目、答案或草稿。
- 练习记录是画像与调度的事实源；新增聚合字段前先确认不会造成两份状态漂移。
- 总分口径唯一：总分 = 采分点（带分值子项）实得分之和，`grade.total` 存折百分制供画像跨题比较；维度分只做诊断。
- 口径只有 `recordTotal()` 一处实现（优先 `grade.total`，老记录才回退维度分折算）；画像均分、子类型统计、调度基准分一律走它，**不要另起一个从维度分算的聚合**。`moduleAvg()` 返回百分制 0–100，不是 0–20。
- 题型表以**官方大纲**为准，不采信培训机构归纳。依据（2026 年版官方 PDF，2025-12）§4.1.2.2 五项能力、§4.1.2.3 任务举例「观点归纳、资料分类、草拟信函、应急处理、联络通知」；2022 版的「会务安排」已删，但「会务组织」作为案例实务子类型保留；申论按大纲五大能力五类题型。**别引旧版编号**（旧版 §5.x，2026 版 §4.x）。

## 模型与档位（AI 调用）

- 模型候选唯一出口是自绘下拉 `#modelMenu`：原生 datalist 会按已填文字过滤（曾致「只拉到一个模型」的误报），外挂 chips 已并入。别恢复这两条路。
- 模型能力**不按名字猜**：`THINK_FAMILIES` 只收参数发法特殊的家族（qwen3 / glm），其余默认按 reasoning_effort 实测试探。`modelCaps`（被拒自动降级 + 顶栏 banner）与 `modelProbe`（思考字数 / 耗时，两档攒够给结论）是持久状态，load / importJSON 已迁移，别绕过它另建能力判定。
- **输出坏了最多重发两次**（`BODY_RETRY_MAX = 2`）：① `content` 为空；② `content` 在但 `parseJsonLoose` 解不出。**两种坏法只要 `finish=length` 就原地把额度翻倍重发**。重发还坏才抛：空输出 `{code:"EMPTY"}`、坏 JSON `{code:"JSON"}`，`handleErr` 各按各的说法提示，不许静默吞。坏输出走 `llmFailNote()` 记控制台（`main.js` 把渲染进程警告以上收进 `logs/startup.log`）。`sseFinish()` 是拿 `finish_reason` 用的，别当无用解析删。
- **额度动态**：首次 `MAX_OUT_TOKENS = 16384`，`finish=length` 就翻倍（→32768→65536，封顶 `MAX_OUT_TOKENS_HARD`）。思考与正文共用一个额度（`reasoning_tokens` 计在 `completion_tokens` 里）。**别写死「某模型的输出上限」**（实测 deepseek-flash 对 4096…65536 全收 200）。阅卷思考档单独降 `GRADE_LEVEL = "quick"`（阅卷照 need 逐条核，不吃长链推理）。
- **范文从批改主请求拆出去单独拉**：`fetchModelAnswer()` 在批改成功后另发一次，**要纯文本不要 JSON**；那次失败只当没写过（catch 掉、留空，`renderGrade` 不渲染空范文），别拖垮整次批改。往主请求里再塞大块附属内容前先想这条。
- **传输层失败自动同档静默重发一次**（`retriedNet`）：DNS / TLS / 连接断 / 整体超时；HTTP 错误照旧走降级阶梯（只 400/422 换档）**绝不重发**。一次请求最坏 4 次调用（传输 1 + 输出 2 + 降级 1）；`retriedNet` 与输出重发不是一回事。
- 综应A 学习卡阶段不亮题面（点「开始作答」才出现）；学习卡 `example` 是「这类题长什么样」的全新示例，prompt 明令不得复用本题材料情节；翻卡计次只属作答阶段。

## 学习闭环（错因 · 复测 · 快判辨析点）

- **闭环最后一步是「回执」，不是「沉淀」**：批改 prompt 要求逐条回报 `experienceChecks`（title 原样照抄 + `again/fixed/na`），`applyExperienceChecks` 写回：`again → recur+1、cleared=false`，`fixed → cleared=true`，没给或 title 对不上就什么都不改（保持待验证）。批改页那行与画像三态都用这份结果，别另存一份。
- `experienceChecks` 与 `kind` **都不参与计分**（与 hits/scores 分开）；`awarded` 与总分口径一字不动。
- **注入顺序就是复测策略**（`activeExperiences`）：还在犯的（recur 多的在前）→ 该核 / 该复测的（没核过，或已改但过了 `RETEST_DAYS = 7` 天）→ 刚核过且已改的。已改掉不是注销，是一周后换题再来一次（超校正效应）。
- **阅卷温度钉在 0**（`GRADE_TEMP = 0`）。三档判法写在 `SCORING_RULES`：**数点不估百分比**，判「半分」必须在 evidence 里写出考生答到了什么。评分校准句（多数答卷落中间档 / 拿不准按中间档 / 答得长不等于答得全）属批改质量，删它等于打开宽松抬分与长度偏好两扇门。**别往 prompt 里写「分差控制在 ±3」这种数字承诺**。
- **判分要数的点出题时就写死**（`keyPoints[].need`，3-6 条，**一条只写一个可核对的事实、不许塞并列要件**；`GEN_POINT_RULES` 有反例）。阅卷只做一件事：照 `need` 逐条独立核（不许并起来判、不许顺带算）。旧记录没带 `need` 就退回按子项文字拆点。`keyPoints` 是原样 `JSON.stringify` 进请求体的，不用另加字段。
- **阅卷漂移的现状，别再折腾**：need 原子化后两个爱跳的子项 10 次不跳，残差 ±1~1.5/20（折百 ±5~7.5）。样本少时的「极差 0」是运气——**报数必须连样本数一起报**，对用户报数字前先自己量三次，并且把 evidence 抄出来看（才分得清「稳定地对」与「稳定地偏严」）。
- **快判「下次再考你」是真承诺**：`pdTrapStats`（看最近 `PD_TRAP_WINDOW = 20` 题）→ `pdWeakTraps`（错过就排进来，错得多、出得多的靠前）→ `genPDRound` 请求体的 `weakTraps`（改请求体别丢）。辨析点文本先用 `pdTrapKind` 按关键词归到标准类再统计。
- **错因归有限几类**：`GRADE_TAGS` 六类（漏点 / 跑偏 / 结构 / 格式 / 表达 / 材料），`gradeTagOf` 只认闭集里的一类（认不出的当没给）。快判的 trap 故意相反（认不出就原样留着）。两套标签分开维护。
- **标签的出口是出题**：`gradeTagStats(k)`（最近 `GRADE_TAG_WINDOW = 20` 条有采分点的记录，按模块分开）→ `weakGradeTags(k, 3)` → `gen()` 请求体的 `weakTags`。画像「常错类型」与出题「重点考这几类」必须同一份数据。
- **经验继承**：`storeExperiences` 是 kind 的关卡（只有错因类且属标签表那几类才落进 state）；**这次没给 kind 不许把已有的冲掉**。

## 作答限时

- **时长不分档**：`#inpLimit` 一个数字框，`normLimitMin` 是唯一口径（留空 / 0 / 填不出 = 不限时；小数取整；超 `LIMIT_MAX`(600) 按上限）。**失焦或回车才生效**，生效后回写规整值；单位「分钟」只在填了数字时才露（`.tlin:placeholder-shown + .tlunit{display:none}`）。
- **从「开始作答」那一刻起算**（综应A 的学习卡是预习不算）；切步与刷新不重置；**交卷停表 `setLimitState(limMin, 0)`**。锚点 `limitMin/limitFrom` 挂训练链（`sanitizeFlows` 的 `Object.assign` 保留未知字段），综应A 挂 `current`；时限记 `state.settings.timeLimit`，下一题沿用。控件在题目行与作答区标题行、行右饰收在 `.secright`；换时长**不重渲**（`setTimeLimit` 就地改）；时钟只开一个（`_timeTick`）。
- **到点不自动交卷**（写一半被截断不可逆）：只 `banner` 报一声 + 剩余时间转「已超时 mm:ss」（`--warn`，剩最后 5 分钟就转）。
- **用时是记录的一部分**（`h.timeLimit` / `h.usedSec`）：批改页报「本题限时 N 分钟 · 用时…（超时…）」；不设限时就什么都不写（不臆造 0）。记录表「用时」列（`usedCellHtml` / `fmtClock`）：没计时的留「—」，超时的把超了多少写在后面并转焦橙。

## 依赖与更新（桌面壳）

**流程细节、验包规矩、已知卡点都在 `docs/发布与更新.md`**；这一节只留边界与硬规矩。

- 更新模块 `update.js`，状态机 `idle / checking / available / downloading / downloaded / up-to-date / error / disabled`；壳用 `GET /__update/status` 暴露，页面 `__updatePush()` 接，动作用 `POST /__update/check` / `/download` / `/install`（`/download` 只有 mac 链用）。**POST 一律要求自定义头 `x-liantai: 1`**（跨站会先 OPTIONS 预检，本服务从不回 CORS 头）——别改成免头路由。
- **mac 那条链是自实现的**（`initMacUpdater` + `MAC_INSTALL_SCRIPT`）：① **只查不下、只下不换**（开机 12 秒自查只推「有新版本」，下载与换包各要用户点一次，`status.autoDownload === false`）；② **只从官方域取包**（`github.com` / `*.githubusercontent.com`，明文 http 只放本机回环）；③ **换包要能回滚**（先 `mv` 走旧包再 `mv` 进新包，失败原地搬回并重开旧版）；④ **失败留痕** `<userData>/updates/install.log`，下次启动 `macLastFailure()` 读、`main.js` 灌进首页提示区。坏包改名 `.zip.bad`（不再匹配），下好没换成的包下次启动会认回来（`macScanDownloaded`）。
- **只发 NSIS 安装版，不要再加 `portable`**；免安装版必须禁用自动更新（带 `PORTABLE_EXECUTABLE_FILE` 就置 `disabled`）。
- 更新不碰用户数据（`%APPDATA%\liantai-desktop` 只是程序文件被换）；`nsis.deleteAppDataOnUninstall` 保持 `false`。更新失败绝不阻断：只进 `logs/startup.log`（`update-*` 行）与设置页一行提示，出错后 30 分钟重试、常驻每 6 小时，不在启动路径弹阻断对话框。
- **备用源与校验下载分离**：主源永远是包内 `app-update.yml`，连不通按 `BACKUP_FEEDS` 顺序换源；元数据（带 sha512）取自 `BACKUP_FEEDS[i]`、安装包地址改写指向 `BACKUP_FEEDS[i+1]`（`installCrossSourceHook`），所以**相邻两条同时活着才算一条能走通的路**。设了 `LIANTAI_UPDATE_FEED` 就只认它，既不光底也不拆。
- **差量缓存会错位，已能自检修复**：`installer.exe`（NSIS 写）与 `current.blockmap`（electron-updater 写）由两个程序维护、可能指向两个版本，那时拿旧尺子量新安装包、组装后校验不过。`alignDifferentialCache()` 每次检查前核对（blockmap 里 `sizes` 逐块相加 == 安装包大小，能分辨 2.5KB），对不上就删 `current.blockmap`。
- **发布**：`npm run release` / `npm run release:mac` / `npm run release:check`，**发布前必须先提 `package.json` 的 version**（不提老用户永远收不到）。**每版都发两个平台**（2026-10-03 拍板）：一个 tag 下一整套 = Windows 三件 + mac 五件。
- **单发 mac 必须加 `--prerelease`**：Windows 的自动更新读 `/releases/latest/download/latest.yml`，而 GitHub 的 latest 指「最新的非 prerelease Release」——只带 mac 资产的 Release 把它占住，Windows 用户检查更新就 404（`release-mac.mjs` 默认不自己建 Release，除非 `--create`）。
- **发布前先跑发布闸门（五项机械检查）**：① `git status --short` 干净；② `gh api repos/lllvernan-blip/liantai-desktop/commits/main --jq .sha` 与本地 HEAD 一致；③ package.json 三铁律（version 已提、`build.win.target` 仅 nsis、无顶层 `productName`）；④ 源码 grep `sk-[a-f0-9]{20,}` 零命中；⑤ AGENTS/README 引用的文件路径全部存在。**验包不许碰本机那份安装**（NSIS 会按 AppId 先把上一版静默卸掉，0.0.13 那次真卸掉了）——详细规矩见 `docs/发布与更新.md`。
- **双机协作发版（四步）**：① mac 提 version + `CHANGELOG` 一行并推；② Windows 拉到最新后 `npm run release`；③ mac `npm run release:mac -- --skip-build` 补 mac 五件；④ 任意一端 `npm run release:check` 看八件齐不齐。
  - Windows **直连官方 git 协议不通**：拉取用转发站一次性 fetch，**别改 origin、更别用它推送**（推送带令牌）——`git fetch "https://gh-proxy.com/https://github.com/lllvernan-blip/liantai-desktop.git" main && git merge --ff-only FETCH_HEAD`；拉完 `git rev-parse HEAD` 必须就是 mac 推的那条 sha，不等就别发。
  - **先发的那台决定 tag**（`gh release create` 用本地 HEAD 建 tag）：谁先发谁先拉最新；tag 不是本地 HEAD 就 `git checkout <tag>` 重新出包。Windows 的 gh 登录是交互式的，必须本人敲一次（`gh auth login --with-token < 文件` 可非交互）。
  - **历史被改写时（改提交说明这类）那台要重新对齐**：`git fetch <转发站> main && git reset --hard FETCH_HEAD`。
- **别在 mac 上顺手出 Windows 包**：NSIS 要 wine 抽卸载器（`NsisTarget.js` 的 `WineVm`），本机没 wine 也没 Rosetta。要一条命令出两平台只有 GitHub Actions。
- **「洁癖」= neat-freak Skill**（`~/.cola/skills/kkkkhazix-khazix-skills-neat-freak`）：说「跑洁癖」或「收尾时把文档和记忆同步掉」都走它。它管六个事实面（代码 / 运行态 / 文档 / 规则 / 记忆 / 工作区），每面标 `verified-current` / `changed-and-verified` / `pending` / `out-of-scope` / `not-applicable`，并审「本文件的规矩有没有被执行」；记忆面只能读（Cola 记忆库只读，写入走 bookmark）。**它替代不了发布闸门**：两个都跑。
- 这台 mac：Node 在 `~/.local/opt/node`（跑前 `export PATH="$HOME/.local/opt/node/bin:$PATH"`），gh 在 `~/.local/opt/gh/bin/gh`；npm 记的「not yet covered by allowScripts」不用管。

## 名称与版本（别乱动的三样）

- 界面叫「练习台」；内部 id 永远 `liantai-desktop`（`package.json` 的 `name`、`build.appId`）。**不要加顶层 `productName`**（Electron 用它决定 userData 目录，一改数据就搬走）；`build.productName` 只影响安装包 / 快捷方式显示名，安全。
- `app/index.html` 里那两处旧默认机关名的迁移分支（旧名拼着写、源码不留完整串）是把旧版用户数据里的机关名改成「模拟练习专用」用的（测试有断言），**不是产品名**。
- 版本号测试阶段只走 `0.x.x`；明确说发正式版才跳 1.x。

## 界面（UI/UX）约束

- 顶栏 `.topbar` 是 sticky：**一行（首页 / 快判轨）49px、两行（科目页 / 作答页）93px**（实测）。科目入口是 `#subjbar`（在品牌后、`.spacer` 前）；页签行高度只在 `--h-modbar` 定义一处，`.modbar` 自己 `height:var(--h-modbar)`，**没页签就整行收起**（`$(".modbar").hidden = !tabs` + `.modbar[hidden]{display:none;}`，因为 `.modbar` 自己是 `display:flex` 会盖掉 `[hidden]`）；那 44px 由 `.wrap.gap-modbar{margin-top:calc(24px + var(--h-modbar))}` 补在纸面上方，三种页面纸面起点都是 117px。**别用 `.topbar` 补高度**（会留一条带边框的空带子）；旧的 `min-height:47px` 锁高已作废，别加回来。
- `.tab.active` 由全局 `tabActiveKey` 驱动：作答中 / 模块落地页 = 那个模块；首页、科目起始页与快判 = `null`（别谎报「你在哪」）。调用点在 `renderModuleLanding` / `renderQuestion` / `renderStart` / `renderHome` / `enterPD`。
- 点页签会 `$("#doc").scrollIntoView(true)`，顶栏 sticky——所以 `#doc` 有 `scroll-margin-top:100px`（盖得住两行顶栏）。
- 动效三条自律：只播一次、≤240ms、不循环不自动播放；只动 opacity / transform / 颜色；`prefers-reduced-motion` 下一律关。不引外部资源、不加依赖。
- 颜色：**不要黄色系**；划线默认绿 `#a7f3d0`；主色一律 `--gov-red`；公文纸面风（直角、极小圆角）是刻意选的。
- **信息密度优先：长信息一律「一行一条 + 点开看明细」**，不用卡片依次铺开。三种收纳件 `.mrow` / `.expline` / `.notebox`；**折叠的 `summary` 必须有可见三角**。批改页次序：分数 → 丢分最狠的三条 → 阅卷点评 → 优点 → 全部采分点对照（展开）→ 维度分 / 参考答案（折叠）。渲染断言盯着 `width:NN%`、`均分 N`、`短板·X`、`hitline miss`、`折合 N 分`。
- **文案分四类**：空态提示（留）、必备声明（留）、讲机制 / 流程（删）、重复的口径（并成一条）。只写「结论与操作」；**发给模型的参数细节不写**；「只存本地 / 备份不含 Key / Key 只发往你填的地址」这类声明一字不动（删了就是骗人）。
- **更新日志一行一条、只写一句话**：`app/index.html` 的 `CHANGELOG` 是给用户扫一眼的，不是给开发者看的；一条只写一件事，**不带括号、不写原因、不写怎么实现的**（参照 ColaMD：`v2.7.3 · 本地链接能跳了`）。细节进 commit message 与 Release 说明。**两个平台共用同一条**，**动笔的地方在这台 mac**。
- **一次点击进快判（2026-10-07 拍板）**：首页最大的红按钮是「开始快判」，点一下直接出题（`startPDRound(PD_MIX)`，不再过落地页）；两句大题各占一个描边按钮；科目栏里快判排在科目之前，用一道 `.subjdiv` 细线分开——位置和那道线都在说「它不是第三个科目，是另一种练法」。
  - **两种起始页分开写**：`startBoxHtml(rf)` 按 `_view === "home"` 分两形——首页红按钮「开始快判」（+ 两句大题 + 示例题链接），**科目首页红按钮是本科目主行动**（`#btnSmart` → `startSmart`）；快判不在科目页抢红，科目页不放两句大题也不放示例轮。两个按钮都可能在也可能不在，`wireStartBox()` 一律取到再接线。
  - **首页没有科目**：打开落在 `renderHome()`，三个入口一个都不预选（`.subjbtn` 不许带 `active`）、页签栏空着、抬头「练习台 · 首页」。品牌名 `#btnHome` 是唯一回首页的路，别删。
  - **大题必须点名科目**：「练一道综应大题 / 练一道申论大题」走 `startSubjectTask(subject)`（切科目 → 退判别轨 `pdActive = false` → 出题）。**不许写成「练一道大题（综应 / 申论）」**——那实际去的是上次练的科目。快判落地页也放这两句。
  - **判 Key 只有 `startPDRound` 一处**：没填 Key 的人在这里拿到内置示例轮（`PD_SAMPLE_ITEMS`、不调 AI、同一套渲染判分、**不入 history**、小结给「填一个 Key」入口），进快判的每个入口都走这一处。
  - **示例题每种形式各 5 道**：`pdSampleItems(form)` 按形式取，不传形式（首页那条）才三种轮着取凑混合轮；`startPDRound` 无 Key 时把点的那一个形式一路传下去，抬头与纸面如实报（只有 `r.form === PD_MIX` 才写「三种形式混着来」）。**改池子守两条**：每种形式不少于 `PD_ROUND_SIZE` 道；正确项在材料里有逐字出处、干扰项只从各形式 `spec` 写明的那几类里造。快判练习页与小结点那句「快判练的是从材料里辨认说法…」别当水词删。
- **纸就是纸，留白不堆东西**：纸面（`#doc`）下半截常常空着，**这是故意的**——「你把那个都填满，就没艺术感、没设计感了，太功能性了。它本来就是模拟纸张，纸张本来就是长方形的嘛。」空的地方要动只有一条路：把已有的那件事做大（如起始区主行动放大），不是添新东西。
- **落款跟着抬头走**：文号（`#docNo`）前缀**由抬头推出来**，没有设置项——首页 `练习台`、快判轨 `快判`、其余按科目名 `综应A` / `申论`（`renderHeader` 一处定）。**能推出来的东西就不要让用户去设置里维护**（留一个不起作用的控件就是界面在说谎，原来的「文号前缀」输入框已撤）。
- **入口少字、详情可密**：入口屏（起始页 / 模块落地页 / 快判落地页）只写「这是什么 + 怎么开始」；进去的明细（作答页 / 批改页 / 画像二级页 / 设置 / 折叠件内部）可以密。判「字多」看的是**入口**。
- **一句成功 / 一句「正在做」，都得有依据**：复查时把「点下瞬间」与「一秒后」两个时刻的界面文字都抓出来对账，凡是「先答应、马上又反悔」的都算骗人。已按这条修过的（新增调用点时照这份清单自问）：
  - **出题 / 阅卷一律先过 `entryBlocked()`**（缺 Key 或没选模型都不进加载态、不点亮按钮），必须排在 `showLoading` 之前；`startPDRound` 与 `submitAnswer` 都在列。
  - **等待页的时间预期是参数**：`showLoading(t, tail)` 第二行默认「AI 出题通常 10-60 秒」（写死过「长文阅卷通常 10-60 秒」，于是出题页在说阅卷）。
  - **引导要跟「此刻真能做到什么」一致**：`TOURS_NO_KEY` / `tourSteps(sub)` 按有无 Key 给两套（没 Key 时第一步改指设置页、末尾那步去掉、首页大题那句改成「都要先填 API Key」）。看引导的往往正是新人。
  - **入口标签要对应到真去处**：没 Key 时快判落地页主按钮写「先试一轮示例题（不用 Key）」、分组写「或只练一种形式（也是内置示例题）」。
  - **产出反馈不夸口**：导出只报「已生成备份 + 文件名」（弹保存位置后取消了我们无从得知），不说「已导出 ✓」；`save()` 把「到底写进去了没有」回给调用方，存储写满时设置页不写「已保存 ✓」（同屏 banner 已在报「未能保存」）。
  - **隐私说明要具体**：「练习记录、草稿、划线只存你这台机器上（我们的服务器不碰）；批改那一步会把题目、你的作答与归类提纲发给你上面填的服务商——它才能给分。」
- **界面不许谎报**：
  - **不许谎报「我在做什么」**：明知走不通就别先答应一声；也别把人从首页拽进科目页（那是靠切 `settings.subject` 完成的，一切抬头就报「综应A · 综合推送」而他什么都没练）。
  - **不许假装没发生**：示例轮不入账是故意的，但得说出来（小结写「示例题不计入练习记录」，画像空态写「刚才那轮是示例题（内置题，不计入统计）」）。
  - **纸面上不写抬头已报的标题**：抬头（`#modLabel`）已经报了「你在哪」，纸面再写一遍就是同一句话写两次（起始页「开始今天的练习」、模块落地页模块名大标题、快判落地页「快判 · 从材料里做判断」都已删）；纸面第一行得是「这是什么」（模块 `note`）或数据。名单同理：`renderModuleLanding` 拆词比对，`note` 与子类型胶囊重复就不写，机制说明不留。小结也只写「本轮小结」。
- **画像分两级**：一级一行一个入口（模块 / 快判 / 经验 / 记录，`.navrow` 整行可点、尾部 `›`），二级才是明细。`profPage` 是当前页（`null` = 一级），`profGo` 进、`profBack` 回；`openModal("modalProfile")` 一律回一级，而 `renderProfile()` **不会**自己回一级（测试要一级就显式 `profBack()`）。一级的行是按钮不是折叠件。
- **弹层加东西先量「主按钮还在不在视口内」**：取景器 AUDIT 查不出纵向切——加两三个字段，主按钮就被顶到窗口高之外。可选件一律默认收起（`<details class="addpick">`），收起态要 `panelScrollH === panelClientH` 且主按钮底边 ≤ 窗口高。
- **长什么样看 `docs/界面规范.md`**：字号六档 / 控件两档高 + 起始区主行动一档 / 颜色只走 token（不要黄色系）/ 数值列 `tabular-nums` 定宽右对齐 / 分隔线与折叠三角各一套 / 横向基准 `max(14px,calc((100% - 880px)/2 + 14px))` / 纸面 `--sh-paper` / 灰三档与表面色三档 / 段落 28–32 组内 6–12 / 采分点三列用 `order` / 设计语言四句话。**改界面前先读那一份**（细节都写在那里，本文件只留行为与口径）。

## 端口与存储（桌面壳）

- 本地 http 源**必须固定端口**（`main.js` 的 `PREFERRED_PORT`）：`localStorage` 按 origin（含端口）分区，随机端口会让用户的设置、记录、草稿在重启后「消失」。改端口策略等于改所有用户的存储位置，属破坏性变更。
- 端口退让必须写 `port-fallback-warning` 日志（让「数据看起来没了」可诊断）。
- 启动路径对声明顺序敏感：`load()` 依赖的 helper（如 `HISTORY_KEY` 这类 const）必须定义在首次调用点之前，否则 TDZ 报错会被兜底 try/catch 静默吞掉，表现为「历史读不回来」。
- 强杀进程会丢最近的异步落盘写入；涉及「答案不可再生」的改动要考虑落盘时机。

## 状态与兼容

- `gw_state` 保存设置、画像、学习卡、笔记和模型缓存；练习历史在独立的 `gw_history`（写满裁最旧，不得并回 `gw_state`）。
- `gw_draft` 保存未提交草稿；`gw_marks` 保存按题目签名的材料划线。
- 修改状态结构时保留旧数据的默认合并与迁移；导入数据不能未经校验直接当成可信记录。
- 题目、草稿和划线通过题目签名关联，不能使用全局单槽覆盖当前题之外的数据。

## 修改后验证

`node tests/run.mjs` 必须看到 `N/N passed` 且退出码 0；涉及窗口 / 启动 / 加载方式再真跑 `npm start`；涉及浏览器交互、异步、设置弹层、导入导出或本地存储要真路径走一遍并看控制台。**细节（探针 / 漂移 / 取景器 / AUDIT 规则 / 字预算 / 调试坑）看 `docs/验证与取景器.md`**，别凭记忆改工具参数。几条最常踩的：

- 临时量一段真行为：写成探针文件再跑 `node tools/probe.mjs 我的探针.js`（可用应用全部函数与常量、支持顶层 await；一次性，用完删）。
- 量阅卷漂移用 `tools/drift.mjs`，**基线必须两份答卷都跑**（只测「写具体」那份会看到假象的极差 0）；Key 只从 `LIANTAI_KEY` 读。
- 量真实布局用取景器 `node tools/shot.mjs <场景文件.mjs> <输出目录>`，**先套 `caffeinate -d -u -t <秒>`**（显示器休眠能把 45 秒变成 17 分钟）；**量可见字要排除 `details:not([open])` 的子元素**；同一份代码连跑两遍要逐张字节一致（`tools/cmp-shots.mjs` 比对），展开态不能留给下一屏。
- 取景器规则宁少勿滥；**退出码 2 = 有 FAIL**。入口字预算调线要说得出口理由，删了字就把线降回去。
- **别用 `node -e` 写带 JSON 片段的探针**（Git Bash 会把带冒号 + 反斜杠的参数当路径列表改写，能白排查半天），写成文件再跑。

## 编辑纪律

- 先读周边代码和现有测试，再做最小范围修改。
- `MODULES` / `GONGWEN_TYPES` / `PD_FORMS` 一改必须同步 `题型规范.md`。
- 打包走 `npm run dist`：先 `tools/stamp-build.mjs` 写 `app/build.json`（里面只有版本号，设置面板底部显示它——别写成「构建时间」），再调 electron-builder。**不要用文本工具改 `打包.bat`**（GBK + `chcp 936` 会被写坏）；加步骤改 `package.json` 的 `scripts.dist`。
- 提交说明只写描述性内容：改了什么、为什么、怎么验证的。**不引用对话、不写「某人说」这类原话**——提交历史是公开的，聊天腔一看就是 AI 代笔。**写完提交前跑 `npm run check:msg`**（默认只查还没推上去的那些，`--all` 查全史，`--rev <ref>` 查某个 ref）；命中就改说明，别带着它推。已经推上去才发现要改，就得重写历史 + 强推，动的是公开历史，先问。
- **不把一次性开发流水账写进本文件**：写之前先问「不照做会不会犯错」，不会就别写。使用方式与边界写 `README.md`，历史走 git。
- 不提交 API Key、真实个人资料或真实练习备份；`node_modules/`、`dist/`、`logs/` 不进 Git。
- 不删除用户未授权的文件或数据；临时调试产物结束前清理。
