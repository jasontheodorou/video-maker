#!/usr/bin/env bash
# Builds video-maker_<version>_amd64.deb: the desktop app for Ubuntu and Debian on Intel and AMD machines.
# Double-click the .deb on the Linux machine to install it. It brings Docker with it if it is missing, runs the
# app all the time, and adds a Video Maker icon. Passwords and the API key are set inside the app.
#
#   packaging/linux/build-deb.sh [version] [output folder]     (defaults: 1.0.0, ~/Downloads)
#
# Runs on a Mac or Linux machine with Docker. No secrets, jobs or uploads go in.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VERSION="${1:-1.0.0}"
OUT="${2:-$HOME/Downloads}"
IMAGE="video-maker:$VERSION"
STAGE="$(mktemp -d)"
PKG="$STAGE/pkg"
trap 'rm -rf "$STAGE"' EXIT

for f in "$HERE"/root/opt/video-maker/bin/* "$HERE"/DEBIAN/*; do
  if grep -q $'\r' "$f"; then echo "$f has Windows line endings. Convert it to LF first." >&2; exit 1; fi
  case "$f" in */control) ;; *) bash -n "$f" ;; esac
done

echo "Building the app image for Intel and AMD (linux/amd64)"
docker buildx build --platform linux/amd64 -t "$IMAGE" --load "$ROOT"

echo "Putting the package together"
cp -R "$HERE/root" "$PKG"
cp -R "$HERE/DEBIAN" "$PKG/DEBIAN"
find "$PKG" -name .DS_Store -delete
docker save --platform linux/amd64 "$IMAGE" | gzip -1 >"$PKG/opt/video-maker/image.tar.gz"

SIZE_KB=$(du -sk "$PKG" | cut -f1)
for f in "$PKG/DEBIAN/control" "$PKG/opt/video-maker/bin/video-maker-run"; do
  sed -i.bak -e "s/@VERSION@/$VERSION/g" -e "s/@SIZE_KB@/$SIZE_KB/g" "$f" && rm -f "$f.bak"
done
chmod 755 "$PKG"/opt/video-maker/bin/* "$PKG"/DEBIAN/postinst "$PKG"/DEBIAN/prerm
chmod 644 "$PKG"/DEBIAN/control

# Last check that no key or local settings slipped in.
if grep -rIlE 'sk-ant-[A-Za-z0-9_-]{20,}' "$PKG" --exclude=image.tar.gz; then echo "An Anthropic API key was found (files above). Stopping." >&2; exit 1; fi

# dpkg-deb runs in a small Debian container, so this works on a Mac too. The image is already compressed.
mkdir -p "$OUT"
DEB="video-maker_${VERSION}_amd64.deb"
docker run --rm -v "$STAGE:/stage" debian:trixie-slim \
  dpkg-deb --root-owner-group -Znone --build /stage/pkg "/stage/$DEB" >/dev/null
mv "$STAGE/$DEB" "$OUT/$DEB"
echo "Done: $OUT/$DEB ($(du -h "$OUT/$DEB" | cut -f1))"
