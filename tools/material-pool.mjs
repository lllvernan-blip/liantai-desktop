/*
 * 材料池 —— 抓一手材料、提炼成事实骨架、落盘。
 *
 *   node tools/material-pool.mjs fetch gov 养老服务 3   政策文件库（按关键词搜）
 *   node tools/material-pool.mjs fetch rmw 10          人民网各频道（按栏目拿最新）
 *   node tools/material-pool.mjs fetch rmrb 10          人民日报电子版（按版面拿最新）
 *   node tools/material-pool.mjs list                    看池子里有什么
 *   node tools/material-pool.mjs verify [条数]           抽几条回原文核（默认 15，规范第七节的验收线）
 *   node tools/material-pool.mjs redo [篇数|all]          用当前 prompt 重提炼池子里已有的文章
 *
 * 规矩全在 docs/材料规范.md（第五节「提炼」、第八节「时效」）：这里只实现，不另立口径。
 * 与 drift.mjs 同一套路子：把 app/index.html 的脚本抠出来配 DOM 桩跑，所以提炼走的是应用里真实的
 * callLLM（降级阶梯、空输出重发、撞额度翻倍都在），不是另写一份请求。
 *
 * 环境变量：
 *   LIANTAI_KEY      不设也能跑——从本机应用数据目录里取已存的 Key（只读，不写仓库、不打印）。
 *   LIANTAI_MODEL    默认 deepseek-flash。
 *   LIANTAI_MAT_DIR  材料池目录，默认 ~/练习台材料。
 *
 * 边界：真接口、真花钱（一篇一次提炼调用）。抓下来的原文不落盘，只落骨架。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir, homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const phase = (process.argv[2] || "").trim();
const DIR = process.env.LIANTAI_MAT_DIR || join(homedir(), "练习台材料");
const poolDir = join(DIR, "池子");
const rawDir = join(DIR, "原文");     // 只在 fetch 过程中临时用，跑完不留（规范：只存骨架，不存原文）

if (phase !== "fetch" && phase !== "list" && phase !== "verify" && phase !== "redo") {
  console.error("用法：node tools/material-pool.mjs fetch <gov|rmw|rmrb> [检索词] [篇数] | list | verify [条数] | redo [篇数|all]");
  process.exit(1);
}

function keysFromLocal(){
  const out = [];
  const base = process.env.HOME ? join(homedir(), "Library", "Application Support") : "";
  if (base && existsSync(base)) {
    for (const app of ["liantai-desktop-test", "liantai-desktop"]) {
      const dir = join(base, app, "Local Storage", "leveldb");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".ldb") && !f.endsWith(".log")) continue;
        const m = readFileSync(join(dir, f)).toString("utf16le").match(/sk-[A-Za-z0-9]{20,}/);
        if (m && !out.includes(m[0])) out.push(m[0]);
      }
    }
  }
  return out;
}
async function pickKey(){
  const explicit = process.env.LIANTAI_KEY || "";
  if (explicit) return explicit;
  for (const k of keysFromLocal()) {
    try {
      const r = await fetch("https://api.deepseek.com/v1/models", { headers: { Authorization: "Bearer " + k } });
      if (r.ok) { console.error("用本机已存的 Key（尾号 " + k.slice(-4) + "）"); return k; }
    } catch (e) { /* 换下一个 */ }
  }
  console.error("没找到能用的 Key：在环境变量里设 LIANTAI_KEY。");
  process.exit(1);
}

/* 抓哪、怎么抓，分两种源。它们的“怎么找一篇”完全不同，所以各写各的：
   - policy：有检索接口，按关键词搜（关键词就是主题）。
   - news：没有可用的检索接口，按**栏目**拿最新的（标题里不一定含关键词，搜也搜不出）。
   两边共用的是同一套提炼与落盘，以及同一条出题规矩（docs/材料规范.md）。 */
