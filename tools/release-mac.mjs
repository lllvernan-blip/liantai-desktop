/*
 * mac 侧发布：盖章 → 出包（dmg + zip）→ 把 mac 资产补到同一个 Release 上。
 *
 *   npm run release:mac                  出包 + 上传 + 对账
 *   npm run release:mac -- --dry-run     只看会传哪些东西，不打包、不联网
 *   npm run release:mac -- --skip-build  不出包，直接传 dist/ 现有的
 *   npm run release:mac -- --create --prerelease   单独发 mac（不碰 Windows 的 /releases/latest）
 *
 * 为什么不是「一条命令发两个平台」：
 *   mac 包只能在 mac 上打（--mac 要求本机是 mac，dmg 还要 hdiutil），win 包只能在 Windows 上打
 *   （那边有 winCodeSign / nsis 那套组件的既有链路）。所以发布是「两边认同一个 tag」：
 *     ① Windows： npm run release        → 建 Release + 传 win 三件套（latest.yml / exe / blockmap）
 *     ② 这台 mac：npm run release:mac    → 把 mac 四件套补到同一个 Release 上
 *   顺序反了也没事（tag 是同一个），只是下面第 1 条约束会提醒你。
 *
 * 两条约束（都不是洁癖）：
 *   1) **默认不自己建 Release**。Windows 的自动更新读的是
 *      https://github.com/<owner>/<repo>/releases/latest/download/latest.yml ——
 *      而 GitHub 的 /releases/latest 指的是「最新的那个非 prerelease Release」。mac 单发要是把它占住了、
 *      那个 Release 里又没有 latest.yml，Windows 用户的检查更新就会 404（备用源也一样 404，它们转发的就是同一个地址）。
 *      所以 mac 侧只往已存在的 Release 补资产；真要单发 mac，用 --create --prerelease：
 *      prerelease 不会被 /releases/latest 选中，Windows 那边照旧。
 *   2) **不信返回码**：传完按产物逐个对账，缺谁报谁；latest-mac.yml 是「指针」，永远覆盖传
 *      （同名旧文件留着会被当成「已有」而跳过，客户端就会拿到旧清单）。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
/* 和 release.mjs 一样直接调 electron-builder 的 JS 入口：不经过 npm/npx 这层壳 */
const BUILDER_CLI = join(root, "node_modules", "electron-builder", "cli.js");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = "v" + pkg.version;
const publish = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};
const REPO = publish.owner && publish.repo ? publish.owner + "/" + publish.repo : "";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const skipBuild = argv.includes("--skip-build") || dryRun;
const create = argv.includes("--create");
const prerelease = argv.includes("--prerelease");
const force = argv.includes("--force");

const DIST = join(root, "dist");
const YML = join(DIST, "latest-mac.yml");

function step(title) {
  console.log("\n=== " + title + " ===");
}

function run(cmd, cmdArgs, opts) {
  const r = spawnSync(cmd, cmdArgs, Object.assign({ cwd: root, stdio: "inherit", shell: false }, opts || {}));
  if (r.error) {
    console.error("无法执行 " + cmd + "：" + r.error.message);
    process.exit(1);
  }
  return r.status;
}

