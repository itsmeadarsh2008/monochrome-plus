// Downloads a complete HLS stream (up to Hi-Res / 192 kHz) as a real audio
// file, not a playlist text.
//
// Tidal's Hi-Res FLAC HLS streams are fragmented MP4: a tiny init segment
// (moov + fLaC sample entry carrying the dfLa STREAMINFO block) plus numbered
// segments, each a moof + mdat whose mdat payload is raw FLAC frames. The
// downloader reassembles them into a standalone .flac (fLaC marker +
// STREAMINFO + concatenated frame payloads) — decodable everywhere, and
// ready for tag embedding. Non-FLAC HLS falls back to the raw fMP4 bytes.
//
// Fetches go through window.__corsBypass.rewriteUrl like the rest of the app.

import { parseHlsManifest, proxiedFetch, extractFlacStreamInfo } from './stream-inspector.js';

function extractMdatPayloads(segmentBytes) {
    const payloads = [];
    let p = 0;
    while (p + 8 <= segmentBytes.length) {
        const size =
            ((segmentBytes[p] << 24) |
                (segmentBytes[p + 1] << 16) |
                (segmentBytes[p + 2] << 8) |
                segmentBytes[p + 3]) >>>
            0;
        if (size < 8 || p + size > segmentBytes.length) break;
        const type = String.fromCharCode(
            segmentBytes[p + 4],
            segmentBytes[p + 5],
            segmentBytes[p + 6],
            segmentBytes[p + 7]
        );
        if (type === 'mdat') payloads.push(segmentBytes.subarray(p + 8, p + size));
        p += size;
    }
    return payloads;
}

export class HlsDownloader {
    constructor() {}

    async downloadHlsStream(manifestUrl, options = {}) {
        const { signal, onProgress, fetchFn } = options;
        const doFetch = fetchFn || proxiedFetch;

        // 1. Resolve the media playlist (follow the first variant of a master).
        const manifestRes = await doFetch(manifestUrl, { signal });
        if (!manifestRes.ok) throw new Error(`Failed to fetch HLS manifest: ${manifestRes.status}`);
        let playlist = parseHlsManifest(await manifestRes.text(), manifestUrl);
        if ((!playlist.variants.length && !playlist.segments.length) || !playlist.segments.length) {
            throw new Error('Invalid HLS playlist');
        }
        if (playlist.variants.length > 0) {
            const variantRes = await doFetch(playlist.variants[0].uri, { signal });
            if (!variantRes.ok) throw new Error(`Failed to fetch HLS media playlist: ${variantRes.status}`);
            const child = parseHlsManifest(await variantRes.text(), playlist.variants[0].uri);
            if (!child.segments.length) throw new Error('Invalid HLS media playlist');
            playlist = child;
        }

        // 2. Init segment (carries moov + dfLa STREAMINFO for FLAC).
        let initBytes = null;
        if (playlist.initUri) {
            const initRes = await doFetch(playlist.initUri, { signal });
            if (initRes.ok) initBytes = new Uint8Array(await initRes.arrayBuffer());
        }

        // 3. Download every segment, extracting the mdat audio payload.
        const segments = playlist.segments.filter((s) => s.uri);
        const framePayloads = [];
        const rawSegments = [];
        let downloadedBytes = 0;
        let estimatedTotal = 0;
        let firstSegmentSize = 0;

        for (let i = 0; i < segments.length; i++) {
            if (signal?.aborted) throw new Error('AbortError');

            let segmentRes = await doFetch(segments[i].uri, { signal });
            if (!segmentRes.ok) {
                // Retry once after a short pause before giving up.
                await new Promise((r) => setTimeout(r, 1000));
                segmentRes = await doFetch(segments[i].uri, { signal });
                if (!segmentRes.ok) throw new Error(`Failed to fetch segment ${i}: ${segmentRes.status}`);
            }

            const segmentBytes = new Uint8Array(await segmentRes.arrayBuffer());
            rawSegments.push(segmentBytes);

            const payloads = extractMdatPayloads(segmentBytes);
            if (payloads.length > 0) {
                for (const payload of payloads) framePayloads.push(payload);
                downloadedBytes += payloads.reduce((sum, pl) => sum + pl.byteLength, 0);
                if (!firstSegmentSize) firstSegmentSize = segmentBytes.byteLength;
            }

            if (onProgress) {
                const estimate = estimatedTotal || firstSegmentSize * segments.length;
                if (firstSegmentSize && !estimatedTotal) estimatedTotal = estimate;
                onProgress({
                    stage: 'downloading',
                    receivedBytes: downloadedBytes,
                    totalBytes: estimatedTotal || undefined,
                    currentSegment: i + 1,
                    totalSegments: segments.length,
                });
            }
        }

        if (framePayloads.length === 0) {
            throw new Error('No audio data found in HLS stream');
        }

        // 4. FLAC: fLaC marker + STREAMINFO block + concatenated FLAC frames.
        const streamInfo = initBytes ? extractFlacStreamInfo(initBytes) : null;
        if (streamInfo) {
            const head = new Uint8Array(4 + 4 + 34);
            head.set([0x66, 0x4c, 0x61, 0x43]); // 'fLaC'
            head[4] = 0x80; // last metadata block, type 0 (STREAMINFO)
            head[5] = 0x00;
            head[6] = 0x00;
            head[7] = 34;
            head.set(streamInfo, 8);
            return new Blob([head, ...framePayloads], { type: 'audio/flac' });
        }

        // 5. Non-FLAC fallback: keep the fragmented MP4 as-is.
        return new Blob(initBytes ? [initBytes, ...rawSegments] : rawSegments, { type: 'audio/mp4' });
    }
}
