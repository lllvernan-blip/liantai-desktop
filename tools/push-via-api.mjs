/*
 * 用 GitHub API 推提交 —— 给「github.com:443 被掐、但 api.github.com 还通」这种情况用。
 *
 *   node tools/push-via-api.mjs
 *
 * 什么时候需要它：`git push` 连的是 github.com，而国内网络经常只对 github.com 重置/超时；
 * 但 api.github.com 与 uploads.github.com 往往还是通的（`gh release upload` 就走这两个，
 * 所以「Release 传得上去、git push 推不上去」是常见组合，2026-09-18 实测就是这样）。
 *
 * 做法：把待推提交里变动的文件传成 blob → 组一棵树（base_tree 指向远端那棵树）→
 * 建一个提交 → 挪分支指针。作者、提交者、时间、提交信息全部照抄本地那份，
 * 所以 API 建出来的 commit sha 应当和本地逐字相同；真不一致会明确报出来
 * （内容仍然是对的，只是 sha 不同，这时 git fetch 后再对一次即可）。
 *
 * 只推快进：远端分支必须是本地历史的祖先，否则停手让你先合并/变基。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = "lllvernan-blip/liantai-desktop";
const BRANCH = "main";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  const r = spawnSync("git", args, { cwd: root, maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw new Error("跑不了 git：" + r.error.message);
  if (r.status !== 0) throw new Error("git " + args.join(" ") + " 失败：" + String(r.stderr || "").slice(0, 400));
  return r.stdout;
}
function gitText(args) {
  return git(args).toString("utf8");
}
function gh(args, input) {
  const r = spawnSync("gh", args, { cwd: root, encoding: "utf8", input, maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw new Error("跑不了 gh：" + r.error.message);
  if (r.status !== 0) throw new Error("gh " + args.slice(0, 3).join(" ") + " 失败：" + String(r.stderr || r.stdout || "").slice(0, 600));
  return (r.stdout || "").trim();
}
function api(method, path, body) {
  const args = ["api", "--method", method, path];
  if (body !== undefined) args.push("--input", "-");
  const out = gh(args, body === undefined ? undefined : JSON.stringify(body));
  return out ? JSON.parse(out) : {};
}

/* ---- 读本地提交对象：作者/提交者/时间/信息要一字不差地照抄 ---- */
function readCommit(sha) {
  const raw = gitText(["cat-file", "-p", sha]);
  const [head, ...rest] = raw.split("\n");
  const msgAt = raw.indexOf("\n\n");
  const headers = raw.slice(0, msgAt).split("\n");
  const message = raw.slice(msgAt + 2);
  const tree = (headers.find((l) => l.startsWith("tree ")) || "").slice(5).trim();
  const parents = headers.filter((l) => l.startsWith("parent ")).map((l) => l.slice(7).trim());
  const ident = (tag) => {
    const line = headers.find((l) => l.startsWith(tag + " "));
    if (!line) throw new Error("读不到 " + tag + " 行");
    const m = /^(\w+) (.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(line);
    if (!m) throw new Error("认不出的 " + tag + " 行：" + line);
    return { name: m[2], email: m[3], date: isoWithOffset(Number(m[4]), m[5]) };
  };
  return { tree, parents, message, author: ident("author"), committer: ident("committer") };
}

/* epoch + 偏移 -> 2026-09-18T16:26:40+08:00（ISO 8601 带偏移，GitHub 原样存） */
function isoWithOffset(epochSec, offset) {
  const sign = offset[0] === "-" ? -1 : 1;
  const offMin = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5)));
  const local = new Date((epochSec + offMin * 60) * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const stamp =
    local.getUTCFullYear() + "-" + p(local.getUTCMonth() + 1) + "-" + p(local.getUTCDate()) +
    "T" + p(local.getUTCHours()) + ":" + p(local.getUTCMinutes()) + ":" + p(local.getUTCSeconds());
  return stamp + offset.slice(0, 3) + ":" + offset.slice(3, 5);
}

/* 某个提交里某个路径的 mode 与 blob sha（相对仓库根的 posix 路径） */
function entryOf(commit, path) {
  const line = gitText(["-c", "core.quotepath=false", "ls-tree", commit, "--", path]).split("\n").filter(Boolean)[0];
  if (!line) throw new Error("ls-tree 读不到 " + commit + ":" + path);
  const m = /^(\d{6}) blob ([0-9a-f]{40})\t/.exec(line);
  if (!m) throw new Error("不是普通文件（符号链接/子模块？）：" + path + " -> " + line);
  return { mode: m[1], blob: m[2] };
}

