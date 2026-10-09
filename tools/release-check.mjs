/*
 * 双平台对账：一个 Release 是不是 Windows + macOS 两边都齐了。
 *
 *   npm run release:check            查 package.json 里当前版本（tag vX.Y.Z）
 *   npm run release:check -- v0.0.15 查指定 tag
 *   npm run release:check -- --quiet 只在有问题时输出
 *
 * 除了对账资产，它还把原来写在 AGENTS.md 人肉清单里的两条机械检查收进来：
 *   package.json 三铁律（version 与 tag 同版 / build.win.target 只有 nsis / 没有顶层 productName）
 *   文档里引用的仓内文件都存在
 *
 * 为什么要有它：
 *   两个平台各自在各自机器上出包、各自往同一个 Release 上补资产（Windows：`npm run release`；
 *   mac：`npm run release:mac`）。两边都对账，但**都只对自己的那半边负责**——所以
 *   「Windows 传完了、mac 忘了传」在两条链路里都是绿的，用户那边却少一个平台。
 *   这个脚本站在外面看整个 Release：该有的资产一个不少、latest.yml 的版本号就是这一版、
 *   以及这一版有没有把 Windows 自动更新的 /releases/latest 指针占住却没带 latest.yml。
 *
 * 只读：不打包、不上传、不建 Release、不改任何文件。退出码 0 = 齐了，1 = 缺东西。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const publish = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};
const REPO = publish.owner && publish.repo ? publish.owner + "/" + publish.repo : "lllvernan-blip/liantai-desktop";

const argv = process.argv.slice(2);
const quiet = argv.includes("--quiet");
const tagArg = argv.find((a) => /^v?\d+\.\d+\.\d+/.test(a));
const tag = tagArg ? (tagArg[0] === "v" ? tagArg : "v" + tagArg) : "v" + pkg.version;
const version = tag.replace(/^v/, "");

/* gh 只装在自备位置的可能（这台 mac 上没有 Homebrew）：先看 PATH，再退到 ~/.local/opt/gh/bin/gh
   —— 与 打包.bat 找 npm、release.mjs 找 gh 的路子一致。 */
function resolveGh() {
  const onPath = spawnSync("gh", ["--version"], { encoding: "utf8" });
  if (!onPath.error && onPath.status === 0) return "gh";
  const local = join(homedir(), ".local", "opt", "gh", "bin", "gh");
  const probe = spawnSync(local, ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) return local;
  return null;
}

const GH = resolveGh();
const ghAuthed = (() => {
  if (!GH) return false;
  const r = spawnSync(GH, ["auth", "status"], { encoding: "utf8" });
  return r.status === 0;
})();
/* 仓库是公开的，匿名也能读：gh 没登录（或没装 gh）时自动退到匿名 GitHub API，只是额度低一些。 */
const viaGh = Boolean(ghAuthed);

function apiGet(path, raw) {
  if (viaGh) {
    const args = ["api", path];
    if (raw) args.push("-H", "Accept: application/vnd.github.raw");
    const r = spawnSync(GH, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      /* 404 不是「gh 坏了」，是「这个东西还不存在」——最常见的一种：version 刚提上去、Release 还没建，
         这时跑一次对账（正是最该跑的时候）却抛出一串 ESM 栈，什么也说明不了。回 null，让调用方说人话，
         与下面匿名分支的行为对齐（那条路一直是 404 → null）。 */
      const err = (r.stderr || "").trim();
      if (/HTTP 404|Not Found/i.test(err)) return null;
      throw new Error(err || "gh api 失败");
    }
    return r.stdout;
  }
  return null; // 异步分支在 fetchJson 里走
}

