# Changelog

All notable changes to this project are documented in this file.

## [2.0.9] - 2026-03-04

### Fixed

- Restored horizontal searchbar/header behavior while keeping sidebar removal mode enabled.
- Fixed collaborative playlist attribution so tracks keep `addedAt`, `addedById`, and `addedByName` metadata across local storage and cloud sync.
- Fixed desktop share URL generation to avoid `tauri.localhost`/local origins and prefer canonical public links.
- Fixed unreleased artist loading from getting stuck after one failed fetch attempt by removing permanent fail lockout behavior.
- Fixed home recommended artists refresh to produce a genuinely refreshed set and improved artist image fallbacks.
- Fixed browser compatibility issues for timeout-based fetches by replacing direct `AbortSignal.timeout(...)` usage with a cross-browser timeout signal helper.
- Fixed share/copy actions across playlist/profile/context menu flows with robust fallbacks (`share` → clipboard API → legacy copy command).

### Changed

- Expanded account listening stats to support Today / This Month / This Year views with updated list rendering and artist avatar support.
- Removed the Custom Database/Auth settings entry and related inactive settings logic from the app settings UI.
- Reduced page scroll-jump behavior by only auto-scrolling to top when navigating to a different page, not on same-page re-renders.

## [2.0.8] - 2026-03-03

### Fixed

- Reduced startup "Not Responding" risk by making auth initialization non-blocking with timeout fallback.
- Improved desktop app startup responsiveness while background auth state hydrates.

### Changed

- Added Rust release profile optimizations (`lto`, `strip`, single codegen unit, abort panic) for faster and leaner Tauri binaries.
- Improved desktop bundle metadata and file associations so Windows/Linux/macOS recognize the app as a music/audio app.

## [2.0.7] - 2026-03-03

### Fixed

- Prevented app startup hangs when Discord is closed by making RPC startup fail fast and non-blocking.
- Added startup timeout handling in desktop Discord bridge so RPC initialization does not block app UI.
- Updated Discord RPC cover handling to build TIDAL image URLs from album cover IDs (e.g. `/images/.../320x320.jpg`) for reliable artwork rendering.

## [2.0.6] - 2026-03-03

### Fixed

- Prevented periodic sync from overwriting cloud playlist/folder metadata with empty local state.
- Prevented automatic deletion of cloud public playlists when local playlist metadata is empty.
- Added protective merge behavior so existing cloud playlist metadata is preserved until local metadata exists.

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
