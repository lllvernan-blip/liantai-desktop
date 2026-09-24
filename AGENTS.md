# 项目协作规则

## 边界

- 形态是「Electron 桌面壳 + 零依赖单文件应用本体」：业务代码全在 `app/index.html`，不要给它引入 npm 依赖、构建步骤或框架。
- 壳 `main.js` 只用 electron + Node 标准库；**唯一的例外是 electron-updater**（差量自动更新非它不可，见下文「依赖与更新」）。再加任何依赖前先问用户。
- API Key、答案、练习记录和本地笔记不得写入 Git。API Key 只允许由用户在设置界面填写。
- **备份文件永不携带 API Key**：`exportJSON` 走 `exportPayload()`（克隆 state 后删掉 `settings.apiKey`）。导入端同样不吃文件里的 Key，也不因文件没带而清空本机 Key——Key 只认本机设置界面填的。理由：备份会被分享/传网盘，而别人给的备份也不该能换掉你的 Key 或把你的请求拐到别的 baseUrl。改动导出/导入时这条不得回退；`tests/assertions.js` 15.4 节是哨兵。
- 用户答案是不可再生资产。异步失败、换题和页面渲染不得无故清空题目、答案或草稿。
- 练习记录是画像和调度的事实源；新增聚合字段前先确认不会造成两份状态漂移。
- 总分口径唯一：总分 = 采分点（带分值子项）实得分之和，`grade.total` 存折合的百分制值供画像跨题比较；维度分只能用于诊断，不得参与总分汇总。
- 口径只有一处实现：`recordTotal()` 是「一条记录的总分」的唯一定义（优先 `grade.total`，老记录才回退维度分折算）。画像的模块均分、子类型统计、调度基准分一律走它，**不要另起一个从维度分算的聚合**——曾经 `moduleAvg` 自己算维度平均，结果同一条答卷画像报 75、记录表报 60。注意 `moduleAvg()` 返回的是百分制（0–100），不是 0–20 的维度分。
- 题型表以**官方大纲**为准，不采信培训机构自造的题型归纳。依据：综应A 看大纲 §5.1.2.2 五项能力与 §5.1.2.3 六项工作内容（观点归纳 / 资料分类 / 草拟信函 / 会务安排 / 应急处理 / 联络通知），申论看大纲五大能力对应的五类题型（归纳概括 / 提出对策 / 综合分析 / 贯彻执行 / 申发论述）。机构讲的那套「综应A 五大题型」是它们自己的归纳，常把 A/B 类内容混写，曾据此误判过模块结构。动题型结构前先回查大纲原文。

## 模型与档位（AI 调用）

- 模型候选的唯一出口是自绘下拉 `#modelMenu`：原生 datalist 会按输入框已有文字过滤（填了模型名后另一个就「看不见」，曾致「只拉到一个模型」的误报），外挂 chips 也已并入。别恢复 datalist 或 chips——这两个方案已在两个 agent 之间来回拉锯两轮。
- 模型能力**不按名字猜**：曾因 `deepseek-flash` 不带 v4 被误判无档位。`THINK_FAMILIES` 只收参数发法特殊的家族（qwen3 / glm），其余一律默认按 reasoning_effort 实测试探；`modelCaps`（ok / rejected，被拒自动降级并顶栏 banner 明示）与 `modelProbe`（思考字数 / 耗时，两档攒够后在设置页给「切换是否有效」结论）是持久状态，load / importJSON 已做迁移，别绕过它们另建能力判定。
- 综应A 学习卡阶段不亮题面（题目、要求、分值等点「开始作答」才出现）；学习卡的 `example` 是「这类题长什么样」的全新示例，prompt 明令不得复用本题背景材料情节。翻卡计次只属作答阶段的抽屉，卡阶段平铺不算翻卡。

## 依赖与更新（桌面壳）

