/*
 * 写构建标识 app/build.json —— 由 `npm run dist` 在打包前自动调用。
 * 应用「设置」面板底部会显示版本号与构建时间，用来回答「我装的是不是新版 / 这是哪一版」。
 *
 * 为什么逻辑放在这里、而不是写进 打包.bat：
 *   打包.bat 是 GBK 编码（配合 chcp 936），用 UTF-8 的编辑器/工具去改会把里面的中文写坏。
 *   挂在 npm script 上，则不管你是双击 .bat 还是直接 npm run dist，都会盖到章，且一行 .bat 都不用动。
 *
 * 版本号取自 package.json（electron-builder 打包用的也是它，两边永远一致）；
 * 输出有意做成纯 ASCII + 手工格式化，不依赖系统区域设置（不靠 toLocaleString）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "app", "build.json");

const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

const d = new Date();
const p = (n) => String(n).padStart(2, "0");
const builtAt = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());

writeFileSync(out, JSON.stringify({ version: pkg.version, builtAt }, null, 2) + "\n", "utf8");
console.log("构建标识已写入 app/build.json -> v" + pkg.version + " " + builtAt);
