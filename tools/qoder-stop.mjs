/*
 * Qoder Stop 钩子的主体：任务结束时把工程闭环跑一遍。
 *
 *   .qoder/settings.json 里配到 Stop 事件；.qoder/hooks/stop-check.sh 负责找 node 再调它。
 *
 * 三件事让它不烦人：
 *   1. 工作区干净 —— 直接放行，不跑测试（问答类任务没有代价）。
 *   2. 同一份内容刚查过 —— 直接放行（stamp 写在 git 目录里，不进仓库）。
 *   3. 失败只拦一次 —— 退出码 2 把输出回给模型去修；同状态再停就不再重复拦（防死循环）。
 *      stdin 里带 stop_hook_active 时也直接放行，这是宿主自己的防重入信号。
 *
 * 它只做「检查并反馈」，不提交、不推送、不改文件（stamp 除外）。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* 宿主从 stdin 喂一段 JSON；没有就当作空对象，不阻塞。 */
let input = {};
try {
  const raw = readFileSync(0, "utf8");
  if (raw.trim()) input = JSON.parse(raw);
} catch (e) { input = {}; }
if (input && input.stop_hook_active) process.exit(0);

function git(args, opts) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input: opts && opts.input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/* 干净工作区：没有可检查的改动，直接放行（也避免每次问答都等 5 秒）。 */
const status = git(["status", "--porcelain"]);
if (status.status !== 0 || !(status.stdout || "").trim()) process.exit(0);

/* 同一份内容只查一次：diff 盖住已跟踪文件的增删改，untracked 文件按内容哈希。
   只看 `git status` 的文件名不够——同一个文件再改一次，名字不变。 */
const diff = git(["diff", "HEAD", "--binary"]);
let diffText = "";
if (diff.status === 0) {
  diffText = diff.stdout || "";
} else {
  /* 还没有第一个提交时 HEAD 不存在：退回两边分开取。 */
  diffText = (git(["diff", "--binary"]).stdout || "") + (git(["diff", "--cached", "--binary"]).stdout || "");
}
const untracked = git(["ls-files", "-z", "-o", "--exclude-standard"]);
const untrackedPaths = (untracked.stdout || "").split("\u0000").filter(Boolean);
let untrackedHash = "";
if (untrackedPaths.length) {
  const h = git(["hash-object", "--stdin-paths"], { input: untrackedPaths.join("\n") + "\n" });
  if (h.status === 0) untrackedHash = h.stdout || "";
}
const state = createHash("sha256").update(diffText + "\n" + untrackedHash).digest("hex");

const gitDirRaw = (git(["rev-parse", "--git-dir"]).stdout || ".git").trim();
const stampPath = join(root, gitDirRaw, "liantai-loop-stamp.json");
let stamp = null;
try { stamp = JSON.parse(readFileSync(stampPath, "utf8")); } catch (e) { stamp = null; }
if (stamp && stamp.state === state) process.exit(0);

const run = spawnSync(process.execPath, [join(root, "tools", "loop.mjs"), "--quiet"], {
  cwd: root,
  encoding: "utf8",
  timeout: 300000,   // 不得短于 loop 里最重一阶段的自身上限（全量自检 180s + 布局 180s 的常态余量）；110s 曾会把还在跑的自检误杀成失败
  maxBuffer: 64 * 1024 * 1024,
});
const out = ((run.stdout || "") + (run.stderr || "")).trim();

if (run.status === 0) {
  try { writeFileSync(stampPath, JSON.stringify({ state, ok: true, at: Date.now() }) + "\n"); } catch (e) { /* 只影响下一次是否重跑 */ }
  const last = out.split("\n").filter(Boolean).pop() || "工程闭环通过";
  console.log("[工程闭环] " + last.trim());
  process.exit(0);
}

/* 失败：先落 stamp，再以 2 退出——同状态不会再拦第二次，改动了才会重新查。 */
try { writeFileSync(stampPath, JSON.stringify({ state, ok: false, at: Date.now() }) + "\n"); } catch (e) { /* 同上 */ }
console.error("[工程闭环] 没过，先修再交付：\n" + (out || (run.error && run.error.message) || "loop 没有输出").slice(0, 6000));
process.exit(2);
