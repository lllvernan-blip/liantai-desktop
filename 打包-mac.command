#!/bin/bash
# 双击即出 macOS 版（.dmg + .zip）——对应 Windows 上的 打包.bat。
#
# 用法：在访达里双击本文件。若提示「无法打开，因为它是未识别的开发者」，
# 右键 → 打开，或在终端里跑：chmod +x 打包-mac.command && ./打包-mac.command
#
# 注意：mac 版只能在 macOS 上打（electron-builder 的 mac target 要本机是 mac），
#       Windows 那边照旧用 打包.bat。

cd "$(dirname "$0")" || exit 1
set -o pipefail

echo
echo "  =============================================="
echo "   综应练习台 - 出 macOS 版"
echo "  =============================================="
echo

# 1) 找 Node：先看 PATH，再退回本机自备的那份（~/.local/opt/node，不动系统目录）
NODE_BIN=""
if command -v npm >/dev/null 2>&1; then
  NODE_BIN="$(dirname "$(command -v npm)")"
elif [ -x "$HOME/.local/opt/node/bin/npm" ]; then
  NODE_BIN="$HOME/.local/opt/node/bin"
fi
if [ -z "$NODE_BIN" ]; then
  echo "  [失败] 没找到 npm。先装 Node（20 以上），装完再跑一次。"
  echo "         或者把 Node 解到 ~/.local/opt/node/ 再跑（本文件认得这个位置）。"
  read -n 1 -s -r -p "  按任意键关闭…"
  exit 1
fi
export PATH="$NODE_BIN:$PATH"
echo "  用 Node：$(node -v)（$NODE_BIN）"
echo

# 2) 依赖（首次会装 electron，几百 MB，慢一次；之后很快）
if [ ! -d node_modules ]; then
  echo "  首次出包，先装依赖…"
  "$NODE_BIN/npm" install || { echo "  [失败] npm install 没成功。"; read -n 1 -s -r -p "  按任意键关闭…"; exit 1; }
  echo
fi

# 3) 图标：从 build/liantai-app-icon-v3.png 重做 icon.icns（macOS 的 1024 网格要留边距）
if command -v python3 >/dev/null 2>&1; then
  python3 tools/make-mac-icon.py || echo "  [提醒] 图标没重做成功，沿用已有的 build/icon.icns。"
  echo
fi

# 4) 出包
echo "  开始出包（首次会下载 Electron 的 mac 版，约 115MB）…"
echo
"$NODE_BIN/npm" run dist:mac || { echo; echo "  [失败] 出包没成功，把终端里的报错发给 Cola。"; read -n 1 -s -r -p "  按任意键关闭…"; exit 1; }

echo
echo "  完成，产物在 dist/（.dmg 双击装上；.zip 是同内容，给自动更新用的）"
open "dist"
read -n 1 -s -r -p "  按任意键关闭…"