- 依赖边界：业务本体 `app/index.html` 永远零依赖；壳只允许 `electron-updater` 一个额外依赖（它负责差量更新：NSIS + `.blockmap`，只下载变化的块——用 Node 标准库写不出重建安装器的逻辑）。新增任何依赖前先问用户。
- 更新模块是 `update.js`，状态机 `idle / checking / available / downloading / downloaded / up-to-date / error / disabled`；壳通过本地源上的 `GET /__update/status` 暴露状态，页面用 `__updatePush()` 接（壳主动推），动作用 `POST /__update/check` 与 `POST /__update/install` 触发。**POST 一律要求自定义头 `x-liantai: 1`**：跨站请求会先发 OPTIONS 预检，而本服务从不回 CORS 头，预检就过不了——别把它改成免头路由。
- **只发 NSIS 安装版，不要再加 `portable` target**（阿楠 2026-09-18 拍板：机器上只留一份、跟着更新走）。历史上发过的免安装版资产已从各 Release 删掉。
- **免安装版必须禁用自动更新**（代码里这道防线留着，哪天又有人拿 portable 包去跑）：portable 进程带 `PORTABLE_EXECUTABLE_FILE`，对它 quitAndInstall 只会「装出一个新副本」，检测到就置 `disabled`，由设置页说明原因。
- 更新不得碰用户数据：用户数据在 `%APPDATA%\liantai-desktop`，更新只替换安装目录里的程序文件；`nsis.deleteAppDataOnUninstall` 保持 `false`（卸载也不删练习记录）。
- 更新失败绝不阻断使用：只进 `logs/startup.log`（`update-*` 行）与设置页一行提示，后台自动重试（出错后 30 分钟、常驻每 6 小时）。不要在启动路径上弹阻断式对话框。
- 发布：`npm run release`（`tools/release.mjs`：盖章 → 出包（`--publish never`，组件源内置 npmmirror 兕底）→ 建 Release → 逐个 `gh` 上传并对账）。**发布前必须先把 `package.json` 的 `version` 提高**——版本号不变，老用户永远收不到这一版；tag 重复会被脚本直接挡下。发布失败若已建出空壳 Release，先 `gh release delete vX.Y.Z --yes --cleanup-tag` 再重出。
- **发布必须对账**：electron-builder 给每个 target 各跑一次发布流程，第二个 target 会撞 `tag_name already_exists` 中断——`latest.yml` 与 `.blockmap` 常就在这一步丢，而少了 `latest.yml` 自动更新压根不会启动。所以 `release.mjs` 不信返回码，出完包按产物逐个对账、缺的用 `gh` 补传；`latest.yml` 永远覆盖上传（它是指针，留着旧的会被当成「已有」跳过）。`npm run release -- --reconcile-only` 只对账不出包。
- **发布前先跑洁癖（五项检查），发完清 dist 旧包（阿楠 2026-09-21 拍板：以后发布前就说「跑洁癖」）：
  ① `git status --short` 工作区干净；② `gh api repos/lllvernan-blip/liantai-desktop/commits/main --jq .sha` 与本地 HEAD 一致；③ package.json 三铁律（version 已提、`build.win.target` 仅 nsis、无顶层 `productName`）；④ 源码 grep `sk-[a-f0-9]{20,}` 零命中；⑤ AGENTS/README 引用的文件路径全部存在。
  发布后删掉 `dist/` 里旧版本安装包、blockmap 与 `win-unpacked` 残留——dist 只留最新一版三件套（供断网对账）。洁癖没跑就先出了包的，事后也必须补跑：0.0.9 就是在 dist 里攒了两版旧安装包才被抓到的。
  **验包不许碰本机那份安装（2026-09-24 修正，原「装到临时目录跑一次」的写法作废）**：electron-builder 的 NSIS 安装器按 AppId 找「上一版」，安装前会先静默卸载它——`/D=<临时目录>` 只改文件装到哪，挡不住这一步。0.0.13 发布时按旧规程装到临时目录验证，结果把本机那份 0.0.12 连目录带卸载项一起卸了，桌面与开始菜单快捷方式也被改指到临时目录（用户数据在 `%APPDATA%\liantai-desktop`，不受影响）。三条规矩：
  - 验「打包产物能不能起」：跑 `dist/win-unpacked/练习台.exe`——同一份产物，不装、不写注册表、不动快捷方式。要真正零接触，还得补两样：用 `--user-data-dir=%TEMP%\liantai-verify` 起（不碰真实 `%APPDATA%\liantai-desktop` 里的记录与 Key），并加 `LIANTAI_UPDATE_FEED=http://127.0.0.1:<本地源端口>/` 指本地源（不让它去真实源下载、不写差量缓存）。另外：它和用户手上那份共用单实例锁与 18743 端口，所以**他正在用的时候不要起**，跑完删临时目录。
  - 验「安装器本身」：只在沙箱里做（另开一个 Windows 用户或虚拟机）。**没沙箱就不验**——代价就是本机在用那份被卸掉。
  - 万一真在本机跑了安装器：先把当前版本的安装包从 Release 留一份，跑完用 `/S` 静默装回去，再核三处归位：`%LOCALAPPDATA%\Programs\liantai-desktop` 目录、`HKCU\...\Uninstall` 里的卸载项、桌面与开始菜单快捷方式指向。
  附带事实：安装器会把自己的安装包写进 `%LOCALAPPDATA%\liantai-desktop-updater\installer.exe`（差量基准），随安装自动就位；装回去之后它也会跟着回到上一版，不用手工维护。
