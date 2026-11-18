#!/usr/bin/env bash
# Build, sign (Developer ID: Digital Vibes GmbH) and publish the macOS DMGs to a GitHub release.
#
#   pnpm release:mac            # build + upload to release v<version>
#   SKIP_UPLOAD=1 pnpm release:mac
#
# Notarization uses the keychain profile "splatcraft". Create it once per machine with
#   xcrun notarytool store-credentials splatcraft --apple-id <id> --team-id 8HFX6YPXXN
# (NOTARIZE=0 skips notarization for a quick local build.)
# Windows and Linux builds are made by .github/workflows/release.yml when the tag is pushed.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./apps/desktop/package.json').version")
TAG="v$VERSION"
export CSC_NAME="${CSC_NAME:-Digital Vibes GmbH (8HFX6YPXXN)}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit first." >&2; exit 1
fi
if [[ "${NOTARIZE:-1}" == "0" ]]; then
  unset APPLE_KEYCHAIN_PROFILE APPLE_ID APPLE_API_KEY
  echo "⚠  NOTARIZE=0: the DMG will be signed but not notarized." >&2
else
  export APPLE_KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-splatcraft}"
fi

echo "▸ SplatCraft $TAG"
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
rm -rf apps/desktop/dist
pnpm --filter @splatcraft/desktop exec electron-vite build
pnpm --filter @splatcraft/desktop exec electron-builder --mac --publish never

ARTIFACTS=(apps/desktop/dist/*.dmg apps/desktop/dist/*.dmg.blockmap)
for app in apps/desktop/dist/mac*/SplatCraft.app; do
  codesign --verify --deep --strict "$app"
  spctl -a -t exec -vv "$app" 2>&1 || { [[ "${NOTARIZE:-1}" == "0" ]] || exit 1; }
done
ls -lh "${ARTIFACTS[@]}"

[[ -n "${SKIP_UPLOAD:-}" ]] && exit 0

if ! git rev-parse "$TAG" >/dev/null 2>&1; then git tag -a "$TAG" -m "SplatCraft $TAG"; fi
git push origin "$TAG"
if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --title "SplatCraft $TAG" --generate-notes --verify-tag
fi
gh release upload "$TAG" "${ARTIFACTS[@]}" --clobber
gh release view "$TAG" --web >/dev/null 2>&1 || gh release view "$TAG"
