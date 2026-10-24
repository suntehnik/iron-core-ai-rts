#!/bin/sh
# Builds the game and publishes dist/ to Firebase Hosting (README, «Публикация на Firebase Hosting»).
#   scripts/deploy.sh                              live site
#   scripts/deploy.sh preview [channel] [expires]  preview channel, "preview" for 7d by default
set -eu
cd "$(dirname "$0")/.."

target="${1:-live}"
case "$target" in
  live | preview) ;;
  *)
    echo "usage: scripts/deploy.sh [live | preview [channel] [expires]]" >&2
    exit 2
    ;;
esac

npm run build
node scripts/check-deploy.mjs
if [ "$target" = live ]; then
  npm run firebase -- deploy --only hosting
else
  npm run firebase -- hosting:channel:deploy "${2:-preview}" --expires "${3:-7d}"
fi
