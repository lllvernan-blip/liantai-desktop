/* 静态网页产物自检：先真跑构建，再核对交付文件、材料包与唯一的脚本注入。 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist-web");

const built = spawnSync(process.execPath, [join(root, "tools", "build-web.mjs")], {
  cwd: root,
  encoding: "utf8",
});
if (built.stdout) process.stdout.write(built.stdout);
if (built.stderr) process.stderr.write(built.stderr);
if (built.status !== 0) {
  console.error("静态网页构建失败" + (built.error ? "：" + built.error.message : "，退出码 " + built.status));
  process.exit(1);
}

const T = [];
const ok = (condition, message) => T.push((condition ? "PASS  " : "FAIL  ") + message);

const artifactNames = ["index.html", "pool-pick.js", "pool.json", "build.json"];
ok(artifactNames.every((name) => existsSync(join(dist, name))), "产物: dist-web 四件齐");

const poolPath = join(dist, "pool.json");
const poolSize = statSync(poolPath).size;
ok(poolSize <= 409600, "产物: pool.json 不超过 409600 B（当前 " + poolSize + " B）");

const pool = JSON.parse(readFileSync(poolPath, "utf8"));
const sourceNames = readdirSync(join(root, "materials", "pool")).filter((name) => /[.]md$/.test(name));
ok(pool.v === 1 && pool.count === sourceNames.length && Array.isArray(pool.items) && pool.items.length === sourceNames.length,
   "产物: items 数量与 materials/pool/*.md 一致（" + sourceNames.length + " 篇）");

const fields = ["name", "text", "topics", "media", "date", "sourceUrl"];
ok(pool.items.every((item) => item && Object.keys(item).length === fields.length
     && fields.every((key) => Object.prototype.hasOwnProperty.call(item, key))
     && typeof item.text === "string" && item.text.trim().length > 0),
   "产物: 每项六字段齐且 text 非空");

const require = createRequire(import.meta.url);
const { pickOne } = require(join(root, "pool-pick.js"));
const picks = [];
let pickError = null;
try {
  for (let i = 0; i < 45; i++) picks.push(pickOne(pool.items, [], undefined));
} catch (error) {
  pickError = error;
}
const itemNames = new Set(pool.items.map((item) => item.name));
ok(!pickError && picks.length === 45 && picks.every((pick) => pick && itemNames.has(pick.name)),
   "产物: pickOne 连取 45 次不抛错，name 都属于 items");
ok(new Set(picks.filter(Boolean).map((pick) => pick.name)).size >= 2,
   "产物: pickOne 连取 45 次至少出现两篇不同材料");

const appHtml = readFileSync(join(root, "app", "index.html"));
const webHtml = readFileSync(join(dist, "index.html"));
const injection = Buffer.from('<script src="pool-pick.js"></script>\n', "utf8");
const injectionAt = webHtml.indexOf(injection);
const stripped = injectionAt < 0 ? webHtml : Buffer.concat([
  webHtml.subarray(0, injectionAt),
  webHtml.subarray(injectionAt + injection.length),
]);
ok(injectionAt >= 0 && injectionAt === webHtml.lastIndexOf(injection) && stripped.equals(appHtml),
   "产物: 删除唯一注入行后与 app/index.html 逐字节相等");
const scriptSrcCount = (webHtml.toString("utf8").match(/<script src=/g) || []).length;
ok(scriptSrcCount === 1, "产物: <script src= 只出现一次（当前 " + scriptSrcCount + " 次）");

console.log(T.join("\n"));
const fails = T.filter((line) => line.startsWith("FAIL"));
console.log("\n== 产物 " + (T.length - fails.length) + "/" + T.length + " passed ==");
if (fails.length) process.exitCode = 1;
