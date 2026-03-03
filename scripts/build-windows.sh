#!/bin/bash

# Build script for Windows
# This script builds the Tauri app for Windows
# NOTE: For proper Windows builds, use the GitHub Actions workflow which runs on Windows runners
# This script is primarily for testing the build process on Linux/macOS

set -e

echo "=================================="
echo "Monochrome+ Windows Build Script"
echo "=================================="
echo ""
echo "WARNING: For production Windows builds, use GitHub Actions with windows-latest runner."
echo "Cross-compilation from Linux to Windows is not fully supported due to MSVC dependencies."
echo ""

# Check if running on Windows (MSYS/Cygwin/Git Bash)
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OS" == "Windows_NT" ]]; then
    echo "Running on Windows - proceeding with native build..."
else
    echo "Not running on Windows. This build may not produce a working Windows executable."
    echo "For proper Windows builds, push a tag to trigger the GitHub Actions workflow."
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for required environment variables
if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
    echo "Warning: TAURI_SIGNING_PRIVATE_KEY is not set. Updater will not work."
fi

if [ -z "$MONOCHROME_DISCORD_APP_ID" ]; then
    echo "Note: MONOCHROME_DISCORD_APP_ID is not set. Using default Discord App ID."
fi

# Install dependencies if needed
echo "Installing Node dependencies..."
if command -v bun &> /dev/null; then
    bun install --frozen-lockfile
elif command -v npm &> /dev/null; then
    npm ci
else
    echo "Error: Neither bun nor npm found. Please install one of them."
    exit 1
fi

# Build the web assets first
echo "Building web assets..."
npm run build:web

# Build the Tauri app for Windows
echo "Building Tauri app..."

if command -v cargo &> /dev/null; then
    if command -v cargo-tauri &> /dev/null || cargo tauri --version &> /dev/null; then
        cargo tauri build
    else
        echo "Error: cargo-tauri not found. Install with: cargo install tauri-cli"
        exit 1
    fi
else
    echo "Error: cargo not found. Please install Rust."
    exit 1
fi

echo "=================================="
echo "Build completed!"
echo "=================================="

# List output files
echo "Output files:"
find src-tauri/target -name "*.msi" -o -name "*.exe" -o -name "*.nsis.zip" 2>/dev/null | head -10 || true

echo ""
echo "For proper Windows builds with signing and updater support,"
echo "use the GitHub Actions workflow by pushing a tag:"
echo "  git tag v2.0.0"
echo "  git push origin v2.0.0"
