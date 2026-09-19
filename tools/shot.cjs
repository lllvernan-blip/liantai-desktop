/* 截快判页最终效果（等动效结束） */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: true });
  await win.loadFile(path.join(__dirname, "..", "app", "index.html"));
  await win.webContents.executeJavaScript(
    `banner("欢迎。点右上角「设置」，选一个服务商（推荐 DeepSeek）、填上 API Key，就能开始用了。");
     switchSubject('zy'); enterPD();`
  );
  await new Promise(r => setTimeout(r, 1600));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, "..", "shot-final.png"), img.toPNG());
  console.log("已存 shot-final.png");
  win.close();
  setTimeout(() => app.quit(), 300);
});
