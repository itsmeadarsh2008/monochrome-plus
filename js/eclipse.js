// js/eclipse.js
// Eclipse addon storage + client. The app's entire music backend is an Eclipse
// addon (https://eclipsemusic.app/docs): search, stream and catalog endpoints
// served by the user's addon. Responses are mapped to the shapes the rest of
// the app expects.

import { APICache } from './cache.js';
import { addMetadataToAudio } from './metadata.js';
import { DashDownloader } from './dash-downloader.js';
import { getExtensionFromBlob, RATE_LIMIT_ERROR_MESSAGE } from './utils.js';

const ADDON_STORAGE_KEY = 'monochrome-eclipse-addon-v2';

export const eclipseAddonStorage = {
    getAddon() {
        try {
            const raw = localStorage.getItem(ADDON_STORAGE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    },

    saveAddon(addon) {
        localStorage.setItem(ADDON_STORAGE_KEY, JSON.stringify(addon));
    },

    clearAddon() {
        localStorage.removeItem(ADDON_STORAGE_KEY);
    },

    async fetchManifest(baseUrl) {
        const normalized = String(baseUrl || '')
            .trim()
            .replace(/\/+$/, '');
        if (!normalized) throw new Error('Addon URL is required');

        const rootUrl = normalized.replace(/\/manifest\.json$/i, '') || normalized;
        const manifestUrl = normalized.endsWith('/manifest.json') ? normalized : `${normalized}/manifest.json`;

        let res;
        try {
            res = await fetch(manifestUrl);
        } catch {
            throw new Error('Addon unreachable — check the URL and your connection');
        }
        if (!res.ok) throw new Error(`Addon unreachable (HTTP ${res.status})`);

        const manifest = await res.json();
        if (!manifest?.id || !Array.isArray(manifest.resources)) {
            throw new Error('Invalid addon manifest');
        }
        if (!manifest.resources.includes('search') || !manifest.resources.includes('stream')) {
            throw new Error('Addon must declare the "search" and "stream" resources');
        }
        return { ...manifest, rootUrl, manifestUrl };
    },

    async ensureInstalled() {
        return this.getAddon();
    },
};

export const NO_ADDON_MESSAGE = 'No Eclipse addon installed. Add one in Settings → Eclipse Addon.';

const SEARCH_CACHE_TTL = 15 * 60 * 1000;

// Minimum gap between addon requests. The addon rate-limits aggressively,
// and the app fires bursts (home = 7 parallel searches, search page = 4).
const MIN_REQUEST_GAP_MS = 180;
// Background work (billboard resolution, etc.) uses a more polite pace and
// only runs when the interactive queues are idle.
const BACKGROUND_REQUEST_GAP_MS = 450;
const MAX_429_RETRIES = 2;

const extractBitDepth = (streamInfo) => {
    const quality = `${streamInfo?.quality || ''} ${streamInfo?.streamQuality || ''}`;
    const match = quality.match(/(\d+)\s*-?\s*bit/i);
    if (match) return parseInt(match[1], 10);
    if (/LOSSLESS/i.test(quality)) return 16;
    return null;
};

const extractSampleRate = (streamInfo) => {
    const quality = `${streamInfo?.quality || ''} ${streamInfo?.streamQuality || ''}`;
    const match = quality.match(/([\d.]+)\s*kHz/i);
    if (match) return Math.round(parseFloat(match[1]) * 1000);
    if (/HI_RES/i.test(quality)) return 96000;
    if (/LOSSLESS/i.test(quality)) return 44100;
    return null;
};

// Extract the actual bitrate (kbps) reported by the addon. Preferred source is
// the numeric bitrate field the addon returns per adaptive format; fall back to
// a "128kbps" style token inside quality strings.
const extractBitrateKbps = (streamInfo) => {
    const raw = streamInfo?.bitrate ?? streamInfo?.audioBitrate ?? streamInfo?.bit_rate ?? streamInfo?.avgBitrate;
    const numeric = parseInt(raw, 10);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.max(1, Math.round(numeric / 1000));
    }
    const qualityTokens = [streamInfo?.quality, streamInfo?.streamQuality, streamInfo?.audioQuality]
        .filter(Boolean)
        .join(' ');
    const tokenMatch = qualityTokens.match(/(\d{2,4})\s*(?:kbps|kbit|kb\/?s)/i);
    return tokenMatch ? parseInt(tokenMatch[1], 10) : null;
};

const yearAsReleaseDate = (year) => (year ? String(year).trim() : undefined);

export class EclipseAPI {
    constructor() {
        this.cache = new APICache({ maxSize: 200, ttl: 1000 * 60 * 30 });
        this.streamCache = new Map();
        this.trackRegistry = new Map();
        this._searchCache = new Map();
        this._searchInflight = new Map();
        this._similarCache = new Map();
        this._requestQueue = [];
        this._priorityQueue = [];
        this._backgroundQueue = [];
        this._queueRunning = false;
        this._backgroundQueueRunning = false;
        this._lastRequestAt = 0;

        setInterval(
            () => {
                this.cache.clearExpired();
                this.pruneStreamCache();
            },
            1000 * 60 * 5
        );
    }

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // Build fetch options that combine the caller's AbortSignal (so stale
    // requests like command-palette keystrokes cancel immediately) with the
    // 15s hung-addon timeout.
    _fetchOptions(signal, useTimeout) {
        if (!useTimeout) return undefined;
        if (!signal) return { signal: AbortSignal.timeout(15000) };
        if (typeof AbortSignal.any === 'function') {
            return { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                controller.abort();
            },
            { once: true }
        );
        return { signal: controller.signal };
    }

    // Serialize addon requests with a minimum gap between them so parallel
    // callers (home sections, search page, command palette) don't trip the
    // addon's rate limiter. Failures never break the queue.
    // High-priority requests (stream URLs, user-initiated playback) jump the
    // queue so play never stalls behind slow background searches.
    // Background requests (billboard resolution, non-visible prefetches) go
    // through a separate lane that only runs when the interactive queues are
    // idle, so they never delay user-facing work.
    _enqueueRequest(fn, priority = false, background = false, signal = null) {
        return new Promise((resolve, reject) => {
            const item = { fn, resolve, reject, signal };
            if (background) {
                this._backgroundQueue.push(item);
                this._pumpBackgroundQueue();
            } else {
                (priority ? this._priorityQueue : this._requestQueue).push(item);
                this._pumpQueue();
            }
        });
    }

    async _pumpQueue() {
        if (this._queueRunning) return;
        this._queueRunning = true;
        try {
            while (this._priorityQueue.length || this._requestQueue.length) {
                const item = this._priorityQueue.shift() || this._requestQueue.shift();
                if (item.signal?.aborted) {
                    item.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                    continue;
                }
                try {
                    const now = performance.now();
                    const waitMs = Math.max(0, this._lastRequestAt + MIN_REQUEST_GAP_MS - now);
                    if (waitMs > 0) await this._sleep(waitMs);
                    this._lastRequestAt = performance.now();
                    item.resolve(await item.fn());
                } catch (error) {
                    item.reject(error);
                }
            }
        } finally {
            this._queueRunning = false;
        }
    }

    async _pumpBackgroundQueue() {
        if (this._backgroundQueueRunning) return;
        this._backgroundQueueRunning = true;
        try {
            while (this._backgroundQueue.length) {
                // Yield to interactive traffic: only run while the main queues
                // are idle so user-facing searches never wait behind background work.
                if (this._priorityQueue.length || this._requestQueue.length) {
                    await this._sleep(200);
                    continue;
                }
                const item = this._backgroundQueue.shift();
                if (item.signal?.aborted) {
                    item.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                    continue;
                }
                try {
                    const now = performance.now();
                    const waitMs = Math.max(0, this._lastRequestAt + BACKGROUND_REQUEST_GAP_MS - now);
                    if (waitMs > 0) await this._sleep(waitMs);
                    this._lastRequestAt = performance.now();
                    item.resolve(await item.fn());
                } catch (error) {
                    item.reject(error);
                }
            }
        } finally {
            this._backgroundQueueRunning = false;
        }
    }

    async _request(
        path,
        retries = MAX_429_RETRIES,
        priority = false,
        background = false,
        persistent = false,
        attempt = 0,
        signal = null
    ) {
        const addon = await eclipseAddonStorage.ensureInstalled();
        if (!addon) throw new Error(NO_ADDON_MESSAGE);

        const baseUrl = (addon.baseUrl || '').replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
        const url = `${baseUrl}/${String(path).replace(/^\/+/, '')}`;

        let res;
        try {
            // A hung addon must never stall the queue forever: every fetch is
            // aborted after 15s so the pump moves on and sections can fall back.
            // A caller-supplied AbortSignal (command palette keystrokes) cancels
            // stale requests so they never sit in the queue consuming slots.
            const useTimeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function';
            res = await this._enqueueRequest(
                () => fetch(url, this._fetchOptions(signal, useTimeout)),
                priority,
                background,
                signal
            );
        } catch (error) {
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
                throw new Error('Addon timed out');
            }
            throw new Error(`Addon unreachable: ${error.message}`);
        }

        if (res.status === 429) {
            // Respect the addon's retry-after when provided; otherwise back off
            // exponentially (500ms → 1s → 2s …), capped so interactive requests
            // never sleep too long. Persistent searches (user-facing search page)
            // keep retrying until the rate limit clears.
            let backoffMs;
            const retryAfter = res.headers.get('retry-after');
            if (retryAfter) {
                const seconds = Number.parseFloat(retryAfter);
                backoffMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
            } else {
                backoffMs = Math.min(500 * Math.pow(2, attempt), persistent ? 30000 : 8000);
            }
            await this._sleep(Math.max(backoffMs, 0));
            if (persistent) {
                return this._request(path, retries, priority, background, persistent, attempt + 1, signal);
            }
            if (retries > 0) {
                return this._request(path, retries - 1, priority, background, false, 0, signal);
            }
            throw new Error(RATE_LIMIT_ERROR_MESSAGE);
        }
        if (res.status === 404) throw new Error('Not supported by this addon');
        if (!res.ok) throw new Error(`Addon error (HTTP ${res.status})`);
        return res.json();
    }

    // ---- search ---------------------------------------------------------

    async _search(query, options = {}) {
        const q = String(query || '').trim();
        if (!q) return { tracks: [], albums: [], artists: [], playlists: [] };

        const cacheKey = q.toLowerCase();
        const cached = this._searchCache.get(cacheKey);
        if (cached) return cached;

        // Deduplicate concurrent identical queries (search page + command
        // palette can race on the same query).
        if (this._searchInflight.has(cacheKey)) return this._searchInflight.get(cacheKey);

        const inflight = (async () => {
            const data = await this._request(
                `search?q=${encodeURIComponent(q)}`,
                MAX_429_RETRIES,
                options?.priority === true,
                options?.background === true,
                options?.retry === true,
                0,
                options?.signal || null
            );
            const result = {
                tracks: (data.tracks || []).map((t) => this.mapSearchTrack(t)),
                albums: (data.albums || []).map((a) => this.mapSearchAlbum(a)),
                artists: (data.artists || []).map((a) => this.mapSearchArtist(a)),
                playlists: (data.playlists || []).map((p) => this.mapSearchPlaylist(p)),
            };

            this._searchCache.set(cacheKey, result);
            setTimeout(() => this._searchCache.delete(cacheKey), SEARCH_CACHE_TTL);
            return result;
        })();
        inflight.finally(() => this._searchInflight.delete(cacheKey)).catch(() => {});
        this._searchInflight.set(cacheKey, inflight);
        return inflight;
    }

    async searchTracks(query, options = {}) {
        const data = await this._search(query, options);
        const items = data.tracks.slice(0, options.limit || 30);
        return { items, limit: options.limit || 30, offset: 0, totalNumberOfItems: items.length };
    }

    async searchAlbums(query, options = {}) {
        const data = await this._search(query, options);
        const items = data.albums.slice(0, options.limit || 30);
        return { items, limit: options.limit || 30, offset: 0, totalNumberOfItems: items.length };
    }

    async searchArtists(query, options = {}) {
        const data = await this._search(query, options);
        const items = data.artists.slice(0, options.limit || 30);
        return { items, limit: options.limit || 30, offset: 0, totalNumberOfItems: items.length };
    }

    /**
     * Resolves an artist id from a display name (search results only carry
     * artist names). Exact name match preferred, otherwise the top result.
     */
    async resolveArtistIdByName(name) {
        if (!name) return null;
        const cleanName = String(name)
            .replace(/\(\s*(?:feat\.?|ft\.?|with)\s+[^)]*\)/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!cleanName) return null;
        try {
            const { items } = await this.searchArtists(cleanName, { limit: 8 });
            if (!items?.length) return null;
            const normalized = cleanName.toLowerCase();
            const exact = items.find((a) => a?.name && String(a.name).toLowerCase() === normalized);
            return (exact || items[0])?.id || null;
        } catch (error) {
            console.warn('Failed to resolve artist id for:', cleanName, error);
            return null;
        }
    }

    async searchPlaylists(query, options = {}) {
        const data = await this._search(query, options);
        const items = data.playlists.slice(0, options.limit || 30);
        return { items, limit: options.limit || 30, offset: 0, totalNumberOfItems: items.length };
    }

    // ---- mappers --------------------------------------------------------

    registerTrack(track) {
        if (track?.id != null) {
            this.trackRegistry.set(String(track.id), track);
        }
        return track;
    }

    mapSearchTrack(t) {
        const track = {
            id: String(t.id),
            title: t.title || 'Unknown Track',
            artist: t.artist ? { name: t.artist } : { name: '' },
            artists: t.artist ? [{ name: t.artist }] : [],
            album: t.album
                ? {
                      id: t.albumId != null ? String(t.albumId) : '',
                      title: t.album,
                      cover: t.albumArtworkURL || t.artworkURL,
                  }
                : null,
            albumId: t.albumId != null ? String(t.albumId) : '',
            albumTitle: t.album,
            duration: t.duration || 0,
            explicit: false,
            isrc: t.isrc || null,
            trackNumber: t.trackNumber,
            format: t.format,
            audioQuality: t.audioQuality,
            provider: t.provider,
            audioModes: t.audioModes || [],
            artwork: t.artworkURL ? [{ url: t.artworkURL }] : [],
            cover: t.artworkURL || t.albumArtworkURL,
            videoCover: null,
        };
        return this.registerTrack(track);
    }

    mapSearchAlbum(a) {
        return {
            id: String(a.id),
            title: a.title,
            cover: a.artworkURL,
            artist: a.artist ? { name: a.artist } : { name: '' },
            artists: a.artist ? [{ name: a.artist }] : [],
            artwork: a.artworkURL ? [{ url: a.artworkURL }] : [],
        };
    }

    mapSearchArtist(a) {
        return {
            id: String(a.id),
            name: a.name,
            picture: a.artworkURL,
            image: a.artworkURL,
        };
    }

    mapSearchPlaylist(p) {
        return {
            uuid: p.id,
            id: p.id,
            title: p.title,
            user: { name: p.creator || '' },
            squareImage: p.artworkURL,
            image: p.artworkURL,
            numberOfTracks: p.trackCount,
            description: '',
        };
    }

    mapDetailTrack(t, fallbackAlbum, fallbackArtistName) {
        const track = {
            id: String(t.id),
            title: t.title || 'Unknown Track',
            artist: t.artist ? { name: t.artist } : { name: fallbackArtistName || '' },
            artists: t.artist ? [{ name: t.artist }] : fallbackArtistName ? [{ name: fallbackArtistName }] : [],
            album: fallbackAlbum
                ? { id: fallbackAlbum.id, title: fallbackAlbum.title, cover: fallbackAlbum.cover }
                : null,
            albumId: fallbackAlbum?.id || '',
            albumTitle: fallbackAlbum?.title,
            duration: t.duration || 0,
            trackNumber: t.trackNumber,
            volumeNumber: 1,
            discNumber: 1,
            explicit: false,
            isrc: t.isrc || null,
            format: t.format,
            artwork: t.artworkURL
                ? [{ url: t.artworkURL }]
                : fallbackAlbum?.cover
                  ? [{ url: fallbackAlbum.cover }]
                  : [],
            cover: t.artworkURL || fallbackAlbum?.cover,
            videoCover: null,
        };
        return this.registerTrack(track);
    }

    // ---- catalog --------------------------------------------------------

    async getAlbum(id) {
        const data = await this._request(`album/${id}`);
        const album = {
            id: String(data.id),
            title: data.title,
            cover: data.artworkURL,
            artist: data.artist ? { name: data.artist } : { name: '' },
            artists: data.artist ? [{ name: data.artist }] : [],
            releaseDate: yearAsReleaseDate(data.year),
            numberOfTracks: data.trackCount,
            artwork: data.artworkURL ? [{ url: data.artworkURL }] : [],
            videoCover: null,
        };
        const tracks = (data.tracks || []).map((t) => this.mapDetailTrack(t, album));
        return { album, tracks };
    }

    async getArtist(id) {
        const data = await this._request(`artist/${id}`);
        const artist = {
            id: String(data.id),
            name: data.name,
            picture: data.artworkURL,
            image: data.artworkURL,
            biography: data.bio || '',
            popularity: 0,
            genres: Array.isArray(data.genres)
                ? data.genres.map((genre) => String(genre || '').trim()).filter(Boolean)
                : [],
            albums: (data.albums || []).map((a) => ({
                id: String(a.id),
                title: a.title,
                cover: a.artworkURL,
                artist: a.artist ? { name: a.artist } : { name: data.name },
                artists: a.artist ? [{ name: a.artist }] : [{ name: data.name }],
                numberOfTracks: a.trackCount,
                releaseDate: yearAsReleaseDate(a.year),
                artwork: a.artworkURL ? [{ url: a.artworkURL }] : [],
            })),
            eps: [],
            tracks: (data.topTracks || []).map((t) =>
                this.mapDetailTrack(t, { id: '', title: '', cover: t.artworkURL }, data.name)
            ),
            mixes: {},
        };
        return artist;
    }

    async getPlaylist(id) {
        const data = await this._request(`playlist/${id}`);
        const playlist = {
            uuid: data.id,
            id: data.id,
            title: data.title,
            user: { name: data.creator || '' },
            squareImage: data.artworkURL,
            image: data.artworkURL,
            numberOfTracks: data.trackCount,
            description: data.description || '',
        };
        const tracks = (data.tracks || []).map((t) =>
            this.mapDetailTrack(t, { id: '', title: playlist.title, cover: data.artworkURL })
        );
        return { playlist, tracks };
    }

    async getMix(id) {
        return {
            mix: { id, title: 'Mix', cover: null, subTitle: 'Mixes are not supported by this addon' },
            tracks: [],
        };
    }

    // ---- streaming ------------------------------------------------------

    async getStreamUrl(id, quality = 'LOSSLESS') {
        const trackId = String(id);
        const key = `stream_${trackId}_${quality || 'LOSSLESS'}`;
        const now = Math.floor(Date.now() / 1000);

        const cached = this.streamCache.get(key);
        if (cached && cached.expiresAt && now < cached.expiresAt - 120) {
            return cached;
        }

        const data = await this._request(`stream/${trackId}`, MAX_429_RETRIES, true);
        const stream = {
            url: data.url,
            format: data.format,
            quality: data.quality,
            streamQuality: data.streamQuality,
            expiresAt: data.expiresAt || now + 3600,
            bitDepth: extractBitDepth(data),
            sampleRate: extractSampleRate(data),
            audioQuality: data.streamQuality || data.quality || null,
            audioMode: null,
            mediaType: data.format || null,
            mimeType: data.mimeType || null,
            bitrateKbps: extractBitrateKbps(data),
        };
        this.streamCache.set(key, stream);
        return stream;
    }

    async getTrack(id, quality) {
        const trackId = String(id);
        const stream = await this.getStreamUrl(trackId, quality);
        const track = this.trackRegistry.get(trackId) || {
            id: trackId,
            title: 'Unknown Track',
            artist: { name: '' },
            artists: [],
            album: null,
            artwork: [],
            cover: null,
        };
        return {
            track,
            info: { manifest: stream.url, expiresAt: stream.expiresAt },
            originalTrackUrl: stream.url,
            url: stream.url,
            bitDepth: stream.bitDepth,
            sampleRate: stream.sampleRate,
            audioQuality: stream.audioQuality,
            audioMode: null,
            mediaType: stream.format,
            mimeType: stream.mimeType,
            bitrateKbps: stream.bitrateKbps,
            isrc: track.isrc || null,
        };
    }

    async getTrackMetadata(id) {
        const track = this.trackRegistry.get(String(id));
        if (!track) throw new Error('Track metadata not available for this track');
        return track;
    }

    pruneStreamCache() {
        const now = Math.floor(Date.now() / 1000);
        for (const [key, entry] of this.streamCache) {
            if (entry.expiresAt && now >= entry.expiresAt) {
                this.streamCache.delete(key);
            }
        }
    }

    // ---- recommendations (synthesized from addon search) ----------------
    // The addon protocol has no "similar"/recommendation endpoints, so these
    // are synthesized from the addon's own catalog:
    //   • similar artists → seed artist genres → artist search by genre
    //   • similar albums  → seed album's artist → "more from this artist"
    //   • similar tracks  → artist + artist/title searches, merged, deduped
    // All synthesis rides the background request lane and caches per seed.

    async getSimilarArtists(artistId, options = {}) {
        const seedId = String(artistId || '');
        if (!seedId) return [];

        const cacheKey = `similar_artists_${seedId}`;
        const cached = this._similarCache.get(cacheKey);
        if (cached && !options.skipCache && Date.now() - cached.at < 10 * 60 * 1000) {
            return cached.items;
        }

        const background = options?.background === true;
        const similar = [];
        let seedName = String(options?.seedName || '').trim();
        let genres = [];

        // A failed seed-detail must not kill synthesis: the caller-provided
        // name (when present) still yields a name-based search below.
        try {
            const data = await this._request(`artist/${seedId}`, MAX_429_RETRIES, false, background);
            seedName = String(data.name || '').trim() || seedName;
            genres = Array.isArray(data.genres)
                ? data.genres
                      .map((genre) => String(genre || '').trim())
                      .filter(Boolean)
                      .slice(0, 2)
                : [];
        } catch (error) {
            console.warn('[Eclipse] Similar-artist seed detail failed for', seedId, error);
        }

        const queries = [...genres, seedName].filter(Boolean).slice(0, 3);
        const seen = new Set([seedName.toLowerCase()]);

        for (const query of queries) {
            try {
                const result = await this.searchArtists(query, { limit: 8, background });
                for (const candidate of result.items || []) {
                    const key = String(candidate?.name || '')
                        .trim()
                        .toLowerCase();
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    similar.push(candidate);
                    if (similar.length >= 8) break;
                }
            } catch (error) {
                console.warn('[Eclipse] Similar-artist search failed for', query, error);
            }
            if (similar.length >= 8) break;
        }

        this._similarCache.set(cacheKey, { at: Date.now(), items: similar });
        return similar;
    }

    async getSimilarAlbums(albumId, options = {}) {
        const seedId = String(albumId || '');
        if (!seedId) return [];

        const cacheKey = `similar_albums_${seedId}`;
        const cached = this._similarCache.get(cacheKey);
        if (cached && !options.skipCache && Date.now() - cached.at < 10 * 60 * 1000) {
            return cached.items;
        }

        const background = options?.background === true;
        const similar = [];
        let artistName = String(options?.seedArtistName || '').trim();
        let seedTitle = '';

        if (!artistName) {
            try {
                const data = await this._request(`album/${seedId}`, MAX_429_RETRIES, false, background);
                artistName = String(data.artist || '').trim();
                seedTitle = String(data.title || '')
                    .trim()
                    .toLowerCase();
            } catch (error) {
                console.warn('[Eclipse] Similar-album seed detail failed for', seedId, error);
            }
        }

        if (artistName) {
            try {
                const result = await this.searchAlbums(artistName, { limit: 14, background });
                for (const album of result.items || []) {
                    const title = String(album?.title || '')
                        .trim()
                        .toLowerCase();
                    if (title && title === seedTitle) continue;
                    similar.push(album);
                    if (similar.length >= 12) break;
                }
            } catch (error) {
                console.warn('[Eclipse] Similar-album search failed for', artistName, error);
            }
        }

        this._similarCache.set(cacheKey, { at: Date.now(), items: similar });
        return similar;
    }

    async getRecommendations(id, options = {}) {
        const seed = this.trackRegistry.get(String(id)) || options.seedTrack || null;
        if (!seed) return { items: [] };

        const background = options?.background === true;
        const artistName = String(seed.artist?.name || seed.artists?.[0]?.name || '').trim();
        const title = String(seed.title || '').trim();
        const queries = [artistName, `${artistName} ${title}`].filter(Boolean);

        const seedId = String(id);
        const candidates = [];
        for (const query of queries.slice(0, 2)) {
            try {
                const results = await this.searchTracks(query, { limit: 24, background });
                candidates.push(...(results.items || []));
            } catch (error) {
                console.warn('[Eclipse] getRecommendations search failed for', query, error);
            }
        }

        const seen = new Set();
        const items = [];
        for (const track of candidates) {
            const trackId = String(track?.id || '');
            if (!trackId || trackId === seedId || seen.has(trackId)) continue;
            seen.add(trackId);
            items.push(track);
            if (items.length >= 25) break;
        }
        return { items };
    }

    async getRecommendedTracksForPlaylist(tracks = [], limit = 30, options = {}) {
        const seeds = (tracks || []).filter((track) => track?.id && (track.title || track.artist?.name)).slice(0, 3);
        if (seeds.length === 0) return [];

        const background = options?.background === true;
        const seedIds = new Set(seeds.map((track) => String(track.id)));
        const seedTitles = new Set(
            seeds
                .map((track) =>
                    String(track.title || '')
                        .trim()
                        .toLowerCase()
                )
                .filter(Boolean)
        );

        const results = await Promise.allSettled(
            seeds.map((seed) => {
                const query = `${seed.artist?.name || ''} ${seed.title || ''}`.trim();
                if (!query) return Promise.resolve({ items: [] });
                return this.searchTracks(query, { limit: limit + 5, background });
            })
        );

        const seen = new Set();
        const items = [];
        for (const result of results) {
            if (result.status !== 'fulfilled') continue;
            for (const track of result.value?.items || []) {
                const trackId = String(track?.id || '');
                const title = String(track?.title || '')
                    .trim()
                    .toLowerCase();
                if (seedIds.has(trackId) || seedTitles.has(title)) continue;
                const key = trackId || `${title}::${String(track?.artist?.name || '').toLowerCase()}`;
                if (seen.has(key)) continue;
                seen.add(key);
                items.push(track);
                if (items.length >= limit) return items;
            }
        }
        return items.slice(0, limit);
    }

    // ---- artist info ----------------------------------------------------

    async getArtistBiography(artistId) {
        const data = await this._request(`artist/${artistId}`);
        return { text: data.bio || '', source: 'Eclipse Addon' };
    }

    async getArtistWebImage(artistName) {
        return null;
    }

    async getLastFmArtistImage(artistName) {
        return null;
    }

    // ---- visual URL helpers (ported) ------------------------------------

    getCoverUrl(id, size = '320') {
        const normalizeSize = (s) => {
            if (typeof s !== 'string') s = String(s);
            if (/^\d+x\d+$/i.test(s)) return s;
            const n = parseInt(s, 10);
            return Number.isFinite(n) && n > 0 ? `${n}x${n}` : '320x320';
        };

        const normalizeRawCoverId = (value) => {
            if (value && typeof value === 'object') {
                value = value.url || value.href || value.src || value.image || value.cover || value.id || '';
            }
            if (value === null || value === undefined) return '';
            return String(value)
                .trim()
                .replace(/^['"]+|['"]+$/g, '');
        };

        const sizeToken = normalizeSize(size);
        const normalizedInput = normalizeRawCoverId(id);

        if (!normalizedInput) {
            return '/assets/appicon.png';
        }

        if (
            normalizedInput.startsWith('http://') ||
            normalizedInput.startsWith('https://') ||
            normalizedInput.startsWith('blob:') ||
            normalizedInput.startsWith('assets/')
        ) {
            try {
                const url = new URL(normalizedInput);
                if (url.hostname === 'resources.tidal.com' && url.pathname.includes('/images/')) {
                    const pathnameWithoutSize = url.pathname.replace(/\/\d+x\d+\.jpg$/i, '').replace(/\/+$/, '');
                    return `${url.origin}${pathnameWithoutSize}/${sizeToken}.jpg`;
                }
            } catch (_) {
                // not a URL object or non-standard format
            }
            return normalizedInput;
        }

        if (/^resources\.tidal\.com\/images\//i.test(normalizedInput)) {
            const normalizedPath = normalizedInput
                .replace(/^resources\.tidal\.com\/images\//i, '')
                .replace(/\/\d+x\d+\.jpg$/i, '')
                .replace(/\/+$/, '');
            return `https://resources.tidal.com/images/${normalizedPath}/${sizeToken}.jpg`;
        }

        if (/^\/images\//i.test(normalizedInput) || /^images\//i.test(normalizedInput)) {
            const normalizedPath = normalizedInput
                .replace(/^\/?images\//i, '')
                .replace(/\/\d+x\d+\.jpg$/i, '')
                .replace(/\/+$/, '');
            return `https://resources.tidal.com/images/${normalizedPath}/${sizeToken}.jpg`;
        }

        let formattedId = normalizedInput;

        if (formattedId.startsWith('/images/')) {
            formattedId = formattedId.replace(/^\/images\//, '');
        }

        if (formattedId.includes('/') || formattedId.includes('-')) {
            formattedId = formattedId.replace(/-/g, '/').replace(/^\/+|\/+$/g, '');

            if (/\.jpg$/i.test(formattedId)) {
                if (formattedId.startsWith('resources.tidal.com/images/')) {
                    return `https://${formattedId}`;
                }
                return `https://resources.tidal.com/images/${formattedId}`;
            }

            return `https://resources.tidal.com/images/${formattedId}/${sizeToken}.jpg`;
        }

        return `https://via.placeholder.com/${sizeToken}?text=No+Cover`;
    }

    getVideoCoverUrl(id, size = '1280') {
        if (!id) return null;

        if (typeof id === 'string' && (id.startsWith('http') || id.startsWith('blob:') || id.startsWith('assets/'))) {
            return id;
        }

        const normalizedId = String(id)
            .replace(/\\/g, '/')
            .replace(/-/g, '/')
            .replace(/^\/+|\/+$/g, '');
        if (!normalizedId) return null;

        const sizeToken = /^\d+x\d+$/i.test(String(size)) ? String(size) : `${size}x${size}`;
        return `https://resources.tidal.com/videos/${normalizedId}/${sizeToken}.mp4`;
    }

    getPreferredVisualUrl(source, size = '1280') {
        if (!source || typeof source !== 'object') return null;

        const videoUrl = this.getVideoCoverUrl(source.videoCover, size);
        if (videoUrl) return videoUrl;
        return this.getCoverUrl(source.cover, size);
    }

    getArtistPictureUrl(id, size = '320') {
        if (!id) {
            return 'assets/appicon.png';
        }

        if (id && typeof id === 'object') {
            if (Array.isArray(id)) {
                const firstUrl = id.find((entry) => typeof entry === 'string' && entry.trim());
                return firstUrl || 'assets/appicon.png';
            }

            if (typeof id.url === 'string' && id.url.trim()) {
                return this.getArtistPictureUrl(id.url, size);
            }

            const stringEntries = Object.entries(id).filter(([, value]) => typeof value === 'string' && value.trim());
            if (stringEntries.length > 0) {
                const normalizedSize = String(size);
                const preferredKeys = [
                    normalizedSize,
                    `${normalizedSize}x${normalizedSize}`,
                    '1280',
                    '1024',
                    '750',
                    '640',
                    '320',
                    '160',
                    '80',
                ];
                for (const key of preferredKeys) {
                    const hit = stringEntries.find(([entryKey]) => entryKey === key);
                    if (hit) return hit[1];
                }

                const numeric = stringEntries
                    .map(([entryKey, value]) => ({ size: Number.parseInt(entryKey, 10), value }))
                    .filter((item) => Number.isFinite(item.size))
                    .sort((a, b) => b.size - a.size);
                if (numeric.length > 0) return numeric[0].value;

                return stringEntries[0][1];
            }
        }

        if (typeof id === 'string' && (id.startsWith('blob:') || id.startsWith('assets/') || id.startsWith('data:'))) {
            return id;
        }

        if (typeof id === 'string' && id.startsWith('http')) {
            return id;
        }

        if (typeof id !== 'string') {
            return 'assets/appicon.png';
        }

        const formattedId = id.replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
    }

    extractStreamUrlFromManifest(manifest) {
        if (!manifest) return null;

        try {
            let decoded;
            if (typeof manifest === 'string') {
                try {
                    decoded = atob(manifest);
                } catch {
                    decoded = manifest;
                }
            } else if (typeof manifest === 'object') {
                if (manifest.urls?.[0]) return manifest.urls[0];
                return null;
            } else {
                return null;
            }

            if (decoded.includes('<MPD')) {
                const blob = new Blob([decoded], { type: 'application/dash+xml' });
                return URL.createObjectURL(blob);
            }

            try {
                const parsed = JSON.parse(decoded);
                if (parsed?.urls?.[0]) {
                    return parsed.urls[0];
                }
            } catch {
                const match = decoded.match(/https?:\/\/[\w\-.~:?#[@!$&'()*+,;=%/]+/);
                return match ? match[0] : null;
            }

            if (typeof manifest === 'string' && /^https?:\/\//.test(manifest)) {
                return manifest;
            }
            return null;
        } catch {
            return null;
        }
    }

    // ---- downloads ------------------------------------------------------

    async downloadTrack(id, quality = 'HI_RES_LOSSLESS', filename, options = {}) {
        const { onProgress, track } = options;

        try {
            const lookup = await this.getTrack(id, quality);
            let streamUrl;
            let blob;

            if (lookup.originalTrackUrl) {
                streamUrl = lookup.originalTrackUrl;
            } else {
                streamUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
                if (!streamUrl) {
                    throw new Error('Could not resolve stream URL');
                }
            }

            if (streamUrl.startsWith('blob:')) {
                try {
                    const downloader = new DashDownloader();
                    blob = await downloader.downloadDashStream(streamUrl, {
                        signal: options.signal,
                        onProgress: options.onProgress,
                    });
                } catch (dashError) {
                    console.error('DASH download failed:', dashError);
                    if (quality !== 'LOSSLESS') {
                        console.warn('Falling back to LOSSLESS (16-bit) download.');
                        return this.downloadTrack(id, 'LOSSLESS', filename, options);
                    }
                    throw dashError;
                }
            } else {
                const response = await fetch(streamUrl, {
                    cache: 'no-store',
                    signal: options.signal,
                });

                if (!response.ok) {
                    throw new Error(`Fetch failed: ${response.status}`);
                }

                const contentLength = response.headers.get('Content-Length');
                const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

                let receivedBytes = 0;

                if (response.body && onProgress) {
                    const reader = response.body.getReader();
                    const chunks = [];

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        if (value) {
                            chunks.push(value);
                            receivedBytes += value.byteLength;

                            onProgress({
                                stage: 'downloading',
                                receivedBytes,
                                totalBytes: totalBytes || undefined,
                            });
                        }
                    }

                    blob = new Blob(chunks, { type: response.headers.get('Content-Type') || 'audio/flac' });
                } else {
                    blob = await response.blob();
                    if (onProgress) {
                        onProgress({
                            stage: 'downloading',
                            receivedBytes: blob.size,
                            totalBytes: blob.size,
                        });
                    }
                }
            }

            if (track) {
                if (onProgress) {
                    onProgress({
                        stage: 'processing',
                        message: 'Adding metadata...',
                    });
                }
                blob = await addMetadataToAudio(blob, track, this, quality);
            }

            const detectedExtension = await getExtensionFromBlob(blob);
            let finalFilename = filename;

            const currentExtension = filename.split('.').pop()?.toLowerCase();
            if (currentExtension && currentExtension !== detectedExtension) {
                finalFilename = filename.replace(/\.[^.]+$/, `.${detectedExtension}`);
            }

            this.triggerDownload(blob, finalFilename);
        } catch (error) {
            if (error.name === 'AbortError') {
                throw error;
            }
            console.error('Download failed:', error);
            throw new Error('Download failed. The stream may require a proxy.');
        }
    }

    triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ---- cache management ----------------------------------------------

    async clearCache() {
        await this.cache.clear();
        this.streamCache.clear();
        this._searchCache.clear();
        this.trackRegistry.clear();
    }

    getCacheStats() {
        return {
            ...this.cache.getCacheStats(),
            streamUrls: this.streamCache.size,
        };
    }

    async clearStreamCache() {
        this.streamCache.clear();
    }
}
