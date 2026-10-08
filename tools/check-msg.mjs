#!/usr/bin/env node
/* 提交说明体检：不许把对话搬进公开的提交历史。

   AGENTS.md 编辑纪律写着「提交说明只写描述性内容，不引用对话、不写『某人说』这类原话」——
   规矩靠记性守不住（写过两次，两次都得重写历史 + 强推，其中一次还动了已发布的 tag），
   所以做成闸门：提交前跑一次，命中就退出码 1 并列出是哪一笔、哪一行。

   范围：
     node tools/check-msg.mjs                默认只查还没推上去的（origin/main..HEAD）
     node tools/check-msg.mjs --all         查当前分支的全部历史
     node tools/check-msg.mjs --rev <ref>   查某个 ref 能到达的全部历史（回溯用，如 --rev refs/original/refs/heads/main）

   读的是「主题行 + 正文」，两处都查——有一次就是漏在主题行里没看见。
   人名的写法各人不同，这份表按本仓库的实际情况维护：命中表之外的说法不算漏网，
   但发现新写法就把词加进来，别靠眼睛。 */
import cp from "node:child_process";

const argv = process.argv.slice(2);
const ALL = argv.includes("--all");
const revIdx = argv.indexOf("--rev");
const REV = revIdx >= 0 ? argv[revIdx + 1] : null;

/* 命中表：一律按「聊天腔」的理由加，不加无关的词（宁少勿滥，跟取景器规则一个道理）。 */
const PATTERNS = [
  "阿楠", "楠哥", // 称呼本人
  "用户说", "用户要求", "用户觉得", "用户指出", "用户反馈",
  "他说", "她说", "我说", // 转述谁说了什么
  "原话", "你觉得", "你自己说", "我跟你", "咱们",
];

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

const { range, label } = resolveRange();
const log = git(`log ${range} --format=%x01%h%x02%ad%x02%s%x02%b --date=short`);
const commits = log
  .split("\x01")
  .filter(Boolean)
  .map((chunk) => {
    const [h, date, subject, body = ""] = chunk.split("\x02");
    return { h, date, subject: subject.trim(), body };
  });

console.log(`检查范围：${label}（${commits.length} 笔）`);

const hits = [];
for (const c of commits) {
  const lines = [`主题行：${c.subject}`, ...c.body.split("\n").map((l) => `正文：${l.trim()}`)];
  for (const line of lines) {
    for (const p of PATTERNS) {
      if (line.includes(p)) {
        hits.push({ ...c, line: line.slice(0, 110), word: p });
        break;
      }
    }
  }
}

if (!hits.length) {
  console.log("✔ 提交说明干净：没有聊天腔、没有转述谁说了什么。");
  process.exit(0);
}

console.log(`✘ ${hits.length} 处不像提交说明，像聊天记录搬了过来：\n`);
for (const h of hits) {
  console.log(`  ${h.h} ${h.date} ${h.subject}`);
  console.log(`     命中「${h.word}」：${h.line}\n`);
}
console.log("改成描述性写法：原来是什么样、现在是什么样、怎么验证的（AGENTS.md 编辑纪律那节）。");
console.log("已经推上去才发现，就得重写历史 + 强推——动的是公开历史，先问，别自己动手。");
process.exit(1);