const SOURCES = {
  gov: {
    name: "中国政府网·政策文件库", kind: "policy",
    // 子库名写错会静默返回空（见 docs/材料规范.md 第三节），所以拿到结果必须断言条数。
    subs: ["zhengcelibrary_gw", "zhengcelibrary_bm", "zhengcelibrary_gb"],
    async list(q, n){
      const items = [];
      for (const t of this.subs) {
        const url = "https://sousuo.www.gov.cn/search-gov/data?t=" + t
          + "&q=" + encodeURIComponent(q) + "&searchfield=title&n=" + n + "&p=1";
        let j;
        try { j = await get(url, true); } catch (e) { console.error("  子库 " + t + " 抓取失败：" + e.message); continue; }
        const list = (j && j.searchVO && j.searchVO.listVO) || [];
        // 不带 searchfield 时接口返回全量、看着有数据其实没筛；这里核对标题里真的含检索词
        for (const it of list) {
          const title = String(it.title || "").replace(/<[^>]+>/g, "");
          if (title.indexOf(q) < 0) continue;
          items.push({ title, url: it.url, wenhao: (it.pcode || it.wenhao || "").trim(),
            pub: (it.pubtimeStr || "").trim(), id: it.id });
        }
      }
      if (!items.length) throw new Error("三个子库都没拿到含「" + q + "」的条目——子库名或检索词要复核");
      return items;
    },
  },
  rmw: {
    name: "人民网（多频道）", kind: "news",
    /* 只取正文文章链接。列表页里混着图片新闻、专题页、外链，靠 URL 形态筛：人民网正文是
       /n1/年/月/日/cNNNN-数字.html —— 注意是 .html，而政府网是 .htm，两边正好相反，别拼错。
       图片新闻（“河南睢县：采摘菊花 供应市场”这类）标题里看得出，留给提炼那一步的入库判断去拦。 */
    /* 2026-10-15 实测：只抓社会法治一栏，一页只能出 7 篇（剩余全是图片新闻与案件警示），
       而且主题全挤在基层治理与法治上，第三步「选题跟着弱项走」没得选。换成多个频道首页：
       实测 社会 15 / 财经 18 / 教育 17 / 健康 16 / 生态 2 / 文化 1，共 65 条去重正文链接。
       时政、法治、IT 三个频道是 GBK 且解析不出正文链接，不列（解码另说：任何一条链接都可能是 GBK，
       所以 `get()` 自己读字节自己解码，不依赖这里列的编码）。 */
    listUrls: [
      "http://society.people.com.cn/",
      "http://finance.people.com.cn/",
      "http://edu.people.com.cn/",
      "http://health.people.com.cn/",
      "http://env.people.com.cn/",
      "http://culture.people.com.cn/",
      "http://society.people.com.cn/GB/428181/index.html",   // 人民直击：一页九条，全是深度调查
    ],
    artRe: /^https?:\/\/[a-z]+\.people\.com\.cn\/n\d\/\d{4}\/\d{4}\/c\d+-\d+\.html$/,
    async list(){
      const seen = new Set(), items = [];
      for (const page of this.listUrls) {
        let h = "";
        try { h = await get(page, false); }
        catch (e) { console.error("  列表页失败 " + page + "：" + e.message); continue; }
        for (const m of h.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{6,80}?)<\/a>/g)) {
          const url = String(m[1] || "").trim();
          const title = String(m[2] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          if (title.length < 10 || !this.artRe.test(url) || seen.has(url)) continue;
          seen.add(url);
          // 人民网的列表页不给日期，但正文地址里带着（/n1/2026/1008/…），取出来拼成 2026-10-08
          items.push({ title, url, wenhao: "", pub: (url.match(/\/(\d{4})\/(\d{2})(\d{2})\//) || [,"",""]).slice(1).join("-"), id: (url.match(/(\d+)\.html$/) || [,""])[1] });
        }
      }
      if (!items.length) throw new Error("列表页没解析出正文链接——站点结构可能变了");
      return items;
    },
  },
  rmrb: {
    name: "人民日报电子版", kind: "news",
    /* 版面页每天二十个版、每版 4—10 篇，重 UTF-8，地址完全可拼。只取问题导向的版：
       各地传真(10) / 社会(14) / 政治(11) / 民主政治(18) / 法治(19) / 文化(13) / 经济(07) / 要闻(01-04,06)。
       不要的：评论(05) 是观点不是材料，理论(09) 同理，视觉(08)、广告(12,16)、体育(15)、
       国际(17)、副刊(20)。版面号会随日期变，但半年内实测稳定，取不到就是空、不报错。 */
    nodes: ["14","10","11","18","19","13","07","01","02","03","04","06"],
    backDays: 3,
    async list(){
      const seen = new Set(), items = [];
      for (let k = 0; k < this.backDays; k++) {
        const t = new Date(Date.now() - k * 86400000);
        const y = t.getFullYear(), mo = String(t.getMonth()+1).padStart(2,"0"), d = String(t.getDate()).padStart(2,"0");
        const pub = y + "-" + mo + "-" + d;
        for (const n of this.nodes) {
          const lu = "http://paper.people.com.cn/rmrb/pc/layout/" + y + mo + "/" + d + "/node_" + n + ".html";
          let h = "";
          try { h = await get(lu, false); } catch (e) { continue; }   // 那天没出版、版号不存在，就当空
          for (const m of h.matchAll(/<a[^>]+href="([^"]*content_\d+\.html)"[^>]*>([\s\S]{2,90}?)<\/a>/g)) {
            const title = String(m[2] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
            if (title.length < 10 || /^本版责编/.test(title)) continue;   // 版面页尾部有“本版责编：…”
            let url; try { url = new URL(m[1], lu).href; } catch (e) { continue; }
            if (seen.has(url)) continue;
            seen.add(url);
            items.push({ title, url, wenhao: "", pub, id: (url.match(/content_(\d+)/) || [,""])[1] });
          }
        }
      }
      if (!items.length) throw new Error("版面页一篇也没解析出来——地址拼接或结构变了");
      return items;
    },
  },
};
const SUBS = SOURCES.gov.subs;

/* ---------- list：不连网，只看盘上有什么 ---------- */
if (phase === "list") {
  if (!existsSync(poolDir)) { console.log("池子是空的（" + poolDir + " 不存在）。"); process.exit(0); }
  const files = readdirSync(poolDir).filter(f => f.endsWith(".md")).sort();
  let total = 0;
  console.log("池子：" + poolDir + "（" + files.length + " 篇）\n");
  for (const f of files) {
    const s = readFileSync(join(poolDir, f), "utf8");
    const n = (s.match(/^\s*[-•]\s|^\s*\d+\.\s/gm) || []).length;
    total += n;
    const title = (s.match(/^# (.+)$/m) || [, f])[1];
    const pub = (s.match(/^发布：(.+)$/m) || [, ""])[1];
    const cur = (s.match(/^时效：(.+)$/m) || [, ""])[1];
    const topic = (s.match(/^主题：(.+)$/m) || [, ""])[1];
    console.log("  " + title.slice(0, 38).padEnd(40) + String(n).padStart(3) + " 条  " + pub.padEnd(11) + topic.slice(0, 14));
  }
  console.log("\n合计 " + total + " 条事实骨架。");
  process.exit(0);
}

/* ---------- fetch：抓 → 提炼 → 落盘 ---------- */
const srcId = (process.argv[3] || "").trim();
if (phase === "fetch" && !SOURCES[srcId]) {
  console.error("要一个源：" + Object.keys(SOURCES).join(" | "));
  console.error("  gov   中国政府网·政策文件库（按关键词搜）   node tools/material-pool.mjs fetch gov 养老服务 3");
  console.error("  rmw   人民网（多频道）                    node tools/material-pool.mjs fetch rmw 10");
  console.error("  rmrb  人民日报电子版                      node tools/material-pool.mjs fetch rmrb 10");
  process.exit(1);
}
/* 只有 fetch 用得到这几个：其余两档必须能平安走过这里（verify 的入口在下面，list 在前面已 exit）。 */
const SRC = phase === "fetch" ? SOURCES[srcId] : null;
const isPolicy = !!SRC && SRC.kind === "policy";
const query = isPolicy ? (process.argv[4] || "").trim() : "";
const want = Math.max(1, Number(process.argv[isPolicy ? 5 : 4]) || 1);
if (isPolicy && !query) { console.error("政策库要一个检索词：node tools/material-pool.mjs fetch gov 养老服务 3"); process.exit(1); }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
/* 自己读字节自己解码，不用 `r.text()`：那个只认响应头里的 charset，头里没写就一律按 UTF-8，
   而 GBK 页（人民网时政频道 `gb2312` 就是这样）会静默解成乱码——HTTP 还是 200，看不出错，
   只有提炼出来的骨架满页怪字符才发现。所以先看头部自己声明的 charset，再退回响应头，最后才猜 UTF-8。 */
async function readText(r){
  const buf = Buffer.from(await r.arrayBuffer());
  const head = buf.subarray(0, 2048).toString("latin1");
  const declared = (head.match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1]
    || ((r.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || [])[1] || "";
  const cs = declared.toLowerCase();
  const enc = /gb2312|gbk|gb18030/.test(cs) ? "gb18030" : /big5/.test(cs) ? "big5" : "utf-8";
  return new TextDecoder(enc).decode(buf);
}
async function get(url, asJson){
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  if (asJson) return r.json();
  return readText(r);
}



/* 正文提取：两种源的 DOM 不一样，但共同点是“正文都在 <p> 里，页脚也在 <p> 里”，所以先切范围再收段。 */
const paraText = seg => [...seg.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
  .map(m => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim())
  .filter(s => s.length > 4)
  .join("\n");
function extractBody(html, src){
  if (src === "rmrb") {
    // 人民日报电子版：正文在 id="articleContent" 里，后面紧跟“本版责编：…”，到那里为止
    const i = html.indexOf('id="articleContent"');
    if (i < 0) return "";
    let seg = html.slice(i);
    const e = seg.indexOf("责编");
    if (e > 0) seg = seg.slice(0, e);
    return paraText(seg);
  }
  if (src === "rmw") {
    // 正文之后还有版权行与整段页脚（报社简介、许可证号），它们同样是 <p>，到“人民日报社概况”为止
    const cut = html.indexOf("人民日报社概况");
    return paraText(cut > 0 ? html.slice(0, cut) : html);
  }
  const start = html.indexOf('id="UCAP-CONTENT"');
  if (start < 0) return "";
  let seg = html.slice(start);
  for (const stop of ['class="pagination"', 'class="share-box"', 'id="jiedu-blk"']) {
    const i = seg.indexOf(stop);
    if (i > 0) seg = seg.slice(0, i);
  }
  return paraText(seg);
}

const key = await pickKey();
const model = process.env.LIANTAI_MODEL || "deepseek-flash";
const SKEL_PROMPT = readFileSync(join(here, "..", "tests", "dom-stub.js"), "utf8");
const html = readFileSync(join(here, "..", "app", "index.html"), "utf8");
const openAt = html.indexOf("<script>");
const closeAt = html.lastIndexOf("</script>");
const appSrc = html.slice(openAt + "<script>".length, closeAt);

/* 提炼 prompt —— 逐条照 docs/材料规范.md 第四、五节写。改这里之前先去改那份规范。 */
const REFINE_SYS = [
  "你是材料提炼员。先判这篇材料能不能用，再抽事实骨架。",
  "",
  "第一步·入库判断（这是选题池，不是档案馆，进不了库的抓了也白抓）：",
  "合格的至少占一条——有矛盾（有问题、有争议、有不同做法）、有做法（具体措施与步骤）、有数据（可核的数字，且数字背后是事，不是噱头）、有立场（不同主体态度不一）。",
  "「有做法」这条最容易判错，单独说：",
  "  做法 = 某个主体为了解决问题采取的措施，**而且必须是已经发生的**。反过来，案子怎么发生的、谁骗了谁、现场查到了什么，一律不算做法。",
  "  最容易混进来的是「建议」：“要丰富……”“专家建议……”“应建立……”这类话还没有发生，不是做法，归到「建议 / 主张」那一栏。",
  "  自检：把这条里的主体名换掉，还刺不刺下一个别人能借鉴的办法？换掉就没了，说明它只是事件经过。",
  "  第二道自检：一份材料能不能出「对策题」，就看它有没有可借鉴的做法，或者有没有成形的建议主张。两样都没有，就算有矛盾、有数据，也只能算半篇。",
  "只有表态、只有会议消息、只有风景或活动报道、只有案件或纠纷经过（读者看完只能感慨一句，学不到什么东西）的，判不合格。",
  "还有一类要专门拦，而且它靠“有没有成绩”是拦不住的——成就稿（成绩宣传）。这类稿子通篇报告已经做成的好事，而且往往还带上不少做法，所以表面上“有做法也有成效”，看着合格；但它在报告成绩，不在讲一件还没办妥的事，读者学不到什么。",
  "  判成就稿只看一条：**这篇里有没有一个还没解决的问题？**",
  "  具体怎么判：把它记下来的事实分成「问题/背景」与「结果/成效」两堆。如果结果那一堆明显压过问题那一堆（例如成效十几条、背景只剩一两条），而且通篇找不到一个还没办妥的环节、一处不同意见、一点遗留短板，就是成就稿，不入库。",
  "  第二道自问：这篇里有没有「谁正在为某件事发愁」？没有就是成就稿。",
  "  别误伤：一篇材料成效很多不要紧，只要它同时还写着一个没解决的问题（成效背后还有短板、还有争议、还可能反弹），就算合格。拦的是「只有结果没有问题」。",
  "还要够撑起两道不同题型的题：一篇通篇只有成效的只能出概括题，也不合格。",
  "把结论写进 usable（true/false）与 why（一句话说结论怎么来的）。不合格就不要抽骨架了，各栏给空数组。",
  "",
  "第二步·抽骨架，硬规矩（逐条照做，不许变通）：",
  "1. 一条只写一个事实。一条里塞了并列要件，后面就没法核。",
  "2. 保留带钱、带比例、带时间的数字——这些是材料密度的来源，也是唯一能核的东西。",
  "3. 允许啰嗦，不许归纳。「多地推行多种举措」这种句子等于什么都没写。",
  "4. 底线是能出题：评价、意义、表态、套话一律不要，那些出不了题。",
  "5. 「难点」这一栏宁缺勿造。凑不出真实难点，就只写一句「原文未提及」——不许拿上一栏的做法和要求充数。",
  "6. 只从正文抽事实。发布日期、文号、栏目名属于元数据，不是材料事实，不许写进任何条目。",
  "7. 五栏各归各位，不许串：背景只放「事情为什么会成问题」——放行动过程与现场细节就是串栏；做法只放「已经发生的、为了解决问题采取的措施」——放当事人之间发生了什么、放还没发生的建议都是串栏；成效只放「这么做之后出现了什么可核的结果」——把做法换个说法重抄一遍不算成效；难点只放「为什么这事不好办」——放已经解决了的旧问题就是串栏；建议只放「还没做、被提出来的主张」——已经做了的归做法。",
  "8. 一条事实只准出现在一栏。同一件事在「做法」和「成效」里各写一遍，是这份骨架最严重的错：后面出题会把它当成两个采分点，一份答卷答了一条就被算成答了两条。看法：两栏里有没有逐字相同的句子？有就是错了。",
  "9. 五栏都可以是空的，空着不扣分，凑数才扣分。新闻里大量材料根本没有「可核的成效」（整治还在进行中）和「真实的难点」（只是读者看得出难，原文并未写出）。这种情况下宁可从缺。「原文未提及」是正确答案，不是失败。",
  "10. 交骨架之前逐栏自检一遍，把不该在这一栏的删掉——归不进四栏的事实，宁可丢掉也不要塞进某一栏。最常见的凑数长什么样：",
  "  「背景」里放行动过程与现场细节（“记者跟随执法”“执法人员抵达时大门紧锁”）——这不是为什么事情会成为问题。",
  "  「做法」里放当事人之间的往来（谁引诱谁、谁翻脸、谁逼谁签条）——措施必须是某个主体为了解决问题主动做的。",
  "  「做法」里放建议（“要丰富……”“应当……”“专家建议……”“下一步应……”）——这些还没发生，归「建议 / 主张」。实测这个错会让出的对策题废掉：整篇建议都抄在材料里，答案现成躺着，考生抄一遍就得分。",
  "  「成效」里放执法发现与原文事实（“查获 POS 机”“无法出示执业证明”“营业执照注册于 7 月 16 日”“签过承诺书”）——发现不等于收效，整治还在进行中的材料本来就可能一条成效都没有。",
  "  「难点」里放调查见闻（“地接人员先问是否本地人”“凭参观证进场”“有人望风”）——那是怎么查出来的，不是难在哪里。难在哪里得是概括性的机制障碍（监管盲区、利益捆绑、违法成本低）。",
  "11. 限定语照原文写，一个字都不许抹。这一条是三次抽样回链里所有错的总源头，所以写细：",
  "  先说清为什么重要：后面出题时，这些条目会变成采分点。限定语一改，标准答案就错了，**答对的人反而被扣分**。",
  "  （一）主体不许上移一层：原文写“王雪认为”，不许写成“有观点认为”；原文写“相关工作人员说”，不许写成“工作室宣称”；原文里是小标题的话，不许归给某个人。",
  "  （二）语气与程度不许拉高：原文写“还可积极参与”，不许写成“积极参与”；建议、拟、争取、有望这类词不能换成已做到。",
  "    这一条最阴，连着两回抽检都只载在它上。实测反例：“在很多人的印象里”被写成“很多人认为”，“（陈女士）很纳闷”被写成“质疑”。这类词看着像同义替换，但对考生不是：出题时它会变成一个采分点，而采分点说的是另一件事。拿不准就照抄原词。",
  "  （三）时间与范围不许丢：原文写“今年以来共查改 125 个”，不许写成“共查改 125 个”。",
  "  （四）不同主体、不同地区、不同案件的事不许并成一条：甲地套取 9 万元与乙地的另一案，不能合成“套取资金”一条。并在一起就核不了了。",
  "  注意方向：本条管的是**向强改**（说得比原文满、比原文确定）。反过来，并列的事拆成几条、一条只取并列原因中的一个，都是对的（第 1 条那条规矩）。",
  "",
  "返回 JSON，字段：usable（布尔）、why（一句话）、topics（这篇适合作哪些主题，从下面这几个里选，可多选：基层治理/乡村振兴/政务服务/生态环保/科技创新/就业服务/养老托育/文化传承/城市更新/应急管理/民生保障/数字经济/法治建设/作风建设）、background（背景）、measures（做法）、effects（成效）、difficulties（争议/难点）、proposals（建议/主张）。",
  "除 usable 与 why 外每个字段是字符串数组，一项一条；某一栏原文没有就返回空数组（difficulties 除外，它要写「原文未提及」）。",
].join("\n");

/* ---------- verify：把池子里的条目抽几条回原文核（规范第七节·可核验性） ----------
   为什么要有这个命令：骨架是模型抽的，模型的错只有向外核才知道。第七节定的验收线是
   「随机抽 15 条回原文核，错的 ≤1 条」。改一次提炼 prompt 就要重跑一次，所以做成命令。
   判三种，只有 supported 算过：
     supported —— 原文有明确依据；
     partial   —— 原文写了，但条目把话说满了、或把两件事并成一件、或改了数字与限定语；
     absent    —— 原文里根本没有。
   最后只打印命中率，不自动改池子：错了是人的事，不是脚本悄悄擦掉就算完。 */
const VERIFY_SYS = [
  "你在核对一份材料骨架有没有编造。下面给你一篇文章的正文，以及从它抽出来的若干条事实。逐条判断。",
  "每条只给三种判决：",
  "  supported —— 原文有明确依据。附原文原句（照抄，不许改写、不许拼接）。",
  "  partial —— 原文写了这件事，但条目把话说满了、把两件事并成一件、或改了数字/时间/主体/范围。要说清改了哪里。",
  "  absent —— 原文里找不到这件事。",
  "规矩（按这个开火，别替条目辩护）：",
  "1. 判 partial 只看一件事：**条目有没有比原文说得更满**（把话说满、把两件事并成一件事、去掉限定语）。只有“向强”的改动算错。",
  "2. **条目比原文少，不算错。** 骨架是一条一条抽的，不是摘要：原文一句里并列的三件事被拆成三条，或一条只取了并列原因中的一个，**都是对的**。不要因为“遗漏了并列表述”而判 partial。",
  "3. 限定语任何一处被抹掉或改写就不是 supported——数字、比例、时间（“今年以来”）、主体（“王某认为”与“相关工作人员说”不是一回事）、地域、程度与语气（“还可参与”不是“积极参与”）。最容易被漏掉的是**时间词与语气词**。",
  "4. 数字逐个核。「近三成」不是「30%」，「十余台」不是「10 台」，算 partial。",
  "5. 只凭这一篇原文判。你自己知道的背景知识、常识推断，都不算依据。",
  "6. 拿不准的一律不给 supported。",
  "只返回 JSON：{\"结果\":[{\"i\":序号,\"判\":\"supported|partial|absent\",\"原句\":\"...\",\"说明\":\"...\"}]}",
].join("\n");

if (phase === "verify") {
  const askN = Number((process.argv[3] || "15").trim()) || 15;
  if (!existsSync(poolDir)) { console.error("池子是空的：" + poolDir); process.exit(1); }
  // 抽哪几条：跨文章随机抽。抽之前先把每篇的条目读出来（条目行：- xxx 或 1. xxx）
  const files = readdirSync(poolDir).filter(f => f.endsWith(".md"));
  const byUrl = new Map();
  for (const f of files) {
    const s = readFileSync(join(poolDir, f), "utf8");
    const url = (s.match(/^来源：(\S+)$/m) || [, ""])[1];
    if (!url) continue;
    let col = "";
    for (const line of s.split("\n")) {
      const h = line.match(/^## (.+)$/);
      if (h) { col = h[1].trim(); continue; }
      const m = line.match(/^(?:- |\d+\. )(.+)$/);
      if (!m || !col || col === "标题") continue;
      const txt = m[1].trim();
      if (!txt || txt.indexOf("原文未提及") === 0) continue;
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push({ col, txt });
    }
  }
  const all = [];
  for (const [url, list] of byUrl) for (const e of list) all.push(Object.assign({ url }, e));
  if (!all.length) { console.error("池子里没有条目可核。"); process.exit(1); }
  // 洗牌后取前 N（按文章去重取，避免 15 条全落在同一篇上）
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const pick = [], perUrl = new Map();
  for (const e of all) {
    if (pick.length >= askN) break;
    const k = perUrl.get(e.url) || 0;
    if (k >= 5) continue;                     // 一篇文章最多贡献 5 条
    perUrl.set(e.url, k + 1);
    pick.push(e);
  }
  console.error("抽 " + pick.length + " 条，来自 " + perUrl.size + " 篇（池子共 " + all.length + " 条 / " + byUrl.size + " 篇）");

  const srcOfUrl = u => /paper\.people\.com\.cn/.test(u) ? "rmrb" : /society\.people\.com\.cn|people\.com\.cn/.test(u) ? "rmw" : "gov";
  const bodies = {};
  for (const u of perUrl.keys()) {
    try { bodies[u] = extractBody(await get(u), srcOfUrl(u)); }
    catch (e) { bodies[u] = ""; console.error("  抓原文失败：" + u + " —— " + e.message); }
  }

  const payload = [...perUrl.keys()].map(u => ({
    url: u,
    body: bodies[u],
    items: pick.filter(e => e.url === u).map(e => ({ col: e.col, txt: e.txt })),
  }));

  const vprobe = `
const T = await import("node:timers");
globalThis.setTimeout = T.setTimeout; globalThis.clearTimeout = T.clearTimeout;
globalThis.setInterval = T.setInterval; globalThis.clearInterval = T.clearInterval;
state.settings.apiKey = ${JSON.stringify(key)};
state.settings.baseUrl = "https://api.deepseek.com/v1";
state.settings.model = ${JSON.stringify(model)};
state.modelCaps = {};
const probes = ${JSON.stringify(payload)};
let ok = 0, part = 0, absent = 0, n = 0;
for (const p of probes) {
  if (!p.body || p.body.replace(/\\s/g, "").length < 200) { console.log("NOSRC " + p.url); continue; }
  const ask = "【正文】\\n" + p.body + "\\n\\n【待核条目】\\n" + p.items.map((e, i) => (i + 1) + ". （" + e.col + "）" + e.txt).join("\\n");
  let r = null;
  try { r = await callLLM(VERIFY_SYS, ask, true, null, { temp: 0, level: "quick" }); } catch (e) { console.log("FAIL " + p.url + " " + ((e && (e.code || e.message)) || JSON.stringify(e))); continue; }
  const list = (r && r["结果"]) || [];
  for (const x of (Array.isArray(list) ? list : [])) {
    n++;
    const i = Number(x.i) - 1;
    const e = p.items[i] || {};
    const verdict = String(x["判"] || "");
    if (verdict === "supported") { ok++; continue; }
    if (verdict === "partial") part++; else absent++;
    console.log(verdict.toUpperCase() + " " + JSON.stringify({ 栏: e.col, 条目: String(e.txt || "").slice(0, 60), 说明: String(x["说明"] || "").slice(0, 90) }));
  }
}
console.log("VERIFY " + JSON.stringify({ 核了: n, 支撑: ok, 说过头: part, 找不到: absent, 错: part + absent }));
if (!n) { console.log("一条也没核成：探针没拿到判决，不要当成全过。"); process.exitCode = 1; }
`;
  const vsrc = [SKEL_PROMPT, appSrc, "const VERIFY_SYS = " + JSON.stringify(VERIFY_SYS) + ";", vprobe].join("\n");
  await import("data:text/javascript;base64," + Buffer.from(vsrc, "utf8").toString("base64"));
  process.exit(0);   // verify 到这就结束，不能落到下面的 fetch 段
}

/* ---------- redo：把池子里已有的文章用当前的 prompt 重新提炼一遍 ---------- 
   为什么要有：改了提炼规矩就得知道它到底管不管用，而 fetch 会跳过池子里已有的地址。
   重建整池子太贵，所以要能只重跑已有的那几篇。跑完拿 verify 比一比才知道改动是好是坏。
   用法：node tools/material-pool.mjs redo [篇数|all]，默认 all。 */
if (phase === "redo") {
  if (!existsSync(poolDir)) { console.error("池子是空的：" + poolDir); process.exit(1); }
  const files = readdirSync(poolDir).filter(f => f.endsWith(".md")).sort();
  const arg = (process.argv[3] || "all").trim();
  const chosen = arg === "all" ? files : files.slice(0, Math.max(1, Number(arg) || 1));
  const jobs = [];
  const srcOfUrl = u => /paper\.people\.com\.cn/.test(u) ? "rmrb" : /people\.com\.cn/.test(u) ? "rmw" : "gov";
  for (const f of chosen) {
    const s = readFileSync(join(poolDir, f), "utf8");
    const url = (s.match(/^来源：(\S+)$/m) || [, ""])[1];
    const title = (s.match(/^# (.+)$/m) || [, f])[1];
    const pub = (s.match(/^发布：(.+)$/m) || [, ""])[1];
    const wenhao = (s.match(/^文号：(.+)$/m) || [, ""])[1];
    if (!url) { console.error("  没地址，跳过：" + f); continue; }
    let body = "";
    try { body = extractBody(await get(url), srcOfUrl(url)); }
    catch (e) { console.error("  抓原文失败：" + title.slice(0,24) + " —— " + e.message); continue; }
    if (body.replace(/\s/g, "").length < 400) { console.error("  正文太短，跳过：" + title.slice(0,24)); continue; }
    jobs.push({ file: f, url, title, pub, wenhao: wenhao === "（无）" ? "" : wenhao, body });
  }
  console.error("重提炼 " + jobs.length + " 篇（fetch 会跳过已有地址，所以这一步只能单独跑）");
  if (!jobs.length) process.exit(1);
  const rprobe = `
const T = await import("node:timers");
globalThis.setTimeout = T.setTimeout; globalThis.clearTimeout = T.clearTimeout;
globalThis.setInterval = T.setInterval; globalThis.clearInterval = T.clearInterval;
state.settings.apiKey = ${JSON.stringify(key)};
state.settings.baseUrl = "https://api.deepseek.com/v1";
state.settings.model = ${JSON.stringify(model)};
state.modelCaps = {};
const REFINE_SYS = ${JSON.stringify(REFINE_SYS)};
const fs = await import("node:fs");
const path = await import("node:path");
const outDir = ${JSON.stringify(poolDir)};
const stamp = new Date().toISOString().slice(0, 10);
const jobs = ${JSON.stringify(jobs)};
let kept = 0, dropped = 0;
for (const j of jobs) {
  let sk = null, err = "";
  try { sk = await callLLM(REFINE_SYS, "【正文】\\n" + j.body, true, null, { temp: 0, level: "quick" }); }
  catch (e) { err = String((e && (e.code || e.message)) || e); }
  if (!sk || typeof sk !== "object") { console.log("FAIL " + j.title.slice(0,30) + " " + err); continue; }
  if (sk.usable === false) {
    dropped++;
    console.log("DROP-now " + JSON.stringify({ title: j.title.slice(0,30), why: String(sk.why || "").slice(0,60) }));
    fs.renameSync(path.join(outDir, j.file), path.join(outDir, "_" + j.file + ".dropped"));
    continue;
  }
  const sec = (t, arr) => "## " + t + "\\n" + ((arr && arr.length) ? arr.map((x,i)=> (t==="做法"||t==="建议 / 主张"? (i+1)+". " : "- ") + x).join("\\n") : "- （原文未提及）");
  const md = [ "# " + j.title, "", "来源：" + j.url, "发布：" + j.pub, "文号：" + (j.wenhao || "（无）"),
    "抓取：" + stamp, "时效：" + (j.wenhao ? "长期框架（有正式文号，按大事件处理）" : "半年（自 " + j.pub + " 起）"),
    "主题：" + ((Array.isArray(sk.topics) && sk.topics.length) ? sk.topics.join("、") : "（未标）"),
    "采用：" + (sk.why || ""), "", sec("背景", sk.background), "", sec("做法（已经发生的）", sk.measures), "",
    sec("成效", sk.effects), "", sec("争议 / 难点", sk.difficulties), "", sec("建议 / 主张（还没发生的）", sk.proposals), "" ].join("\\n");
  fs.writeFileSync(path.join(outDir, j.file), md, "utf8");
  kept++;
  const n = ["background","measures","effects","difficulties","proposals"].reduce((a,k)=> a + ((sk[k]||[]).length), 0);
  console.log("OK " + JSON.stringify({ title: j.title.slice(0,26), 条数: n,
    分布: { 背景:(sk.background||[]).length, 做法:(sk.measures||[]).length, 成效:(sk.effects||[]).length, 难点:(sk.difficulties||[]).length, 建议:(sk.proposals||[]).length } }));
}
console.log("REDO " + JSON.stringify({ 重写: kept, 转成不合格: dropped }));
`;
  const rsrc = [SKEL_PROMPT, appSrc, rprobe].join("\n");
  await import("data:text/javascript;base64," + Buffer.from(rsrc, "utf8").toString("base64"));
  process.exit(0);
}

console.error("抓取 " + SRC.name + (query? "「" + query + "」" : "") + "…");
const hits = await SRC.list(query, want * 3);
console.error("  命中 " + hits.length + " 条（取前 " + want + " 篇新）");

// 自己不重（设计稿第 4 节）：池子里已经有的地址直接跳过。
// 不这么做的话，“抓 3 篇”每跑一次都在反复加工同一批文章，永远扩不开。
const used = new Set();
if (existsSync(poolDir)) {
  for (const f of readdirSync(poolDir)) {
    if (!f.endsWith(".md")) continue;
    const m = readFileSync(join(poolDir, f), "utf8").match(/^来源：(\S+)$/m);
    if (m) used.add(m[1].trim());
  }
}
const fresh = hits.filter(it => !used.has(it.url));
if (used.size) console.error("  池子里已有 " + used.size + " 篇，剩 " + fresh.length + " 条候选");

// 正文先抓完（这一步不用 Key、不占模型调用）；下面的探针拼成独立模块，看不到本文件的函数，
// 所以能传的只有数据。
// 列表页里混着图片新闻（正文不到一百字）与专题页，所以不能“取前 N 篇”就算：
// 往后多抓几篇，正文够长的才凑数，凑够 want 篇为止。
const MIN_BODY = 400;
const picked = [];
const bodies = {};
for (const it of fresh) {
  if (picked.length >= want) break;
  let body = "";
  try { body = extractBody(await get(it.url), srcId); }
  catch (e) { console.error("  抓正文失败：" + it.title.slice(0, 24) + " —— " + e.message); }
  if (body.replace(/\s/g, "").length < MIN_BODY) {
    console.error("  跳过（正文 " + body.replace(/\s/g, "").length + " 字）：" + it.title.slice(0, 26));
    continue;
  }
  bodies[it.url] = body;
  picked.push(it);
}
if (!picked.length) { console.error("候选里没有一篇正文够长（≥ " + MIN_BODY + " 字），这一栏可能要换。"); process.exit(1); }

if (!existsSync(poolDir)) mkdirSync(poolDir, { recursive: true });

const probe = `
const T = await import("node:timers");
globalThis.setTimeout = T.setTimeout; globalThis.clearTimeout = T.clearTimeout;
globalThis.setInterval = T.setInterval; globalThis.clearInterval = T.clearInterval;
state.settings.apiKey = ${JSON.stringify(key)};
state.settings.baseUrl = "https://api.deepseek.com/v1";
state.settings.model = ${JSON.stringify(model)};
state.modelCaps = {};

const REFINE_SYS = ${JSON.stringify(REFINE_SYS)};
const items = ${JSON.stringify(picked)};
const bodies = ${JSON.stringify(bodies)};

const fs = await import("node:fs");
const path = await import("node:path");
const outDir = ${JSON.stringify(poolDir)};
const srcId = ${JSON.stringify(srcId)};
const stamp = new Date().toISOString().slice(0, 10);
const done = [];

for (const it of items) {
  const body = bodies[it.url] || "";
  if (body.replace(/\\s/g, "").length < 400) { console.log("SKIP " + JSON.stringify({ title: it.title.slice(0,30), why: "正文太短（" + body.length + " 字）" })); continue; }
  let sk = null, err = "";
  try {
    sk = await callLLM(REFINE_SYS, "【正文】\\n" + body, true, null, { temp: 0, level: "quick" });
  } catch (e) { err = String((e && (e.code || e.message)) || e); }
  if (!sk || typeof sk !== "object") { console.log("FAIL " + JSON.stringify({ title: it.title.slice(0,30), err: err || "没解出骨架" })); continue; }
  // 入库判断不过就不落盘（规范第四节：不合格的不进池子，不是先存下来再筛）
  if (sk.usable === false) { console.log("DROP " + JSON.stringify({ title: it.title.slice(0,30), url: it.url, why: sk.why || "判为出不了题" })); continue; }
  // 串栏探针（只报不改）：同一件事被写进两栏，出题时会变成两个采分点，一份答卷答一条被算成两条。
  // 先只量不改，看光靠 prompt 的硬约束能不能压住；压不住再上本地去重。
  const dupes = [];
  const cols = [["背景", sk.background], ["做法", sk.measures], ["成效", sk.effects], ["难点", sk.difficulties], ["建议", sk.proposals]];
  const seen = new Map();
  for (const [name, arr] of cols) for (const x of (Array.isArray(arr) ? arr : [])) {
    const k = String(x).replace(/[\s，。、；：,.]+/g, "");
    if (k.length < 12) continue;
    if (seen.has(k)) dupes.push(seen.get(k) + " / " + name + "：" + String(x).slice(0, 26));
    else seen.set(k, name);
  }
  if (dupes.length) console.log("DUP " + JSON.stringify({ title: it.title.slice(0,30), n: dupes.length, 例: dupes.slice(0,3) }));
  // 成就稿探针（只报不改）：成效条数压过「背景+难点」条数就是嫌疑。这只是代理指标，
  // 真正的判据在 prompt 里（这篇里有没有一个还没解决的问题），所以先量、不拦。
  const nEff = (sk.effects||[]).length, nProb = (sk.background||[]).length + (sk.difficulties||[]).length;
  if (nEff >= 6 && nEff > nProb * 2) console.log("MAYBE-成就稿 " + JSON.stringify({ title: it.title.slice(0,30), 成效: nEff, 问题: nProb }));
  const sec = (t, arr) => "## " + t + "\\n" + ((arr && arr.length) ? arr.map((x,i)=> (t==="做法"||t==="建议 / 主张"? (i+1)+". " : "- ") + x).join("\\n") : "- （原文未提及）");
  const md = [
    "# " + it.title,
    "",
    "来源：" + it.url,
    "发布：" + it.pub,
    "文号：" + (it.wenhao || "（无）"),
    "抓取：" + stamp,
    "时效：" + (it.wenhao ? "长期框架（有正式文号，按大事件处理）" : "半年（自 " + it.pub + " 起）"),
    "主题：" + ((Array.isArray(sk.topics) && sk.topics.length) ? sk.topics.join("、") : "（未标）"),
    "采用：" + (sk.why || ""),
    "",
    sec("背景", sk.background),
    "",
    sec("做法（已经发生的）", sk.measures),
    "",
    sec("成效", sk.effects),
    "",
    sec("争议 / 难点", sk.difficulties),
    "",
    sec("建议 / 主张（还没发生的）", sk.proposals),
    "",
  ].join("\\n");
  const name = stamp.replace(/-/g, "") + "-" + srcId + "-" + String(it.id || Math.random().toString(36).slice(2,8)) + ".md";
  fs.writeFileSync(path.join(outDir, name), md, "utf8");
  const n = ["background","measures","effects","difficulties","proposals"].reduce((a,k)=> a + ((sk[k]||[]).length), 0);
  console.log("OK " + JSON.stringify({ file: name, title: it.title.slice(0,32), 条数: n,
    分布: { 背景:(sk.background||[]).length, 做法:(sk.measures||[]).length, 成效:(sk.effects||[]).length, 难点:(sk.difficulties||[]).length, 建议:(sk.proposals||[]).length },
    正文字数: body.replace(/\\s/g,"").length }));
  done.push(name);
}
console.log("DONE " + JSON.stringify({ 落盘: done.length, 目录: outDir }));
`;

const src = [SKEL_PROMPT, appSrc, probe].join("\n");
await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

