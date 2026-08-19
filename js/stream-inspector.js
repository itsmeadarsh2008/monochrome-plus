// Ground-truth stream metadata reader.
//
// The addon's quality *label* is a text string that can be missing, vague or
// wrong ("Tidal · Hi-Res FLAC · 24-bit / 44.1 kHz" carries no bitrate at all).
// This module reads the actual media files instead:
//   - HLS:     the manifest (#EXT-X-STREAM-INF BANDWIDTH, or first segment's
//              byte size ÷ its #EXTINF duration) + the init segment's audio
//              sample entry (moov → stsd → fLaC/mp4a/Opus fields).
//   - direct:  a Range probe for the file size ÷ track duration, plus a moov
//              parse if the head of the file is an mp4 container.
//
// Everything is best-effort and never throws; every function resolves to {}
// when a property cannot be determined. Fetching happens through
// window.__corsBypass.rewriteUrl so proxied hosts (sp-ad-fa.audio.tidal.com)
// work exactly like the rest of the app.

const HEAD_PROBE_BYTES = 262144; // 256 KB — enough for any init segment / moov

const STREAM_SPEC_CACHE = new Map();
const STREAM_SPEC_CACHE_LIMIT = 64;

const readU8 = (bytes, off) => bytes[off];
const readU16 = (bytes, off) => (bytes[off] << 8) | bytes[off + 1];
const readU32 = (bytes, off) =>
    ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;

function typeString(bytes, off) {
    return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}

// Visits top-level ISO-BMFF boxes inside [start, end). Handles the compact
// 4-byte size, size === 0 (box extends to end) and size === 1 (64-bit largesize).
function walkBoxes(bytes, start, end, onBox) {
    let p = start;
    while (p + 8 <= end) {
        let size = readU32(bytes, p);
        if (size === 1) {
            if (p + 16 > end) break;
            const hi = readU32(bytes, p + 8);
            const lo = readU32(bytes, p + 12);
            size = hi * 0x100000000 + lo;
        } else if (size === 0) {
            size = end - p;
        }
        if (size < 8 || p + size > end) break;
        if (onBox(typeString(bytes, p + 4), p, p + size) === false) return;
        p += size;
    }
}

// Recursively collects box start offsets of the given type anywhere in the
// buffer. Only known container types are descended into; anything else (or a
// malformed size-0 box that swallows the rest of the buffer) is left alone, so
// recursion is bounded by real box nesting.
const BOX_CONTAINERS = new Set([
    'moov',
    'trak',
    'mdia',
    'minf',
    'stbl',
    'dinf',
    'edts',
    'mvex',
    'udta',
    'mfra',
    'mooof',
    'traf',
    'skip',
    'free',
]);
function collectBoxes(bytes, start, end, targetType, out = []) {
    walkBoxes(bytes, start, end, (type, boxStart, boxEnd) => {
        if (type === targetType) {
            out.push(boxStart);
            return;
        }
        if (BOX_CONTAINERS.has(type) && boxEnd - boxStart > 8) {
            collectBoxes(bytes, boxStart + 8, boxEnd, targetType, out);
        }
    });
    return out;
}

