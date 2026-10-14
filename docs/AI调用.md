# AI 调用（细节）

本文件承接 `AGENTS.md`「模型与档位」「学习闭环」两节里的机制：常量值、函数名、字段名、当前实现方式。**判断与禁令在 `AGENTS.md`**，改代码时两处对着看。

## 模型候选

- 唯一出口是自绘下拉 `#modelMenu`。原生 `datalist` 会按已填文字过滤，外挂 chips 同样不用，两条路都别恢复。

## 模型能力

- **不按名字猜**：`THINK_FAMILIES` 只收参数发法特殊的家族（qwen3 / glm），其余默认按 `reasoning_effort` 实测试探。
- `modelCaps`（被拒自动降级 + 顶栏 banner）与 `modelProbe`（思考字数 / 耗时）是持久状态，`load` / `importJSON` 要带着它们走，别绕过另建能力判定。

## 输出坏了怎么办

- 最多重发两次（`BODY_RETRY_MAX = 2`），两种坏法：① `content` 为空；② `content` 在但 `parseJsonLoose` 解不出。
- 两种坏法**只要 `finish=length` 就原地把额度翻倍重发**。
- 重发还坏才抛：空输出 `{code:"EMPTY"}`、坏 JSON `{code:"JSON"}`，`handleErr` 各按各的说法提示，不许静默吞。坏输出走 `llmFailNote()` 记控制台。
- `sseFinish()` 是拿 `finish_reason` 用的，别当无用解析删。

## 输出额度

- 首次 `MAX_OUT_TOKENS = 16384`，`finish=length` 就翻倍（→32768→65536，封顶 `MAX_OUT_TOKENS_HARD`）。思考与正文共用一个额度。
- 阅卷思考档单独降 `GRADE_LEVEL = "quick"`。

## 范文

- `fetchModelAnswer()` 在批改成功后另发一次，**要纯文本不要 JSON**。
- 那次失败只当没写过（catch 掉、留空，`renderGrade` 不渲染空范文）。

## 超时

- 非流式：`fetchWithTimeout()` 连 body 一起读完再返回（`{res, text, json}`）。只把 `fetch` 包进计时器挡不住「回了头却停住 body」，那一路会永久挂住。
- 流式：`CONNECT_TIMEOUT` 只算到首字节；到了就交给 `IDLE_TIMEOUT`——连续 60 秒没字节才算吊死。别让它变成一条「整个流 60 秒」的隐形硬上限。

## 传输层失败

- 自动同档静默重发一次（`retriedNet`）：DNS / TLS / 连接断 / 整体超时。
- HTTP 错误照旧走降级阶梯（只 400/422 换档），**绝不重发**。
- 一次请求最坏 4 次调用（传输 1 + 输出 2 + 降级 1）。

## 阅卷

- 温度 `GRADE_TEMP = 0`。
- 三档判法写在 `SCORING_RULES`：**数点不估百分比**，判「半分」必须在 evidence 里写出考生答到了什么。
- 评分校准句（多数答卷落中间档 / 拿不准按中间档 / 答得长不等于答得全）属批改质量，删它等于打开宽松抬分与长度偏好两扇门。
- **别往 prompt 里写「分差控制在 ±3」这种数字承诺。**

## 采分点

- 判分要数的点出题时就写死：`keyPoints[].need`，3-6 条。
- 一条只写一个可核对的事实、不许塞并列要件；`GEN_POINT_RULES` 有反例。
- 阅卷只做一件事：照 `need` 逐条独立核（不许并起来判、不许顺带算）。
- 旧记录没带 `need` 就退回按子项文字拆点。

## 回执与计分

- 批改 prompt 要求逐条回报 `experienceChecks`（title 原样照抄 + `again/fixed/na`）。
- `experienceChecks` 与 `kind` **都不参与计分**（与 hits/scores 分开）；`awarded` 与总分口径一字不动。

## 报分

- `need` 原子化后残差约 ±1~1.5/20（折百 ±5~7.5），样本少时「极差 0」是运气。
- 报数连样本数一起报；对用户报数字前先量三次，并把 evidence 抄出来看（分辨「稳定地对」与「稳定地偏严」）。

## 错因标签

- `GRADE_TAGS` 六类：漏点 / 跑偏 / 结构 / 格式 / 表达 / 材料。
- `gradeTagOf` 只认闭集里的一类（认不出的当没给）；快判的 trap 故意相反（认不出就原样留着），两套标签分开维护。
- 标签的出口是出题：`gradeTagStats(k)`（最近 `GRADE_TAG_WINDOW = 20` 条有采分点的记录，按模块分开）→ `weakGradeTags(k, 3)` → `gen()` 请求体的 `weakTags`。画像「常错类型」与出题「重点考这几类」必须同一份数据。

## 快判辨析点

- `pdTrapStats`（看最近 `PD_TRAP_WINDOW = 20` 题）→ `pdWeakTraps`（错过就排进来，错得多、出得多的靠前）→ `genPDRound` 请求体的 `weakTraps`（改请求体别丢这份名单）。
- 辨析点文本先用 `pdTrapKind` 按关键词归到标准类再统计。

## 出题 prompt 里的事

- `matSpec` 是材料规格那段 prompt；快判禁令在 `sysPD()`。两处都写了地名与机关的虚化口径。
- 主观题与快判**两条 prompt 的地名口径必须同改**，只改一条等于没改。