- 对账前会校验 `dist/latest.yml` 的 `version` 与 `sha512` 是否就是当前产物：**别拿上一次试打包残留的清单去对账**，否则会把旧版本号或错哈希写到线上（客户端表现为「版本号是新版、内容是旧版」或「下完校验失败」），两种都不会在打包阶段报错。
- 差量的两个前提：缓存 `%LOCALAPPDATA%\liantai-desktop-updater\installer.exe`（上一版安装包）在，且**源上旧版的 `.blockmap` 不删**。generic 源支持 `multipart/byteranges` 才是真差量（不支持就优雅退化为全量，不报错）；GitHub 资产 CDN 对多段 Range 返回 501，但 `BaseGitHubProvider` 写死单段逐段请求（206 可用），所以 GitHub 源差量可用。
- 网络现实：国内直连 GitHub 时 `checkForUpdates` 可能直接 `ERR_CONNECTION_TIMED_OUT`（真机见过）。这不是 bug：失败会按规则重试且不阻断使用；要稳定就换源（`LIANTAI_UPDATE_FEED`）。
- **备用源与校验下载分离**：主源永远是包内 `app-update.yml`（GitHub 官方）；它连不通时 `update.js` 按 `BACKUP_FEEDS` 顺序换源，全试过才落 error（下一轮从主源重新开始）。列表在 `update.js` 顶部：2026-09-18 在本机实测 `ghproxy.net` / `gh-proxy.com` / `gh.ddlc.top` 可用且都支持 Range（差量照旧），直连 github.com 则是连接超时。**校验与下载必须分开（2026-09-21 阿楠拍板）**：元数据（带 sha512）取自 `BACKUP_FEEDS[i]`，安装包地址改写指向 `BACKUP_FEEDS[i+1]`（`installCrossSourceHook` 覆写 `getUpdateInfoAndProvider`，只取原地址末段拼到我们选的下载源上，元数据里写绝对地址也拨回来）。同一个源改不了两边，sha512 校验才不是自证；要作恶得两个源同时动手。设了 `LIANTAI_UPDATE_FEED` 就只认那一个源，既不兜底也不拆。
  - 本地验更新链路不必真装：`LIANTAI_UPDATE_FEED=http://127.0.0.1:<port>/` 指向一个放好 `latest.yml` + 安装包 + `.blockmap` 的目录，跑 `dist/win-unpacked/练习台.exe` 即可（generic 源）。

