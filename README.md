# 备考练习台（桌面版）

AI 原生综应 A 练习工具，打包成可双击运行的 Windows 桌面应用。覆盖公文写作、归纳概括、综合分析、提出对策和案例实务五类训练，提供学习卡、作答、AI 阅卷、采分点对照、画像和自适应推送。

三个入口：综应 A（学习卡 → 作答 → 批改）、申论（读材料含找点 → 归类 → 一稿 → 批改 → 沉淀）、快判（逐题点选即判，练信息取舍与表达规范的眼力）。快判一轮 5 题，「综合快判」把事实选择 / 分组概括 / 表达比较三种形式混着出（不给提示，更像真考），也可以单练某一类；它只记正确率，不计入综应A/申论的维度画像。

## 下载与安装（Windows 10/11 x64）

从 [Releases](https://github.com/lllvernan-blip/liantai-desktop/releases) 下最新一版的安装包 `liantai-desktop-setup-x.y.z.exe`，双击装上：

| 形态 | 自动更新 |
| --- | --- |
| **NSIS 安装版**（只发这一种） | ✅ 启动后后台检查，只下载变化的部分（差量），下完点「重启并更新」；不点也行，下次打开就是新版 |

> **更新不会动你的数据。** 练习记录、画像、草稿、划线、API Key 都在 `%APPDATA%\liantai-desktop` 的用户数据目录里，更新只替换安装目录里的程序文件——不是「删了重装」，所以没有任何东西需要重新填、重新下载。

应用本身不含 API Key：首次运行要在「设置」里填自己的 Key（推荐 DeepSeek，OpenAI 兼容接口均可）。

## 结构

| 路径 | 作用 |
| --- | --- |
| `main.js` | Electron 主进程：窗口、单实例锁、把 `app/` 挂到 `127.0.0.1` 的本地 http 源、启动日志 |
| `update.js` | 自动更新（electron-updater）：检查 / 差量下载 / 重启安装 / 状态机；免安装版与开发版自动置为禁用 |
| `app/index.html` | **应用本体**（单文件 HTML + CSS + JS，零依赖）；业务代码改这里 |
| `tests/` | 零依赖自检：从 `app/index.html` 抽取唯一 `<script>`，配合 DOM 桩在 Node 里跑 |
| `题型规范.md` | 各模块子类型与评分维度的数值依据（改 `MODULES` / `GONGWEN_TYPES` / `PD_FORMS` 必须同步它） |
| `打包.bat` | 双击自助出包：跑 `npm run dist`，完成后自动打开 `dist/`（GBK 编码，勿用普通文本工具改） |
| `tools/` | 打包辅助：`stamp-build.mjs` 写 `app/build.json`（版本 + 构建时间）；`release.mjs` 一键发布到 GitHub Release；`probe.mjs` 跑一次性探针 |
| `logs/startup.log` | 启动日志（已 gitignore）。窗口没出来、数据看着像丢了，先看它 |
| `node_modules/` | 只有 electron（已 gitignore），开发与打包时才需要 |

## 运行

```powershell
npm install     # 首次：只装 electron（本机已有二进制缓存，命中后很快）
npm start       # 开发运行：起本地 http 源 + 独立窗口
```

打包成成品（`dist/` 里出 **NSIS 安装版**；打包前先关掉正在运行的应用）：

```powershell
npm run dist
```

或者直接双击 `打包.bat`。打包器要从网上拉组件，`打包.bat` 已内置国内镜像源（直连 GitHub 常 TLS 断连）；手动跑 `npm run dist` 遇到下载失败，先设 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 为 npmmirror 再试。

发布新版本（先改 `package.json` 里的 `version`，再一键传上 GitHub Release）：

```powershell
npm run release
```

首次运行要在应用内「设置」里填一次 API Key —— 桌面应用的存储与浏览器那份是分开的，不会自动继承。

## 自动更新（安装版）

- **源**：GitHub Release。配置在 `package.json` 的 `build.publish`，打包时生成包内 `app-update.yml`；换源不必改代码，设环境变量 `LIANTAI_UPDATE_FEED` 指向任意 generic 源（目录里放 `latest.yml` + 安装包 + `.blockmap`）即可，本地验证与镜像切换都走它。
- **差量**：NSIS 目标会一并出 `latest.yml` 与 `.blockmap`，更新时只下载与上一版**不同的数据块**（80MB 的包通常只需几 MB）。两个前提：缓存里有上一版安装包（手工装的第一版没有，首次会退化成全量，之后就常态走差量）、且**源上旧版的 `.blockmap` 别删**；不满足只会退成全量，不会出错。
- **不做免安装版**：只发 NSIS 安装版。免安装版对 quitAndInstall 只会「装出一个新副本」，得单独禁用它（代码里那道防线还留着，免得哪天又有人拿 portable 包去跑）。
- **失败不阻断**：任何更新错误只写日志与设置页一行提示，30 分钟后自动重试；排查看 `logs/startup.log` 里的 `update-*` 行。
- **连不上 GitHub 也能更新**：主源是 GitHub 官方，直连不通时自动换备选线路继续，差量照旧，不用手动做什么；想指定自己的源就设 `LIANTAI_UPDATE_FEED`，设了就不再兜底。

## 自检

```powershell
node tests/run.mjs
```

看到 `N/N passed` 且退出码为 0 才算过。自检不依赖 Electron，也不需要浏览器。

## AI 行为

- 模型候选一律从接口实拉，点模型输入框展开自绘菜单全量列出（原生下拉会按已填文字过滤，不可信），点谁填谁。
- 推理程度随模型自适应：默认按思考强度实测试探，被拒自动记住并改按标准方式发送（顶栏会提示）；两档各用过几次后，设置页会给出「切换是否有效」的实测结论（比较思考量与耗时）。
- 综应A 先看学习卡再亮题：卡阶段不显示题目，点「开始作答」后题面与材料才出现；学习卡附「这类题长什么样」的全新示例（不含本题情节）。

## 数据与端口（重要）

- 窗口通过 `http://127.0.0.1:18743` 加载。**端口固定是刻意的，不是随手写的**：`localStorage` 按 origin（含端口）分区，端口一变就是另一套存储空间，用户的设置、练习记录、草稿、划线会「凭空消失」（数据还在磁盘上，只是换了 key 空间）。
- 端口被占用时依次退让到邻近端口，并在 `logs/startup.log` 里写 `port-fallback-warning`。**看到这条告警，就意味着这次启动读不到旧数据。**
- 存储键：`gw_state`（设置 / 画像 / 学习卡 / 笔记）、`gw_history`（练习记录，写满裁最旧）、`gw_draft`（草稿，最多 8 份）、`gw_marks`（划线，最多 8 份）。
- 应用数据目录：`%APPDATA%\liantai-desktop`（打包版与开发版共用同一目录，Key 和记录只填一次）。Chromium 的存储是异步落盘的，**强杀进程（任务管理器、`Stop-Process -Force`）可能丢掉最近几次写入**；正常关窗口不受影响。
- 导出 / 导入：备份 JSON **不含 API Key**（所以备份可以放心分享、传网盘）；导入时文件里的 Key 也不会被采用，本机已填的 Key 保持不变——换机迁移要在新机器上重填一次 Key。

## 维护提示

业务代码仍是零依赖、无构建的单文件应用：不要为了桌面壳往 `app/index.html` 里塞第三方库或构建步骤。

总分口径：题目满分取自 `question.score`，采分点是带分值的子项（子项分值之和 = 题目满分），阅卷按覆盖程度落三档给分；总分 = 各子项实得分之和，另折合百分制存为 `grade.total` 供画像跨题比较。维度分只做诊断，不参与总分。若阅卷列出的子项合计与题目满分不一致，界面会明示，并只按已列出的子项计分。

改状态字段时要考虑旧 `localStorage` 与导入备份的默认值合并与迁移，不要直接删除已有键。涉及用户答案、草稿、历史、划线、AI 请求和调度的改动，必须补断言并跑全量自检。
