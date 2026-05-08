#!/bin/bash

# Development Build Script
# This creates a development binary that connects to localhost for testing
# Usage: bash scripts/build-dev.sh

set -e

echo "=================================="
echo "Monochrome+ Development Build"
echo "=================================="
echo ""

# Colors
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}⚠️  WARNING:${NC} This creates a DEVELOPMENT build"
echo ""
echo "Development builds:"
echo "  • Connect to localhost:5173 (requires 'npm run dev' in another terminal)"
echo "  • Support hot-reload for faster development"
echo "  • Are NOT suitable for distribution"
echo ""
echo "For production builds with static assets, use:"
echo "  npm run build:tauri"
echo ""
read -p "Continue with development build? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

echo ""
echo "Building development binary..."
cd src-tauri

# Development build - uses devUrl (localhost:5173)
cargo build

cd ..

echo ""
echo "=================================="
echo "Development Build Complete"
echo "=================================="
echo ""
echo "Binary: src-tauri/target/debug/monochrome-plus"
echo ""
echo -e "${RED}⚠️  IMPORTANT:${NC} You must run 'npm run dev' in another terminal first!"
echo ""
echo "To run:"
echo "  Terminal 1: npm run dev"
echo "  Terminal 2: ./src-tauri/target/debug/monochrome-plus"