const baseTreeOf = (sha) => readCommit(sha).tree;

function main() {
  const head = gitText(["rev-parse", "HEAD"]).trim();
  const remote = api("GET", "repos/" + REPO + "/git/ref/heads/" + BRANCH).object.sha;
  if (head === remote) {
    console.log("远端 " + BRANCH + " 已经和本地一致（" + head.slice(0, 7) + "），不用推。");
    return;
  }

  // 待推的提交链（从最老的开始）
  const chain = [];
  let cur = head;
  while (cur && cur !== remote) {
    chain.unshift(cur);
    const parents = readCommit(cur).parents;
    cur = parents[0] || "";
  }
  if (chain.length === 0) {
    console.error("远端 " + remote.slice(0, 7) + " 不在本地历史里（本地落后了？先 git pull）。");
    process.exit(1);
  }
  if (chain.length > 1) console.log("要推 " + chain.length + " 个提交。");
  if (cur !== remote) {
    console.error("远端 " + remote.slice(0, 7) + " 不是本地历史的祖先 —— 这条只能快进，先合并/变基再来。");
    process.exit(1);
  }

  let baseTree = baseTreeOf(remote);
  let last = "";
  let shaMismatch = false;

  for (const c of chain) {
    const info = readCommit(c);
    const parent = info.parents[0] || remote;
    /* -c core.quotepath=false：不然 git 会把中文文件名转义成 "\351\242\230..." 这种八进制串 */
    const status = gitText(["-c", "core.quotepath=false", "diff-tree", "-r", "--no-commit-id", "--name-status", "--no-renames", parent, c])
      .split("\n").filter(Boolean);

    const entries = [];
    for (const line of status) {
      const [kind, ...paths] = line.split("\t");
      const path = paths.join("\t");
      if (path.indexOf('"') === 0) throw new Error("带引号的路径名（特殊字符），这个工具没处理：" + path);
      if (kind[0] === "D") {
        entries.push({ path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      if (kind[0] !== "A" && kind[0] !== "M" && kind[0] !== "T") {
        throw new Error("没见过的变更类型：" + line);
      }
      const { mode, blob } = entryOf(c, path);
      const content = git(["cat-file", "blob", c + ":" + path]);
      const up = api("POST", "repos/" + REPO + "/git/blobs", {
        content: content.toString("base64"),
        encoding: "base64",
      });
      if (up.sha !== blob) {
        console.error("  !! " + path + " 传上去的 blob sha 和本地不一样（本地 " + blob.slice(0, 7) + " / 远端 " + String(up.sha).slice(0, 7) + "）");
        shaMismatch = true;
      }
      entries.push({ path, mode, type: "blob", sha: blob });
      console.log("  blob  " + path + "  (" + Math.round(content.length / 1024) + " KB)");
    }

    const tree = api("POST", "repos/" + REPO + "/git/trees", { base_tree: baseTree, tree: entries });
    if (tree.sha !== info.tree) {
      console.error("  !! 树 sha 不一致（本地 " + info.tree.slice(0, 7) + " / 远端 " + String(tree.sha).slice(0, 7) + "）");
      shaMismatch = true;
    }

    const commit = api("POST", "repos/" + REPO + "/git/commits", {
      message: info.message,
      tree: tree.sha,
      parents: [parent],
      author: info.author,
      committer: info.committer,
    });
    if (commit.sha !== c) {
      console.error("  !! 提交 sha 不一致（本地 " + c.slice(0, 7) + " / 远端 " + String(commit.sha).slice(0, 7) + "）");
      shaMismatch = true;
    }
    console.log("  提交  " + c.slice(0, 7) + "  " + info.message.split("\n")[0]);
    baseTree = tree.sha;
    last = commit.sha;
  }

  api("PATCH", "repos/" + REPO + "/git/refs/heads/" + BRANCH, { sha: last, force: false });
  console.log("\n已推：" + BRANCH + " -> " + last.slice(0, 7) + "  （https://github.com/" + REPO + "）");

  if (shaMismatch) {
    console.log("\n注意：远端 commit sha 和本地不同（内容一致，只是元数据有别）。本地说一句就能对齐：");
    console.log("  git fetch origin && git reset --hard origin/" + BRANCH);
  } else {
    console.log("本地与远端 sha 完全一致，下一次 git push 也不会打架。");
  }
}

main();
