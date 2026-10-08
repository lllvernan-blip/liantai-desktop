#!/usr/bin/env node
/* 公开面体检：不许把对话搬进这个仓库。

   AGENTS.md 编辑纪律写着「提交说明只写描述性内容，不引用对话、不写『某人说』这类原话」，
   同样的道理对文件内容也成立——README、注释、AGENTS.md 都是公开面，写着「某人要求……」，
   一眼就是 AI 代笔。这条规矩靠记性守不住（写过好几轮，两次得重写历史 + 强推，第二次还动了
   已经发布的 tag），所以做成闸门：命中就退出码 1，列出是哪一笔提交 / 哪个文件、命中在哪一行。

   查两处：
     ① 提交说明——默认只查还没推上去的（origin/main..HEAD），推之前就能拦住
     ② 工作树里被 git 跟踪的文件（跳过本文件自己）
   用法：
     node tools/check-msg.mjs                查「还没推的提交 + 工作树文件」
     node tools/check-msg.mjs --all          提交说明改查当前分支的全部历史
     node tools/check-msg.mjs --rev <ref>    提交说明改查某个 ref 的可达历史（回溯用）
     node tools/check-msg.mjs --no-files     只查提交说明，不查文件

   主题行与正文分开查：漏过一次就是漏在主题行里（有一笔把转述写进了标题的括号里）。 */
import cp from "node:child_process";
import fs from "node:fs";

const argv = process.argv.slice(2);
const ALL = argv.includes("--all");
const NO_FILES = argv.includes("--no-files");
const revIdx = argv.indexOf("--rev");
const REV = revIdx >= 0 ? argv[revIdx + 1] : null;

/* 提交说明的命中表：一律按「聊天腔」的理由加，不加无关的词（宁少勿滥，跟取景器规则一个道理）。
   人名的写法各人不同，这份表按本仓库的实际情况维护。 */
const COMMIT_PATTERNS = [
  "阿楠", "楠哥", // 称呼本人
  "用户说", "用户要求", "用户觉得", "用户指出", "用户反馈",
  "他说", "她说", "我说", // 转述谁说了什么
  "原话", "你觉得", "你自己说", "我跟你", "咱们",
];

/* 文件用更窄的一张表：文件里会合法地引用外部材料的原话（比如题型规范里引出版方的说法），
   所以这里只查「称呼本人」与「转述谁说了什么」，不查「原话」这类中性词。 */
const FILE_PATTERNS = [
  "阿楠", "楠哥", "李西楠",
  "用户说", "用户要求", "用户觉得", "用户指出", "用户反馈",
  "他说", "她说", "你觉得", "你自己说", "咱们",
];

const SELF = "tools/check-msg.mjs"; // 本文件自己就是一张词表，跳过

function git(args) {
  return cp.execSync(`git ${args}`, { encoding: "utf8", maxBuffer: 1 << 28 });
}

function resolveRange() {
  if (ALL) return { range: "HEAD", label: "当前分支全部历史" };
  if (REV) return { range: REV, label: `ref ${REV} 的全部历史` };
  try {
    git("rev-parse --verify --quiet origin/main");
    return { range: "origin/main..HEAD", label: "还没推上去的提交（origin/main..HEAD）" };
  } catch {
    return { range: "-20 HEAD", label: "origin/main 不可用，退回最近 20 笔" };
  }
}

function firstHit(patterns, text) {
  for (const p of patterns) if (text.includes(p)) return p;
  return null;
}

/* ── ① 提交说明 ─────────────────────────────────────────────── */
const { range, label } = resolveRange();
const log = git(`log ${range} --format=%x01%h%x02%ad%x02%s%x02%b --date=short`);
const commits = log
  .split("\x01")
  .filter(Boolean)
  .map((chunk) => {
    const [h, date, subject, body = ""] = chunk.split("\x02");
    return { h, date, subject: subject.trim(), body };
  });

console.log(`① 提交说明：${label}（${commits.length} 笔）`);

const commitHits = [];
for (const c of commits) {
  const lines = [`主题行：${c.subject}`, ...c.body.split("\n").map((l) => `正文：${l.trim()}`)];
  for (const line of lines) {
    const word = firstHit(COMMIT_PATTERNS, line);
    if (word) commitHits.push({ ...c, line: line.slice(0, 110), word });
  }
}

if (!commitHits.length) {
  console.log("   ✔ 干净：没有聊天腔、没有转述谁说了什么。");
} else {
  console.log(`   ✘ ${commitHits.length} 处不像提交说明，像聊天记录搬了过来：\n`);
  for (const h of commitHits) {
    console.log(`      ${h.h} ${h.date} ${h.subject}`);
    console.log(`         命中「${h.word}」：${h.line}\n`);
  }
}

/* ── ② 工作树里的文件 ───────────────────────────────────────── */
const fileHits = [];
let scanned = 0;
if (!NO_FILES) {
  const files = git("ls-files").split("\n").filter(Boolean).filter((f) => f !== SELF);
  for (const f of files) {
    let text;
    try {
      if (fs.statSync(f).size > 2 * 1024 * 1024) continue;
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue; // 符号链接 / 读不到就算
    }
    if (text.includes("\u0000")) continue; // 二进制
    scanned++;
    text.split("\n").forEach((line, i) => {
      const word = firstHit(FILE_PATTERNS, line);
      if (word) fileHits.push({ file: f, line: i + 1, word, text: line.trim().slice(0, 110) });
    });
  }
  console.log(`\n② 工作树文件：${scanned} 个（跳过本文件）`);
  if (!fileHits.length) {
    console.log("   ✔ 干净：文档与注释里没有称呼本人、也没有转述谁说了什么。");
  } else {
    console.log(`   ✘ ${fileHits.length} 处：\n`);
    for (const h of fileHits) {
      console.log(`      ${h.file}:${h.line}  命中「${h.word}」`);
      console.log(`         ${h.text}\n`);
    }
  }
}

const total = commitHits.length + fileHits.length;
if (!total) {
  console.log("\n通过。");
  process.exit(0);
}
console.log("改成描述性写法：原来是什么样、现在是什么样、怎么验证的（AGENTS.md 编辑纪律那节）。");
console.log("提交说明已经推上去才发现，就得重写历史 + 强推——动的是公开历史，先问，别自己动手。");
process.exit(1);
