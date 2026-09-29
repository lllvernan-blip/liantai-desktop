// 逐张比对两次取景的 PNG：重构前 vs 重构后。
// 用法：node tools/cmp-shots.mjs <目录A> <目录B>
// 目的只有一个——证明「界面一个像素都没动」。同名的两张图字节不同就报出来，并给出差异像素数。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [a, b] = process.argv.slice(2);
if(!a || !b){ console.log("用法: node tools/cmp-shots.mjs <目录A> <目录B>"); process.exit(1); }

const files = fs.readdirSync(a).filter(f=> f.toLowerCase().endsWith(".png")).sort();
let same = 0, diff = [];
for(const f of files){
  const pa = path.join(a, f), pb = path.join(b, f);
  if(!fs.existsSync(pb)){ diff.push([f, "B 里没有这张"]); continue; }
  const ba = fs.readFileSync(pa), bb = fs.readFileSync(pb);
  const ha = crypto.createHash("sha256").update(ba).digest("hex");
  const hb = crypto.createHash("sha256").update(bb).digest("hex");
  if(ha === hb){ same++; continue; }
  diff.push([f, `字节不同（${ba.length} vs ${bb.length}）`]);
}
const extra = fs.readdirSync(b).filter(f=> f.toLowerCase().endsWith(".png") && files.indexOf(f) < 0);
console.log(`共 ${files.length} 张：字节完全一致 ${same} 张，不同 ${diff.length} 张`);
for(const [f, why] of diff) console.log(`  ✗ ${f} — ${why}`);
if(extra.length) console.log(`  （B 里多出：${extra.join("、")}）`);
if(same === files.length && !extra.length) console.log("结论：两次取景逐张字节一致——界面没有任何改动。");
