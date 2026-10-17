/*
 * 渲染进程与外界之间唯一的通道。
 *
 * 为什么要有它：界面层一直是沙箱（sandbox: true、nodeIntegration: false），拿不到文件系统。
 * 而「有据出题」要用本机攒下来的材料池，后台抓取也得把结果写到磁盘上——这两件事都在主进程做，
 * 界面只读结果。
 *
 * 只开三个口子，且都限定在「材料池」这一个目录里：
 *   poolPick(topics) 取一篇还没用过的骨架（取完就标为已用），
 *                    返回 { name, title, text, media, date, topics } 或 null
 *                    media/date/topics 供材料区标「素材：哪家媒体 · 哪天 · 主题」
 *   poolList()        列出池子里有什么（调试与将来选题用）
 *   poolStat()        池子有多少篇、各主题几篇（界面只用来决定走有据还是编材料）
 *
 * 不开通用 fs、不开任意路径读写：名字一律只认文件名本身，目录拼接与校验在主进程做。
 * 沙箱里 preload 只能用 electron 的 ipcRenderer 与 contextBridge，其余一概没有。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("liantai", {
  poolPick: (topics) => ipcRenderer.invoke("pool:pick", { topics: Array.isArray(topics) ? topics : [] }),
  poolList: () => ipcRenderer.invoke("pool:list"),
  poolStat: () => ipcRenderer.invoke("pool:stat"),
});
