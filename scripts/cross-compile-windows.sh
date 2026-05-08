#!/bin/bash

# Cross-compilation script for Windows from Linux
# This creates a PRODUCTION Windows binary with STATIC ASSETS embedded
# 
# IMPORTANT: This produces a bare executable WITHOUT an installer.
# For production builds with NSIS/MSI installers, use GitHub Actions.
#
# Usage:
#   npm run build:tauri:windows:cross
#   OR
#   bash scripts/cross-compile-windows.sh

set -e

echo "=================================="
echo "Monochrome+ Windows Cross-Compilation"
echo "=================================="
echo ""

# Check if we're on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "Error: This script is designed for Linux cross-compilation only."
    echo "On Windows, use: npm run build:tauri"
    exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}⚠️  IMPORTANT NOTES:${NC}"
echo ""
echo "1. This creates a PRODUCTION binary with STATIC ASSETS embedded"
echo "2. No localhost connection required - uses dist/ folder"
echo "3. Output is a bare .exe (no installer)"
echo "4. Uses GNU toolchain instead of MSVC"
echo ""
echo "For production builds with proper installers, use GitHub Actions:"
echo "   git tag v2.0.1"
echo "   git push origin v2.0.1"
echo ""
read -p "Do you want to continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

echo ""
echo -e "${GREEN}[1/5]${NC} Installing cross-compilation dependencies..."
sudo apt-get update
sudo apt-get install -y \
    gcc-mingw-w64-x86-64 \
    g++-mingw-w64-x86-64 \
    mingw-w64-tools \
    mingw-w64-x86-64-dev

echo -e "${GREEN}[2/5]${NC} Installing Rust Windows target..."
rustup target add x86_64-pc-windows-gnu

# Set environment variables for cross-compilation
export CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc
export CXX_x86_64_pc_windows_gnu=x86_64-w64-mingw32-g++
export AR_x86_64_pc_windows_gnu=x86_64-w64-mingw32-ar

echo -e "${GREEN}[3/5]${NC} Building web assets..."
npm run build:web

echo -e "${GREEN}[4/5]${NC} Building Windows binary with STATIC ASSETS..."
echo ""
echo "This will create a production binary that uses the dist/ folder"
echo "instead of connecting to localhost..."
echo ""

cd src-tauri

# CRITICAL FIX: Set environment variables to force production build
# This tells tauri-build to embed static assets instead of using devUrl
export TAURI_ENV=production
export TAURI_DEBUG=false
export CARGO_FEATURE_CUSTOM_PROTOCOL=true

# Clean previous builds to ensure fresh build with static assets
cargo clean

# Build the project with cross-compilation
# The --release flag should trigger tauri-build to embed assets
CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc \
cargo build --release --target x86_64-pc-windows-gnu

cd ..

echo ""
echo -e "${GREEN}[5/5]${NC} Build complete!"
echo ""
echo "=================================="
echo "Output"
echo "=================================="
echo ""

# Check if binary was created
if [ -f "src-tauri/target/x86_64-pc-windows-gnu/release/monochrome-plus.exe" ]; then
    echo -e "${GREEN}✓${NC} Windows binary created successfully!"
    echo ""
    echo "Location:"
    echo "  src-tauri/target/x86_64-pc-windows-gnu/release/monochrome-plus.exe"
    echo ""
    
    # Copy to dist for easy access
    mkdir -p dist/windows
    cp "src-tauri/target/x86_64-pc-windows-gnu/release/monochrome-plus.exe" dist/windows/
    echo "Copied to: dist/windows/monochrome-plus.exe"
    echo ""
    
    # Check binary size
    ls -lh src-tauri/target/x86_64-pc-windows-gnu/release/monochrome-plus.exe
    echo ""
    
    echo -e "${GREEN}✓${NC} This binary should use STATIC ASSETS (embedded from dist/)"
    echo -e "${GREEN}✓${NC} No localhost connection should be required!"
    echo ""
    echo -e "${YELLOW}To test:${NC} Run the .exe on Windows - it should work without internet!"
else
    echo -e "${RED}✗${NC} Binary not found. Build may have failed."
    exit 1
fi

echo ""
echo -e "${YELLOW}⚠️  Limitations:${NC}"
echo "  • No NSIS/MSI installer (requires Windows to build)"
echo "  • Uses GNU toolchain instead of MSVC"
echo "  • WebView2 runtime must be pre-installed on target Windows machine"
echo ""
echo "For production releases with installers, use GitHub Actions:"
echo "  git tag v2.0.1"
echo "  git push origin v2.0.1"
