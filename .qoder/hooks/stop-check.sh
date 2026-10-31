#!/bin/sh
# Qoder Stop 钩子的入口：找 node，再交给 tools/qoder-stop.mjs。
# 钩子的 PATH 不一定和终端一样，所以这里按 pre-commit 同一套路子退到自备路径。
set -u

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

NODE=""
if command -v node >/dev/null 2>&1; then
  NODE=$(command -v node)
else
  for p in "$HOME/.local/opt/node/bin/node" "/opt/homebrew/bin/node" "/usr/local/bin/node"; do
    if [ -x "$p" ]; then NODE="$p"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "[工程闭环] 找不到 node，这次跳过（装上 Node 后自动恢复）。" >&2
  exit 0
fi

exec "$NODE" tools/qoder-stop.mjs
