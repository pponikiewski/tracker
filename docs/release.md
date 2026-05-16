# Release Runbook

Final release flow for tracker desktop builds.

## One-time setup

1. Push this repo to GitHub (`pponikiewski/tracker`).
2. If you fork to another repo, update the endpoint in `src-tauri/tauri.conf.json`:

   ```json
   "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
   ```

3. Add GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — content of `C:\tmp\tracker-updater-v2.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — content of `C:\tmp\tracker-updater-password.txt`

The updater public key is already committed in `src-tauri/tauri.conf.json`. Keep the private key safe; losing it means existing installations cannot be updated.

## Local validation

```powershell
pnpm run ci
scripts\tauri-build.cmd
```

For signed updater artifacts locally:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content C:\tmp\tracker-updater-v2.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content C:\tmp\tracker-updater-password.txt -Raw
scripts\tauri-build.cmd
```

On Windows the helper builds the NSIS installer and updater artifacts. Build outputs are written under `src-tauri\target\release\bundle\`.

## GitHub release

1. Bump `package.json` and `src-tauri/tauri.conf.json` to the same SemVer version.
2. Commit the version bump.
3. Create and push a tag:

   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. The `release` workflow builds Windows, Linux, and macOS artifacts through `tauri-apps/tauri-action`.
5. Review the draft GitHub Release, confirm it includes `latest.json`, installers, and `.sig` files.
6. Publish the draft release.

The in-app updater checks `latest.json` from the latest GitHub Release and installs signed artifacts only.
