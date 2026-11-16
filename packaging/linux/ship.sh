#!/usr/bin/env bash
# Updates the video maker on the Linux machine straight from this one, with no reinstall and no password there.
# Builds the app, sends it over SSH, makes it the current version and restarts the app. Videos, brands, the
# password and the API key are kept.
#
#   packaging/linux/ship.sh [user@host]      (default: the machine named in packaging/linux/.ship-host)
#
# Needs: the desktop app installed there (video-maker .deb), SSH access, and that user in the docker group.
# Waits for a video being made to finish first, so nobody loses one.
set -euo pipefail

HOST="${1:-$(cat "$(dirname "$0")/.ship-host" 2>/dev/null || true)}"
[ -n "$HOST" ] || { echo "Say which machine: packaging/linux/ship.sh user@host (or put user@host in packaging/linux/.ship-host)." >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="video-maker:$(date +%Y%m%d-%H%M)"

echo "Checking $HOST"
ssh -o BatchMode=yes "$HOST" 'docker image inspect video-maker:current >/dev/null 2>&1' \
  || { echo "The desktop app is not installed on $HOST, or it has not started yet. Install the .deb there first." >&2; exit 1; }

echo "Building $TAG"
docker buildx build --platform linux/amd64 -t "$TAG" --load "$ROOT"

echo "Sending it (about 1.4 GB, a few minutes)"
docker save --platform linux/amd64 "$TAG" | gzip -1 | ssh "$HOST" 'gunzip | docker load'

echo "Waiting for any video being made to finish"
# A video is queued or being made when its job.json says so (server/jobs.ts).
BUSY_JS='const fs=require("fs");const d="/data/jobs";let n=0;let js=[];try{js=fs.readdirSync(d)}catch{}for(const j of js){try{const s=JSON.parse(fs.readFileSync(d+"/"+j+"/job.json","utf8")).state;if(s==="queued"||s==="running")n++}catch{}}console.log(n)'
ssh "$HOST" "BUSY_JS='$BUSY_JS'"' ; for i in $(seq 1 360); do
  busy=$(docker exec video-maker-app node -e "$BUSY_JS" 2>/dev/null || echo 0)
  [ "$busy" = 0 ] && exit 0
  [ "$i" = 1 ] && echo "  A video is being made. Waiting for it (up to 30 minutes)."
  sleep 5
done; echo "  Still busy after 30 minutes. Updating anyway: press Try again on that video." >&2'

echo "Switching to the new version"
ssh "$HOST" "docker tag $TAG video-maker:current && docker stop -t 30 video-maker-app >/dev/null"

echo "Waiting for it to start again"
ssh "$HOST" 'for i in $(seq 1 90); do
  running=$(docker inspect -f "{{.State.Running}} {{.Config.Image}}" video-maker-app 2>/dev/null || true)
  if [ "$running" = "true video-maker:current" ] && curl -fs -m 2 http://127.0.0.1:3006/healthz >/dev/null; then exit 0; fi
  sleep 2
done; echo "It did not come back. Check with: systemctl status video-maker" >&2; exit 1'

echo "Done. $HOST is running $TAG."
