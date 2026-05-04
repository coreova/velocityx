# VelocityX Privacy Policy

Last updated: May 3, 2026

VelocityX is designed to control media playback locally in your browser. The extension is published by Coreova, created by Maruf Ahmed Limon, and does not run remote analytics, does not upload your playback history to the publisher, and does not sell personal data.

## What VelocityX processes

- Settings you choose, such as default speed, shortcuts, overlay preferences, silence-skip options, site rules, and custom CSS.
- Local analytics values, such as total time saved, weekly time saved, session counts, and speed-distribution totals.
- Current tab context needed for playback control, such as the active page URL or hostname and media state.
- Optional page-specific speed memory when `Remember Per URL` is enabled.
- Optional analytics share cards that you create manually. These are rendered locally as PNG files and are not uploaded by VelocityX.

## How data is stored

- Syncable settings are stored in `chrome.storage.sync` when Chrome sync is available for your profile.
- Local-only runtime values and analytics are stored in `chrome.storage.local` on this browser.
- VelocityX does not send this data to a VelocityX server because the extension does not use one.

## Permissions explained

- `storage`: saves your settings, site rules, shortcuts, and local analytics.
- `tabs`: identifies the active tab so popup actions and badge updates affect the correct page.
- `scripting` and content script access on matching pages: lets VelocityX detect HTML5 media, inject the controller UI, and apply playback controls on supported pages.

## Data sharing

- VelocityX does not sell your personal data.
- VelocityX does not transmit your settings or analytics to Coreova.
- VelocityX does not upload generated share cards. You decide where to save or post them.
- If Chrome sync is enabled in your browser profile, Google may sync settings between your signed-in browsers under Google's own policies.

## Your choices

- You can reset settings from `Settings > Advanced`.
- You can reset analytics from `Settings > Analytics`.
- You can disable `Remember Per URL` if you do not want page-specific speed memory.
- You can remove the extension at any time to stop all processing.

## Changes to this policy

If VelocityX adds features that change data handling, this policy should be updated before or when those features ship.

## Contact

For questions, bug reports, or privacy concerns related to this project, use the GitHub issue tracker:

- https://github.com/coreova/velocityx/issues

Publisher website:

- https://coreova.github.io/

Source:

- https://github.com/coreova/velocityx
