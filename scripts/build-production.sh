#!/bin/bash

# Production Build Script
# This creates a production binary with static assets embedded
# Usage: bash scripts/build-production.sh

set -e

echo "=================================="
echo "Monochrome+ Production Build"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if cargo-tauri is installed
if ! command -v cargo-tauri &> /dev/null && ! cargo tauri --version &> /dev/null; then
    echo -e "${YELLOW}Installing tauri-cli...${NC}"
    cargo install tauri-cli
fi

# Ensure web assets are built
echo -e "${GREEN}[1/3]${NC} Building web assets..."
npm run build:web

# Build production binary
echo -e "${GREEN}[2/3]${NC} Building production binary..."
cd src-tauri

# IMPORTANT: Use 'cargo tauri build' NOT 'cargo build'
# 'cargo tauri build' embeds static assets
# 'cargo build' creates a development binary that connects to localhost

cargo tauri build

cd ..

echo -e "${GREEN}[3/3]${NC} Build complete!"
echo ""
echo "=================================="
echo "Output Locations:"
echo "=================================="
echo ""

# Show output files
if [ -d "src-tauri/target/release/bundle" ]; then
    echo "Installers/Bundles:"
    find src-tauri/target/release/bundle -type f -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" -o -name "*.msi" -o -name "*.exe" -o -name "*.dmg" 2>/dev/null | while read file; do
        echo "  - $file"
    done
fi

echo ""
echo "Binary:"
echo "  src-tauri/target/release/monochrome-plus"
echo ""
echo -e "${GREEN}✓${NC} This binary uses STATIC ASSETS (no localhost required)"
echo ""

# Test the binary
echo "To run the app:"
echo "  ./src-tauri/target/release/monochrome-plus"
