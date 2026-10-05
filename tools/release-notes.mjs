/*
 * Release 说明 —— 两个平台共用一个 Release，说明也就只有一份，所以两份一起写。
 *
 * Windows 的 Release 由 release.mjs 建、mac 的资产由 release-mac.mjs 补，谁先谁后都行；
 * 但「建 Release 时写的那段说明」只有一个地方能写。以前 Windows 这边写死一句只讲自己的话，
 * 下 mac 版的人就看不到安装指引（拖进「应用程序」、Gatekeeper 怎么过）。所以说明从这里出，
 * 两个脚本都取它——谁建 Release，看到的都是完整的一份。
 *
 * 写文案的规矩（跟界面同一套）：只写「这是干什么的」和用户要做的动作，
 * 不写内部机制（差量、sha512、后台静默这些一律不进），不写括号里的原因。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/* Windows 资产在线上叫 ASCII 名（本地那份中文名不带版本只在 dist/ 里） */
function windowsFile() {
  return "liantai-desktop-setup-" + pkg.version + ".exe";
}

/* mac 资产名从 package.json 的 artifactName 模板推出来，改模板或改 arch 都不用改这里 */
function macFile() {
  const mac = (pkg.build && pkg.build.mac) || {};
  const tpl = mac.artifactName || "${name}-${version}-${arch}.${ext}";
  const targets = Array.isArray(mac.target) ? mac.target : [];
  for (const t of targets) {
    const name = typeof t === "string" ? t : t.target;
    if (name !== "dmg") continue;
    const arch = (typeof t === "object" && t.arch && t.arch[0]) || "arm64";
    return tpl
      .replace("${name}", pkg.name)
      .replace("${version}", pkg.version)
      .replace("${arch}", arch)
      .replace("${ext}", "dmg");
  }
  return "";
}

export function releaseNotes() {
  return [
    "Windows（安装版）：下载 " + windowsFile() + "，双击打开，按提示装完就行。",
    "macOS（Apple 芯片 arm64）：下载 " + macFile() + "，双击打开，把「练习台」拖进「应用程序」。",
    "",
    "装过一次之后就不用再回来下载了：应用启动会自己问有没有新版，查到在首页出一条小提示，点「重启并更新」即可（macOS 上要先点一次「更新到 vX」让它自己下）。",
    "",
    "macOS 首次打开可能被 Gatekeeper 拦（这一版未做签名）：右键点「练习台」→「打开」→ 再点「打开」；还不行就在终端跑一次",
    "`xattr -dr com.apple.quarantine \"/Applications/练习台.app\"`。",
    "",
    "练习记录、画像、草稿、划线、API Key 都存在你自己的机器上，更新一个字节都不碰。",
  ].join("\n");
}
