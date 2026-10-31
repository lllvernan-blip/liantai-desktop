/*
 * 文档里引用的仓内文件得真在：AGENTS.md / README.md / docs/*.md 一旦指向一个不存在的脚本，
 * 下一个人会照着敲一遍才发现。只看仓内的固定前缀，外链（http、/releases/…）不在此列。
 *
 * 发版对账（tools/release-check.mjs）与本地闭环（tools/loop.mjs）共用这一份：
 * 两边各写一套的话，迟早一个查得到、一个查不到。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PREFIXES = ["app/", "tests/", "tools/", "docs/", "build/", "site/", ".github/", ".qoder/"];
const ROOT_FILES = ["AGENTS.md", "README.md", "package.json", "main.js", "update.js", "打包.bat"];

export function checkDocRefs(root) {
  const files = ["AGENTS.md", "README.md",
    ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => "docs/" + f)];
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
  return { missing: [...missing], checked, files };
}
