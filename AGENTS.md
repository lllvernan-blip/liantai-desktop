# 项目协作规则

只写「下次不照做就会犯错」的约束与陈述句，不写叙事、引语和理由展开。**尺寸是硬约束：≤32 KiB**（Codex 系项目指令链默认上限，超了按字节截断）。使用方式与边界写 `README.md`，历史与实测过程进 git。

**机器能查的不在这里复述**：顶栏结构、文案串、CSS 串由 `tests/assertions.js` 与 `tools/release-check.mjs` 盯着，本文件只留人的判断（口径、行为、边界）与指路；认定某条已被断言覆盖前，先去断言里确认它真在看这件事。

## 边界

- 形态是「Electron 桌面壳 + 零依赖单文件应用本体」：业务代码全在 `app/index.html`，不要引入 npm 依赖、构建步骤或框架。壳 `main.js` 只用 electron + Node 标准库，**唯一例外是 electron-updater**；加依赖前先问。
- API Key、答案、练习记录、本地笔记不进 Git；Key 只由用户在设置界面填。
- **备份永不携带 API Key**：`exportJSON` 走 `exportPayload()`（克隆 state 后删 `settings.apiKey`）；导入不吃文件里的 Key，也不清空本机 Key。
- 用户答案是不可再生资产：异步失败、换题、渲染不得无故清空题目、答案或草稿。
- 练习记录是画像与调度的事实源；新增聚合字段前先确认不会造成两份状态漂移。
- 总分口径唯一：总分 = 采分点（带分值子项）实得分之和，`grade.total` 存折百分制供画像跨题比较；维度分只做诊断。口径只有 `recordTotal()` 一处实现（优先 `grade.total`，老记录才回退维度分折算），画像均分、子类型统计、调度基准分一律走它，**不要另起一个从维度分算的聚合**；`moduleAvg()` 返回百分制 0–100。
- 题型表以**官方大纲**为准，不采信培训机构归纳。依据 2026 年版官方 PDF §4.1.2.2 五项能力、§4.1.2.3 任务举例「观点归纳、资料分类、草拟信函、应急处理、联络通知」；「会务组织」作为案例实务子类型保留；申论按大纲五大能力五类题型。**别引旧版编号**（旧版 §5.x）。

## 模型与档位（AI 调用）

- 模型候选唯一出口是自绘下拉 `#modelMenu`：原生 datalist 会按已填文字过滤，外挂 chips 同样不用，两条路都别恢复。
- 模型能力**不按名字猜**：`THINK_FAMILIES` 只收参数发法特殊的家族（qwen3 / glm），其余默认按 reasoning_effort 实测试探。`modelCaps`（被拒自动降级 + 顶栏 banner）与 `modelProbe`（思考字数 / 耗时）是持久状态，`load` / `importJSON` 要带着它们走，别绕过另建能力判定。
- **输出坏了最多重发两次**（`BODY_RETRY_MAX = 2`）：① `content` 为空；② `content` 在但 `parseJsonLoose` 解不出。**两种坏法只要 `finish=length` 就原地把额度翻倍重发**。重发还坏才抛：空输出 `{code:"EMPTY"}`、坏 JSON `{code:"JSON"}`，`handleErr` 各按各的说法提示，不许静默吞。坏输出走 `llmFailNote()` 记控制台。`sseFinish()` 是拿 `finish_reason` 用的，别当无用解析删。
- **额度动态**：首次 `MAX_OUT_TOKENS = 16384`，`finish=length` 就翻倍（→32768→65536，封顶 `MAX_OUT_TOKENS_HARD`）。思考与正文共用一个额度。**别写死「某模型的输出上限」**。阅卷思考档单独降 `GRADE_LEVEL = "quick"`。
- **范文从批改主请求拆出去单独拉**：`fetchModelAnswer()` 在批改成功后另发一次，**要纯文本不要 JSON**；那次失败只当没写过（catch 掉、留空，`renderGrade` 不渲染空范文），别拖垮整次批改。往主请求里再塞大块附属内容前先想这条。
- **非流式调用的超时盖住「读完 body」**：`fetchWithTimeout()` 连 body 一起读完再返回（`{res, text, json}`）；只把 `fetch` 包进计时器挡不住「回了头却停住 body」，那一路会永久挂住。流式那条路的 `CONNECT_TIMEOUT` 只算到首字节（到了就交给 `IDLE_TIMEOUT`：连续 60 秒没字节才算吊死），别让它变成一条「整个流 60 秒」的隐形硬上限。
- **传输层失败自动同档静默重发一次**（`retriedNet`）：DNS / TLS / 连接断 / 整体超时；HTTP 错误照旧走降级阶梯（只 400/422 换档）**绝不重发**。一次请求最坏 4 次调用（传输 1 + 输出 2 + 降级 1）。
- **训练链只有三步**（`FLOW_STEPS`：读材料含找点 / 一稿 / 批改）：链前先摆一整页学习卡（`f.cardSeen`，不进步骤条），**两科都是先看学习卡再动手**、卡阶段不亮题面；归类降级成一稿页上的入口（`f.orgOpen`），沉淀并进批改页（`_lastDistilled` 异步跑完由 `paintExpLine` 就地补一行）。写与读材料时卡以浮标 + 抽屉常驻，**浮标挂在 `#docBody` 之外的 `#fabSlot`**（纸面内的 transform 会成为 fixed 的包含块）。学习卡 `example` 是「这类题长什么样」的全新示例，prompt 明令不得复用本题材料情节；翻卡计次只属作答阶段。

