#!/usr/bin/env bash
# Downloads the 50-image "fox" test scene from NVlabs/instant-ngp into samples/fox/images.
# The images are NOT part of this repository (they're under NVIDIA's own license);
# check https://github.com/NVlabs/instant-ngp for its terms before using them.
set -euo pipefail
cd "$(dirname "$0")/.."
dest=samples/fox/images
mkdir -p "$dest"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/NVlabs/instant-ngp.git "$tmp/ingp"
git -C "$tmp/ingp" sparse-checkout set data/nerf/fox/images
cp "$tmp"/ingp/data/nerf/fox/images/*.jpg "$dest"/
echo "Fetched $(ls "$dest" | wc -l | tr -d ' ') images into $dest"
