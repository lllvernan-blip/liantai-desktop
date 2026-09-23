/*
 * 练习台 —— 取景器的 Electron 侧（由 tools/shot.mjs 拉起，不单独用）
 *
 * 每个场景默认拍两张：原始态 + 把所有 <details> 展开的态（环境变量 LIANTAI_SHOT_EXPAND=0 可关掉）。
 * 展开态是为了一件事：折叠块里的内容（学习卡内部、批改明细、提纲）原先只有手动点开才看得到，
 * 等于没进保护范围——不用手写第二套场景，直接在同一个场景上再跑一遍「全开」。
 *
 * 每屏跑完自动过一遍 AUDIT_JS：横向溢出 / 字形出纸 / 字号出档 / 热区过小 / 折叠件缺三角 / 页面报错。
 * 结论以 AUDIT 开头的行写进日志——**先看结论，只在有 FAIL 时才去点那张图**。
 *
 * 每个场景：执行场景 js → 隔展开态 → 等动效跑完（≤240ms，留 1.2s 富余；截早会撞上淡入的中间帧，
 * 截出整页空白或半透明，看着像页面坏了）→ 量几何 → 自检 → capturePage 存 PNG。
 *
 * Windows 上 Electron 是 GUI 子系统程序，main 进程的 console.log 不保证能回到父进程的管道里，
 * 所以结果写进 <输出目录>/_run.log，不靠 stdout 汇报（shot.mjs 收尾会把结论再打一遍到终端）。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const url = process.env.LIANTAI_SHOT_URL;
const scenesPath = process.env.LIANTAI_SHOT_SCENES;
const outDir = process.env.LIANTAI_SHOT_OUT;
const EXPAND = process.env.LIANTAI_SHOT_EXPAND !== "0";   // 每个场景是否再拍一张「折叠块全展开」态
// 启动即留痕：取景器失败的默认表现是「静默退出、什么都不说」，有这一行就能判断脚本到底跑没跑
try { fs.appendFileSync(path.join(require("os").tmpdir(), "liantai-shot-boot.log"), new Date().toISOString() + " boot url=" + url + " scenes=" + scenesPath + " out=" + outDir + "\n"); } catch (e) {}
if (!url || !scenesPath || !outDir) {
  // 不弹「JavaScript error in the main process」那种对话框：取景器是工具，失败就该安静地写在日志里
  app.quit();
  return;
}

if (!url || !scenesPath || !outDir) {
  app.quit();
  return;
}

fs.mkdirSync(outDir, { recursive: true });
const LOG = path.join(outDir, "_run.log");
const lines = [];
function say(s) { lines.push(s); try { fs.writeFileSync(LOG, lines.join("\n"), "utf8"); } catch (e) {} }
// 主进程里未捕获的异常会弹「A JavaScript error occurred in the main process」对话框。
// 取景器是工具，失败只该写日志，所以自己吃掉并退出——记住别在处理器里再抛（写日志本身要包 try）。
process.on("uncaughtException", (e) => { say("UNCAUGHT: " + (e && e.stack || e)); app.exit(1); });

let scenes = [];
try {
  scenes = JSON.parse(fs.readFileSync(scenesPath, "utf8"));
  say("场景数 " + scenes.length + " · url=" + url);
} catch (e) {
  say("读场景失败: " + e.message);
  app.exit(1);
}

// 关键块几何：顶栏/提示条/纸面/红头/正文/页脚，以及正文里的几种收纳件
const METRICS_JS = `(() => {
  const sel = [".topbar",".toolbar",".modbar","#bannerSlot",".wrap","#doc",".redhead",".modlabel","#docBody",
    ".startbox",".secrow",".flowrail",".material",".qtop",".hits",".grade",".nextrow",".fnav",".foot",".actions",".explist",".mrowbox"];
  const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(b.height), Math.round(b.left), Math.round(b.right)]; };
  const out = { viewport: [window.innerWidth, window.innerHeight], docScrollH: document.documentElement.scrollHeight };
  for (const s of sel) { const e = document.querySelector(s); if (e) out[s] = r(e); }
  // 起始类页面那一大片留白：.startbox 有 min-height:440px，内容常常只用到一半。
  // startFill = 内容实际占到哪，startPad = 它底下被撑出来的空白（这才是「大半张纸是空的」的量）。
  const sb = document.querySelector(".startbox");
  if (sb) {
    const kids = Array.from(sb.children).filter(e => e.offsetHeight > 0);
    const last = kids.length ? kids[kids.length - 1] : null;
    const box = sb.getBoundingClientRect();
    if (last) { out.startFill = Math.round(last.getBoundingClientRect().bottom - box.top); out.startPad = Math.round(box.bottom - last.getBoundingClientRect().bottom); }
  }
  const doc = document.querySelector("#doc"), body = document.querySelector("#docBody");
  if (doc && body) {
    const kids = Array.from(body.children).filter(e => e.offsetHeight > 0);
    const last = kids.length ? kids[kids.length - 1] : null;
    if (last) out.tailGap = Math.round(doc.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom);
  }
  // 纸面里真正被用掉的高度：正文顶部到正文底部，与纸面高度的差就是这块纸空着的量
  const head = document.querySelector(".redhead");
  if (doc && body && head) {
    out.usedPx = Math.round(body.getBoundingClientRect().bottom - head.getBoundingClientRect().top);
    out.blankPx = Math.round(doc.getBoundingClientRect().height - 40 - out.usedPx - 56);
  }
  return out;
})()`;

// 自检规则：只放「客观、不靠审美」的几条。宁少勿滥——规则误报一次，以后就没人信它的结论了。
// 折叠起来的内容 offsetHeight 为 0，天然被排除在外；跑展开态时它们才参与检查。
const AUDIT_JS = `(() => {
  const issues = [];
  const add = (lv, rule, detail) => issues.push(lv + " " + rule + " — " + detail);
  const body = document.querySelector("#docBody"), doc = document.querySelector("#doc");
  const de = document.documentElement;
  if (de.scrollWidth > window.innerWidth + 1) add("FAIL", "页面横向溢出", de.scrollWidth + "px > 视口 " + window.innerWidth + "px");
  if (!body) return issues;
  const skip = (el) => el.closest(".drawer,.markpop,.mask,.fab");
  const floating = (el) => { const p = getComputedStyle(el).position; return p === "fixed" || p === "absolute"; };
  const textLeaf = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  const live = Array.from(body.querySelectorAll("*")).filter((el) => el.offsetHeight && !skip(el));
  // ① 字形越出纸面：量字形（Range），不是量盒子——盒子把 padding 也算进去，
  //    会把「看着没出纸」误判成出了，也会把真出纸的漏过去（2026-09-23 踩过）
  if (doc) {
    const pb = doc.getBoundingClientRect(), rg = document.createRange(), bad = [];
    for (const el of live) {
      if (!textLeaf(el) || floating(el)) continue;
      rg.selectNodeContents(el);
      const r = rg.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < pb.left - 1 || r.right > pb.right + 1) bad.push((el.className || el.tagName) + " 字形 " + Math.round(r.left) + ".." + Math.round(r.right) + " / 纸 " + Math.round(pb.left) + ".." + Math.round(pb.right));
    }
    if (bad.length) add("FAIL", "字形越出纸面", bad.length + " 处：" + bad.slice(0, 4).join("；"));
  }
  // ② 字号只有六档（13.5 / 14.5 这类半像素档已明令废掉）
  const FS_OK = [12, 13, 14, 15, 16, 19, 26, 30], off = new Map();
  for (const el of live) {
    if (!textLeaf(el)) continue;
    const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
    if (FS_OK.indexOf(fs) < 0) off.set(fs, (off.get(fs) || 0) + 1);
  }
  if (off.size) add("WARN", "字号出档", Array.from(off).map((p) => p[0] + "px×" + p[1]).join("，"));
  // ③ 可点热区：低于 24px 就属于「点不准」。24 是行内文字按钮（.asgline 的「移出」）那一档的下限，
  //    顶栏文字按钮 30、正文按钮 36、主行动 40
  const small = [];
  for (const el of Array.from(body.querySelectorAll("button,summary,a")).filter((e) => e.offsetHeight && !skip(e))) {
    const r = el.getBoundingClientRect();
    if (Math.round(r.height) < 24) small.push((el.className || el.tagName) + " " + Math.round(r.height) + "px");
  }
  if (small.length) add("WARN", "可点热区不足 24px", small.length + " 处：" + small.slice(0, 4).join("；"));
  // ④ 折叠件必须带可见三角：没有 ::after 的 details 在纸上就是一句普通文字，用户不知道它点得开
  const noMark = [];
  for (const d of body.querySelectorAll("details")) {
    const s = d.querySelector(":scope > summary");
    if (!s) { noMark.push("details 缺 summary"); continue; }
    const c = getComputedStyle(s, "::after").content;
    if (!c || c === "none" || c === "normal") noMark.push((s.className || "summary") + " 无三角");
  }
  if (noMark.length) add("WARN", "折叠件缺三角标记", noMark.length + " 处：" + noMark.slice(0, 4).join("；"));
  return issues;
})()`;

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 900, useContentSize: true, show: false, backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  await win.loadURL(url);
  await wait(1600);   // 字体 + init() 里的首屏渲染

  // 页面自己抛的错也算 FAIL：桩子测试发现不了「渲染到一半炸了」这种
  await win.webContents.executeJavaScript(
    "(function(){ if (window.__errors) return; window.__errors = [];" +
    " window.addEventListener('error', function(e){ window.__errors.push(String(e.message) + ' @' + (e.filename || '') + ':' + (e.lineno || 0)); });" +
    " window.addEventListener('unhandledrejection', function(e){ window.__errors.push('未处理的 Promise: ' + String((e.reason && e.reason.message) || e.reason)); }); })()",
    true);
  const pageLevel = [];
  win.webContents.on("did-fail-load", (e, code, desc, u) => pageLevel.push("FAIL 页面加载失败 " + code + " " + desc + " " + u));
  win.webContents.on("render-process-gone", (e, d) => pageLevel.push("FAIL 渲染进程退出 " + JSON.stringify(d)));

  let failCnt = 0, warnCnt = 0, shotCnt = 0;
  for (const sc of scenes) {
    // 原始态 + 全展开态各跑一遍：折叠块里的东西也得进保护范围，不为它再写一套场景
    const variants = EXPAND
      ? [{ suf: "", pre: "" }, { suf: "__展开", pre: 'document.querySelectorAll("details:not([open])").forEach(function(d){ d.open = true; });' }]
      : [{ suf: "", pre: "" }];
    for (const v of variants) {
      const name = sc.name + v.suf;
      try {
        if (sc.width || sc.height) win.setContentSize(sc.width || 1280, sc.height || 900);
        if (sc.width || sc.height) await wait(400);
        await win.webContents.executeJavaScript(sc.js, true);
        await wait(sc.wait || 1300);
        if (v.pre) { await win.webContents.executeJavaScript(v.pre, true); await wait(700); }
        if (sc.full) {
          const h = await win.webContents.executeJavaScript("document.documentElement.scrollHeight", true);
          win.setContentSize(sc.width || 1280, Math.max(600, Math.min(h + 8, 6000)));
          await wait(500);
        }
        const m = await win.webContents.executeJavaScript(METRICS_JS, true);
        // 自检：客观规则自己判，结论进日志。图是给人看的，规则是给机器看的
        let audit = [];
        try { audit = await win.webContents.executeJavaScript(AUDIT_JS, true); } catch (e) { audit = ["WARN 自检脚本自身失败 — " + (e && e.message)]; }        try {
          const errs = await win.webContents.executeJavaScript("(window.__errors || []).splice(0).join(' | ')", true);
          if (errs) audit.push("FAIL 页面报错 — " + String(errs).slice(0, 300));
        } catch (e) {}
        if (pageLevel.length) audit = audit.concat(pageLevel.splice(0));   // 加载/渲染进程级的问题也算这一屏的账        // sc.probe：场景自带的额外探测（返回什么就原样打进日志），用来查「哪些元素跑出纸面」这类问题
        let extra;
        if (sc.probe) { try { extra = await win.webContents.executeJavaScript(sc.probe, true); } catch (e) { extra = "PROBE-FAIL " + (e && e.message); } }
        // capturePage 会拿到「最后一次合成的帧」。show:false 的窗口改完 DOM 不会自己重绘，
        // 于是截出上一屏的内容（本项目踩过，且 webContents.invalidate() 无效）。
        // 实测管用的是「改一下窗口尺寸」——它逼着窗口重新合成一帧。
        const w = sc.width || 1280, h = sc.height || 900;
        win.setContentSize(w, h + 1);
        await wait(120);
        win.setContentSize(w, h);
        await wait(260);
        // sc.crop：只截指定区域（CSS 像素），用来看清某一行到底压在哪条线上——
        // 整页截图缩到 900px 宽以后，10px 的错位肉眼分不出来，而「一条线对不齐」正是要查的东西
        const img = sc.crop
          ? await win.webContents.capturePage({ x: sc.crop[0], y: sc.crop[1], width: sc.crop[2], height: sc.crop[3] })
          : await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, name + ".png"), img.toPNG());
        shotCnt++;
        say("=== " + name + "\n" + JSON.stringify(m) + (extra === undefined ? "" : "\nPROBE " + JSON.stringify(extra)));
        for (const a of audit) {
          say("AUDIT " + name + " :: " + a);
          if (a.indexOf("FAIL") === 0) failCnt++; else warnCnt++;
        }
        if (sc.full) { win.setContentSize(w, h); await wait(300); }
      } catch (e) {
        say("!!! " + name + " 失败: " + (e && e.message ? e.message : e));
        failCnt++;
      }
    }
  }

  say("自检 " + shotCnt + " 张图 · FAIL " + failCnt + " · WARN " + warnCnt);
  say("DONE");
  win.close();
  app.quit();
});