## 学习闭环（错因 · 复测 · 快判辨析点）

- **闭环最后一步是「回执」，不是「沉淀」**：批改 prompt 要求逐条回报 `experienceChecks`（title 原样照抄 + `again/fixed/na`），`applyExperienceChecks` 写回：`again → recur+1、cleared=false`，`fixed → cleared=true`，没给或 title 对不上就什么都不改（保持待验证）。批改页那行与画像三态都用这份结果，别另存一份。**沉淀不占一步**：提炼结果就近补进批改页，经验库管理在画像的经验页。
- `experienceChecks` 与 `kind` **都不参与计分**（与 hits/scores 分开）；`awarded` 与总分口径一字不动。
- **注入顺序就是复测策略**（`activeExperiences`）：还在犯的（recur 多的在前）→ 该核 / 该复测的（没核过，或已改但过了 `RETEST_DAYS = 7` 天）→ 刚核过且已改的。已改掉不是注销，是一周后换题重来。
- **阅卷温度钉在 0**（`GRADE_TEMP = 0`）。三档判法写在 `SCORING_RULES`：**数点不估百分比**，判「半分」必须在 evidence 里写出考生答到了什么。评分校准句（多数答卷落中间档 / 拿不准按中间档 / 答得长不等于答得全）属批改质量，删它等于打开宽松抬分与长度偏好两扇门。**别往 prompt 里写「分差控制在 ±3」这种数字承诺**。
- **判分要数的点出题时就写死**（`keyPoints[].need`，3-6 条，**一条只写一个可核对的事实、不许塞并列要件**；`GEN_POINT_RULES` 有反例）。阅卷只做一件事：照 `need` 逐条独立核（不许并起来判、不许顺带算）。旧记录没带 `need` 就退回按子项文字拆点。
- **报分先自己量**：need 原子化后残差约 ±1~1.5/20（折百 ±5~7.5），样本少时「极差 0」是运气。**报数连样本数一起报**，对用户报数字前先量三次，并把 evidence 抄出来看（分辨「稳定地对」与「稳定地偏严」）。
- **快判「下次再考你」是真承诺**：`pdTrapStats`（看最近 `PD_TRAP_WINDOW = 20` 题）→ `pdWeakTraps`（错过就排进来，错得多、出得多的靠前）→ `genPDRound` 请求体的 `weakTraps`（改请求体别丢）。辨析点文本先用 `pdTrapKind` 按关键词归到标准类再统计。
- **错因归有限几类**：`GRADE_TAGS` 六类（漏点 / 跑偏 / 结构 / 格式 / 表达 / 材料），`gradeTagOf` 只认闭集里的一类（认不出的当没给）；快判的 trap 故意相反（认不出就原样留着），两套标签分开维护。**标签的出口是出题**：`gradeTagStats(k)`（最近 `GRADE_TAG_WINDOW = 20` 条有采分点的记录，按模块分开）→ `weakGradeTags(k, 3)` → `gen()` 请求体的 `weakTags`；画像「常错类型」与出题「重点考这几类」必须同一份数据。
- **经验继承**：`storeExperiences` 是 kind 的关卡（只有错因类且属标签表那几类才落进 state）；**这次没给 kind 不许把已有的冲掉**。