## 名称与版本（别乱动的三样）

- 界面上叫「练习台」；内部 id 永远保持 `liantai-desktop`：`package.json` 的 `name`、`build.appId`。**不要给 package.json 加顶层 `productName`**——Electron 用顶层 `name` / `productName` 决定 userData 目录，一改用户数据就搬去新目录（用户会以为记录全丢了）。`build.productName` 只影响安装包/快捷方式的显示名，改它安全。（历史上这项目叫过「规范表达」→「综应练习台」→「练习台」，界面上改名字从不影响数据。）另外：`app/index.html` 里还有两处 `orgName === "综应练习台"` 的迁移分支 —— 那是把旧版写进用户数据的机关名改成「模拟练习专用」用的（测试里有对应断言），**不是产品名，别跟着一起改**。
- 版本号：测试阶段只走 `0.x.x`（用户拍板：「现在还算在测试」），他明确说发正式版才跳 1.x。

## 界面（UI/UX）约束

- 顶栏 `.topbar` 是 sticky，高 92px（工具栏 + 页签栏）。**页签栏 `.modbar` 的高度必须锁死**（`min-height:47px`）：快判模式下不渲染页签，不锁就会矮 13px、整条顶栏看着像“往上跳”（用户报过的 bug）。
- `.tab.active` 由全局 `tabActiveKey` 驱动：作答中 / 模块落地页 = 那个模块；起始页与快判 = `null`（别谎报“你在哪”）。调用点在 `renderModuleLanding` / `renderQuestion` / `renderStart` / `enterPD`，改页签渲染时四处都要跟上。
- 点页签会 `$("#doc").scrollIntoView(true)`，而顶栏是 sticky——所以 `#doc` 有 `scroll-margin-top:100px`，否则红头会被顶栏盖住。
- 动效三条自律（用户对“界面自走”极敏感）：只播一次、≤240ms、不循环不自动播放；只动 opacity / transform / 颜色；`prefers-reduced-motion` 下一律关。不引外部资源、不加依赖。
- 颜色：**不要黄色系**（用户明确不喜欢），划线默认绿 `#a7f3d0`，主色一律 `--gov-red`；公文纸面风（直角、极小圆角）是刻意选的，别改成大圆角卡片风。
- **信息密度优先（2026-09-22 改版定的形状）：长信息一律「一行一条 + 点开看明细」，不用「一张张卡片依次铺下来」。** 三种收纳件：`.mrow`（画像一个模块一行：名称 / 均分 / 细条 / 次数 / 短板）、`.expline`（经验一行一条：类型 / 标题 / 摘要）、`.notebox`（批改页折叠区，在 `.grade` 里收成带顶线的行、不再套盒子）。**折叠的 `summary` 必须有可见三角标记**（`::after` 已统一给出）——没标记用户不知道能点开。批改页次序是「结论在上、明细在下」：分数 → 丢分最狠的三条 → 阅卷点评 → 优点 → 全部采分点对照（展开）→ 维度分 / 参考答案（折叠）。改这几屏时别退回并排卡片；渲染类断言盯着 `width:NN%`、`均分 N`、`短板·X`、`hitline miss`、`折合 N 分` 这些串，跟着一起改。
- **质感基线（2026-09-22 造型收敛）：以后改界面按这几条来，别再一点点积回“糙”的感觉。**
  - **字号只有六档**：12 标签 / 13 元信息与提示 / 14 行与控件 / 15 正文与材料 / 16 小节标题 / 19 大标题（红头 26/30 单算）。13.5 / 14.5 / 15.5 这类半像素档已全部归位，别再引入。**`<small>` 是个陷阱**：不写 `font-size` 它就按浏览器的 `smaller` 算——父级 13px 时算出 10.8px，悄没声地掉到六档之外（2026-09-23 被取景器自检担出来的，修在 `.chip small` / `.typestat .t small`）。
  - **控件只有两档高度**：`--h-ctl:36px`（按钮 / 输入框 / 下拉）、`--h-ctl-sm:30px`（胶囊 chip / 科目按钮 / 工具栏文字键）；控件 `line-height` 定死 1.35，不许再继承 body 的 1.7（否则一个按钮就 40px）。
  - **颜色只走 token**：`:root` 外不写 hex。淡底只有 `--wash / --wash-2 / --wash-3 / --line-soft`，语义色用 `--danger / --success / --warn`。`--warn(#b45309)` 是焦橙不是黄（“半对”与提醒句用），别再另开一个暗金 `#b8860b` 那种黄。
  - **数值列不抖**：分数 / 百分比 / 次数 / 字数一律 `font-variant-numeric:tabular-nums`，并给固定宽右对齐（范例：`.hist .num`、`.barline .bn/.bv`、`.mrow .mavg/.mmeta`、`.hitline .sc`）。只加 CSS，不改结构或文案——`width:NN%`、`均分 N` 这些串是断言盯着的。
  - **分隔线一套**：逐条列表一律 1px 实线（`.pditem / .hitline / .pickline / .asgline / .lossline / .barline / .mrow / .expline`），虚线只给 `.nextrow` / `.redline` 这类非实体分隔。
  - **折叠三角只有一套**：12px + `var(--line-strong)`；flex 行用 `margin-left:auto`，块级 `summary` 用 `float:right`。
  - **悬停上浮只给 `.primary` 红按钮**；其余控件悬停只换底色或描边。焦点反馈三处一致：输入框与大文本框都带 `--focus-halo` 外圈。
  - **行内 `margin-top` 有 9 档（4/6/8/10/12/14/16/18/26）尚未收敛**：都在 JS 模板串里，逐处改带回退风险；将来动它要小批替换 + 全量自检全绿。
