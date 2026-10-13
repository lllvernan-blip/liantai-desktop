/*
 * 打一个「测试副本」：与正式版并存、数据分家的那一个包。
 *
 * 起因（2026-10-13）：升级本身成了一次真实风险——0.0.20 撞上 load() 的 TDZ，
 * 装上去的人看到的是「记录全没了」。所以发版前要先有一个能安心用的测试形态，
 * 日常使一两天，确认没问题再发正式包。
 *
 * 它跟正式包差三处，其余完全一样：
 *   ① bundle id 与显示名带 test，Finder 里两个 app 不打架；
 *   ② 包内埋一个 app/build-test.json —— 壳看见它就把 userData 换成 "…-test"，
 *      于是测试版的设置、记录、草稿和正式版各走各的，互不打扰；
 *   ③ 不写发布源（publish 置空），包内没有 app-update.yml；壳在测试版里也不接更新链，
 *      免得自动更新把自己顶成正式版、被测的东西当场消失。
 *
 * 产物落在 dist-test/（与 dist/ 分开，不会被发布脚本顺手带上）。
 * ⚠ 那只 app 里读的是 app/ 目录和壳代码，测的正是工作区当前的样子；
 *   要让测试版反映某个提交，先把它落到工作区（提交或不提交都行）。
 *
 * 用法：
 *   node tools/build-test.mjs            出包（约 2 分钟）
 *   node tools/build-test.mjs --dry-run  只说要做什么，不打包
 */
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dryRun = process.argv.includes("--dry-run");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const FLAG = join(root, "app", "build-test.json");
const OUT = "dist-test";
const CONF = join(root, OUT, "electron-builder-test.json");
const BUILDER_CLI = join(root, "node_modules", ".bin", "electron-builder");

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ cwd: root, stdio: "inherit", shell: false }, opts || {}));
  return r.status === 0 ? 0 : (r.status === null ? 1 : r.status);
}

console.log("测试副本 · v" + pkg.version);

const conf = Object.assign({}, pkg.build, {
  appId: pkg.build.appId + ".test",
  productName: pkg.build.productName + " 测试",
  directories: Object.assign({}, pkg.build.directories, { output: OUT }),
  mac: Object.assign({}, pkg.build.mac, {
    artifactName: "liantai-desktop-${version}-${arch}-test.${ext}",
  }),
  /* 测试包不进发布链：包内不留 app-update.yml，也就没人会把它当成一版正式的。 */
  publish: null,
});

if (dryRun) {
  console.log("  （--dry-run：只说不做）");
  console.log("  会写   app/build-test.json     壳看见它就把 userData 换成 …-test");
  console.log("  会写   " + OUT + "/electron-builder-test.json");
  console.log("  会跑   electron-builder --mac --publish never --config " + CONF);
  console.log("  会删   app/build-test.json     打完就撤，工作区不留痕");
  console.log("\n  产物：" + OUT + "/练习台 测试-" + pkg.version + "-arm64.dmg，装它的是那只 app");
  process.exit(0);
}

if (!existsSync(BUILDER_CLI)) {
  console.error("没找到 electron-builder：" + BUILDER_CLI + "\n先 npm install。");
  process.exit(1);
}

/* ① 埋标记。它得在打包前就位，才能被 app/**\/* 收进 asar。 */
writeFileSync(FLAG, JSON.stringify({ test: true, version: pkg.version }, null, 2) + "\n", "utf8");
console.log("  埋好标记 app/build-test.json");

/* ② 配置。electron-builder 的 --config 是「整份替换 package.json 的 build 段」，
      所以上面那份是从 pkg.build 派生出来的、字段一个不少。
      目录要先建：配置写在产物目录里，而那个目录此刻还不存在。 */
mkdirSync(join(root, OUT), { recursive: true });
writeFileSync(CONF, JSON.stringify(conf, null, 2) + "\n", "utf8");
console.log("  写好 " + OUT + "/electron-builder-test.json");

/* ③ 打包。镜像兜底同 dist:mac —— 直连 github.com 拉 Electron 会超时。 */
const env = Object.assign({}, process.env);
if (!env.ELECTRON_MIRROR) env.ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
if (!env.ELECTRON_BUILDER_BINARIES_MIRROR) env.ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/";

const code = run(BUILDER_CLI, ["--mac", "--publish", "never", "--config", CONF], { env });

/* ④ 撤标记。失败也要撤：留在工作区里，下一次正式打包会把「测试版」这顶帽子扣到正式包上。 */
rmSync(FLAG, { force: true });
console.log("  撤掉标记 app/build-test.json");

if (code !== 0) {
  console.error("\n打包失败了。先看一眼 " + OUT + "/mac-arm64/ 有没有半成品，再重跑一次。");
  process.exit(code);
}

console.log("\n出好了。测试副本在 " + OUT + "/ ：");
console.log("  mac-arm64/练习台 测试.app   ← 直接双击就能开，与正式版并存");
console.log("  练习台 测试-" + pkg.version + "-arm64.dmg   ← 想装进 /Applications 就用它");
console.log("\n它读的是自己那份数据（~/Library/Application Support/liantai-desktop-test）。");
console.log("要把正式版的记录搬过来：正式版「设置 → 导出」，测试版「设置 → 导入」。");