## 作答限时

- **时长不分档**：`#inpLimit` 一个数字框，`normLimitMin` 是唯一口径（留空 / 0 / 填不出 = 不限时；小数取整；超 `LIMIT_MAX`(600) 按上限）。**失焦或回车才生效**，生效后回写规整值；单位「分钟」只在填了数字时才露（`.tlin:placeholder-shown + .tlunit{display:none}`）。
- **从「开始作答」那一刻起算**（综应A 的学习卡是预习不算）；切步与刷新不重置；**交卷停表 `setLimitState(limMin, 0)`**。锚点 `limitMin/limitFrom` 挂训练链（`sanitizeFlows` 的 `Object.assign` 保留未知字段），综应A 挂 `current`；时限记 `state.settings.timeLimit`，下一题沿用。控件在题目行与作答区标题行、行右饰收在 `.secright`；换时长**不重渲**（`setTimeLimit` 就地改）；时钟只开一个（`_timeTick`）。
- **到点不自动交卷**（写一半被截断不可逆）：只 `banner` 报一声 + 剩余时间转「已超时 mm:ss」（`--warn`，剩最后 5 分钟就转）。不弹阻断框。
- **用时是记录的一部分**（`h.timeLimit` / `h.usedSec`）：批改页报「本题限时 N 分钟 · 用时…（超时…）」；不设限时就什么都不写（不臆造 0）。记录表「用时」列（`usedCellHtml` / `fmtClock`）：没计时的留「—」，超时的把超了多少写在后面并转焦橙。

## 依赖与更新（桌面壳）

**流程细节、验包规矩、已知卡点都在 `docs/发布与更新.md`**；这一节只留边界与硬规矩。

- 更新模块 `update.js`；壳用 `GET /__update/status` 暴露，页面 `__updatePush()` 接，动作用 `POST /__update/check` / `/download` / `/install`（`/download` 只有 mac 链用）。**POST 一律要求自定义头 `x-liantai: 1`**（跨站会先 OPTIONS 预检）——别改成免头路由。
- **mac 那条链是自实现的**（`initMacUpdater` + `MAC_INSTALL_SCRIPT`）：① **只查不下、只下不换**（自查只推「有新版本」，下载与换包各要用户点一次，`status.autoDownload === false`）；② **只从官方域取包**（`github.com` / `*.githubusercontent.com`，明文 http 只放本机回环）；③ **换包要能回滚**（旧的先 `mv` 走，失败原地搬回并重开旧版）；④ **失败留痕** `<userData>/updates/install.log`，下次启动 `macLastFailure()` 读、`main.js` 灌进首页提示区。坏包改名 `.zip.bad`；下好没换成的包下次启动会认回来（`macScanDownloaded`）。
- **只发 NSIS 安装版，不要再加 `portable`**；免安装版必须禁用自动更新（带 `PORTABLE_EXECUTABLE_FILE` 就置 `disabled`）。
- 更新不碰用户数据；`nsis.deleteAppDataOnUninstall` 保持 `false`。更新失败绝不阻断：只进 `logs/startup.log`（`update-*` 行）与设置页一行提示，不在启动路径弹阻断对话框。
- **备用源与校验下载分离**：主源永远是包内 `app-update.yml`，连不通按 `BACKUP_FEEDS` 顺序换源；元数据取自 `BACKUP_FEEDS[i]`、包地址改写指向 `BACKUP_FEEDS[i+1]`（`installCrossSourceHook`），**相邻两条同时活着才算一条能走通的路**。设了 `LIANTAI_UPDATE_FEED` 就只认它。
- **差量缓存会错位，每次检查前必须自检**：`installer.exe`（NSIS 写）与 `current.blockmap`（electron-updater 写）可能指向两个版本；`alignDifferentialCache()` 每次检查前核对（blockmap 里 `sizes` 逐块相加 == 安装包大小），对不上就删 `current.blockmap`。
- **发布**：三个命令 `release` / `release:mac` / `release:check`，**发布前必须先提 `package.json` 的 version**（不提老用户永远收不到）。**每版都发两个平台**（一个 tag 下一整套，缺哪件由 `release:check` 逐件报）。
- **发版节奏**：改完不立刻发。**常规改善攒够一个主题再发**，**修重要 bug 当天就发**。发之前先给一份测试副本，日常使一两天，确认没问题再走正式发布。
- **测试副本**（`npm run test:build`，`tools/build-test.mjs`）：与正式版并存、数据分家的那一只 app。
  - 包内埋 `app/build-test.json`；壳认到它就换 userData 到 `…-test`、固定用 18744 端口（`localStorage` 按 origin 分区，撞上就是又一套空存储）、**不接更新链**（否则自动更新把自己顶成正式版，被测的东西当场消失）。
  - bundle id 与显示名带 test（Finder 里两个 app 不打架），不写发布源；产物落 `dist-test/`，与 `dist/` 分开。
