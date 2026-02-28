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

        let [r, g, b] = centroids[bestIdx];
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

        // Adjust brightness for light/dark mode
        const theme = document.documentElement.getAttribute('data-theme');
        if (theme === 'white' && brightness > 150) {
            const factor = 0.7;
            r = Math.round(r * factor);
            g = Math.round(g * factor);
            b = Math.round(b * factor);
        } else if (theme !== 'white' && brightness < 80) {
            const factor = 1.4;
            r = Math.min(255, Math.round(r * factor));
            g = Math.min(255, Math.round(g * factor));
            b = Math.min(255, Math.round(b * factor));
        }

        const adjustedBrightness = 0.299 * r + 0.587 * g + 0.114 * b;
        const toHex = (rv, gv, bv) => `#${rv.toString(16).padStart(2, '0')}${gv.toString(16).padStart(2, '0')}${bv.toString(16).padStart(2, '0')}`;
        const hex = toHex(r, g, b);

        // Sort remaining centroids by brightness for secondary/tertiary uses
        const others = centroids
            .filter((_, i) => i !== bestIdx)
            .sort((a, b) => luminance(b) - luminance(a));

        const secondaryHex = others[0] ? toHex(others[0][0], others[0][1], others[0][2]) : hex;
        const tertiaryHex = others[1] ? toHex(others[1][0], others[1][1], others[1][2]) : secondaryHex;

        const root = document.documentElement;

        // Core accent variables
        root.style.setProperty('--accent-color', hex);
        root.style.setProperty('--accent-glow', hex + '44');
        root.style.setProperty('--accent-dim', hex + '88');
        root.style.setProperty('--palette-rgb', `${r},${g},${b}`);
        root.style.setProperty('--palette-1', hex + '55');
        root.style.setProperty('--palette-2', secondaryHex + '44');
        root.style.setProperty('--palette-3', tertiaryHex + '33');
        root.style.setProperty('--palette-border', hex + '26');
        root.style.setProperty('--palette-secondary', secondaryHex);

        // Backward-compatible variables (from setVibrantColor)
        root.style.setProperty('--primary', hex);
        root.style.setProperty('--primary-foreground', adjustedBrightness > 128 ? '#000000' : '#ffffff');
        root.style.setProperty('--highlight', hex);
        root.style.setProperty('--highlight-rgb', `${r}, ${g}, ${b}`);
        root.style.setProperty('--active-highlight', hex);
        root.style.setProperty('--ring', hex);
        root.style.setProperty('--track-hover-bg', `rgba(${r},${g},${b}, ${adjustedBrightness > 200 ? 0.25 : 0.15})`);

        // Dynamic theme gradient
        if (theme === 'dynamic') {
            const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
            const r2 = clamp(r + 40), g2 = clamp(g - 30), b2 = clamp(b + 20);
            const r3 = clamp(r - 30), g3 = clamp(g + 40), b3 = clamp(b - 20);
            root.style.setProperty('--dynamic-gradient',
                `linear-gradient(135deg, ` +
                `rgb(${clamp(r * 0.3)},${clamp(g * 0.3)},${clamp(b * 0.3)}) 0%, ` +
                `rgb(${clamp(r2 * 0.35)},${clamp(g2 * 0.35)},${clamp(b2 * 0.35)}) 25%, ` +
                `rgb(${clamp(r3 * 0.25)},${clamp(g3 * 0.25)},${clamp(b3 * 0.25)}) 50%, ` +
                `rgb(${clamp(r * 0.2)},${clamp(g * 0.2)},${clamp(b * 0.2)}) 75%, ` +
                `rgb(${clamp(r2 * 0.3)},${clamp(g2 * 0.3)},${clamp(b2 * 0.3)}) 100%)`
            );
            root.style.setProperty('--dynamic-brightness',
                adjustedBrightness > 150 ? '0.3' : adjustedBrightness > 100 ? '0.4' : '0.5'
            );
        }

        // Palette transition
        root.style.setProperty('--palette-transition', '0.8s');
        setTimeout(() => root.style.setProperty('--palette-transition', '0s'), 900);

        // Update theme-color meta tag (affects mobile browser chrome)
        let themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (!themeColorMeta) {
            themeColorMeta = document.createElement('meta');
            themeColorMeta.name = 'theme-color';
            document.head.appendChild(themeColorMeta);
        }
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
    const vars = [
        '--accent-color', '--accent-glow', '--accent-dim',
        '--palette-rgb', '--palette-1', '--palette-2', '--palette-3',
        '--palette-border', '--palette-secondary',
        '--primary', '--primary-foreground',
        '--highlight', '--highlight-rgb', '--active-highlight',
        '--ring', '--track-hover-bg',
        '--dynamic-gradient', '--dynamic-brightness',
        '--palette-transition',
    ];
    for (const v of vars) root.style.removeProperty(v);
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.content = '';
}
