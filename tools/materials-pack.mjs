#!/usr/bin/env node
/*
 * 材料发布：把 materials/pool/ 打成一个包、签名、发到 GitHub 的 materials Release。
 *
 *   node tools/materials-pack.mjs            打包 + 签名 + 自检 + 发布（--clobber，可重复跑）
 *   node tools/materials-pack.mjs --dry-run  只打包签名自检，不联网、不发
 *
 * 为什么单独发而不是随安装包：材料每次刷新都得重新打包发版太重，而材料的时效线是半年，
 * 它自己该有更新节奏。走的是一个固定 tag（materials）的 prerelease——不占 /releases/latest，
 * 不会干扰 Windows 的更新链（electron-updater 查的是 latest，prerelease 不占位）。
 *
 * 为什么签名：材料会进 prompt 影响出题，等于发布内容的一部分；光靠 GitHub 上的 sha256
 * 是自证的（元数据被改，地址与期望值一起改，校验必然过）。这里复用 mac 更新链那把发布私钥
 * （~/.liantai-release-key，见 tools/mac-key.mjs），应用侧用钉在 update.js 里的同名公钥验。
 * 自检那一步就是拿**钉住的那把公钥**验，不是拿本机私钥自己验自己——后者只能证明签名没打错，
 * 证明不了应用会不会收。
 *
 * 为什么要求 materials/ 干净：池子的审计面就是 git diff。工作区里躺着一份没提交的材料，
 * 发出去的包就对不上任何一个提交，等于把审计这一步绕过去了。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const req = createRequire(import.meta.url);
const APP = req(join(root, "app-meta.js"));
const { MAC_UPDATE_KEYS } = req(join(root, "update.js"));

const DRY = process.argv.includes("--dry-run");
const POOL = join(root, "materials", "pool");
const OUT_DIR = join(root, "dist-materials");
const PACK_NAME = "liantai-materials.json";
const TAG = "materials";
const SIG_SUFFIX = ".sig";
const MAX_ITEM_BYTES = 256 * 1024;   // 单篇上限：骨架是清单，不该有这么大；大了一定是搞错了
const MAX_PACK_BYTES = 4 * 1024 * 1024;
const NAME_OK = /^[A-Za-z0-9._-]+\.md$/;

function die(msg) { console.error("\n" + msg); process.exit(1); }
function note(s) { console.log("  " + s); }

let GH = "gh";
function resolveGh() {
  const onPath = spawnSync("gh", ["--version"], { encoding: "utf8" });
  if (!onPath.error && onPath.status === 0) return "gh";
  const local = join(homedir(), ".local", "opt", "gh", "bin", "gh");
  return existsSync(local) ? local : "";
}
function gh(args, opts) {
  return spawnSync(GH, args, Object.assign({ cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, opts || {}));
}
function git(args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim();
}

/* ---------- 1) 打包 ---------- */
if (!existsSync(POOL)) die("找不到池子目录：" + POOL);
const names = readdirSync(POOL).filter((f) => /[.]md$/.test(f)).sort();
if (!names.length) die("池子是空的（" + POOL + "）——空池子发出去只会让应用白拉一次。");

const items = [];
for (const name of names) {
  if (!NAME_OK.test(name)) die("池子里有个文件名不像骨架：" + name + "\n（只认 [A-Za-z0-9._-]+.md，应用侧也按这条校验）");
  const text = readFileSync(join(POOL, name), "utf8");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_ITEM_BYTES) die(name + " 有 " + bytes + " 字节，超过单篇上限 " + MAX_ITEM_BYTES + "——这是骨架，不该这么大");
  items.push({ name, text });
}

const pack = {
  v: 1,
  at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  git: git(["rev-parse", "HEAD"]).slice(0, 12),
  count: items.length,
  items,
};
const packText = JSON.stringify(pack);
if (Buffer.byteLength(packText, "utf8") > MAX_PACK_BYTES) die("整包超过 " + MAX_PACK_BYTES + " 字节——池子该分批发，别一次全塞进去。");

mkdirSync(OUT_DIR, { recursive: true });
const packPath = join(OUT_DIR, PACK_NAME);
writeFileSync(packPath, packText, "utf8");
const bytes = statSync(packPath).size;
console.log("已打包 materials/pool/（" + items.length + " 篇）");
note(packPath + "（" + bytes + " 字节）");
note("提交：" + pack.git + (git(["status", "--porcelain", "materials"]) ? "  ⚠ materials/ 有未提交的改动" : ""));

/* ---------- 2) 签名 ---------- */
const signed = spawnSync(process.execPath, [join(here, "mac-key.mjs"), "--sign", packPath], { cwd: root, stdio: "inherit" });
if (signed.status !== 0) die("签名失败，没发出去。");
const sigPath = packPath + SIG_SUFFIX;

/* ---------- 3) 自检：拿钉在应用里的公钥验一遍 ---------- */
/* 这一步不通过就绝不发布：签了但应用不认，等于发了一份用户永远收不到的东西。 */
const hashHex = createHash("sha256").update(readFileSync(packPath)).digest("hex");
const payload = Buffer.from(hashHex + " " + PACK_NAME, "utf8");
const sig = Buffer.from(readFileSync(sigPath, "utf8").trim(), "base64");
let accepted = false;
for (const pem of MAC_UPDATE_KEYS) {
  try {
    if (verify(null, payload, createPublicKey(pem), sig)) { accepted = true; break; }
  } catch (e) { /* 这把不行看下一把 */ }
}
if (!accepted) {
  die("这份包的签名，用 update.js 里钉住的公钥验不过——发出去应用也会拒收。\n" +
      "多半是这次签名用的私钥不是当初生成公钥的那一把（本机私钥：~/.liantai-release-key）。\n" +
      "核对：node tools/mac-key.mjs --pubkey，和 update.js 的 MAC_UPDATE_KEYS 比一比。");
}
note("自检通过：应用的公钥认这份签名。");

if (DRY) {
  console.log("\n--dry-run：没联网、没发布。产物在 " + OUT_DIR + "。");
  process.exit(0);
}

/* ---------- 4) 发布 ---------- */
GH = resolveGh();
if (!GH) die("本机没装 gh（也不在 ~/.local/opt/gh/bin）。材料发布走 gh 的登录态，装一个再跑。");
const who = gh(["auth", "status"]);
if (who.status !== 0) die("gh 未登录。先跑 gh auth login。");

/* materials/ 没提交就别发：审材料就是看 diff，工作区脏了这次发布就没有可审的对应物 */
const dirty = git(["status", "--porcelain", "materials"]);
if (dirty) die("materials/ 有没提交的改动，先提交再发：\n" + dirty + "\n（池子的审计面就是 git diff，这一步绕不过去。）");

const view = gh(["release", "view", TAG, "--repo", APP.slug]);
if (view.status === 0) {
  note("Release " + TAG + " 已存在，只换资产。");
} else {
  const made = gh(["release", "create", TAG, "--repo", APP.slug, "--prerelease",
    "--title", "材料池", "--notes", "出题用的材料骨架。应用自动取用，不用手动下载。"]);
  if (made.status !== 0) die("创建 Release " + TAG + " 失败：\n" + (made.stderr || ""));
  note("已创建 Release " + TAG + "（prerelease，不占 /releases/latest）。");
}

for (const f of [packPath, sigPath]) {
  const up = gh(["release", "upload", TAG, f, "--repo", APP.slug, "--clobber"]);
  if (up.status !== 0) die("上传 " + f + " 失败：\n" + (up.stderr || ""));
}
console.log("\n已发布 " + items.length + " 篇  ->  " + APP.releasesUrl + "/tag/" + TAG);