- **横向基准只有一条（2026-09-22 第二轮精致度：阿楠说「还是不够精致」时最扎眼的一处）**：纸面是 `max-width:880px` 居中的，而顶栏/科目栏原来是两端贴窗口边——一屏里两套左右基准。`.toolbar` 与 `.modbar` 的左右 padding 统一写 `max(14px,calc((100% - 880px)/2 + 14px))`，与 `.wrap` 逐像素对齐（窄窗口自动退回 14px），任何新顶栏行都照抄。
  - **纸面要像纸**：`.doc` 带 `--sh-paper`（两级极淡投影）。白纸贴在灰底上没边，看着就是个 div。
  - **细条（`.barline .bt` / `.mrow .mbar`）只能 4px + 圆头**，填充色 `--bar(#a9a49a)`。之前 6px 实心深灰是整行最重的东西，比字还重——诊断数据不该抢注意力。
  - **`--head(#f2efe8)` 是暖底**：原来 `#f1f2f0` 偏冷，在暖纸面上是一块灰斑。
- **画像的数值列是定宽右对齐，不是 min-width**：`.mavg/.mmeta` 各 `flex:0 0 84px`（「正确率 100%」宽 83px）、`.mweak` `flex:0 0 120px`。用 min-width 时宽值会把细条起点逐行往右顶（阿楠看到的就是「一列数字」实则逐行跳）；未练行也走 `.mavg`（不是 `.mmeta`），这样「未练」与「均分 N」同列、维度说明与细条同起点。
- **训练链步骤条 `.flowrail` 是「进度」不是「五个按钮」**：`counter-reset/increment` 出序号徽标（已过 = ✓、当前 = 红底白字）、`width:fit-content` 自成一条、段间 1px `--line-soft` 分隔、上下 1px 实线。**它不可点（没有点击处理），所以不给 `cursor:pointer`/hover——看着能点却点不动比没反馈更糙**。
- **题头右侧的行内动作走 `.secrow`**（`justify-content:space-between`）：`换一题` 以前单占一行、孤悬在题头之上。注意断言盯着 `class="sec-title">题目` 这个串，包一层 `.secrow` 安全，别给 `.sec-title` 自身再加类。
- **题面字段（作答要求 / 建议结构）用悬挂缩进**：`.require{padding-left:5em;text-indent:-5em}` + `.require b{display:inline-block;min-width:5em;text-indent:0}` + `.require br{display:none}`——两个标签都是 5 字，于是值从同一条竖线开始，折行也缩进到值那一列。**`b` 上的 `text-indent:0` 不能省**：`text-indent` 是继承属性，而 `inline-block` 自成块容器，会把父级那个 `-5em` 在自己的首行上再应用一次，标签的字因此被推到纸面左边缘之外（实测标签字形起点 181、纸面左沿 201，窄窗口下甚至是 -1）。
- **设计语言（2026-09-22 第四轮，「改的不行」之后定下来的四句话）**：
  - **控件是产品，文档是公文**：按钮 / 页签 / 下拉用雅黑（仿宋笔画细，小字号像没渲染完）；红头、材料、作答、范文才是仿宋 / 宋体的地盘。新控件别再默认继承仿宋。
  - **清单只有一种语言：一条顶线 + 行间细线，不套框**。`.hits/.pdreview/.hist/.mrowbox/.ogroup/.notebox` 全部去边框盒（2026-09-22 改）；新增列表别再画 `.xxx{border:1px solid var(--line)}` 的盒子。
  - **框只留一个，卡里不再套盒**（2026-09-23 改）：`.tpl`（答题框架 / 示例 / 提纲 / 差异对照）去掉 1px 边框与近白底，只留左缘 2px `--bar` 细线——框由它所在的学习卡（`details.card` / `.card`）提供。给文本块加框前，先看它是不是已经站在某个框里。
  - **欢迎语不穿报错的红衣服**：`banner(html)` 默认是安静的信息条（左缘 3px 红线）；只有真失败才 `banner(html, "error")` 存储写入失败、接口失败、导入失败这批。别再让两类消息共一种样式。
  - **主角要敢占地方**：材料 16px / 行距 2.05（作答区、范文同步）；主行动按钮 40px 高 / 15px 加粗（`.primary`）；批改页分数 30px。一个屏幕里这种重量级的东西只允许一个。
  - **pill / tag 不描边**：`.pill/.etag/.ptag/.typestat .t` 都是淡底色块，不再 1px 边框 + 淡底 + 彩字三件套（那是 Windows 复选框的气质）。
