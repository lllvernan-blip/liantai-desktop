/*
 * 渲染进程与外界之间唯一的通道。
 *
 * 为什么要有它：界面层一直是沙箱（sandbox: true、nodeIntegration: false），拿不到文件系统。
 * 而「有据出题」要用本机攒下来的材料池，后台抓取也得把结果写到磁盘上——这两件事都在主进程做，
 * 界面只读结果。
 *
 * 口子限定在主进程固定目录里（材料池 / userData/backup / userData/logs），界面传不进任意路径：
 *   poolPick(topics) 取一篇还没用过的骨架（取完就标为已用），
 *                    返回 { name, title, text, media, date, topics } 或 null
 *   poolList()        列出池子里有什么（调试与将来选题用）
 *   poolStat()        返回 { total, unused }；调试用，页面目前不调用
 *   appVersion()      当前版本号，写进导出备份的 appVersion
 *   backupSnapshot()  启动时送一份全量状态（不含 API Key）给主进程落盘，留在 userData/backup/
 *   backupList()      列出启动备份，供设置页挑一份恢复
 *   backupRead(name)  读回某一份的原文；名字只认主进程认得的固定格式
 *   openLogs()        打开 userData/logs/；路径由主进程定，界面只发一个动作
 *
 * 不开通用 fs、不开任意路径读写：名字一律只认文件名本身，目录拼接与校验在主进程做。
 * 沙箱里 preload 只能用 electron 的 ipcRenderer 与 contextBridge，其余一概没有。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("liantai", {
  poolPick: (topics) => ipcRenderer.invoke("pool:pick", { topics: Array.isArray(topics) ? topics : [] }),
  poolList: () => ipcRenderer.invoke("pool:list"),
  poolStat: () => ipcRenderer.invoke("pool:stat"),
  appVersion: () => ipcRenderer.invoke("app:version"),
  backupSnapshot: (payload) => ipcRenderer.invoke("backup:snapshot", payload),
  backupList: () => ipcRenderer.invoke("backup:list"),
  backupRead: (name) => ipcRenderer.invoke("backup:read", { name: String(name || "") }),
  openLogs: () => ipcRenderer.invoke("app:openLogs"),
});
