#!/bin/bash

# Build script for all platforms
# Usage: bash scripts/build-all.sh [platform]
# Platforms: linux, windows, macos, or all (default)

set -e

PLATFORM=${1:-all}
BUILD_TYPE=${2:-release}

echo "=================================="
echo "Monochrome+ Build Script"
echo "=================================="
echo "Platform: $PLATFORM"
echo "Type: $BUILD_TYPE"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check dependencies
check_deps() {
    if ! command -v cargo &> /dev/null; then
        print_error "Cargo not found. Please install Rust."
        exit 1
    fi

    if ! command -v npm &> /dev/null && ! command -v bun &> /dev/null; then
        print_error "Neither npm nor bun found. Please install one of them."
        exit 1
    fi

    if ! cargo tauri --version &> /dev/null; then
        print_warning "tauri-cli not found. Installing..."
        cargo install tauri-cli
    fi
}

# Build web assets
build_web() {
    print_status "Building web assets..."
    if command -v bun &> /dev/null; then
        bun install --frozen-lockfile
        bun run build:web
    else
        npm ci
        npm run build:web
    fi
    print_status "Web assets built successfully!"
}

# Build for Linux
build_linux() {
    print_status "Building for Linux..."
    
    # Check for Linux dependencies
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        print_status "Installing Linux dependencies..."
        sudo apt-get update
        sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf \
            libssl-dev \
            pkg-config
    fi

    cd src-tauri
    
    if [ "$BUILD_TYPE" == "release" ]; then
        cargo tauri build
    else
        cargo tauri build --debug
    fi
    
    cd ..
    
    print_status "Linux build complete!"
    echo "Output: src-tauri/target/release/bundle/"
}

# Build for Windows (requires Windows or cross-compilation setup)
build_windows() {
    print_status "Building for Windows..."
    
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OS" == "Windows_NT" ]]; then
        # Running on Windows - native build
        print_status "Running on Windows - building natively..."
        cd src-tauri
        if [ "$BUILD_TYPE" == "release" ]; then
            cargo tauri build
        else
            cargo tauri build --debug
        fi
        cd ..
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Running on Linux - use cross-compilation
        print_warning "Cross-compiling from Linux to Windows..."
        print_warning "Note: This requires MinGW and produces a GNU binary."
        print_warning "For MSVC builds, run this script on Windows or use GitHub Actions."
        
        # Install cross-compilation tools
        sudo apt-get update
        sudo apt-get install -y gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64
        rustup target add x86_64-pc-windows-gnu
        
        cd src-tauri
        
        # Build only the binary (bundling requires Windows)
        export CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc
        export CXX_x86_64_pc_windows_gnu=x86_64-w64-mingw32-g++
        export AR_x86_64_pc_windows_gnu=x86_64-w64-mingw32-ar
        
        if [ "$BUILD_TYPE" == "release" ]; then
            cargo build --release --target x86_64-pc-windows-gnu
        else
            cargo build --target x86_64-pc-windows-gnu
        fi
        
        cd ..
        
        print_status "Windows binary built!"
        echo "Output: src-tauri/target/x86_64-pc-windows-gnu/release/monochrome-plus.exe"
        print_warning "Note: This is a bare executable without an installer."
        print_warning "For NSIS/MSI installer, build on Windows or use GitHub Actions."
    else
        print_error "Windows build not supported on this platform: $OSTYPE"
        print_error "Please run on Windows or use GitHub Actions."
        exit 1
    fi
}

# Build for macOS
build_macos() {
    print_status "Building for macOS..."
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Running on macOS
        print_status "Running on macOS - building natively..."
        
        # Add targets for universal binary
        rustup target add x86_64-apple-darwin
        rustup target add aarch64-apple-darwin
        
        cd src-tauri
        
        if [ "$BUILD_TYPE" == "release" ]; then
            cargo tauri build --target universal-apple-darwin
        else
            cargo tauri build --debug --target universal-apple-darwin
        fi
        
        cd ..
        
        print_status "macOS build complete!"
        echo "Output: src-tauri/target/universal-apple-darwin/release/bundle/"
    else
        print_error "macOS build must be run on macOS."
        print_error "Please run on macOS or use GitHub Actions."
        exit 1
    fi
}

# Main execution
main() {
    check_deps
    
    # Always build web assets first
    build_web
    
    case $PLATFORM in
        linux)
            build_linux
            ;;
        windows)
            build_windows
            ;;
        macos)
            build_macos
            ;;
        all)
            print_status "Building for current platform: $OSTYPE"
            if [[ "$OSTYPE" == "linux-gnu"* ]]; then
                build_linux
            elif [[ "$OSTYPE" == "darwin"* ]]; then
                build_macos
            elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OS" == "Windows_NT" ]]; then
                build_windows
            else
                print_error "Unknown platform: $OSTYPE"
                exit 1
            fi
            ;;
        *)
            print_error "Unknown platform: $PLATFORM"
            echo "Usage: $0 [linux|windows|macos|all] [release|debug]"
            exit 1
            ;;
    esac
    
    print_status "Build process completed!"
}

main
