import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
    _store: new Map(),
    getItem(key) {
        return this._store.has(key) ? this._store.get(key) : null;
    },
    setItem(key, value) {
        this._store.set(String(key), String(value));
    },
    removeItem(key) {
        this._store.delete(key);
    },
    clear() {
        this._store.clear();
    },
};

globalThis.indexedDB = {
    open() {
        return {
            result: null,
            onerror: null,
            onsuccess: null,
            onupgradeneeded: null,
            addEventListener() {},
        };
    },
};

const { extractBitDepth, extractSampleRate } = await import('../js/eclipse.js');
const { deriveTrackQuality, createFullscreenQualityHTML, getTrackArtistsHTML } = await import('../js/utils.js');
const { mergeRecommendationCandidates } = await import('../js/lastfm.js');

test('generic lossless labels do not imply hardcoded bit depth or sample rate', () => {
    assert.equal(extractBitDepth({ quality: 'LOSSLESS' }), null);
    assert.equal(extractSampleRate({ quality: 'LOSSLESS' }), null);
    assert.equal(extractBitDepth({ quality: 'HI_RES_LOSSLESS' }), null);
    assert.equal(extractSampleRate({ quality: 'HI_RES_LOSSLESS' }), null);
});

test('explicit numeric metadata remains accepted', () => {
    assert.equal(extractBitDepth({ quality: 'FLAC 24-bit 96 kHz' }), 24);
    assert.equal(extractSampleRate({ quality: 'FLAC 24-bit 96 kHz' }), 96000);
    assert.equal(extractBitDepth({ quality: '24-bit / 44.1 kHz' }), 24);
    assert.equal(extractSampleRate({ quality: '24-bit / 44.1 kHz' }), 44100);
});

test('quality is derived from the actual stream metadata when the track metadata is missing', () => {
    const quality = deriveTrackQuality({
        streamInfo: {
            bitDepth: 24,
            sampleRate: 96000,
            codec: 'FLAC',
            mediaType: 'audio/flac',
        },
        album: {},
    });

    assert.equal(quality, 'HI_RES_LOSSLESS');
});

test('actual stream metadata overrides stale track or album metadata', () => {
    const quality = deriveTrackQuality({
        bitDepth: 16,
        sampleRate: 44100,
        codec: 'AAC',
        format: 'AAC',
        album: { bitDepth: 24, sampleRate: 96000 },
        streamInfo: {
            bitDepth: 24,
            sampleRate: 192000,
            codec: 'FLAC',
            format: 'FLAC',
        },
    });

    assert.equal(quality, 'HI_RES_LOSSLESS');
});

test('fullscreen quality reads numeric details from the stream quality string', () => {
    const html = createFullscreenQualityHTML({
        streamInfo: {
            quality: 'FLAC 24-bit 96 kHz',
            codec: 'FLAC',
            format: 'FLAC',
        },
        album: {},
    });

    assert.match(html, /24-bit/i);
    assert.match(html, /96\s*kHz/i);
    assert.match(html, /FLAC/i);
});

test('track artist links support singular artist metadata', () => {
    const html = getTrackArtistsHTML({ artist: { name: 'Artist A' } });

    assert.match(html, /class="artist-link"/);
    assert.match(html, /Artist A/);
    assert.match(html, /data-artist-id=""/);
    assert.match(html, /data-artist-name="Artist A"/);
});

test('recommendation merging keeps multiple distinct tracks instead of collapsing to one', () => {
    const candidates = mergeRecommendationCandidates(
        [
            { title: 'Dawn', artist: { name: 'Artist A' }, match: 0.92 },
            { title: 'Night', artist: { name: 'Artist A' }, match: 0.81 },
        ],
        [
            { title: 'Echo', artist: { name: 'Artist B' }, match: 0.88 },
            { title: 'Drift', artist: { name: 'Artist C' }, match: 0.75 },
        ]
    );

    assert.equal(candidates.length, 4);
    assert.deepEqual(
        candidates.map((item) => `${item.artist.name}:${item.title}`),
        ['Artist A:Dawn', 'Artist B:Echo', 'Artist A:Night', 'Artist C:Drift']
    );
});