function gh(ghArgs) {
  return spawnSync(GH, ghArgs, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/* gh 只装在自备位置的可能（这台 mac 上没有 Homebrew、系统里本来也没 gh）：
   先看 PATH，再退到 ~/.local/opt/gh/bin/gh —— 与 打包-mac.command 找 npm 的路子一致。 */
let GH = "gh";
function resolveGh() {
  const onPath = spawnSync("gh", ["--version"], { encoding: "utf8" });
  if (!onPath.error && onPath.status === 0) return "gh";
  const local = join(homedir(), ".local", "opt", "gh", "bin", "gh");
  return existsSync(local) ? local : "";
}

function die(msg) {
  console.error("\n" + msg);
  process.exit(1);
}

/* 发布说明：给下载的人看的，先说下哪个文件、再说首次打开会被拦怎么办。
   备份文件不含 Key、练习记录在用户数据目录这两件事也写上一句，免得人家以为换版本要重填。 */
function notes() {
  const names = macArtifacts().filter((a) => a.target === "dmg").map((a) => a.file);
  return [
    "macOS 版（Apple 芯片 arm64）：下载 " + (names[0] || "dmg") + "，双击打开，把「练习台」拖进「应用程序」。",
    "",
    "首次打开可能被 Gatekeeper 拦（这一版未做签名）：右键点「练习台」→「打开」→ 再点「打开」；还不行就在终端跑一次",
    "`xattr -dr com.apple.quarantine \"/Applications/练习台.app\"`。",
    "",
    "装上这一版之后就不用再回来下载了：应用启动会自己问有没有新版，查到在首页出一条小提示，点「更新到 vX」它自己下（带 sha256 校验）、再点「重启并更新」换包重启。",
    "（比这更早的版本还没接上这条链，得手动装一次这一版。）练习记录、画像、草稿、划线、API Key 都在用户数据目录（~/Library/Application Support/liantai-desktop）里，更新不碰它们。",
  ].join("\n");
}

/* 产物名从 package.json 的 artifactName 模板推出来（改模板/改 arch 都不用改这里） */
function macArtifacts() {
  const mac = (pkg.build && pkg.build.mac) || {};
  const tpl = mac.artifactName || "${name}-${version}-${arch}.${ext}";
  const targets = Array.isArray(mac.target) ? mac.target : [];
  const extOf = { dmg: "dmg", zip: "zip" };
  const out = [];
  for (const t of targets) {
    const name = typeof t === "string" ? t : t.target;
    if (!extOf[name]) continue;                       // pkg / mas 这类先不管，本项目只出 dmg 与 zip
    const arches = (typeof t === "object" && t.arch) || ["arm64"];
    for (const a of arches) {
      out.push({
        target: name,
        arch: a,
        file: tpl
          .replace("${name}", pkg.name)
          .replace("${version}", pkg.version)
          .replace("${arch}", a)
          .replace("${ext}", extOf[name]),
      });
    }
  }
  return out;
}

function sha512Base64(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

/* 要传的东西：dmg + zip + 各自 blockmap（将来做差量更新用）+ latest-mac.yml（指针）= 五件。
   踩过的坑（2026-10-05）：这里原先只补 zip 的 blockmap，漏了 dmg 的——dmg.blockmap 是上一版手工传上去的，
   于是脚本自己跑一遍反而会把一个「少一件」的 Release 说成发布完成，而 release-check 那边要求 dmg.blockmap 齐全，
   两边对不上。现在按「本地产物有什么 blockmap 就传什么」，不再按 target 挑。 */
function wantedAssets() {
  const list = [];
  for (const a of macArtifacts()) list.push({ path: join(DIST, a.file), name: a.file, pointer: false });
  for (const a of macArtifacts()) {
    const bm = join(DIST, a.file + ".blockmap");
    if (existsSync(bm)) list.push({ path: bm, name: a.file + ".blockmap", pointer: false });
  }
  list.push({ path: YML, name: "latest-mac.yml", pointer: true });
  return list;
}

/* latest-mac.yml 是「客户端该下哪个包、拿哪个哈希校验」的指针，必须就是当前这一版、且哈希对得上本地产物。
   踩过的坑（win 侧同样）：dist/ 里混着上一次试打包的清单，于是把旧版本的包按新版名字传上去，
   客户端表现为「版本号写着新版、内容是旧版」或「下完校验失败」——两种都不会在打包阶段报错。 */
function checkYml() {
  if (!existsSync(YML)) die("没有 dist/latest-mac.yml：先 npm run dist:mac 出一次包（或别加 --skip-build）。");
  const text = readFileSync(YML, "utf8");
  const v = (((/^version:\s*(.+)$/m.exec(text) || [])[1]) || "").trim().replace(/^['"]|['"]$/g, "");
  if (v !== pkg.version) {
    die("dist/latest-mac.yml 是「" + (v || "读不出") + "」的清单，package.json 是「" + pkg.version + "」。\n" +
        "dist/ 里混着上一次打包的残留 —— 先 npm run dist:mac 重新出一次包。");
  }
  const problems = [];
  for (const a of macArtifacts()) {
    const local = join(DIST, a.file);
    if (!existsSync(local)) { problems.push(a.file + "（本地没有）"); continue; }
    const m = new RegExp("- url: " + a.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\n\\s+sha512: (.+)");
    const ymlSha = (m.exec(text) || [])[1];
    if (!ymlSha) { problems.push(a.file + "（清单里没列）"); continue; }
    const actual = sha512Base64(local);
    if (actual !== ymlSha.trim()) problems.push(a.file + "（清单 " + ymlSha.trim().slice(0, 16) + "… / 实际 " + actual.slice(0, 16) + "…）");
  }
  if (problems.length) {
    die("latest-mac.yml 与本地产物对不上：\n  - " + problems.join("\n  - ") + "\n先 npm run dist:mac 重新出包再来发布。");
  }
}

function main() {
  console.log("mac 侧发布 · " + tag + " · " + (REPO || "(package.json 里没配 build.publish)"));
  if (!REPO) die("package.json 的 build.publish 里没有 owner/repo，不知道该发到哪儿。");

  step("检查本地产物与清单");
  checkYml();
  const want = wantedAssets();
  for (const w of want) {
    const ok = existsSync(w.path);
    const size = ok ? statSync(w.path).size : 0;
    console.log("  " + (ok ? "就绪" : "缺  ") + "  " + w.name + (ok ? "  " + (size / 1048576).toFixed(1) + "MB" : ""));
  }
  GH = resolveGh() || "gh";

  if (dryRun) {
    step("（--dry-run：不打包、不联网、不校验 gh 登录态）");
    console.log("  会执行的命令：");
    console.log("    " + GH + " release view " + tag + " --repo " + REPO + " --json tagName,isPrerelease,assets");
    for (const w of want) console.log("    " + GH + " release upload " + tag + " dist/" + w.name + " --repo " + REPO + (w.pointer || force ? " --clobber" : ""));
    console.log("\n  提示：真要发之前先确认这个 tag 已在 Windows 上跑过 npm run release（建 Release + win 三件套）。");
    return;
  }

  if (!skipBuild) {
    step("写构建标识 + 出包（electron-builder --mac --publish never）");
    if (run(process.execPath, [join(here, "stamp-build.mjs")]) !== 0) die("盖章失败。");
    /* 组件源兜底：electron-builder 默认从 github.com 拉 Electron，本机到那里超时（实测 connect ETIMEDOUT）。
       外部已经显式设置就尊重外部设置。 */
    const buildEnv = Object.assign({}, process.env);
    if (!buildEnv.ELECTRON_MIRROR) buildEnv.ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
    if (!buildEnv.ELECTRON_BUILDER_BINARIES_MIRROR) buildEnv.ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/";
    if (run(process.execPath, [BUILDER_CLI, "--mac", "--publish", "never"], { env: buildEnv }) !== 0) {
      die("打包报错了。先重跑一次；还不行就查 dist/ 里有没有 mac-arm64.tmp 残留。");
    }
    checkYml();   // 刚出的包再核一遍：这一遍才是真正要传的东西
  } else {
    console.log("\n（--skip-build：用 dist/ 现有的产物传）");
  }

  step("gh 登录态与 Release " + tag);
  const auth = gh(["auth", "status"]);
  if (auth.status !== 0) {
    die("gh 未登录（或本机没装）。先在这台 mac 上跑一次：\n  " + GH + " auth login\n" +
        "（选 GitHub.com → HTTPS → 用浏览器登录；登录态存在钥匙串里，以后不用再登。）");
  }
  let info = null;
  const view = gh(["release", "view", tag, "--repo", REPO, "--json", "tagName,isPrerelease,assets"]);
  if (view.status === 0) {
    try { info = JSON.parse(view.stdout); } catch (err) { info = null; }
  }
  if (!info) {
    if (!create) {
      die("GitHub 上还没有 Release " + tag + "。\n" +
          "正常情况下它该由 Windows 那边的 npm run release 建出来（连同 win 三件套）。\n" +
          "确实只发 mac 的话，加 --create --prerelease：\n" +
          "  npm run release:mac -- --create --prerelease");
    }
    const created = gh(["release", "create", tag, "--repo", REPO, "--title", pkg.version,
      "--notes", notes(),
      prerelease ? "--prerelease" : "--latest"]);
    if (created.status !== 0) die("创建 Release 失败（重试；先确认 gh 已登录、tag 没被别的 Release 占用）。");
    console.log("  已创建 Release " + tag + (prerelease ? "（prerelease：不会占用 /releases/latest）" : ""));
    info = { assets: [], isPrerelease: prerelease };
  } else {
    const names = (info.assets || []).map((a) => a.name);
    console.log("  Release " + tag + " 已存在，现有资产 " + names.length + " 个" + (info.isPrerelease ? "（prerelease）" : ""));
    if (!info.isPrerelease && names.indexOf("latest.yml") < 0) {
      /* 这是最要命的一种组合：它是最新的非 prerelease Release，却没有 win 的清单 */
      console.error("\n  [警告] 这个 Release 里没有 win 的 latest.yml，而它不是 prerelease ——");
      console.error("         Windows 用户的 /releases/latest/download/latest.yml 会 404（检查更新直接失败）。");
      console.error("         办法：在 Windows 上补跑 npm run release，或者下次用 --create --prerelease 单独发 mac。");
    }
  }

  step("上传并对账");
  const have = new Set(((info && info.assets) || []).map((a) => a.name));
  const missing = [];
  for (const w of want) {
    /* latest-mac.yml 是指针，必须永远覆盖传；二进制产物是不可变的，已经有了就跳过（省一次 100MB 上传） */
    if (!w.pointer && !force && have.has(w.name)) {
      console.log("  已有   " + w.name);
      continue;
    }
    if (!existsSync(w.path)) { console.log("  ??    " + w.name + "（本地也没有，跳过）"); missing.push(w.name); continue; }
    const up = gh(["release", "upload", tag, w.path, "--repo", REPO, "--clobber"]);
    if (up.status === 0) console.log("  已传   " + w.name);
    else { console.error("  失败   " + w.name + " :: " + String(up.stderr || "").trim().slice(0, 200)); missing.push(w.name); }
  }

  const after = gh(["release", "view", tag, "--repo", REPO, "--json", "assets", "--jq", ".assets[].name"]);
  const nowHave = new Set((after.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean));
  const stillMissing = want.filter((w) => !nowHave.has(w.name)).map((w) => w.name);
  if (stillMissing.length) {
    die("发布资产仍不完整：" + stillMissing.join("、") + "\n（对账以 GitHub 上的实际列表为准，不看上传命令的返回码。）");
  }

  step("发布完成");
  console.log(tag + "  ->  https://github.com/" + REPO + "/releases/tag/" + tag);
  console.log("mac 版更新由应用自己实现（未签名，走不了系统那套）：装过这一版之后就能在应用里一键更新，不必再回来下 dmg。");
  console.log("这一版还有 Windows 那一半（在 Windows 上 npm run release）；两边都传完用 npm run release:check 看整个 Release 齐不齐。");
}

main();
