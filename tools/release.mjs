/*
 * 一键发布：盖章 → 出包（NSIS 安装版 + 免安装版）→ 上传到 GitHub Release。
 *
 *   npm run release
 *
 * 为什么要有它：
 *   发布是「版本号 + 安装包 + latest.yml + blockmap」四件套必须同时到位的事。
 *   少传一个 blockmap，差量更新就退化成全量下载；忘了改版本号，用户永远等不到更新。
 *   一步做完，就没得忘。
 *
 * 发布改用 gh 自己上传（不再让 electron-builder 发布：它两个 target 各跑一次发布，
 * 第二次撞 tag 已存在而中断，latest.yml 与 blockmap 常就丢在那一步）。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
/* 直接调 electron-builder 的 JS 入口，不调 npx/npm：
   Windows 上 Node 18.20+/20.12+ 已经禁止 spawn 一个 .cmd/.bat 而不带 shell（CVE-2024-27980），
   而带 shell 又要跟引号搏斗——走 js 入口最干净。 */
const BUILDER_CLI = join(root, "node_modules", "electron-builder", "cli.js");
const REPO = "lllvernan-blip/liantai-desktop";
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = "v" + pkg.version;
// --reconcile-only：只把 Release 上缺的资产补齐，不出包
const reconcileOnly = process.argv.indexOf("--reconcile-only") >= 0;

function step(title) {
  console.log("\n=== " + title + " ===");
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ cwd: root, stdio: "inherit", shell: false }, opts || {}));
  if (r.error) {
    console.error("无法执行 " + cmd + "：" + r.error.message);
    process.exit(1);
  }
  return r.status;
}

step("发布 v" + pkg.version);

// 1) 干净的工作区。允许有改动（发布常和提交一起做），但要说清楚打进去的是什么。
const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
if (dirty.status === 0 && dirty.stdout.trim()) {
  console.log("注意：工作区有未提交的改动，这一版会包含它们：");
  console.log(dirty.stdout.trim());
}

// 2) gh 登录状态（上传走 gh 自己的登录态，不需要手工配 GH_TOKEN）
const auth = spawnSync("gh", ["auth", "status"], { cwd: root, encoding: "utf8" });
if (auth.status !== 0) {
  console.error("gh 未登录。先跑 gh auth login。");
  process.exit(1);
}

// 3) tag 不能已存在
const exists = spawnSync("gh", ["release", "view", tag, "--repo", REPO, "--json", "tagName"], { cwd: root, encoding: "utf8" });
if (exists.status === 0 && !reconcileOnly) {
  console.error("GitHub 上已经有 " + tag + " 了。要发新版本，先把 package.json 里的 version 提高。");
  process.exit(1);
}

// 4) 盖章（版本号 + 构建时间写进 app/build.json）
// 只对账时不要盖章：那不是在建包，盖了只会让磁盘上的 build.json 跑到包内那份前面。
if (!reconcileOnly) {
  step("写构建标识");
  if (run(process.execPath, [join(here, "stamp-build.mjs")]) !== 0) process.exit(1);
}

// 5) 出包（不发布：--publish never）
/* 为什么不让 electron-builder 发布：它的 nsis / portable 两个 target 会各跑一次发布流程，
   第二次撞「tag_name already_exists」而中断，而 latest.yml 与 *.blockmap 常就丢在那一步——
   少了 latest.yml，自动更新压根不会启动。所以打包只用它，发布交给下面的 gh。 */
if (reconcileOnly) {
  console.log("\n跳过打包，只对账补齐。");
} else {
  step("出包（electron-builder --win nsis portable --publish never）");
  /* 组件源默认走 npmmirror：electron-builder 打包时要下 winCodeSign / nsis 这些组件，
     默认从 github.com 拉 —— 本机到 github.com 时通时断（实测 ETIMEDOUT 20.205.243.166:443）。
     外部（打包.bat 或环境变量）已经显式设置就尊重外部设置。 */
  const buildEnv = Object.assign({}, process.env);
  if (!buildEnv.ELECTRON_MIRROR) buildEnv.ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
  if (!buildEnv.ELECTRON_BUILDER_BINARIES_MIRROR) buildEnv.ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/";
  const status = run(process.execPath, [BUILDER_CLI, "--win", "nsis", "portable", "--publish", "never"], { env: buildEnv });
  if (status !== 0) {
    console.error("\n打包报错了（多半是组件下载超时：本机到 github.com 时通时断）。");
    console.error("先跑一次 tools/release.mjs 重试；还不行就查 %LOCALAPPDATA%\\electron-builder\\Cache 少了哪个组件。");
    console.error("下面先按现有产物对账（补不齐就停）。");
  }
}

/* 6) 确认 Release 存在 */
step("确认 Release " + tag);
if (!ensureRelease()) process.exit(1);