// Reads the first audio sample entry's codec spec from a moov box.
//
// Two AudioSampleEntry layouts exist in the wild: the ISO 14496-12 layout
// (8 reserved bytes after data_reference_index; channelcount at +24,
// samplesize at +26, samplerate at +32 — used by Tidal's HLS muxer) and the
// QuickTime variant (version/revision/vendor instead; channelcount +16,
// samplesize +18, samplerate +24). Both are tried, plausibility-checked.
function readAudioSpecFromMoov(bytes) {
    for (const stsdStart of collectBoxes(bytes, 0, bytes.length, 'stsd')) {
        const count = readU32(bytes, stsdStart + 12);
        for (let i = 0; i < count; i += 1) {
            const entryStart = stsdStart + 16 + i * 8;
            if (entryStart + 8 > bytes.length) break;
            const entryType = typeString(bytes, entryStart + 4);
            if (entryType === 'fLaC' || entryType === 'mp4a') {
                const codec = entryType === 'fLaC' ? 'FLAC' : 'AAC';
                const readSpec = (channelOff, sizeOff, rateOff) => {
                    const channelCount = readU16(bytes, entryStart + channelOff);
                    const sampleSize = readU16(bytes, entryStart + sizeOff);
                    const sampleRate = readU32(bytes, entryStart + rateOff) >>> 16;
                    if (!(sampleRate >= 8000 && sampleRate <= 768000)) return null;
                    return {
                        codec,
                        sampleRate,
                        bitDepth: sampleSize > 1 ? sampleSize : null,
                        channels: channelCount > 0 ? channelCount : null,
                    };
                };
                const spec = readSpec(24, 26, 32) || readSpec(16, 18, 24);
                if (spec) return spec;
            } else if (entryType === 'Opus') {
                const channelCount = readU8(bytes, entryStart + 9);
                const sampleRate = readU32(bytes, entryStart + 10);
                if (sampleRate > 0) {
                    return {
                        codec: 'Opus',
                        sampleRate,
                        bitDepth: null,
                        channels: channelCount > 0 ? channelCount : null,
                    };
                }
            }
        }
    }
    return {};
}

function resolveUri(uri, baseUrl) {
    try {
        return new URL(uri, baseUrl).toString();
    } catch {
        return uri;
    }
}

async function proxiedFetch(url, init) {
    const rewritten = window.__corsBypass?.rewriteUrl ? window.__corsBypass.rewriteUrl(url) : url;
    return fetch(rewritten, init);
}

async function fetchHeadBytes(url, maxBytes = HEAD_PROBE_BYTES) {
    const res = await proxiedFetch(url, { headers: { Range: `bytes=0-${maxBytes - 1}` } });
    if (!res.ok && res.status !== 206) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    try {
        const chunks = [];
        let total = 0;
        while (total < maxBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.byteLength;
        }
        await reader.cancel().catch(() => {});
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return total > 0 ? out : null;
    } catch {
        return null;
    }
}

// Parses a master or media HLS playlist. Returns {} on malformed input.
function parseHlsManifest(text, baseUrl) {
    const segments = [];
    const variants = [];
    let initUri = null;
    let currentVariantBandwidth = null;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
            const bw = line.match(/BANDWIDTH=(\d+)/i);
            currentVariantBandwidth = bw ? parseInt(bw[1], 10) : null;
        } else if (line.startsWith('#EXT-X-MAP')) {
            const uri = line.match(/URI="([^"]+)"/i);
            if (uri) initUri = uri[1];
        } else if (line.startsWith('#EXTINF')) {
            const dur = parseFloat(line.replace('#EXTINF:', '').split(',')[0]);
            segments.push({ duration: Number.isFinite(dur) && dur > 0 ? dur : null });
        } else if (line && !line.startsWith('#')) {
            if (currentVariantBandwidth != null) {
                variants.push({ bandwidth: currentVariantBandwidth, uri: resolveUri(line, baseUrl) });
                currentVariantBandwidth = null;
            } else if (segments.length > 0 && !segments[segments.length - 1].uri) {
                segments[segments.length - 1].uri = resolveUri(line, baseUrl);
            }
        }
    }

    if (initUri) initUri = resolveUri(initUri, baseUrl);
    return { segments, variants, initUri };
}

const plausible = {
    sampleRate: (v) => Number.isInteger(v) && v >= 8000 && v <= 768000,
    bitDepth: (v) => Number.isInteger(v) && v >= 1 && v <= 32,
    bitrateKbps: (v) => Number.isFinite(v) && v >= 8 && v <= 10000,
    channels: (v) => Number.isInteger(v) && v >= 1 && v <= 32,
};

function pickPlausible(meta) {
    const out = {};
    for (const [key, test] of Object.entries(plausible)) {
        if (meta[key] != null && test(meta[key])) out[key] = meta[key];
    }
    return out;
}

