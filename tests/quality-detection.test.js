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
const { deriveTrackQuality, createFullscreenQualityHTML } = await import('../js/utils.js');

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