- **单发 mac 必须加 `--prerelease`**：只带 mac 资产的 Release 会占住 `/releases/latest`，Windows 用户检查更新就 404（`release-mac.mjs` 默认不自己建 Release，除非 `--create`）。
- **发布闸门是脚本，不是人肉清单**：`tools/gate.mjs`（`release` / `release:mac` 开头自动跑，也可单跑）——① 工作区干净；② 远端 `main` 的 sha = 本地 HEAD；③ 跟踪文件里没有明文密钥。任一不过就停手；`--skip-gates` 是明知故犯时的唯一出口。**第四条 `npm run release:check` 只能在发完之后跑**。演示/测试用的假 Key 靠行内 `gate-allow` 标记放行。**验包不许碰本机那份安装**。
- **双机协作发版（四步）**：① mac 提 version + `CHANGELOG` 一行并推；② Windows 拉到最新后 `npm run release`；③ mac `npm run release:mac -- --skip-build` 补 mac 六件。
- **mac 包每版都有发布侧签名**（`tools/mac-key.mjs`）：`release:mac` 自动给每个 zip 签出 `.sig` 再传，没私钥就停手不传。**私钥在 `~/.liantai-release-key`，不进仓库、不上传，丢了就只能手动重装一次**；`update.js` 里的 `MAC_UPDATE_KEYS` 钉着公钥，换钥要先把新公钥加进数组发一版。细节与理由见 `tools/mac-key.mjs` 开头。
- **仓库位置与应用标识只有一处真源（`app-meta.js`）**：壳、更新链、发布工具都从它取 owner/repo/appId/name；`package.json` 的 `build.publish` 与 `build.appId` 是给 electron-builder 的同一份信息，两边对不上由 `tests/shell.mjs` 报错。**运行期不能读 package.json 取这些值**：打包时 electron-builder 会把 `build` 段剥掉。
  - Windows **直连官方 git 协议不通**：拉取用转发站一次性 fetch，**别改 origin、更别用它推送**（推送带令牌）——`git fetch "https://gh-proxy.com/https://github.com/lllvernan-blip/liantai-desktop.git" main && git merge --ff-only FETCH_HEAD`；拉完 `git rev-parse HEAD` 必须就是 mac 推的那条 sha，不等就别发。
  - **先发的那台决定 tag**（`gh release create` 用本地 HEAD 建 tag）：谁先发谁先拉最新；tag 不是本地 HEAD 就 `git checkout <tag>` 重新出包。Windows 的 gh 登录是交互式的，必须本人敲一次。
  - **历史被改写时（改提交说明这类）那台要重新对齐**：`git fetch <转发站> main && git reset --hard FETCH_HEAD`。
- **别在 mac 上出 Windows 包**：NSIS 要 wine 抽卸载器，这条链只认 Windows 本机或 GitHub Actions。
- **「洁癖」= neat-freak Skill**（`~/.cola/skills/kkkkhazix-khazix-skills-neat-freak`）：说「跑洁癖」就走它；对账代码 / 文档 / 规则 / 工作区，并审本文件规矩的执行情况，记忆面只读。**替代不了发布闸门**，两个都跑。
- 这台 mac：Node 在 `~/.local/opt/node`（跑前 `export PATH="$HOME/.local/opt/node/bin:$PATH"`），gh 在 `~/.local/opt/gh/bin/gh`。

## 名称与版本（别乱动的三样）

