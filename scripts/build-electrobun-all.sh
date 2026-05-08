#!/bin/bash

# Electrobun Build Script
# This creates production builds for all platforms
# Usage: bash scripts/build-electrobun-all.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "=================================="
echo "Monochrome+ Electrobun Build"
echo "=================================="
echo ""

# Check if electrobun is installed
if ! command -v electrobun &> /dev/null; then
    echo -e "${YELLOW}Installing electrobun...${NC}"
    npm install -g electrobun
fi

# Check Node/Bun
if command -v bun &> /dev/null; then
    PACKAGE_MANAGER="bun"
elif command -v npm &> /dev/null; then
    PACKAGE_MANAGER="npm"
else
    echo -e "${RED}Error: Neither bun nor npm found${NC}"
    exit 1
fi

echo -e "${GREEN}[1/3]${NC} Installing dependencies..."
if [ "$PACKAGE_MANAGER" = "bun" ]; then
    bun install --frozen-lockfile
else
    npm ci
fi

echo -e "${GREEN}[2/3]${NC} Building web assets..."
if [ "$PACKAGE_MANAGER" = "bun" ]; then
    bun run build:web
else
    npm run build:web
fi

echo -e "${GREEN}[3/3]${NC} Building Electrobun apps..."

# Build for current platform
echo "Building for current platform..."
electrobun build

echo ""
echo -e "${GREEN}✓${NC} Build complete!"
echo ""
echo "=================================="
echo "Output Locations:"
echo "=================================="
echo ""

# Show output files
if [ -d "dist" ]; then
    echo "Build artifacts:"
    find dist -type f \( -name "*.tar.zst" -o -name "*.exe" -o -name "*.dmg" -o -name "*.AppImage" \) 2>/dev/null | while read file; do
        echo "  - $file"
    done
fi

echo ""
echo "To run the app:"
echo "  electrobun run"

echo ""
echo -e "${GREEN}✓${NC} Production build ready!"