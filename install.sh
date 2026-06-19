#!/usr/bin/env sh
# Conjure CLI installer.
#
#   From a cloned repo:   ./install.sh
#   (once published):     npm i -g conjure-live    # or: npx conjure-live
#
# Builds the CLI from this checkout and symlinks `cjr` (+ aliases) into ~/.local/bin (override
# with CONJURE_PREFIX). Requires Node.js >= 20.
set -e

PREFIX="${CONJURE_PREFIX:-$HOME/.local/bin}"

if ! command -v node >/dev/null 2>&1; then
  echo "Conjure needs Node.js >= 20 — install it from https://nodejs.org and re-run." >&2
  exit 1
fi

if [ ! -f cli/package.json ] || ! grep -q '"conjure-live"' cli/package.json 2>/dev/null; then
  echo "Run this from a cloned Conjure repo." >&2
  echo "Once the package is published you'll be able to: npm i -g conjure-live" >&2
  exit 1
fi

echo "→ installing dependencies"
npm install --silent

echo "→ building the CLI"
npm run build --workspace cli --silent

mkdir -p "$PREFIX"
TARGET="$(cd cli && pwd)/dist/index.js"
chmod +x "$TARGET"
# Primary command is `cjr` (bare `conjure` collides with ImageMagick); also link the aliases.
for name in cjr conjure-live conjure; do ln -sf "$TARGET" "$PREFIX/$name"; done

echo "✓ installed: $PREFIX/cjr  (aliases: conjure-live, conjure)"
case ":$PATH:" in
  *":$PREFIX:"*) ;;
  *) echo "  note: add $PREFIX to your PATH (e.g. in ~/.bashrc or ~/.zshrc):"
     echo "        export PATH=\"$PREFIX:\$PATH\"" ;;
esac
echo
echo "Next: cjr login --url <your-server> --token <your-token>"