- 界面叫「练习台」；内部 id 永远 `liantai-desktop`（`package.json` 的 `name`、`build.appId`）。**不要加顶层 `productName`**（Electron 用它决定 userData 目录，一改数据就搬走）；`build.productName` 只影响安装包 / 快捷方式显示名，安全。
- `app/index.html` 里那两处旧默认机关名的迁移分支（旧名拼着写、源码不留完整串）是把旧版用户数据里的机关名改成「模拟练习专用」用的，**不是产品名**。
- 版本号测试阶段只走 `0.x.x`；明确说发正式版才跳 1.x。

## 界面（UI/UX）约束

- 顶栏 `.topbar` 是 sticky，只有一行（49px），背景随底板（`--canvas`），与底板融为一体。品牌标是应用书本图标（data URI 内联，22×22 圆角）+「练习台」，点击回首页、悬浮提示「首页」；**不许换回单字印章式代标**。科目入口是 `#subjbar`（品牌后、`.spacer` 前，**只有综应A/申论两颗，快判不进顶栏**）；模块入口不上顶栏，落在纸面 chips。`.wrap` 顶边距固定 24px，不补空行高度；**别用 `.topbar` 补高度**（会留一条带边框的空带子）。
- 模块落地页的纸面模块 chips 里，当前模块带 `on` 类（红边红底）；首页与科目起始页不带任何高亮（别谎报「你在哪」）。
- **「推送」没有界面入口**：自适应选题在出题引擎底层每次出题时发生，批改页 nextrow 只有「同模块再来一道」「看我的画像」；画像纯展示，不许出现「接下来练」「智能推送」类发起行动的行（空态去处除外）。
- 点纸面模块 chips 会 `$("#doc").scrollIntoView(true)`，顶栏 sticky——所以 `#doc` 有 `scroll-margin-top:100px`。
- **动效预算**：一屏至多一处主动效，不循环不自动播放；**当前全应用没有主动效**。其余只许 opacity / transform / 颜色的微过渡（≤240ms、只播一次），`prefers-reduced-motion` 下一律关。不引外部资源、不加依赖。
- **入口纸面的垂直节奏与层级**：`.startbox.start-entry` 的元素间距走全局五档（4/8/12/16/24，见 `docs/界面规范.md`），同屏同类间距一致；模块切换 chips（`data-mod`）是次级导航，**降半档**（小一号、淡色、透明底），别和文种选择 chips 平起平坐。
- **信息密度优先**：长信息一律「一行一条 + 点开看明细」，不用卡片依次铺开。三种收纳件 `.mrow` / `.expline` / `.notebox`；**折叠的 `summary` 必须有可见三角**。
- **批改页**：次序是分数（右侧「换一题」）→ **我的答案（逐句标注）** → **参考答案** → **解析** → 提炼回执。**不重复题面**：作答要求、分值、难度都不在这一页出现，分数就是这一页的头。**分数只报一处**（不另报「丢 N 分」、不报采分点项数）。题目行的「换一题」与轻题头同行（`.secrow` + `.sec-title.plain`），不独占一行。三段平铺、不折叠；**只有「我的答案」用重题头**（红竖线那套），参考答案与解析降成细线上方的墨灰小标题。**不另造「丢分清单」这类清单**——哪句没拿对就标在卷面上，漏了什么由解析说；**标记只给丢分处**：零分标红、半分在句末报出拿到几分，满分句什么都不挂。解析 100 字以内，只讲这题的采分点与答法、不评价答卷。**维度分不在批改页**，「答得好的地方」也不单列。逐句标注是**派生**的：拿采分项 evidence 里的逐字片段（AI 写在引号里）定位回答卷、得分加到那句上，不额外调一次 AI；定位不到一半就整块退回只摆答案（见 `answerMarks`）。
- **文案分四类**：空态提示（留）、必备声明（留）、讲机制 / 流程（删）、重复的口径（并成一条）。只写「结论与操作」；**发给模型的参数细节不写**；「只存本地 / 备份不含 Key / Key 只发往你填的地址」这类声明一字不动（删了就是骗人）。
- **更新日志一个版本只写一条**：`app/index.html` 的 `CHANGELOG` 给用户扫一眼；最重要、最直观的那件事写在前半句，其余概括成「修复了一些问题」之类带过；**不带括号、不写原因、不写怎么实现的**。细节进 commit message 与 Release 说明。**两个平台共用同一条**，动笔的地方在这台 mac。只约束新写的条目，旧条目不回改。
- **说明句紧贴主行动**：各起始页红按钮紧跟在它上面的说明句下方，间距一律 24px——说明句和按钮是一个整体，中间不插大空档；次级行（模块 chips）也一律 24px 跟进。
- **快判只有首页一个入口**：首页红按钮「开始快判」→ `startPDRound(PD_MIX)` 直接综合一轮；`PD_FORMS` / `PD_FORM_ORDER` 只当出题引擎用，界面上没有可挑的形式、没有落地页、没有顶栏入口。快判一轮进行中 `pdActive` 置真、`_view = "pd"`（判别轨是独立的第四屏：不挂 `_view` 会被首页那支报成「首页」，与文号的「快判」自相矛盾），小结收尾是「再来一轮 / 回首页」。**出题失败回到出题前的现场**：上一轮已收尾就回小结（回到那道题的「看本轮小结」上，它的翻页守卫会把人钉在原地）。
  - **起始页统一 hero 排布**：`startBoxHtml(rf)` 三页共用同一套骨架（hero-big → hero-sub → 红按钮 → chips → foot，间距全 24 档、几何同锚）。**首页**：大标题「今天练什么？」+「按你最近的练习情况出题，写完就有分」+「开始快判」+ 两枚点名科目 chips + 必备声明。**科目页（综应A/申论）**：大标题「综应A/申论 练什么？」+ 说明句换成当前页的话（本页流程「学习卡 → 作答 → 批改，写完就有分」）+「开始综应A/申论练习」+ 模块 chips + 同一行必备声明。**首页也是一张公文纸**：红头常显，hero 接在卷首下方。**没填 Key 时两处主行动都换成 `#btnSetup`「先填 API Key（出题和阅卷都要）」→ 开设置页**——出题这条路此刻走不通，按钮就不说「开始练习」或「开始快判」。三颗按钮都可能不在，`wireStartBox()` 一律取到再接线。
  - **首页没有科目**：打开落在 `renderHome()`，三个入口一个都不预选（`.subjbtn` 不许带 `active`）、纸面不摆模块 chips。品牌名 `#btnHome` 是唯一回首页的路，别删。
  - **大题必须点名科目**：首页那两枚 chips（「综应A 练一轮」/「写一篇申论」）走 `startSubjectTask(subject)`（切科目 → 退判别轨 `pdActive = false` → 出题）。**不许写成不点科目名的说法**（如「练一道大题（综应 / 申论）」）——那实际去的是上次练的科目。
  - **没 Key 就没有快判可练**：判 Key 在 `startPDRound`（经 `entryBlocked()`）：没填 Key 时首页红按钮位换成「先填 API Key」，`startPDRound` 被调也停在原地、不进加载态；界面不提供绕开 Key 的练法。
