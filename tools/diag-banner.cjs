/* 探针：量输入框与 chips 容器/内容宽度，看右边界为何参差 */
const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: false });
  await win.loadFile(path.join(__dirname, "..", "app", "index.html"));
  const r = await win.webContents.executeJavaScript(`(() => {
    switchSubject('zy'); enterPD();
    const B = (sel) => { const n = document.querySelector(sel); if(!n) return null;
      const b = n.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) }; };
    const chips = [...document.querySelectorAll(".subtypechips .chip")];
    const rows = {};
    chips.forEach(c => { const t = Math.round(c.getBoundingClientRect().top);
      rows[t] = rows[t] || []; rows[t].push(Math.round(c.getBoundingClientRect().right)); });
    return {
      pdforms: B(".pdforms"), input: B("#pdTheme"), chipsBox: B(".subtypechips"),
      chipRows: Object.entries(rows).map(([t, rights]) => ({ top: t, n: rights.length,
        minRight: Math.min(...rights), maxRight: Math.max(...rights) })),
      sbContentW: Math.round(document.querySelector(".startbox").clientWidth),
    };
  })()`);
  console.log("startbox 内容宽 =", r.sbContentW);
  console.log("pdforms  ", JSON.stringify(r.pdforms));
  console.log("输入框   ", JSON.stringify(r.input));
  console.log("chips容器", JSON.stringify(r.chipsBox));
  console.log("chips 各行（各 chip 的右边界）:");
  for (const x of r.chipRows) console.log("  top=" + x.top, "个数=" + x.n, "右边界 " + x.minRight + "~" + x.maxRight);
  win.close(); setTimeout(() => app.quit(), 200);
});
