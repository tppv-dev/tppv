#!/usr/bin/env bash
# tppv CLI — one-line installer (macOS / Linux / WSL / Git Bash)
#
#   curl -fsSL https://tppv.dev/cli/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/tppv-dev/tppv/main/packages/cli/install.sh | bash
#
set -euo pipefail

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: $1 is required. Install Node.js 18+ first: https://nodejs.org" >&2
    exit 1
  }
}

need node
need npm

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "error: Node.js 18+ required (found $(node -v))" >&2
  exit 1
fi

echo "→ Installing @tppv/cli"
if ! npm install -g @tppv/cli; then
  echo "error: npm install -g @tppv/cli failed" >&2
  echo "  From a local clone: npm install && npm exec -w @tppv/cli tppv -- --help" >&2
  exit 1
fi

echo ""
echo "✓ tppv installed"
echo "  Run:  tppv"
echo "  Help: tppv --help"
echo "  Site: https://tppv.dev"
echo ""