// Resolves a media playlist (following the first variant) and reads the real
// stream spec: bitrate from BANDWIDTH or first segment size ÷ EXTINF, and the
// codec fields from the init segment's audio sample entry.
async function inspectHls(manifestUrl) {
    const manifestRes = await proxiedFetch(manifestUrl);
    if (!manifestRes.ok) return {};
    const manifestText = await manifestRes.text();
    let playlist = parseHlsManifest(manifestText, manifestUrl);
    if (!playlist.variants.length && !playlist.segments.length) return {};

    // Follow the first variant down one level when this is a master playlist.
    if (playlist.variants.length > 0) {
        const variant = playlist.variants[0];
        const variantRes = await proxiedFetch(variant.uri);
        if (!variantRes.ok) return {};
        const child = parseHlsManifest(await variantRes.text(), variant.uri);
        if (child.segments.length > 0) playlist = child;
        if (variant.bandwidth) playlist.bandwidth = variant.bandwidth;
        if (!playlist.initUri) playlist.initUri = child.initUri;
    }

    const meta = {};

    if (playlist.bandwidth) {
        meta.bitrateKbps = Math.round(playlist.bandwidth / 1000);
    } else if (playlist.segments.length > 0) {
        const first = playlist.segments[0];
        if (first.uri && first.duration) {
            try {
                const segRes = await proxiedFetch(first.uri);
                if (segRes.ok) {
                    const size = (await segRes.arrayBuffer()).byteLength;
                    if (size > 0) meta.bitrateKbps = Math.round((size * 8) / first.duration / 1000);
                }
            } catch {
                /* best-effort */
            }
        }
    }

    if (playlist.initUri) {
        const initBytes = await fetchHeadBytes(playlist.initUri);
        if (initBytes) {
            const spec = readAudioSpecFromMoov(initBytes);
            Object.assign(meta, pickPlausible(spec));
        }
    }

    return pickPlausible(meta);
}

// Direct-file path: probe the total byte size via Content-Range and derive the
// bitrate from the track duration; read the sample spec from the file head when
// it's an mp4 container (moov at the start).
async function inspectDirect(url, durationSeconds) {
    const meta = {};

    const headBytes = await fetchHeadBytes(url);
    if (headBytes) {
        const spec = readAudioSpecFromMoov(headBytes);
        Object.assign(meta, pickPlausible(spec));
    }

    if (durationSeconds && durationSeconds > 0) {
        try {
            const res = await proxiedFetch(url, { headers: { Range: 'bytes=0-0' } });
            const total = res.headers.get('content-range')?.match(/\/(\d+)\s*$/);
            if (total) {
                const size = parseInt(total[1], 10);
                if (size > 0) meta.bitrateKbps = Math.round((size * 8) / durationSeconds / 1000);
            } else {
                res.body?.cancel().catch(() => {});
            }
        } catch {
            /* best-effort */
        }
    }

    return pickPlausible(meta);
}

// Public entry point: returns a promise of { sampleRate, bitDepth, bitrateKbps,
// channels, codec } — only fields that were actually read from the media. Never
// rejects. Results are cached per URL.
export async function inspectStreamMetadata(streamUrl, options = {}) {
    if (!streamUrl || typeof streamUrl !== 'string') return {};

    if (STREAM_SPEC_CACHE.has(streamUrl)) {
        return STREAM_SPEC_CACHE.get(streamUrl);
    }

    let meta;
    try {
        if (options.isHls) {
            meta = await inspectHls(streamUrl);
        } else {
            meta = await inspectDirect(streamUrl, options.duration);
        }
    } catch {
        meta = {};
    }

    if (Object.keys(meta).length > 0) {
        if (STREAM_SPEC_CACHE.size >= STREAM_SPEC_CACHE_LIMIT)
            STREAM_SPEC_CACHE.delete(STREAM_SPEC_CACHE.keys().next().value);
        STREAM_SPEC_CACHE.set(streamUrl, meta);
    }
    return meta;
}
