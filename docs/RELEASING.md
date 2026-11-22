# Releasing

Builds are hosted on [GitHub Releases](https://github.com/fabianfreund/SplatCraft/releases).

| Platform | Built by | Signed |
|---|---|---|
| macOS arm64 + x64 (`.dmg`, `-mac.zip`) | locally, `pnpm release:mac` | Developer ID: Digital Vibes GmbH (8HFX6YPXXN), notarized |
| Windows x64 (`.exe`, NSIS) | GitHub Actions (`.github/workflows/release.yml`) on a `v*` tag | no |
| Linux x64 (`.AppImage`, `.deb`) | GitHub Actions, same workflow | no |

## Steps
1. Bump `version` in **every** `package.json` (root, `apps/desktop`, `packages/*`) and the mock `app.info` in `apps/desktop/src/renderer/src/lib/mock/mockApi.ts`.
2. Commit on `main` and push.
3. Run `pnpm release:mac`. It:
   - refuses to run on a dirty tree, then installs, typechecks and runs the tests;
   - builds and signs both mac architectures, notarizes them, and verifies them with `codesign` and `spctl`;
   - tags `v<version>`, pushes the tag, creates the release and uploads the DMGs, the zips and `latest-mac.yml`.
4. The tag push starts the CI workflow, which attaches the Windows and Linux builds to the same release. To rebuild an existing tag, run the workflow manually with `tag: v<version>`.

Options: `SKIP_UPLOAD=1` builds only. `NOTARIZE=0` skips notarization, for a fast local check; Gatekeeper will reject that build.

## One-time setup on a new Mac
- The Developer ID certificate for Digital Vibes GmbH must be in the login keychain (`security find-identity -v -p codesigning`).
- Store notarization credentials as the keychain profile `splatcraft`:
  ```bash
  xcrun notarytool store-credentials splatcraft --apple-id <apple id> --team-id 8HFX6YPXXN
  ```
  It asks for an app-specific password (appleid.apple.com → Sign-In and Security).
- `gh auth login` with push access to the repo.

## Notes
- Electron must be pinned to an exact version in `apps/desktop/package.json`, because electron-builder needs it.
- Root `package.json` has `pnpm.supportedArchitectures`, so `sharp` binaries for both mac architectures get installed.
- Entitlements are in `apps/desktop/build/entitlements.mac.plist`. Icons come from `node scripts/make-icons.mjs`.
## Auto-update
Packaged apps update themselves from the newest **published** (not draft, not prerelease) GitHub release, via `electron-updater` (`apps/desktop/src/main/services/updater.ts`, Settings → General → Updates, and *Check for Updates…* in the app/Help menu).
- `publish` in `electron-builder.yml` points at `fabianfreund/SplatCraft`. Builds still use `--publish never`, but electron-builder writes the update metadata next to the installers.
- Each release must carry the metadata for every platform: `latest-mac.yml` + `*-mac.zip` (from `pnpm release:mac`; Squirrel.Mac installs from the zip), `latest.yml` (Windows, CI) and `latest-linux.yml` (AppImage, CI). Until CI has attached its files, Windows and Linux apps report "No update found for this platform yet".
- mac auto-update only works for signed builds; `NOTARIZE=0` builds should not be published.
- The Linux `.deb` and dev builds don't self-update. Windows builds are unsigned, so SmartScreen may warn on the first install.
- The app checks 10 s after launch and every 6 h (switchable off), downloads in the background and installs on quit, or right away with *Restart to update*.
