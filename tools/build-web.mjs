#!/usr/bin/env node
/* 把单文件应用与材料池打成 GitHub Pages 可直接托管的纯静态产物。
 * 只用 Node 内置模块；--check 在内存里跑同一套构建，不创建目录、不写文件。 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "dist-web");
const checkOnly = process.argv.includes("--check");
const POOL_LIMIT = 400 * 1024;
const INJECT = '<script src="pool-pick.js"></script>\n';
const require = createRequire(import.meta.url);
const { parsePoolHead } = require(join(root, "pool-pick.js"));

function utf8(text) { return Buffer.from(text, "utf8"); }

function build() {
  const appHtml = readFileSync(join(root, "app", "index.html"), "utf8");
  const bodyAt = appHtml.lastIndexOf("</body>");
  if (bodyAt < 0) throw new Error("app/index.html 里没有 </body>，无法注入网页选材脚本。");
  const indexHtml = appHtml.slice(0, bodyAt) + INJECT + appHtml.slice(bodyAt);

  const pickerSource = readFileSync(join(root, "pool-pick.js"), "utf8");
  const pickerJs = pickerSource + (pickerSource.endsWith("\n") ? "" : "\n")
    + "window.poolPicker={pickOne,parsePoolHead,mediaName,sourceHost};\n";

  const poolDir = join(root, "materials", "pool");
  const names = readdirSync(poolDir).filter((name) => /[.]md$/.test(name)).sort();
  const items = names.map((name) => {
    const raw = readFileSync(join(poolDir, name));
    const head = parsePoolHead(raw.subarray(0, 400).toString("utf8"));
    return {
      name,
      text: raw.toString("utf8"),
      topics: head.topics,
      media: head.media,
      date: head.date,
      sourceUrl: head.sourceUrl,
    };
  });

  const builtAt = new Date().toISOString();
  const poolJson = JSON.stringify({ v: 1, at: builtAt, count: items.length, items });
  const poolBytes = utf8(poolJson);
  if (poolBytes.length > POOL_LIMIT) {
    throw new Error("pool.json 有 " + poolBytes.length + " 字节，超过材料整包上限 " + POOL_LIMIT + " 字节。");
  }

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const buildJson = JSON.stringify({ version: pkg.version, builtAt });
  return [
    ["index.html", utf8(indexHtml)],
    ["pool-pick.js", utf8(pickerJs)],
    ["pool.json", poolBytes],
    ["build.json", utf8(buildJson)],
  ];
}

const files = build();
for (const [name, data] of files) console.log(name + " " + data.length + " B");
if (checkOnly) {
  console.log("--check：四件产物已在内存生成并校验，未写入 dist-web/。");
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [name, data] of files) writeFileSync(join(outDir, name), data);
  console.log("已生成 dist-web/（" + files.length + " 个文件，pool.json 上限 " + POOL_LIMIT + " B）。");
}
