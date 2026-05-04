# VelocityX Browser Packages

VelocityX ships as a free Coreova open-source extension. It is published by Coreova, created by Maruf Ahmed Limon, and MIT licensed by Coreova. Use the release builder to create clean store-ready ZIP files with `manifest.json` at the ZIP root.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1
```

Generated packages live in `release/`.

## Which ZIP To Use

| Browser / Store | Package |
| --- | --- |
| Chrome Web Store | `release/velocityx-chrome-web-store-v1.0.0.zip` |
| Microsoft Edge Add-ons | `release/velocityx-edge-addons-v1.0.0.zip` |
| Brave | `release/velocityx-brave-opera-chromium-v1.0.0.zip` or the Chrome Web Store listing when available |
| Opera | `release/velocityx-brave-opera-chromium-v1.0.0.zip` |
| Vivaldi | `release/velocityx-brave-opera-chromium-v1.0.0.zip` |
| Chromium | `release/velocityx-brave-opera-chromium-v1.0.0.zip` |
| Firefox / AMO | `release/velocityx-firefox-amo-v1.0.0.zip` |

## Notes

- Chrome, Edge, Brave, Opera, Vivaldi, and Chromium use the standard Manifest V3 package with `background.service_worker`.
- Firefox gets a generated manifest variant with `background.scripts` and Gecko metadata in `browser_specific_settings`.
- The builder also writes `release/firefox-manifest.generated.json` so the generated Firefox manifest can be inspected before AMO upload.
- No package adds telemetry, remote upload, donation prompts, browser notifications, or extra permissions.
- The expected permission set stays exactly `storage`, `tabs`, and `scripting`.

## Before Publishing

- Load the unpacked `VelocityX` folder locally and test popup, options, analytics, DevTools, and the in-page overlay.
- Confirm each ZIP contains `manifest.json` at the root, not inside a wrapping folder.
- Upload the matching ZIP to the target store dashboard.
- If `web-ext` is available, run AMO lint against `release/velocityx-firefox-amo-v1.0.0.zip` before submitting to Firefox Add-ons.
