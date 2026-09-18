/*
 * 一键发布：盖章 → 出包（NSIS 安装版 + 免安装版）→ 上传到 GitHub Release。
 *
 *   npm run release
 *
 * 为什么要有它：
 *   发布是「版本号 + 安装包 + latest.yml + blockmap」四件套必须同时到位的事。
 *   少传一个 blockmap，差量更新就退化成全量下载；忘了改版本号，用户永远等不到更新。
 *   一步做完，就没得忘。
 *
 * 用 gh CLI 取 token（`gh auth token`），省得手工配 GH_TOKEN。
 * 发布前如果那个 tag 已经存在，直接停——重复发布只会让人分不清哪一版是新版。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
/* 直接调 electron-builder 的 JS 入口，不调 npx/npm：
   Windows 上 Node 18.20+/20.12+ 已经禁止 spawn 一个 .cmd/.bat 而不带 shell（CVE-2024-27980），
   而带 shell 又要跟引号搏斗——走 js 入口最干净。 */
const BUILDER_CLI = join(root, "node_modules", "electron-builder", "cli.js");
const REPO = "lllvernan-blip/liantai-desktop";
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = "v" + pkg.version;
// --reconcile-only：只把 Release 上缺的资产补齐，不出包
const reconcileOnly = process.argv.indexOf("--reconcile-only") >= 0;

function step(title) {
  console.log("\n=== " + title + " ===");
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ cwd: root, stdio: "inherit", shell: false }, opts || {}));
  if (r.error) {
    console.error("无法执行 " + cmd + "：" + r.error.message);
    process.exit(1);
  }
  return r.status;
}

step("发布 v" + pkg.version);

// 1) 干净的工作区。允许有改动（发布常和提交一起做），但要说清楚打进去的是什么。
const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
if (dirty.status === 0 && dirty.stdout.trim()) {
  console.log("注意：工作区有未提交的改动，这一版会包含它们：");
  console.log(dirty.stdout.trim());
}

// 2) gh 登录状态 + token
const auth = spawnSync("gh", ["auth", "status"], { cwd: root, encoding: "utf8" });
if (auth.status !== 0) {
  console.error("gh 未登录。先跑 gh auth login。");
  process.exit(1);
}
const tokenRes = spawnSync("gh", ["auth", "token"], { cwd: root, encoding: "utf8" });
const token = (tokenRes.stdout || "").trim();
if (tokenRes.status !== 0 || !token) {
  console.error("拿不到 GitHub token（gh auth token 失败），无法发布。");
  process.exit(1);
}

// 3) tag 不能已存在
const exists = spawnSync("gh", ["release", "view", tag, "--repo", REPO, "--json", "tagName"], { cwd: root, encoding: "utf8" });
if (exists.status === 0 && !reconcileOnly) {
  console.error("GitHub 上已经有 " + tag + " 了。要发新版本，先把 package.json 里的 version 提高。");
  process.exit(1);
}

// 4) 盖章（版本号 + 构建时间写进 app/build.json）
// 只对账时不要盖章：那不是在建包，盖了只会让磁盘上的 build.json 跑到包内那份前面。
if (!reconcileOnly) {
  step("写构建标识");
  if (run(process.execPath, [join(here, "stamp-build.mjs")]) !== 0) process.exit(1);
}

// 5) 出包并上传（--publish always：出完即传，包含 latest.yml 与 *.blockmap）
let status = 0;
if (reconcileOnly) {
  console.log("跳过打包，只对账补齐。");
} else {
  step("打包并上传（electron-builder --win nsis portable --publish always）");
  status = run(
    process.execPath,
    [BUILDER_CLI, "--win", "nsis", "portable", "--publish", "always"],
    { env: Object.assign({}, process.env, { GH_TOKEN: token }) }
  );
  if (status !== 0) {
    console.error("\n打包/上传过程报错了（常见原因：两个 target 各跑一次发布，第二次撞上 tag 已存在）。下面统一对账补齐。");
  }
}

/* electron-builder 每个 target 各跑一次发布流程，第二次会撞「tag_name already_exists」而中断——
   偏偏 latest.yml 与 *.blockmap 很可能就是在那一步丢的，而少了 latest.yml，自动更新压根不会启动。
   所以不信任它的返回码，而是**对着产物对账**：该在的都必须在，缺的用 gh 补传。 */
step("对账发布资产");
const missing = reconcileRelease();
if (missing.length) {
  console.error("发布资产仍不完整：" + missing.join("、") + "（自动更新会因为缺 latest.yml / blockmap 而不可用）");
  process.exit(1);
}

