# Building Monochrome+ Desktop App

This document explains how to build the Monochrome+ Tauri desktop application for different platforms.

## ⚠️ Critical: Development vs Production Builds

**DEVELOPMENT builds** connect to `localhost:5173` and require a running dev server.  
**PRODUCTION builds** embed static files and can run standalone.

| Command             | Type        | Uses Static Assets | For Distribution |
| ------------------- | ----------- | ------------------ | ---------------- |
| `cargo build`       | Development | ❌ No              | ❌ No            |
| `cargo tauri build` | Production  | ✅ Yes             | ✅ Yes           |

### The "localhost refused to connect" Error

If you see this error, you built a **development binary** instead of a **production binary**:

```
Hmmm… can't reach this page
localhost refused to connect.
ERR_CONNECTION_REFUSED
```

**Solution:** Use production build commands:

```bash
npm run build:tauri
```

## Quick Start

### Development (with hot-reload)

```bash
# Option 1: Single command (runs both frontend and desktop)
npm run dev:tauri

# Option 2: Separate terminals
# Terminal 1: npm run dev
# Terminal 2: npm run build:tauri:dev
```

### Production Build (Current Platform)

```bash
# Recommended - builds with static assets
npm run build:tauri

# Output: src-tauri/target/release/bundle/
```

## Build Scripts

| Script        | Command                    | Purpose                                 |
| ------------- | -------------------------- | --------------------------------------- |
| Production    | `npm run build:tauri`      | Production build with static assets     |
| Development   | `npm run build:tauri:dev`  | Development build (needs localhost)     |
| Fast          | `npm run build:tauri:fast` | Direct tauri build (same as production) |
| All Platforms | `npm run build:tauri:all`  | Build script wrapper                    |

## Platform-Specific Builds

### Linux

**Requirements:**

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev patchelf
```

**Build:**

```bash
# Production (with static assets)
npm run build:tauri

# Output:
# - src-tauri/target/release/bundle/appimage/*.AppImage
# - src-tauri/target/release/bundle/deb/*.deb
# - src-tauri/target/release/bundle/rpm/*.rpm
```

### Windows

#### Option 1: Native Build (Windows only)

```bash
# Production build on Windows
npm run build:tauri

# Output:
# - src-tauri/target/release/bundle/nsis/*-setup.exe
# - src-tauri/target/release/bundle/msi/*.msi
```

#### Option 2: Cross-Compilation from Linux

```bash
# Cross-compile (produces bare .exe only)
npm run build:tauri:windows:cross

# Output:
# - src-tauri/target/x86_64-pc-windows-gnu/release/monochrome-plus.exe

# ⚠️ Limitations:
# - No NSIS/MSI installer
# - Uses GNU toolchain (not MSVC)
# - WebView2 must be pre-installed
# - Larger file size
```

### macOS

**Requirements:** macOS machine

**Build:**

```bash
npm run build:tauri

# Output:
# - src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
# - src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app
```

## Automated Builds (GitHub Actions)

**Recommended for production releases:**

```bash
git tag v2.0.1
git push origin v2.0.1
```

This triggers `.github/workflows/tauri-release.yml` which builds:

- Linux: AppImage
- Windows: NSIS installer (.exe)
- macOS: Universal DMG (Intel + Apple Silicon)

## Technical Details

### How Tauri Build Works

1. **Development** (`cargo build`):
    - Compiles Rust code
    - Sets app to use `devUrl: http://localhost:5173`
    - Requires dev server running
    - Binary location: `src-tauri/target/debug/monochrome-plus`

2. **Production** (`cargo tauri build`):
    - Runs `beforeBuildCommand` (`npm run build` → creates `dist/`)
    - Compiles Rust code with production settings
    - Embeds `dist/` folder into binary
    - Creates platform bundles
    - Binary location: `src-tauri/target/release/monochrome-plus`

### Configuration

The build behavior is controlled by [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json):

```json
{
    "build": {
        "frontendDist": "../dist", // Static assets for production
        "devUrl": "http://localhost:5173", // Dev server for development
        "beforeDevCommand": "npm run dev",
        "beforeBuildCommand": "npm run build"
    }
}
```

## Troubleshooting

### "localhost refused to connect"

You ran `cargo build` (development) instead of `cargo tauri build` (production).

**Fix:**

```bash
npm run build:tauri
```

### Missing Dependencies (Linux)

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev patchelf
```

### Cross-Compilation Fails

- Windows from Linux: Limited to bare binary (no installer)
- macOS: Must be built on macOS (Apple's licensing)

### GitHub Actions Build Fails

Set these secrets in your repository:

- `TAURI_SIGNING_PRIVATE_KEY` - Generate with `cargo tauri signer generate`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## Environment Variables

| Variable                             | Description        | Required     |
| ------------------------------------ | ------------------ | ------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Update signing key | For releases |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password       | For releases |

## File Structure

```
src-tauri/
├── src/
│   ├── lib.rs          # Rust backend
│   └── main.rs         # Entry point
├── Cargo.toml          # Rust dependencies
├── tauri.conf.json     # Tauri configuration
└── target/
    ├── debug/          # Development builds
    │   └── monochrome-plus        # Linux dev binary
    └── release/        # Production builds
        ├── monochrome-plus        # Linux prod binary
        └── bundle/                # Platform bundles
            ├── appimage/
            ├── deb/
            ├── rpm/
            ├── nsis/
            └── msi/
```

## Summary

| What you want              | Command to use                      |
| -------------------------- | ----------------------------------- |
| Quick test                 | `npm run dev:tauri`                 |
| Development                | `npm run build:tauri:dev`           |
| Production (this machine)  | `npm run build:tauri`               |
| Production (all platforms) | Push a git tag                      |
| Windows from Linux         | `npm run build:tauri:windows:cross` |
