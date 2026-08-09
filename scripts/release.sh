#!/usr/bin/env bash
#
# リリース用バイナリをローカルでクロスコンパイルして dist/release に置く。
#
#   scripts/release.sh v0.1.0
#
# フロントは webdist/ に埋め込まれるので 1 度ビルドすれば全プラットフォームで使い回せる。
# 生成物のアップロードは最後に表示される gh コマンドで行う。

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "使い方: scripts/release.sh <version>   例: scripts/release.sh v0.1.0" >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  echo "バージョンは vX.Y.Z 形式で指定してください（例: v0.1.0）: $VERSION" >&2
  exit 1
fi

PLATFORMS=(
  "darwin arm64"
  "darwin amd64"
  "linux amd64"
  "linux arm64"
)

OUT="dist/release"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> フロントをビルドして webdist/ に詰める"
pnpm exec vite build
node scripts/pack-web.mjs

for platform in "${PLATFORMS[@]}"; do
  read -r goos goarch <<<"$platform"
  # バージョンを含めない。含めると /releases/latest/download/<名前> で
  # 最新版を直接 curl できなくなるため。
  name="di_${goos}_${goarch}"

  echo "==> build ${goos}/${goarch}"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags="-s -w" -o "$OUT/$name/di" .

  tar -czf "$OUT/${name}.tar.gz" -C "$OUT/$name" di
  rm -rf "${OUT:?}/${name}"
done

(cd "$OUT" && shasum -a 256 ./*.tar.gz >SHA256SUMS)

echo
echo "==> 完成"
ls -lh "$OUT"
echo
echo "リリースを作成するには:"
echo "  gh release create $VERSION $OUT/*.tar.gz $OUT/SHA256SUMS --title $VERSION --generate-notes"