step("发布完成");
console.log(tag + "  ->  https://github.com/lllvernan-blip/liantai-desktop/releases/tag/" + tag);
console.log("装的用户下次启动就会在后台收到它（差量更新，只下载变化的部分）。");

function sha512Base64(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

/* 返回仍然缺的资产名（空数组 = 齐了）。
   注意名字：本地产物是中文名，上游要的是 latest.yml 里写的 ASCII 名，两套名字必须对上，
   对不上的话客户端会 404 —— 这正是最隐蔽的一种“更新装了但没人收得到”。 */
function reconcileRelease() {
  const ymlPath = join(root, "dist", "latest.yml");
  if (!existsSync(ymlPath)) {
    console.error("没有 dist/latest.yml，无法对账（先在本地跑一次 npm run dist）。");
    return ["latest.yml"];
  }
  const yml = readFileSync(ymlPath, "utf8");

  /* 先确认这份清单就是当前版本的。
     踩过的坑：dist/ 里混着上一次试打包的 latest.yml，于是把 1.0.0 的包装成了 1.0.1 的名字传上去，
     客户端会拿到一个「版本号写着新版、内容却是旧版」的包。清单版本与 package.json 不符就直接停。 */
  const vMatch = /^version:\s*(.+)$/m.exec(yml);
  const ymlVersion = vMatch ? vMatch[1].trim().replace(/^['"]|['"]$/g, "") : "";
  if (ymlVersion !== pkg.version) {
    console.error("dist/latest.yml 是「" + (ymlVersion || "读不出") + "」的清单，package.json 是「" + pkg.version + "」。");
    console.error("dist/ 里混着上一次打包的残留 —— 先 npm run dist 重新出一次包再来发布。");
    return ["latest.yml"];
  }

  const m = /^path:\s*(.+)$/m.exec(yml) || /^\s*url:\s*(.+)$/m.exec(yml);
  if (!m) {
    console.error("latest.yml 里读不到产物名，无法对账。");
    return ["latest.yml"];
  }
  const remoteSetupName = m[1].trim();
  const localSetup = join(root, "dist", "综应练习台-Setup-" + pkg.version + ".exe");
  const localBlockmap = localSetup + ".blockmap";

  /* 清单里的 sha512 必须就是本地产物的 sha512。
     只有名字对不上是 404；哈希对不上是「下载完校验失败」——两种都属于“发布了但没人更新成功”，
     而且都不会在打包阶段报错，只能靠这里拦。 */
  const ymlSha = (/^\s*sha512:\s*(.+)$/m.exec(yml) || [])[1];
  if (ymlSha && existsSync(localSetup)) {
    const actual = sha512Base64(localSetup);
    if (actual !== ymlSha.trim()) {
      console.error("latest.yml 里的 sha512 与本地产物不符（清单 " + ymlSha.trim().slice(0, 16) + "… / 实际 " + actual.slice(0, 16) + "…）。");
      console.error("同样说明 dist/ 是混的，先 npm run dist 重新出包。");
      return ["latest.yml"];
    }
  }

  const want = [];
  if (existsSync(localSetup)) want.push({ local: localSetup, name: remoteSetupName });
  if (existsSync(localBlockmap)) want.push({ local: localBlockmap, name: remoteSetupName + ".blockmap" });
  want.push({ local: ymlPath, name: "latest.yml" });

  const listed = spawnSync("gh", ["release", "view", tag, "--repo", REPO, "--json", "assets", "--jq", ".assets[].name"], { cwd: root, encoding: "utf8" });
  const have = new Set((listed.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean));
  const stillMissing = [];

  for (const w of want) {
    // latest.yml 是指针，必须上传最新的那份：同名旧文件留着就会被当成“已有”而跳过，
    // 结果客户端按旧清单去下旧版本（或对不上哈希）。二进制产物才是不可变的、可跳过的。
    const isPointer = w.name === "latest.yml";
    if (!isPointer && have.has(w.name)) {
      console.log("  已有   " + w.name);
      continue;
    }
    if (!existsSync(w.local)) {
      console.log("  ??    " + w.name + "（本地也没有，跳过）");
      stillMissing.push(w.name);
      continue;
    }
    // gh 上传后的资产名就是本地文件名，所以先复制成目标名再传
    const staged = join(root, "dist", w.name);
    if (staged !== w.local) copyFileSync(w.local, staged);
    const up = spawnSync("gh", ["release", "upload", tag, staged, "--repo", REPO, "--clobber"], { cwd: root, stdio: "inherit" });
    if (up.status === 0) {
      console.log("  补传   " + w.name);
    } else {
      console.error("  失败   " + w.name);
      stillMissing.push(w.name);
    }
  }
  return stillMissing;
}
