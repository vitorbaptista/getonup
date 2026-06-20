#!/usr/bin/env sh
# getonup CLI installer.
#
#   From a cloned repo:   ./install.sh
#   (once published):     npm i -g getonup    # or: npx getonup
#
# Builds the CLI from this checkout and symlinks the `getonup` binary into ~/.local/bin (override
# with GETONUP_PREFIX). Sub-commands like `up`/`ls` live inside it. Requires Node.js >= 22.18.
set -e

PREFIX="${GETONUP_PREFIX:-$HOME/.local/bin}"

if ! command -v node >/dev/null 2>&1; then
  echo "getonup needs Node.js >= 22.18 — install it from https://nodejs.org and re-run." >&2
  exit 1
fi

if [ ! -f cli/package.json ] || ! grep -q '"getonup"' cli/package.json 2>/dev/null; then
  echo "Run this from a cloned getonup repo." >&2
  echo "Once the package is published you'll be able to: npm i -g getonup" >&2
  exit 1
fi

echo "→ installing dependencies"
npm install --silent

echo "→ building the CLI"
npm run build --workspace cli --silent

mkdir -p "$PREFIX"
TARGET="$(cd cli && pwd)/dist/index.js"
chmod +x "$TARGET"
ln -sf "$TARGET" "$PREFIX/getonup"

echo "✓ installed: $PREFIX/getonup"
case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *) echo "  note: add $PREFIX to your PATH (e.g. in ~/.bashrc or ~/.zshrc):"
     echo "        export PATH=\"$PREFIX:\$PATH\"" ;;
esac
echo
echo "Next: getonup login --url <your-server> --token <your-token>"