- **灰要分三档（2026-09-22 第三轮）**：`--ink`（结论/正文）/ `--muted #5e5e57`（元信息）/ `--muted-2 #827d72`（约 4.0:1，证据 / 计数 / 口径说明 / 摘要）。只有两档灰时，正文与证据糊在同一层，用户感受到的「不精致」多半就是这个。新加文字前先问它属于哪一档。
- **表面色只三档**：`--paper`（纸）/ `--ctl #fffefb`（控件外表，**不要再用裸 `#fff`**，纯白比纸面更冷更亮，贴上去像另一个应用）/ `--mat #f6f2e7`（给定材料，比纸面明显黄一档，一眼分得出「材料」与「我写的地方」）。`--write` 专给作答区与笔记。
- **段落之间要拉开（28–32），组内保持 6–12**：`.sec-title` 28 / `.grade` 32 / `.notebox` 20 / `.ogroup` 14 / `.nextrow` 28 / `.field` 22。全屏都是 14–20 时，眼睛分不出「哪里换了一段」，一屏就是一长条。
- **批改页采分点行是三列（要点 | 证据 | 分值）**：`.hitline .ev{order:2;flex:0 0 32%}` + `.hitline .sc{order:3;flex:0 0 52px}`。**用 `order` 只改视觉顺序，DOM 顺序不动**——所以 `hitline miss` 那些字符串断言不受影响（用真删真换就得同步改断言）。
- **纸内的红要数得出来**：`.grade` 顶线已退中性 1px（红只从 26px 分数开始）、`.ghead` 自带底线成页眉；顶栏的实心红只留主行动，科目选中是红描边胶囊。动颜色前先数一眼这屏有几处红。
- **材料区的「已点选」是暖沙（`#e9e1cc` + `inset #cdbe97`），不是淡蓝**：淡蓝 + 蓝下划线是整屏唯一的冷色，看着像超链接。
- **输入框里的技术串（接口地址 / API Key / 模型名）用雅黑不用仿宋**：仿宋里 l / 1 / I 长得一样。下拉候选框用 `--sh-2`（下拉浮标那一档），否则纸色底盖纸色纸背，看不出浮在上面。
- 文案写宽泛、贴用户视角，**别写死实现**：说「本地」，不说「这台电脑/本机浏览器/localStorage」这类以后实现一变就要跟着改的词（阿楠 2026-09-18 明确要求）。

