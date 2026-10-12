#!/usr/bin/env node
/*
 * mac 更新包的签名工具：给发布出去的 zip 配一份独立签名，应用侧验过才收。
 *
 * 为什么需要它（说清楚，不然以后看着像是多余的一步）：
 *   mac 链现在的完整性校验是「下载地址 + sha256 期望值都读同一份 Release 元数据」——
 *   元数据被改（账号被盗、有人拿 token 发了一版）时，两个值会一起被改，校验必然通过。
 *   签名用的是只有本机才有的私钥，GitHub 上没有、发布页上也推不出来：
 *   包被换过、签名对不上，应用就拒收（宁可先不更新）。
 *
 * 用法：
 *   node tools/mac-key.mjs --init              生成密钥对（私钥写 ~/.liantai-release-key，权限 600）
 *   node tools/mac-key.mjs --pubkey            打印公钥（钉进 update.js 的 MAC_UPDATE_KEYS）
 *   node tools/mac-key.mjs --sign dist/x.zip   给包签名，写 dist/x.zip.sig（npm run release:mac 会自动做）
 *   node tools/mac-key.mjs --verify dist/x.zip 拿公钥验一遍（发版前自检）
 *
 * 签名覆盖的内容由 update.js 的 macSigPayload() 定义——两边共用同一个函数，
 * 避免「工具签的和应用验的不是同一串」。改格式只需要改那一处。
 *
 * 私钥丢了怎么办：本轮已装上的版本会拒绝一切更新（它只认钉进去的那把公钥），
 * 手动下一次安装包即可恢复。要在不手动重装的前提下轮换，先把新公钥加进
 * update.js 的 MAC_UPDATE_KEYS 数组发一版（数组里允许多把），再用新私钥签下一版。
 */
import { createRequire } from "node:module";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/* 签名覆盖的内容与验证逻辑都从 update.js 取——单一实现，不靠两边各写一遍保持一致 */
const { macSigPayload } = createRequire(import.meta.url)(join(root, "update.js"));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : "";
};
const KEY_PATH = valueOf("--key") || join(homedir(), ".liantai-release-key");

function die(msg) {
  console.error("\n" + msg);
  process.exit(1);
}

function loadPrivate() {
  if (!existsSync(KEY_PATH)) {
    die("找不到签名私钥：" + KEY_PATH + "\n" +
        "这台机器上还没生成过的话，先跑一次：\n  node tools/mac-key.mjs --init\n" +
        "（密钥只在本机，不进仓库、不上传；换机器发版要把这个文件copy过去，或改用 --key 指到它。）");
  }
  let pem = "";
  try { pem = readFileSync(KEY_PATH, "utf8"); } catch (err) { die("私钥读不出来：" + ((err && err.message) || err)); }
  try { return createPrivateKey(pem); } catch (err) { die("私钥解析失败（文件被改坏了？）：" + ((err && err.message) || err)); }
}

function publicPemOf(priv) {
  return createPublicKey(priv).export({ type: "spki", format: "pem" }).trim();
}

/* 指纹：公钥 DER 的 sha256 前 16 位十六进制。人眼核对用，与 update.js 里钉的那把是不是同一把。
   参数可以是私钥、也可以是公钥对象（两处调用都有）。 */
function fingerprint(key) {
  const pub = (key && typeof key === "object" && key.type === "public") ? key : createPublicKey(key);
  return createHash("sha256").update(pub.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
}

function sha256Hex(file) {
  let buf = null;
  try { buf = readFileSync(file); } catch (err) { die("包读不出来：" + file + " :: " + ((err && err.message) || err)); }
  return createHash("sha256").update(buf).digest("hex");
}

function readSig(file) {
  const sigPath = file + ".sig";
  if (!existsSync(sigPath)) die("签名文件不在：" + sigPath);
  const raw = String(readFileSync(sigPath, "utf8") || "").trim();
  if (!/^[A-Za-z0-9+/=]{40,}$/.test(raw)) die("签名文件内容不像 base64：" + sigPath);
  return Buffer.from(raw, "base64");
}

function initKey() {
  if (existsSync(KEY_PATH) && !has("--force")) {
    die("已经有一把私钥了：" + KEY_PATH + "\n" +
        "换一把会让所有已装版本都用不了自动更新（它们只认旧公钥）——确实要换就加 --force，\n" +
        "并且先用旧公钥发一版「把新公钥也钉进去」的更新，再切新私钥。");
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(KEY_PATH, pem, { mode: 0o600 });
  try { chmodSync(KEY_PATH, 0o600); } catch (err) { /* 文件系统不支持就算了 */ }
  const pub = publicPemOf(privateKey);
  console.log("私钥已生成：" + KEY_PATH + "（权限 " + (statSync(KEY_PATH).mode & 0o777).toString(8) + "）");
  console.log("公钥指纹：" + fingerprint(pub));
  console.log("\n把这把公钥钉进 update.js 的 MAC_UPDATE_KEYS（整段替换）：\n");
  console.log('const MAC_UPDATE_KEYS = [`' + "\n" + pub + "\n`];");
  console.log("\n私钥不进仓库、不上传。丢了 = 已装版本只能手动重装一次。");
}

function doSign(file) {
  if (!file || !existsSync(file)) die("要签的包不存在：" + (file || "(没给路径)") + "\n用法：node tools/mac-key.mjs --sign dist/xxx.zip");
  const priv = loadPrivate();
  const payload = macSigPayload(sha256Hex(file), file.split("/").pop());
  const sig = sign(null, Buffer.from(payload, "utf8"), priv).toString("base64");
  writeFileSync(file + ".sig", sig + "\n");
  console.log("已签名：" + file + ".sig");
  console.log("  内容：" + payload);
  console.log("  指纹：" + fingerprint(priv));
  return payload;
}

function doVerify(file) {
  if (!file || !existsSync(file)) die("要验的包不存在：" + (file || "(没给路径)"));
  const priv = loadPrivate();
  const pub = createPublicKey(priv);
  const payload = macSigPayload(sha256Hex(file), file.split("/").pop());
  const sig = readSig(file);
  const good = verify(null, Buffer.from(payload, "utf8"), pub, sig);
  if (!good) die("签名验不过：" + file + "\n（这次签名用的不是 " + KEY_PATH + " 里那把私钥，或者包在签名之后被改过。）");
  console.log("签名验过：" + file + "（指纹 " + fingerprint(pub) + "）");
  return true;
}

/* 直接跑才进 CLI：这个文件也可能被 import（沿用同一套签名逻辑），那时不该执行任何命令 */
function main() {
  if (has("--init")) return initKey();
  if (has("--pubkey")) {
    const priv = loadPrivate();
    const pub = publicPemOf(priv);
    console.log(pub);
    console.log("\n指纹：" + fingerprint(pub));
    return;
  }
  if (has("--sign")) return doSign(valueOf("--sign"));
  if (has("--verify")) return doVerify(valueOf("--verify"));
  console.log("用法：");
  console.log("  node tools/mac-key.mjs --init               生成密钥对（私钥写 " + KEY_PATH + "）");
  console.log("  node tools/mac-key.mjs --pubkey             打印公钥（钉进 update.js）");
  console.log("  node tools/mac-key.mjs --sign <zip>         签名，写 <zip>.sig");
  console.log("  node tools/mac-key.mjs --verify <zip>       验签");
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

export { KEY_PATH, doSign, doVerify, loadPrivate, publicPemOf, fingerprint };
