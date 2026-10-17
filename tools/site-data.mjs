/*
 * 官网取数：把「最新版是哪个、安装包叫什么」写进站点自带的两个文件。
 *
 *   npm run site:data
 *
 * 产出（只写这两个，别的都不动）：
 *   site/latest.json     每个平台各自的版本 / 发布日 / 包名 / 字节数
 *   site/changelog.json  更新日志，从 app/index.html 的 CHANGELOG 抽一份（单一真源，站点不另写一份）
 *
 * 为什么要有它：site/index.html 一级就读这两个文件——不赌访客能不能连上 api.github.com，
 * 也不吃 API 限额。缺了它，页面只剩写死的那个版本号可看（2026-10-17 就是这么指向一个旧版的）。
 *
 * 取哪一版：prerelease 也算（这个仓库用 prerelease 表示「只发了一个平台」，不是「不稳」），
 * 但两个平台各取自己最新有产物的那一版——所以 mac 单发一版时，Windows 那一栏还指着上一次的正式包，
 * 不会给 Windows 用户一个不存在的下载链接。
 *
 * 什么时候跑：两边都发完之后（release:check 全绿），跑一次、提交、推送；Pages 会自己重新部署。
 * release:check 会盯着这一步有没有忘——站点数据不是本版时它会报出来。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const siteDir = join(root, "site");
/* 仓库位置只有一处真源（app-meta.js） */
const REPO = createRequire(import.meta.url)(join(root, "app-meta.js")).slug;

/* gh 只装在自备位置的可能（这台 mac 上没有 Homebrew）：先看 PATH，再退到 ~/.local/opt/gh/bin/gh
   —— 与 release-check.mjs 找 gh 的路子一致。 */
function resolveGh() {
  const onPath = spawnSync("gh", ["--version"], { encoding: "utf8" });
  if (!onPath.error && onPath.status === 0) return "gh";
  const local = join(homedir(), ".local", "opt", "gh", "bin", "gh");
  const probe = spawnSync(local, ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) return local;
  return null;
}

const GH = resolveGh();
const ghAuthed = GH ? spawnSync(GH, ["auth", "status"], { encoding: "utf8" }).status === 0 : false;

async function releases() {
  if (ghAuthed) {
    const r = spawnSync(GH, ["api", "repos/" + REPO + "/releases?per_page=30"], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) throw new Error((r.stderr || "").trim() || "gh api 失败");
    return JSON.parse(r.stdout);
  }
  /* 仓库是公开的，匿名也能读，只是额度低一些 */
  const res = await fetch("https://api.github.com/repos/" + REPO + "/releases?per_page=30", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "liantai-site-data" },
  });
  if (!res.ok) throw new Error("GitHub API " + res.status + " " + (await res.text()).slice(0, 200));
  return res.json();
}

const mb = (n) => Math.round(Number(n) / 1048576 * 10) / 10 + " MB";
const cmpVersion = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

/* 每个平台取自己最新有产物的那一版：一次遍历（已按发布时间倒序）各记一次头一回撞见的 */
function pick(list, test) {
  for (const rel of list) {
    const a = (rel.assets || []).find((x) => test.test(x.name));
    if (a) {
      return {
        version: rel.tag_name.replace(/^v/, ""), tag: rel.tag_name,
        date: (rel.published_at || "").slice(0, 10), file: a.name, size: a.size,
      };
    }
  }
  return null;
}

const all = await releases();
/* prerelease 不筛掉（这个仓库拿它表示「只发了一个平台」），只排除草稿和不是版本号的 tag */
const list = all
  .filter((r) => !r.draft && /^v\d/.test(r.tag_name || ""))
  .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

const windows = pick(list, /-setup-\d[\d.]*\.exe$/);
const mac = pick(list, /-arm64\.dmg$/);
if (!windows || !mac) throw new Error("没在 Release 里同时找到 Windows 的 .exe 和 macOS 的 .dmg");

const newest = cmpVersion(windows.version, mac.version) >= 0 ? windows : mac;
const latest = { version: newest.version, date: newest.date, windows, mac };

/* 更新日志：应用里那份 CHANGELOG 是唯一真源，这里抽出来给站点用 */
const appHtml = readFileSync(join(root, "app", "index.html"), "utf8");
const block = /const CHANGELOG = \[([\s\S]*?)\n\];/.exec(appHtml);
if (!block) throw new Error("没在 app/index.html 里找到 CHANGELOG 数组");
const entries = [...block[1].matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]*)"\s*\]/g)].map((m) => [m[1], m[2]]);
if (!entries.length) throw new Error("CHANGELOG 抽出来是空的，检查一下 app/index.html 的写法");

writeFileSync(join(siteDir, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
writeFileSync(join(siteDir, "changelog.json"), JSON.stringify({ entries }, null, 2) + "\n");

console.log("=== 官网取数 ===");
console.log("  版本   " + latest.version + "（" + latest.date + "）");
console.log("  Windows  " + windows.file + "   " + mb(windows.size) + "   v" + windows.version);
console.log("  macOS    " + mac.file + "   " + mb(mac.size) + "   v" + mac.version);
console.log("  更新日志  " + entries.length + " 条（来自 app/index.html 的 CHANGELOG）");
console.log("  已写  site/latest.json、site/changelog.json");
console.log("");
console.log("  下一步：git add site/ && git commit && git push —— Pages 会自己重新部署");
