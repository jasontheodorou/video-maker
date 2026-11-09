#!/usr/bin/env bash
# One-line install of the video maker on a Linux machine that stays on:
#
#   curl -fsSL https://raw.githubusercontent.com/jasontheodorou/video-maker/main/install.sh | bash
#
# It puts the helper script in ~/video-maker (or $VIDEO_MAKER_DIR) and runs "./video-maker install", which
# installs Docker and Tailscale, downloads the app, asks for the password and API key, and prints the link.
# Safe to run again.

set -euo pipefail

REPO=jasontheodorou/video-maker
BRANCH=${VIDEO_MAKER_BRANCH:-main}
RAW="https://raw.githubusercontent.com/$REPO/$BRANCH"
DIR=${VIDEO_MAKER_DIR:-$HOME/video-maker}

[ "$(uname -s)" = Linux ] || { echo "This installs on a Linux machine." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "Install curl first (sudo apt-get install curl), then run this again." >&2; exit 1; }
[ -e /dev/tty ] || { echo "Run this from a terminal: it asks for a password." >&2; exit 1; }

echo "Downloading the video maker into $DIR"
mkdir -p "$DIR"
for f in video-maker docker-compose.yml README.md; do
  curl -fsSL "$RAW/home-server/$f" -o "$DIR/$f.new"
  mv "$DIR/$f.new" "$DIR/$f"
done
chmod +x "$DIR/video-maker"

# Piped through bash, this script's own input is the download, so the questions read from the terminal.
cd "$DIR"
exec ./video-maker install </dev/tty
