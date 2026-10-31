/*
 * 装 / 卸工程闭环的 pre-commit 钩子。
 *
 *   npm run hooks:install           把本仓库的 core.hooksPath 指到 .githooks
 *   npm run hooks:install -- --remove   撤掉（不影响 .githooks 里的文件）
 *
 * 为什么不用默认的 .git/hooks：那个目录不进 Git，换台机器就没了；
 * .githooks 跟着仓库走，装的时候只改一条本地配置。
 *
 * 只改 core.hooksPath 这一项，不动别的 git 配置，也不改任何文件。
 * 不自动装：钩子会跑全量自检，什么时候让提交变慢该由人决定。
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const remove = process.argv.includes("--remove");

function git(args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) {
    const err = (r.stderr || "").trim().split("\n").filter(Boolean)[0] || "";
    console.error("git " + args.join(" ") + " 失败：" + err);
    process.exit(1);
  }
  return (r.stdout || "").trim();
}

const top = git(["rev-parse", "--show-toplevel"]);
if (top !== root) {
  console.error("这个脚本要在仓库根目录里跑（现在认到的根是 " + top + "）。");
  process.exit(1);
}

if (remove) {
  const cur = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" });
  if (cur.status !== 0 || (cur.stdout || "").trim() !== ".githooks") {
    console.log("  core.hooksPath 现在不是 .githooks（" + ((cur.stdout || "").trim() || "未设置") + "），没有可撤的。");
    process.exit(0);
  }
  git(["config", "--unset", "core.hooksPath"]);
  console.log("  已撤掉 pre-commit 钩子（.githooks/ 里的文件还在）。");
  process.exit(0);
}

const before = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" });
const old = (before.stdout || "").trim();
if (old && old !== ".githooks") {
  console.error("core.hooksPath 已经指向别处（" + old + "），先确认那边是什么再装；没有覆盖它。");
  process.exit(1);
}
if (!existsSync(join(root, ".githooks", "pre-commit"))) {
  console.error("找不到 .githooks/pre-commit；先把钩子文件取回来再装（装一条指向空目录的路径等于没装）。");
  process.exit(1);
}

git(["config", "core.hooksPath", ".githooks"]);
/* git 只认可执行的钩子；Windows 没有这一位，git 自己会调它。 */
if (process.platform !== "win32") chmodSync(join(root, ".githooks", "pre-commit"), 0o755);
console.log("  pre-commit 钩子已装：core.hooksPath = .githooks");
console.log("  下次 git commit 会先跑 node tools/loop.mjs --staged --quiet（约 5 秒）。");
console.log("  撤掉：npm run hooks:install -- --remove");
