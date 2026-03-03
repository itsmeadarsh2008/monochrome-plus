# Changelog

All notable changes to this project are documented in this file.

## [2.0.5] - 2026-03-03

### Fixed

- Fixed desktop OAuth redirect flow that could send users to `http://127.0.0.1`/`http://localhost` and fail with "refused to connect".
- Updated redirect selection to use valid HTTP origins first and fall back to the public app URL for desktop runtime.

## [2.0.4] - 2026-03-03

### Added

- Added a Friends quick-nav button in the top search bar for authenticated users.

### Changed

- Updated desktop OAuth redirect handling to support desktop/Tauri contexts with multiple redirect URL and endpoint fallbacks.
- Updated Discord Rich Presence large image handling to correctly support external cover image URLs via media proxy format.
- Updated release workflow to allow unsigned macOS builds by removing mandatory Apple signing/notarization secret requirements.
- Updated application version to `2.0.4` across `package.json`, Tauri config, and Cargo metadata.
- Updated Tauri app metadata copyright year to `2026`.

### Fixed

- Improved Discord OAuth and Google OAuth session initialization resiliency by reusing shared fallback session logic.