## 端口与存储（桌面壳）

- 本地 http 源**必须使用固定端口**（`main.js` 里的 `PREFERRED_PORT`）。`localStorage` 按 origin（含端口）分区，随机端口会让用户的设置、记录、草稿、划线在每次重启后「消失」。改端口策略等于改所有用户的存储位置，属破坏性变更。
- 端口退让必须写 `port-fallback-warning` 日志——让「数据看起来没了」这件事可诊断。
- 启动路径对声明顺序敏感：`load()` 依赖的 helper（如 `HISTORY_KEY` 这类 const）必须定义在首次调用点之前，否则 TDZ 报错会被兜底 try/catch 静默吞掉，表现为「历史读不回来」。
- 强杀进程会丢失最近的异步落盘写入；涉及「答案不可再生」的改动要考虑落盘时机。

## 状态与兼容

- `gw_state` 保存设置、画像、学习卡、笔记和模型缓存；练习历史在独立的 `gw_history`（写满裁最旧，不得并回 `gw_state`）。
- `gw_draft` 保存未提交草稿；`gw_marks` 保存按题目签名的材料划线。
- 修改状态结构时，保留旧数据的默认合并和迁移；导入数据不能未经校验直接当成可信记录。
- 题目、草稿和划线通过题目签名关联，不能使用全局单槽覆盖当前题之外的数据。

## 修改后验证

在项目根目录：

```powershell
node tests/run.mjs
```

必须看到 `N/N passed` 且退出码为 0。改动涉及窗口、启动或加载方式时，还要真跑一次 `npm start`，确认 `logs/startup.log` 里有 `did-finish-load`、没有 `did-fail-load`；涉及浏览器交互、异步请求、设置弹层、导入导出或本地存储时，用真实路径走一遍并检查控制台错误。

要临时量一段真行为（看某个函数的实际输出、核一个口径、比对打包产物），**写成探针文件再跑**：

```bash
node tools/probe.mjs 我的探针.js
```

`tools/probe.mjs` 会把 `app/index.html` 里的脚本抠出来、配最小 DOM 桩子跑，探针里可以直接用应用的全部函数与常量（`MODULES` / `moduleAvg` / `gen` / `pickSubtypeFor` …），也支持顶层 await。探针是一次性的，用完删掉，别往 `tests/` 里塞。

**要量真实布局（位置、留白、有没有出纸），用取景器**：

```bash
node tools/shot.mjs <场景文件.mjs> <输出目录> [--plain]     # 例：node tools/shot.mjs tools/scenes-ui.mjs _shots/ui
```

起临时静态服务 + Electron 真渲染，**每个场景拍两张**：原始态 + 折叠块全展开态（`--plain` 只拍原始态）。折叠起来的内容（学习卡内部、批改明细、提纲）`offsetHeight` 为 0——不展开就等于没进保护范围，所以不为它另写一套场景。

