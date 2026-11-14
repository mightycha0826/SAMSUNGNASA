#!/usr/bin/env bash
# Build B's web app into web/dist so the hub serves it at https://<Jetson>:8443/.
#   tools/build_web.sh          # npm install + npm run build
#   tools/build_web.sh --pull   # git pull first
# Uses the system Node.js if it is 20.19+; otherwise downloads Node 22 into .tools/.
# Restart the hub afterwards if it was started before web/dist existed.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$PWD/.tools
ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)'; }
if ! ok; then
  export PATH=$T/node/bin:$PATH
  if ! ok; then
    case "$(uname -m)" in aarch64) A=arm64 ;; x86_64) A=x64 ;; *) echo "unknown arch"; exit 1 ;; esac
    V=$(curl -fsS https://nodejs.org/dist/index.json | python3 -c "import json,sys;print(next(r['version'] for r in json.load(sys.stdin) if r['lts'] and r['version'].startswith('v22')))")
    mkdir -p "$T"
    curl -fL "https://nodejs.org/dist/$V/node-$V-linux-$A.tar.xz" | tar xJ -C "$T"
    ln -sfn "node-$V-linux-$A" "$T/node"
  fi
fi
[ "${1:-}" = "--pull" ] && git pull --ff-only
cd ../web
npm install --no-audit --no-fund
npm run build
echo "built $(pwd)/dist"
