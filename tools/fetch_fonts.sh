#!/usr/bin/env sh
# Downloads the fonts used by gen_assets.py into tools/fonts/ (git-ignored).
#   Barlow Condensed - SIL Open Font License
#   Material Symbols Rounded - Apache License 2.0
set -e
cd "$(dirname "$0")"
mkdir -p fonts
cd fonts
GF=https://github.com/google/fonts/raw/main/ofl/barlowcondensed
MS=https://github.com/google/material-design-icons/raw/master/variablefont
for w in Medium SemiBold Bold; do
  curl -fsSL -o "BarlowCondensed-$w.ttf" "$GF/BarlowCondensed-$w.ttf"
done
curl -fsSL -o MaterialSymbolsRounded.ttf "$MS/MaterialSymbolsRounded%5BFILL,GRAD,opsz,wght%5D.ttf"
curl -fsSL -o MaterialSymbolsRounded.codepoints "$MS/MaterialSymbolsRounded%5BFILL,GRAD,opsz,wght%5D.codepoints"
echo "fonts ready in tools/fonts/"