每屏跑完还自动过一遍客观规则（`shot-app.cjs` 的 `AUDIT_JS`）：横向溢出 / 字形出纸 / 字号出档 / 可点热区不足 24px / 折叠件缺三角 / 页面报错。收尾把结论打在终端上，**退出码 2 = 有 FAIL**；全过就是一句「不用点开图」。**规则宁少勿滥**：只放用不着审美判断的客观项，误报一次以后就没人信它的结论了。

**别用 `node -e` 写带 JSON 片段的探针**：参数里只要同时出现「冒号」和「反斜杠」，Git Bash 就会把这段当路径列表改写（`\"` 变成 `/"`、`\\` 变成 `//`）。轻则语法错误，重则搜索串被悄悄改掉、程序照跑并返回 `false`，看起来像"功能没生效"或"没打包进去"，能白排查半天。实测 `MSYS_NO_PATHCONV=1` 与 `MSYS2_ARG_CONV_EXCL='*'` 在本机**都治不住**，别指望环境变量，老老实实写成文件。

## 编辑纪律

- 先读周边代码和现有测试，再做最小范围修改。
- `MODULES` / `GONGWEN_TYPES` / `PD_FORMS` 一改，必须同步 `题型规范.md`。那张表被代码注释与本文档当作「数值依据」引用，却曾经整体落后于代码（申论半张表四个模块的子类型与维度数全不符），是含金量最高的一处文档债。
- 打包走 `npm run dist`：它先跑 `tools/stamp-build.mjs` 生成 `app/build.json`（应用设置面板底部会显示这个构建时间，用来确认装的是不是新版），再调 electron-builder。**不要用文本工具改 `打包.bat`**：它是 GBK 编码（配 `chcp 936`），会被写坏；要给打包加步骤就改 `package.json` 的 `scripts.dist`。
- **只出 NSIS 一种包**：`package.json` 的 `build.win.target` 只有 `nsis`，`scripts.dist` / `release.mjs` 也只带 `--win nsis`。免安装版（portable）不发了 —— 它每次更新只会「装出一个新副本」，得单独禁用，属于多一份心。
- electron-builder 要下的组件（electron / winCodeSign / nsis）默认从 github.com 拉，本机到那里时通时断（实测 `connect ETIMEDOUT 20.205.243.166:443`，卡在 packaging 之后那一步就是缺 winCodeSign）。**`tools/release.mjs` 与 `打包.bat` 都设了组件下载源兜底（npmmirror，外部已设则不覆盖）**。发布失败时若 Release 已经被建出来（空壳、没资产），**先 `gh release delete vX.Y.Z --yes --cleanup-tag` 再重出** —— 否则客户端会看到一个「有新版但没有资产」的坑。
- electron-builder 偶发在 `downloaded label=electron progress=100%` 之后长时间不动（extraction 已完成但零写入，实测停 13 分钟）。确认卡死后结束进程、删掉 `dist/win-unpacked.tmp` 与 `.tmp.lock` 再重跑，通常 2–3 分钟就过。**打包中途失败不会破坏 `dist/` 里上一版的安装包**（builder 写的是新目录，最后才替换），所以用户手上那一版始终可用。
- 不提交 API Key、真实个人资料或真实练习备份；`node_modules/`、`dist/`、`logs/` 不进 Git。
- 提交说明（commit message）只写描述性内容：改了什么、为什么、怎么验证的。**不引用对话、不写「阿楠说/用户说」这类原话**——提交历史是公开的，聊天腔一看就是 AI 代笔（阿楠 2026-09-18 明确要求）。
- 不把一次性开发流水账写进本文件；稳定的使用方式和边界写在 `README.md`，历史通过 Git 记录。
- 不删除用户未授权的文件或数据；临时调试产物结束前清理。