- **纸就是纸，不是网页卡片**：`.doc` 是公文纸——6px 小圆角、放平的阴影、`min-height` 撑满视口（下方不悬空），不许做回大圆角悬浮卡片。纸面下半截空着是刻意设计（模拟纸张）。要动只有一条路：把已有的那件事做大（如起始区主行动放大），不是添新东西。
- **落款跟着抬头走**：文号（`#docNo`）前缀**由抬头推出来**，没有设置项——首页 `练习台`、快判轨 `快判`、其余按科目名（`renderHeader` 一处定）。**能推出来的东西就不要让用户去设置里维护**（留一个不起作用的控件就是界面在说谎）。
- **入口少字、详情可密**：入口屏（起始页 / 模块落地页）只写「这是什么 + 怎么开始」；进去的明细（作答页 / 批改页 / 画像二级页 / 设置 / 折叠件内部）可以密。判「字多」看的是**入口**。
- **一句成功 / 一句「正在做」，都得有依据**：把「点下瞬间」与「一秒后」两个时刻的界面文字都抽出来对账，凡是「先答应、马上又反悔」的都算骗人。新增调用点时照这几条自问：
  - **出题 / 阅卷一律先过 `entryBlocked()`**（缺 Key 或没选模型都不进加载态、不点亮按钮），必须排在 `showLoading` 之前；`startPDRound` 与 `submitAnswer` 都在列。
  - **等待页的时间预期是参数**：`showLoading(t, tail)` 第二行默认「AI 出题通常 10-60 秒」，别让它说出与当前动作无关的时长。
  - **引导要跟「此刻真能做到什么」一致**：全应用只有**一条**首次引导序列（`TUT_SEQ`，顺序 home → zy → sl），别拆回分屏各弹各的；快判不进序列。步骤由 `visibleSteps()` 按有无 Key 过滤（`nk` 变体替换、`onlyKey` 整步去掉）。跳过 = 整条序列不再自动弹；播到一半切走页面 = 暂停，游标不推进；弹层打开时气泡暂歇，不叠在弹层之上。
  - **产出反馈不夸口**：导出只报「已生成备份 + 文件名」（弹保存位置后取消了我们无从得知），不说「已导出 ✓」；`save()` 把「到底写进去了没有」回给调用方，存储写满时设置页不写「已保存 ✓」。
  - **隐私说明要具体**：「练习记录、草稿、划线只存你这台机器上（我们的服务器不碰）；批改那一步会把题目、你的作答与归类提纲发给你上面填的服务商——它才能给分。」
