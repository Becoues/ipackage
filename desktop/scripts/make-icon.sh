#!/usr/bin/env bash
# 由 web/public/favicon.svg 生成 desktop/icon.icns（结果已入库，平时打包不需要重跑）。
# 本机没有 rsvg/imagemagick：用 headless Chrome 以透明背景渲染 1024px PNG，再 sips + iconutil。
set -euo pipefail

DESKTOP="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$DESKTOP/.." && pwd)"
SVG="$ROOT/web/public/favicon.svg"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1024x1024 透明画布，图形按 macOS 图标网格居中占 824px（四周留 100px，和 Dock 里其它图标大小一致）
cat > "$TMP/icon.html" <<HTML
<!doctype html><html><head><style>
html,body{margin:0;padding:0;background:transparent;width:1024px;height:1024px;overflow:hidden}
img{display:block;width:824px;height:824px;margin:100px}
</style></head><body><img src="file://$SVG"></body></html>
HTML

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --default-background-color=00000000 --force-device-scale-factor=1 \
  --window-size=1024,1024 --allow-file-access-from-files \
  --screenshot="$TMP/icon_1024.png" "file://$TMP/icon.html" >/dev/null 2>&1

ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon_1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$TMP/icon_1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$DESKTOP/icon.icns"
echo "✓ 已生成 $DESKTOP/icon.icns"
