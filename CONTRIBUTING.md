# Contributing To VelocityX

Thank you for helping improve VelocityX.

VelocityX is a free, open-source Coreova browser extension for local video speed control. It is published by Coreova, created by Maruf Ahmed Limon, and MIT licensed by Coreova. Contributions should keep the extension useful, dependable, privacy-aware, accessible, and easy to maintain.

## Before You Start

- Read `README.md`, `PRIVACY_POLICY.md`, and the open issues first.
- Keep each issue or pull request focused on one clear problem.
- Open an issue before large behavior, architecture, permissions, storage, or UI direction changes.
- Do not include secrets, private data, access tokens, browser profile data, or vulnerability details in public threads.
- Report security concerns through `SECURITY.md`, not public issues.

## Development Setup

VelocityX has no package install step for normal local testing.

1. Clone or download the repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Click `Load unpacked`.
5. Select the `VelocityX` folder.
6. Reload the extension after changing files.

## Good Issues

A strong issue includes:

- VelocityX version.
- Browser and operating system.
- The page or media player where the issue appears.
- Steps to reproduce.
- Expected behavior and actual behavior.
- Screenshots, recordings, console logs, or a minimal test page when useful.

## Good Pull Requests

A strong pull request:

- Solves one focused problem.
- Keeps playback logic, permissions, and storage behavior stable unless the change explicitly targets them.
- Updates docs or screenshots when public behavior changes.
- Includes manual verification notes for popup, options, overlay, and affected media sites.
- Avoids unrelated formatting churn and generated archives.
- Does not add telemetry, remote scripts, tracking, donation nags, or promotional interruptions.

## Project Standards

- Keep the extension local-first and transparent.
- Avoid new permissions unless there is a clear user benefit and a documented reason.
- Preserve keyboard accessibility and readable UI states.
- Keep site-specific fixes scoped and documented.
- Prefer simple browser APIs over new dependencies.

Maintainers may narrow scope, request changes, or decline work that is too broad, fragile, unsafe, or misaligned with VelocityX.
