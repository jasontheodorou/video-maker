#!/usr/bin/env bash
# Builds video-maker-home.tar: everything needed to run the video maker on a home Linux server.
#
#   scripts/make-home-kit.sh [output folder]     (default ~/Downloads)
#
# The kit holds the app image for Intel and AMD machines, the source to build it on anything else,
# and home-server/ (the setup script, Compose file and README). No secrets, jobs or uploads go in.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Scripts with Windows line endings fail on Linux with "bad interpreter", so check before the long build.
for f in "$ROOT/home-server/video-maker" "$ROOT/home-server/docker-compose.yml" "$ROOT/docker/whisper-cli" "$ROOT/Dockerfile"; do
  if grep -q $'\r' "$f"; then echo "$f has Windows line endings. Convert it to LF first." >&2; exit 1; fi
done
bash -n "$ROOT/home-server/video-maker"
sh -n "$ROOT/docker/whisper-cli"
OUT="${1:-$HOME/Downloads}"
STAGE="$(mktemp -d)"
KIT="$STAGE/video-maker"
trap 'rm -rf "$STAGE"' EXIT

echo "Building the app image for Intel and AMD (linux/amd64)"
docker buildx build --platform linux/amd64 -t video-assembly:amd64 --load "$ROOT"

mkdir -p "$KIT/image" "$KIT/source"
cp "$ROOT/home-server/video-maker" "$ROOT/home-server/docker-compose.yml" "$ROOT/home-server/README.md" "$KIT/"
chmod +x "$KIT/video-maker"

echo "Saving the image"
docker save --platform linux/amd64 video-assembly:amd64 | gzip -1 >"$KIT/image/video-assembly-amd64.tar.gz"

echo "Copying the source (for machines that are not Intel or AMD)"
# The same files Docker would see, following .dockerignore.
tar -C "$ROOT" -cf - \
  --exclude=.git --exclude=.env --exclude='.env.*' --exclude=.vellum --exclude=.cache --exclude=node_modules \
  --exclude=ui/dist --exclude=jobs --exclude=demo-output --exclude=data --exclude=server/test/screenshots \
  --exclude=engine/icons/sheets --exclude=home-server --exclude='.DS_Store' \
  --exclude=brands/demo/.preview --exclude=brands/demo/media/uploads \
  --exclude=HANDOVER.md --exclude=skill \
  . | tar -C "$KIT/source" -xf -
# Only the sample brand goes in.
find "$KIT/source/brands" -mindepth 1 -maxdepth 1 ! -name demo -exec rm -rf {} +
chmod +x "$KIT/source/docker/whisper-cli"
# Last check that no key or local settings slipped in.
if grep -rIlE 'sk-ant-[A-Za-z0-9_-]{20,}' "$KIT" ; then echo "An Anthropic API key was found in the kit (files above). Stopping." >&2; exit 1; fi
if find "$KIT" -name '.env' -o -name '.env.*' -o -name 'session-secret' | grep -q .; then echo "A settings file was found in the kit. Stopping." >&2; exit 1; fi

mkdir -p "$OUT"
# No macOS extended attributes or ._ files, which GNU tar on Linux warns about. Files are owned by uid 1000.
if tar --version 2>/dev/null | grep -q bsdtar; then
  COPYFILE_DISABLE=1 tar -C "$STAGE" --no-mac-metadata --no-xattrs --no-acls --uid 1000 --gid 1000 --uname "" --gname "" -cf "$OUT/video-maker-home.tar" video-maker
else
  tar -C "$STAGE" --no-xattrs --no-acls --owner=1000 --group=1000 --numeric-owner -cf "$OUT/video-maker-home.tar" video-maker
fi
echo "Done: $OUT/video-maker-home.tar ($(du -h "$OUT/video-maker-home.tar" | cut -f1))"