/* 7) 自己上传 + 对账：一次创建、逐个 --clobber 传，幂等可重跑，不依赖任何人返回码 */
step("上传并对账发布资产");
const missing = reconcileRelease();
if (missing.length) {
  console.error("发布资产仍不完整：" + missing.join("、") + "（自动更新会因为缺 latest.yml / blockmap 而不可用）");
  process.exit(1);
}

step("发布完成");
console.log(tag + "  ->  https://github.com/lllvernan-blip/liantai-desktop/releases/tag/" + tag);
console.log("装的用户下次启动就会在后台收到它（差量更新，只下载变化的部分）。");

function sha512Base64(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

/* 返回仍然缺的资产名（空数组 = 齐了）。
   注意名字：本地产物是中文名，上游要的是 latest.yml 里写的 ASCII 名，两套名字必须对上，
   对不上的话客户端会 404 —— 这正是最隐蔽的一种“更新装了但没人收得到”。 */
function reconcileRelease() {
  const ymlPath = join(root, "dist", "latest.yml");
  ensureLatestYml(ymlPath);   // 清单缺了/版本或哈希对不上，就按本地安装包重写（详见函数注释）
  if (!existsSync(ymlPath)) {
    console.error("没有 dist/latest.yml，无法对账（先在本地跑一次 npm run dist）。");
    return ["latest.yml"];
  }
  const yml = readFileSync(ymlPath, "utf8");

  /* 先确认这份清单就是当前版本的。
     踩过的坑：dist/ 里混着上一次试打包的 latest.yml，于是把 1.0.0 的包装成了 1.0.1 的名字传上去，
     客户端会拿到一个「版本号写着新版、内容却是旧版」的包。清单版本与 package.json 不符就直接停。 */
  const vMatch = /^version:\s*(.+)$/m.exec(yml);
  const ymlVersion = vMatch ? vMatch[1].trim().replace(/^['"]|['"]$/g, "") : "";
  if (ymlVersion !== pkg.version) {
    console.error("dist/latest.yml 是「" + (ymlVersion || "读不出") + "」的清单，package.json 是「" + pkg.version + "」。");
    console.error("dist/ 里混着上一次打包的残留 —— 先 npm run dist 重新出一次包再来发布。");
    return ["latest.yml"];
  }

  const m = /^path:\s*(.+)$/m.exec(yml) || /^\s*url:\s*(.+)$/m.exec(yml);
  if (!m) {
    console.error("latest.yml 里读不到产物名，无法对账。");
    return ["latest.yml"];
  }
  const remoteSetupName = m[1].trim();
  const localSetup = join(root, "dist", setupLocalName());
  const localBlockmap = localSetup + ".blockmap";

  /* 清单里的 sha512 必须就是本地产物的 sha512。
     只有名字对不上是 404；哈希对不上是「下载完校验失败」——两种都属于“发布了但没人更新成功”，
     而且都不会在打包阶段报错，只能靠这里拦。 */
  const ymlSha = (/^\s*sha512:\s*(.+)$/m.exec(yml) || [])[1];
  if (ymlSha && existsSync(localSetup)) {
    const actual = sha512Base64(localSetup);
    if (actual !== ymlSha.trim()) {
      console.error("latest.yml 里的 sha512 与本地产物不符（清单 " + ymlSha.trim().slice(0, 16) + "… / 实际 " + actual.slice(0, 16) + "…）。");
      console.error("同样说明 dist/ 是混的，先 npm run dist 重新出包。");
      return ["latest.yml"];
    }
  }

  const want = [];
  if (existsSync(localSetup)) want.push({ local: localSetup, name: remoteSetupName });
  if (existsSync(localBlockmap)) want.push({ local: localBlockmap, name: remoteSetupName + ".blockmap" });
  // 免安装版也要在 Release 上（README 两种形态都提供；少了它，用免安装版的人只能找到旧版）
  const portableLocal = join(root, "dist", portableLocalName());
  if (existsSync(portableLocal)) want.push({ local: portableLocal, name: pkg.name + "-" + pkg.version + ".exe" });
  want.push({ local: ymlPath, name: "latest.yml" });

  const listed = spawnSync("gh", ["release", "view", tag, "--repo", REPO, "--json", "assets", "--jq", ".assets[].name"], { cwd: root, encoding: "utf8" });
  const have = new Set((listed.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean));
  const stillMissing = [];

  for (const w of want) {
    // latest.yml 是指针，必须上传最新的那份：同名旧文件留着就会被当成“已有”而跳过，
    // 结果客户端按旧清单去下旧版本（或对不上哈希）。二进制产物才是不可变的、可跳过的。
    const isPointer = w.name === "latest.yml";
    if (!isPointer && have.has(w.name)) {
      console.log("  已有   " + w.name);
      continue;
    }
    if (!existsSync(w.local)) {
      console.log("  ??    " + w.name + "（本地也没有，跳过）");
      stillMissing.push(w.name);
      continue;
    }
    // gh 上传后的资产名就是本地文件名，所以先复制成目标名再传
    const staged = join(root, "dist", w.name);
    if (staged !== w.local) copyFileSync(w.local, staged);
    const up = spawnSync("gh", ["release", "upload", tag, staged, "--repo", REPO, "--clobber"], { cwd: root, stdio: "inherit" });
    if (up.status === 0) {
      console.log("  补传   " + w.name);
    } else {
      console.error("  失败   " + w.name);
      stillMissing.push(w.name);
    }
  }
  return stillMissing;
}

/* 本地产物名（中文，用户看着舒服）与 gh 上的资产名（ASCII，避免各种下载器乱码）是两套名字。
   上游 electron-builder 发布时会用 package name 替换产品名，所以我们按同样的规则推算。 */
function setupLocalName() {
  const tpl = (pkg.build && pkg.build.nsis && pkg.build.nsis.artifactName) || "练习台-Setup-${version}.exe";
  return tpl.replace("${version}", pkg.version);
}

function portableLocalName() {
  const tpl = (pkg.build && pkg.build.portable && pkg.build.portable.artifactName) || "练习台.exe";
  return tpl.replace("${version}", pkg.version);
}

/* dist/latest.yml 是「客户端该下哪个包、拿哪个哈希校验」的唯一指针。
   踩过的坑：dist/ 里混着上一次试打包的清单，于是拿旧版本号去对账，
   把 1.0.0 的安装包按 1.0.1 的名字传了上去（客户端表现为「版本号是新版、内容是旧版」或「下完校验失败」，
   而且都不会在打包阶段报错）。所以不猜也不信残留：缺失、或版本/哈希与本地产物不符，
   就按本地安装包的真实指纹重写一份。 */
function ensureLatestYml(ymlPath) {
  const localSetup = join(root, "dist", setupLocalName());
  if (!existsSync(localSetup)) return;   // 本地产物都没有，交给后面的对账去报缺
  const remoteSetupName = pkg.name + "-setup-" + pkg.version + ".exe";
  const sha = sha512Base64(localSetup);
  if (existsSync(ymlPath)) {
    const yml = readFileSync(ymlPath, "utf8");
    const v = (((/^version:\s*(.+)$/m.exec(yml) || [])[1]) || "").trim().replace(/^['"]|['"]$/g, "");
    const s = (((/^\s*sha512:\s*(.+)$/m.exec(yml) || [])[1]) || "").trim();
    if (v === pkg.version && s === sha) return;   // 就是当前这一版，别动它
    console.log("  dist/latest.yml 与当前产物不符（版本 " + (v || "?") + " / 哈希 " + (s ? s.slice(0, 12) + "…" : "?") + "），按本地安装包重写。");
  } else {
    console.log("  本地没有 dist/latest.yml，按本地安装包生成一份。");
  }
  const size = statSync(localSetup).size;
  const iso = new Date(statSync(localSetup).mtime).toISOString();
  const text =
    "version: " + pkg.version + "\n" +
    "files:\n" +
    "  - url: " + remoteSetupName + "\n" +
    "    sha512: " + sha + "\n" +
    "    size: " + size + "\n" +
    "path: " + remoteSetupName + "\n" +
    "sha512: " + sha + "\n" +
    "releaseDate: '" + iso + "'\n";
  writeFileSync(ymlPath, text, "utf8");
  console.log("  已写 dist/latest.yml：" + pkg.version + " / " + remoteSetupName + " / " + size + " bytes");
}

/* 确保 Release 存在：不存在就建（tag 指向刚推上去的提交），存在就复用。
   资产的上传由 reconcileRelease() 负责，两个函数都不依赖任何人的返回码。 */
function ensureRelease() {
  const view = spawnSync("gh", ["release", "view", tag, "--repo", REPO, "--json", "tagName"], { cwd: root, encoding: "utf8" });
  if (view.status === 0) {
    console.log("  Release " + tag + " 已存在，直接补资产");
    return true;
  }
  const notes = "自动更新已就绪：安装版在后台只下载变化的部分（差量），练习记录、画像、草稿、划线、Key 都不动。";
  const created = spawnSync(
    "gh",
    ["release", "create", tag, "--repo", REPO, "--title", pkg.version, "--notes", notes],
    { cwd: root, stdio: "inherit" }
  );
  if (created.status !== 0) {
    console.error("创建 Release 失败（网络不稳可重试；先确认 gh 已登录、tag 没被别的 Release 占用）。");
    return false;
  }
  return true;
}
