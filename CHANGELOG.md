# Changelog

All notable changes to this project are documented in this file.

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
