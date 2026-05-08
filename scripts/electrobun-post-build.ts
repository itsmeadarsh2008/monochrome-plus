// scripts/electrobun-post-build.ts
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

// Post-build script for Electrobun
// Copies the Vite dist to the views/main directory

const distDir = 'dist';
const viewsMainDir = 'views/main';

console.log('Running Electrobun post-build script...');

// Ensure views/main directory exists
if (!existsSync(viewsMainDir)) {
    mkdirSync(viewsMainDir, { recursive: true });
}

// Copy all files from dist to views/main
import { readdirSync, statSync } from 'fs';

function copyDir(src: string, dest: string) {
    const entries = readdirSync(src);

    for (const entry of entries) {
        const srcPath = join(src, entry);
        const destPath = join(dest, entry);

        const stat = statSync(srcPath);

        if (stat.isDirectory()) {
            if (!existsSync(destPath)) {
                mkdirSync(destPath, { recursive: true });
            }
            copyDir(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

if (existsSync(distDir)) {
    copyDir(distDir, viewsMainDir);
    console.log('✓ Copied Vite dist to views/main');
} else {
    console.error('✗ Dist directory not found');
    process.exit(1);
}

console.log('✓ Post-build complete');
