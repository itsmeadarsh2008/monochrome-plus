// js/palette.js
// Dynamic Accent Color — extracts dominant palette from album art via Canvas + k-Means
// Then injects values into :root CSS variables and <meta name="theme-color">

const K = 5; // number of clusters
const ITER = 12;
const SAMPLE_SIZE = 120; // pixels to sample per side (downscale)

/**
 * Load an image URL via a same-origin proxy (or directly if CORS allows).
 * Returns an ImageBitmap ready to draw on canvas.
 */
async function loadImage(src) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    return new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    });
}

/**
 * Sample pixel colours from an image.
 * @param {HTMLImageElement} img
 * @returns {number[][]} array of [r,g,b] triplets
 */
function samplePixels(img) {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    const pixels = [];
    for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i], g = imageData[i + 1], b = imageData[i + 2], a = imageData[i + 3];
        // Skip transparent and near-black/white borders
        if (a < 128) continue;
        if (r > 240 && g > 240 && b > 240) continue; // white
        if (r < 15 && g < 15 && b < 15) continue;     // black
        pixels.push([r, g, b]);
    }
    return pixels;
}

function dist([r1, g1, b1], [r2, g2, b2]) {
    return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

/**
 * Simple k-Means clustering.
 * @param {number[][]} pixels
 * @param {number} k
 * @returns {{centroids: number[][], sizes: number[]}}
 */
function kMeans(pixels, k) {
    if (pixels.length < k) return { centroids: pixels.slice(0, k), sizes: pixels.map(() => 1) };

    // Random init from evenly spaced picks
    let centroids = Array.from({ length: k }, (_, i) =>
        [...pixels[Math.floor((i / k) * pixels.length)]]
    );

    let assignments = new Int32Array(pixels.length);

    for (let iter = 0; iter < ITER; iter++) {
        // Assign step
        for (let i = 0; i < pixels.length; i++) {
            let best = 0, bestDist = Infinity;
            for (let c = 0; c < k; c++) {
                const d = dist(pixels[i], centroids[c]);
                if (d < bestDist) { bestDist = d; best = c; }
            }
            assignments[i] = best;
        }

        // Update step
        const sums = Array.from({ length: k }, () => [0, 0, 0]);
        const counts = new Int32Array(k);
        for (let i = 0; i < pixels.length; i++) {
            const c = assignments[i];
            sums[c][0] += pixels[i][0];
            sums[c][1] += pixels[i][1];
            sums[c][2] += pixels[i][2];
            counts[c]++;
        }
        for (let c = 0; c < k; c++) {
            if (counts[c] > 0) {
                centroids[c] = [
                    Math.round(sums[c][0] / counts[c]),
                    Math.round(sums[c][1] / counts[c]),
                    Math.round(sums[c][2] / counts[c]),
                ];
            }
        }
    }

    return {
        centroids, sizes: Array.from(assignments).reduce((acc, c) => {
            acc[c] = (acc[c] || 0) + 1; return acc;
        }, new Array(k).fill(0))
    };
}

/**
 * Compute perceived luminance (0–1).
 */
function luminance([r, g, b]) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Compute saturation of an RGB colour (0–1, HSL model approximation).
 */
function saturation([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return 0;
    const d = max - min;
    return d / (1 - Math.abs(2 * l - 1));
}

/**
 * Score a centroid for use as a primary accent colour.
 * Prefer vibrant, non-too-dark, non-too-light colours.
 */
function accentScore(colour, size) {
    const lum = luminance(colour);
    const sat = saturation(colour);
    // Penalise very dark/light colours
    const lumPenalty = lum < 0.08 || lum > 0.92 ? 0.1 : 1;
    return sat * lumPenalty * Math.sqrt(size);
}

/**
 * Main entry: extract palette from an album art URL and apply to the document.
 * @param {string} imageUrl
 */
export async function applyPaletteFromImage(imageUrl) {
    if (!imageUrl) return;
    try {
        const img = await loadImage(imageUrl);
        const pixels = samplePixels(img);
        if (pixels.length < K) return;

        const { centroids, sizes } = kMeans(pixels, K);

        // Pick the best accent colour
        let bestIdx = 0;
        let bestScore = -Infinity;
        for (let i = 0; i < centroids.length; i++) {
            const score = accentScore(centroids[i], sizes[i]);
            if (score > bestScore) { bestScore = score; bestIdx = i; }
        }

        const [r, g, b] = centroids[bestIdx];
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

        // Sort remaining centroids by brightness for secondary/tertiary uses
        const others = centroids
            .filter((_, i) => i !== bestIdx)
            .sort((a, b) => luminance(b) - luminance(a));

        const root = document.documentElement;
        root.style.setProperty('--accent-color', hex);
        root.style.setProperty('--palette-rgb', `${r},${g},${b}`);
        if (others[0]) {
            const [r2, g2, b2] = others[0];
            root.style.setProperty('--palette-secondary', `#${r2.toString(16).padStart(2, '0')}${g2.toString(16).padStart(2, '0')}${b2.toString(16).padStart(2, '0')}`);
        }

        // Update theme-color meta tag (affects mobile browser chrome)
        let themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (!themeColorMeta) {
            themeColorMeta = document.createElement('meta');
            themeColorMeta.name = 'theme-color';
            document.head.appendChild(themeColorMeta);
        }
        // Use a darkened version of the accent as theme-color so the browser chrome looks good
        const darkFactor = 0.6;
        const themeMeta = `rgb(${Math.round(r * darkFactor)},${Math.round(g * darkFactor)},${Math.round(b * darkFactor)})`;
        themeColorMeta.content = themeMeta;

        return { hex, rgb: [r, g, b], all: centroids };
    } catch (err) {
        // Non-fatal: album art might not load due to CORS
        console.warn('[Palette] Failed to extract colours:', err.message);
    }
}

/**
 * Reset accent colours back to the default theme.
 */
export function resetPalette() {
    const root = document.documentElement;
    root.style.removeProperty('--accent-color');
    root.style.removeProperty('--palette-rgb');
    root.style.removeProperty('--palette-secondary');
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.content = '';
}