- **界面不许谎报**：
  - **不许谎报「我在做什么」**：明知走不通就别先答应一声；也别把人从首页拽进科目页（那是靠切 `settings.subject` 完成的）。
  - **不许假装没发生**：故意不做的楼不要留给用户错觉——拿不到的结果不亮成功态，不入账的轮次直接不存在。
  - **纸面上不写抬头已报的标题**：抬头（`#modLabel`）已经报了「你在哪」，纸面再写一遍就是同一句话写两次；纸面第一行得是「这是什么」（模块 `note`）或数据。名单同理：`renderModuleLanding` 拆词比对，`note` 与子类型胶囊重复就不写。小结也只写「本轮小结」。
- **画像分两级**：一级一行一个入口（模块 / 快判 / 经验 / 记录，`.navrow` 整行可点、尾部 `›`），二级才是明细。`profPage` 是当前页（`null` = 一级），`profGo` 进、`profBack` 回；`openModal("modalProfile")` 一律回一级，而 `renderProfile()` **不会**自己回一级。一级的行是按钮不是折叠件。**两级都要接线**：`wireProfileNav()` 与 `wireExperiences()` 一个不能少（停用/删除两颗按钮只长在二级页上）。
- **弹层加东西先量「主按钮还在不在视口内」**：加两三个字段，主按钮就被顶到窗口高之外。可选件一律默认收起（`<details class="addpick">`），收起态要 `panelScrollH === panelClientH` 且主按钮底边 ≤ 窗口高。
- **长什么样看 `docs/界面规范.md`**：字号 / 控件高 / 颜色与表面 / 间距与分隔 / 横向基准 / 纸面 / 数据列 / 组件形状 / 设计语言都在那一份。**改界面前先读**；本文件只留行为与口径。

## 端口与存储（桌面壳）

- 本地 http 源**必须固定端口**（`main.js` 的 `PREFERRED_PORT`）：`localStorage` 按 origin（含端口）分区，随机端口会让用户的设置、记录、草稿在重启后「消失」。改端口策略等于改所有用户的存储位置，属破坏性变更。
- **三个边界策略写在 `shell-policy.js`**（主进程 require 它，`tests/shell.mjs` 纯代码验它）：① **窗口内导航只放行本源**（`isOwnUrl`：`127.0.0.1` + 当前端口，**按「源」比而非字符串前缀**），外部链接交系统浏览器；② **每个请求过 Host 校验**（`hostAllowed`：必须就是本源，比 Origin 靠得住）；③ **Origin 校验**（`originAllowed`）**不带 Origin 的请求必须放行**（页面自己 fetch 同源 GET 不发 Origin）。改动作的路由另有 `x-liantai` 头把关，两道合起来才成立。
- **渲染进程带 CSP**（`cspFor`，由本地服务下发响应头，非页面里的 `<meta>`）：`default-src 'none'`、`object-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'`；`script-src` **只认 nonce**（不给 `'self'` 也不给 `'unsafe-inline'`），HTML 下发时用 `injectNonce()` 给内联 `<script>` 打上本次 nonce——认不出标签就退回宽松策略并记日志，**宁可松一格不能白屏**；`style-src` 必须留 `'unsafe-inline'`（界面大量用 `style="…"` 属性现算现写）；`connect-src` 留 `http:`（接口地址自由填写）。**新增任何一类资源（图标 / 字体 / 媒体）都要在 `cspFor` 里开口子**，否则在应用里就是加载不出来。
- **主进程 require 的仓内模块必须写进 `package.json` 的 `build.files`**：漏一个，源码直跑一切正常、装上才崩（shell 测试有断言播这个）。
- 端口退让必须写 `port-fallback-warning` 日志（让「数据看起来没了」可诊断）。
- 启动路径对声明顺序敏感：`load()` 依赖的 helper（如 `HISTORY_KEY` 这类 const）必须定义在首次调用点之前，否则 TDZ 报错会被兜底 try/catch 静默吞掉。
- 强杀进程会丢最近的异步落盘写入；涉及「答案不可再生」的改动要考虑落盘时机。

