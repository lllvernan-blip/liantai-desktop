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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = "v" + pkg.version;

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
const exists = spawnSync("gh", ["release", "view", tag, "--json", "tagName"], { cwd: root, encoding: "utf8" });
if (exists.status === 0) {
  console.error("GitHub 上已经有 " + tag + " 了。要发新版本，先把 package.json 里的 version 提高。");
  process.exit(1);
}

// 4) 盖章（版本号 + 构建时间写进 app/build.json）
step("写构建标识");
if (run(process.execPath, [join(here, "stamp-build.mjs")]) !== 0) process.exit(1);

// 5) 出包并上传（--publish always：出完即传，包含 latest.yml 与 *.blockmap）
step("打包并上传（electron-builder --win nsis portable --publish always）");
const status = run(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["electron-builder", "--win", "nsis", "portable", "--publish", "always"],
  { env: Object.assign({}, process.env, { GH_TOKEN: token }) }
);
if (status !== 0) {
  console.error("\n打包/上传失败。常见原因：网络到 GitHub 不稳（重试即可）、electron-builder 组件下载失败（设 npmmirror 镜像）。");
  process.exit(status || 1);
}

step("发布完成");
console.log(tag + "  ->  https://github.com/lllvernan-blip/liantai-desktop/releases/tag/" + tag);
console.log("装的用户下次启动就会在后台收到它（差量更新，只下载变化的部分）。");