async function fetchJson(path) {
  const local = apiGet(path);
  if (local != null) return JSON.parse(local);
  const res = await fetch("https://api.github.com" + path, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "liantai-release-check" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("GitHub API " + res.status + " " + (await res.text()).slice(0, 200));
  return res.json();
}

async function fetchAssetText(asset) {
  if (viaGh) {
    /* 要原始内容得用 application/octet-stream；写成 vnd.github.raw 拿到的是 JSON 元数据，
       解析出来就是「version 读不到」——这个坑在 2026-10-03 登录态下真撞过。 */
    const r = spawnSync(GH, ["api", "repos/" + REPO + "/releases/assets/" + asset.id, "-H", "Accept: application/octet-stream"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (r.status !== 0) return null;
    return r.stdout;
  }
  const res = await fetch(asset.browser_download_url, { headers: { "User-Agent": "liantai-release-check" } });
  if (!res.ok) return null;
  return res.text();
}

/* 两边的资产名都是 ASCII（electron-builder 用 package name 推出来的），
   本地产物名是中文，所以这里按模式认，不按本机文件名认。 */
const setupExe = pkg.name + "-setup-" + version + ".exe";
const macPrefix = pkg.name + "-" + version + "-";

function ymlVersion(text) {
  if (!text) return null;
  const m = /^version:\s*(.+)$/m.exec(text);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

function list(title, rows) {
  console.log("\n  " + title);
  for (const r of rows) console.log("   " + (r.ok ? "✔" : "✘") + " " + r.name + (r.note ? "   " + r.note : ""));
}

const problems = [];

/* ================= 本仓库自检（与 Release 无关，但发版前同样必须为真） ================= */

const localRows = [];
const localProblems = [];
{
  /* 铁律一：只发 NSIS 安装版。加了 portable 就得单独禁用它的自动更新，所以这里拦住。 */
  const winTarget = pkg.build && pkg.build.win && pkg.build.win.target;
  /* electron-builder 允许两种写法：字符串 / 数组 / 带 arch 的对象（本项目就是对象那种），
     所以按对象取 target 名，别拿 JSON 直接比字符串。 */
  const targetNames = (Array.isArray(winTarget) ? winTarget : winTarget ? [winTarget] : [])
    .map((t) => (typeof t === "string" ? t : (t && t.target) || ""))
    .filter(Boolean);
  const onlyNsis = targetNames.length === 1 && targetNames[0] === "nsis";
  localRows.push({
    name: "build.win.target 只有 nsis",
    ok: onlyNsis,
    note: onlyNsis ? "" : "现在=" + JSON.stringify(winTarget || null) + "（只发 NSIS 安装版）",
  });
  if (!onlyNsis) localProblems.push("package.json 的 build.win.target 不再是唯一的 nsis");

  /* 铁律二：不要顶层 productName——Electron 用它决定 userData 目录，一改用户的记录就搬走。 */
  const topProductName = Object.prototype.hasOwnProperty.call(pkg, "productName");
  localRows.push({
    name: "没有顶层 productName",
    ok: !topProductName,
    note: topProductName ? "顶层 productName 决定 userData 目录，一改数据就搬走" : "显示名走 build.productName，安全",
  });
  if (topProductName) localProblems.push("package.json 多了顶层 productName");

  /* 铁律三：version 与 tag 同版。不提版本号，老用户永远收不到这一版。 */
  const sameVersion = tag === "v" + pkg.version;
  localRows.push({ name: "tag 与 package.json 同版", ok: sameVersion, note: "tag " + tag + " · package.json " + pkg.version });
  if (!sameVersion) localProblems.push("tag " + tag + " 与 package.json 的 " + pkg.version + " 不是同一版");
}
{
  /* 文档里引用的仓内文件得真在：AGENTS.md / README.md 一旦指向一个不存在的脚本，
     下一个人会照着敲一遍才发现。只看仓内的固定前缀，外链（http、/releases/…）不在此列。 */
  const PREFIXES = ["app/", "tests/", "tools/", "docs/", "build/"];
  const ROOT_FILES = ["AGENTS.md", "README.md", "package.json", "main.js", "update.js", "打包.bat"];
  const files = ["AGENTS.md", "README.md", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => "docs/" + f)];
  const missing = new Set();
  let checked = 0;
  for (const f of files) {
    const text = readFileSync(join(root, f), "utf8");
    for (const m of text.matchAll(/[A-Za-z0-9_\u4e00-\u9fa5./-]+\.(?:mjs|cjs|json|html|command|bat|yml|md|py|js)/g)) {
      const t = m[0];
      if (t.includes("://") || t.startsWith("/")) continue;
      const internal = PREFIXES.some((p) => t.startsWith(p)) || ROOT_FILES.includes(t);
      if (!internal) continue;
      checked++;
      if (!existsSync(join(root, t))) missing.add(f + " → " + t);
    }
  }
  const list = [...missing];
  localRows.push({ name: "文档引用的仓内文件都存在", ok: list.length === 0, note: list.length ? "缺 " + list.join("；") : "查了 " + checked + " 处" });
  if (list.length) localProblems.push("文档引用了不存在的文件：" + list.join("；"));
}

const release = await fetchJson("/repos/" + REPO + "/releases/tags/" + tag);
if (!quiet) console.log("=== 双平台对账 " + tag + "（" + REPO + "）===");
list("本仓库（与 Release 无关，发版前同样必须为真）", localRows);
if (!release) {
  for (const p of localProblems) console.error("  [缺] " + p);
  console.error("Release " + tag + " 不存在（这一版还没发，或者 tag 写错了）。");
  process.exit(1);
}

const names = (release.assets || []).map((a) => a.name);
const has = (n) => names.includes(n);
const bySuffix = (suffix) => names.filter((n) => n.endsWith(suffix));

/* ---- Windows：latest.yml（指针）+ 安装包 + blockmap ---- */
const winRows = [];
winRows.push({ name: "latest.yml", ok: has("latest.yml") });
winRows.push({ name: setupExe, ok: has(setupExe) });
winRows.push({ name: setupExe + ".blockmap", ok: has(setupExe + ".blockmap") });
const extraExe = bySuffix(".exe").filter((n) => n !== setupExe);
if (extraExe.length) {
  winRows.push({ name: extraExe.join("、"), ok: true, note: "版本号不是本版的安装包（对账只认本版名）" });
  problems.push("Windows 上挂着不属于本版的安装包：" + extraExe.join("、") + "（客户端可能下到旧内容）");
}
if (has("latest.yml")) {
  const asset = release.assets.find((a) => a.name === "latest.yml");
  const v = ymlVersion(await fetchAssetText(asset));
  if (v === null) {
    winRows.push({ name: "latest.yml 里的 version", ok: true, note: "读不到内容，跳过校验（清单位置本身对）" });
  } else {
    const ok = v === version;
    winRows.push({ name: "latest.yml 里的 version", ok, note: ok ? "= " + version : "= " + v + "（应为 " + version + "）" });
    if (!ok) problems.push("latest.yml 的 version 不是 " + version + "（「版本号是新版、内容是旧版」的经典翻车）");
  }
}

/* ---- macOS：latest-mac.yml + dmg/zip + 各自 blockmap ---- */
const macRows = [];
const macYml = "latest-mac.yml";
macRows.push({ name: macYml, ok: has(macYml) });
const dmgs = names.filter((n) => n.startsWith(macPrefix) && n.endsWith(".dmg"));
const zips = names.filter((n) => n.startsWith(macPrefix) && n.endsWith(".zip"));
macRows.push({ name: dmgs.length ? dmgs.join("、") : "*.dmg（安装包）", ok: dmgs.length > 0 });
for (const d of dmgs) macRows.push({ name: d + ".blockmap", ok: has(d + ".blockmap") });
macRows.push({ name: zips.length ? zips.join("、") : "*.zip（自动更新用，与 dmg 同内容）", ok: zips.length > 0 });
for (const z of zips) macRows.push({ name: z + ".blockmap", ok: has(z + ".blockmap") });
if (has(macYml)) {
  const asset = release.assets.find((a) => a.name === macYml);
  const v = ymlVersion(await fetchAssetText(asset));
  if (v === null) {
    macRows.push({ name: "latest-mac.yml 里的 version", ok: true, note: "读不到内容，跳过校验（清单位置本身对）" });
  } else {
    const ok = v === version;
    macRows.push({ name: "latest-mac.yml 里的 version", ok, note: ok ? "= " + version : "= " + v + "（应为 " + version + "）" });
    if (!ok) problems.push("latest-mac.yml 的 version 不是 " + version);
  }
}
const macArchs = [...new Set([...dmgs, ...zips].map((n) => (/-([a-z0-9]+)\.(dmg|zip)$/.exec(n) || [])[1]).filter(Boolean))];

/* ---- 指针位：/releases/latest 指「最新的非 prerelease」，Windows 自动更新读它 ---- */
const releases = (await fetchJson("/repos/" + REPO + "/releases?per_page=30")) || [];
const stable = releases.filter((r) => !r.prerelease && !r.draft);
const newestStable = stable[0] || null;
const pointerRows = [];
if (newestStable) {
  const isSelf = newestStable.tag_name === tag;
  const hasYml = (newestStable.assets || []).some((a) => a.name === "latest.yml");
  const pointerOk = !isSelf || hasYml;
  pointerRows.push({
    name: "/releases/latest → " + newestStable.tag_name + (isSelf ? "（就是本版）" : "（不是本版）"),
    ok: pointerOk,
    note: isSelf
      ? (hasYml ? "带 latest.yml，Windows 检查更新正常" : "没有 latest.yml，Windows 检查更新会 404")
      : "Windows 用户看到的最新版是它，不是本版",
  });
  if (isSelf && !hasYml) problems.push("本版占了 /releases/latest 却没有 latest.yml：Windows 检查更新会 404（mac 单发要用 --create --prerelease）");
}
pointerRows.push({ name: "本版是 prerelease？", ok: true, note: release.prerelease ? "是——不占 /releases/latest，不影响 Windows" : "否" });

/* ---- 汇报 ---- */
list("Windows（NSIS 安装版）", winRows);
list("macOS（dmg + zip）", macRows);
list("自动更新指针", pointerRows);

problems.push(...localProblems);
const missingWin = winRows.filter((r) => !r.ok).length;
const missingMac = macRows.filter((r) => !r.ok).length;
if (missingWin) problems.push("Windows 缺 " + missingWin + " 项");
if (missingMac) problems.push("macOS 缺 " + missingMac + " 项");

console.log("");
if (problems.length === 0) {
  console.log("  本仓库三条铁律都在，文件引用都在；两个平台也齐了：" + release.assets.length + " 个资产" + (macArchs.length ? "（mac arch：" + macArchs.join("/") + "）" : ""));
  process.exit(0);
}
for (const p of problems) console.error("  [缺] " + p);
if (missingMac > 0) console.error("       → mac 那一半在这台 mac 上跑：npm run release:mac");
if (missingWin > 0) console.error("       → Windows 那一半在 Windows 上跑：npm run release");
process.exit(1);