## 状态与兼容

- `gw_state` 保存设置、画像、学习卡、笔记和模型缓存；练习历史在独立的 `gw_history`（写满裁最旧，**不得并回 `gw_state`**）。
- `gw_draft` 保存未提交草稿；`gw_marks` 保存按题目签名的材料划线。**这两样的落盘失败必须出声**（`storageFail()`，同一次故障只报一次）：草稿与划线是不可再生的手写内容，静默丢掉就真没了（`save()` / `saveHistory()` 一直把「写没写进去」回给调用方，草稿与划线不许例外）。
- 修改状态结构时保留旧数据的默认合并与迁移；导入数据不能未经校验直接当成可信记录。
- 题目、草稿和划线通过题目签名关联，不能使用全局单槽覆盖当前题之外的数据。

## 修改后验证

`node tests/run.mjs` 必须看到 `N/N passed` 且退出码 0；涉及窗口 / 启动 / 加载方式再真跑 `npm start`；涉及浏览器交互、异步、设置弹层、导入导出或本地存储要真路径走一遍并看控制台。**细节（探针 / 漂移 / 调试坑）看 `docs/验证工具.md`**，别凭记忆改工具参数。几条最常踩的：

- 临时量一段真行为：写成探针文件再跑 `node tools/probe.mjs 我的探针.js`（可用应用全部函数与常量；一次性，用完删）。
- 量阅卷漂移用 `tools/drift.mjs`，**基线必须两份答卷都跑**；Key 只从 `LIANTAI_KEY` 读。
- **界面验收用真浏览器看当屏**：改完打开 `app/index.html`（壳功能除外）看一眼，别只看断言数字。
- **别用 `node -e` 写带 JSON 片段的探针**（Git Bash 会把含冒号 + 反斜杠的参数当路径列表改写），写成文件再跑。

## 编辑纪律

- 先读周边代码和现有测试，再做最小范围修改。
- `MODULES` / `GONGWEN_TYPES` / `PD_FORMS` 一改必须同步 `docs/题型规范.md`。
- 打包走 `npm run dist`：先 `tools/stamp-build.mjs` 写 `app/build.json`（里面只有版本号，设置面板底部显示它——别写成「构建时间」），再调 electron-builder。**不要用文本工具改 `打包.bat`**（GBK + `chcp 936` 会被写坏）；加步骤改 `package.json` 的 `scripts.dist`。
- 提交说明只写改了什么、为什么、怎么验证的；**不引用对话、不写「某人说」这类原话**，文档与注释同理（都在公开面）。提交前过体检工具：`node ~/cola/tools/check-msg.mjs`（清单在同目录 `check-msg.local.json`；**别放进 `~/.cola/` 顶层**，那里会被整理机制搬走）。命中就改；已推送才发现要改，得重写历史 + 强推，先问。
- **成批写 / 改措辞先过目**：成段、成批的文字（代码注释、文档、界面文字、提交说明）在落盘前先列「原来 → 现在」的对照给他看，等一句话再写进去；单处一句话的修补不用问。
- **规则句判据（三条全过才写进来）**：① 现在时祈使——写「照着做 / 别做 X」，不带日期戳与「曾 / 原来 / 已撤」；② 不绑今天的机制——绑着机制名的那半句进 `docs/`；③ 单次事故不进正文——只进泛化后的结论。写之前先问「不照做会不会犯错」，不会就别写。
- 不提交 API Key、真实个人资料或真实练习备份；`node_modules/`、`dist/`、`logs/` 不进 Git。
- 不删除用户未授权的文件或数据；临时调试产物结束前清理。
