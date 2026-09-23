/*
 * 练习台 —— 取景器的 Electron 侧（由 tools/shot.mjs 拉起，不单独用）
 *   electron tools/shot-app.cjs <url> <场景JSON> <输出目录>
 *
 * 每个场景：执行场景 js → 等动效跑完（≤240ms，留 1.2s 富余；截早会撞上淡入的中间帧，
 * 截出整页空白或半透明，看着像页面坏了）→ 量几何 → capturePage 存 PNG。
 *
 * Windows 上 Electron 是 GUI 子系统程序，main 进程的 console.log 不保证能回到父进程的管道里，
 * 所以结果写进 <输出目录>/_run.log，不靠 stdout 汇报。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const url = process.env.LIANTAI_SHOT_URL;
const scenesPath = process.env.LIANTAI_SHOT_SCENES;
const outDir = process.env.LIANTAI_SHOT_OUT;
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

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 900, useContentSize: true, show: false, backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  await win.loadURL(url);
  await wait(1600);   // 字体 + init() 里的首屏渲染

  for (const sc of scenes) {
    try {
      if (sc.width || sc.height) win.setContentSize(sc.width || 1280, sc.height || 900);
      if (sc.width || sc.height) await wait(400);
      await win.webContents.executeJavaScript(sc.js, true);
      await wait(sc.wait || 1300);
      if (sc.full) {
        const h = await win.webContents.executeJavaScript("document.documentElement.scrollHeight", true);
        win.setContentSize(sc.width || 1280, Math.max(600, Math.min(h + 8, 6000)));
        await wait(500);
      }
      const m = await win.webContents.executeJavaScript(METRICS_JS, true);
      // sc.probe：场景自带的额外探测（返回什么就原样打进日志），用来查「哪些元素跑出纸面」这类问题
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
      fs.writeFileSync(path.join(outDir, sc.name + ".png"), img.toPNG());
      say("=== " + sc.name + "\n" + JSON.stringify(m) + (extra === undefined ? "" : "\nPROBE " + JSON.stringify(extra)));
      if (sc.full) { win.setContentSize(sc.width || 1280, sc.height || 900); await wait(300); }
    } catch (e) {
      say("!!! " + sc.name + " 失败: " + (e && e.message ? e.message : e));
    }
  }

  say("DONE");
  win.close();
  app.quit();
});
