// js/eclipse.js
// Eclipse addon storage + client. The app's entire music backend is an Eclipse
// addon (https://eclipsemusic.app/docs): search, stream and catalog endpoints
// served by the user's addon. Responses are mapped to the shapes the rest of
// the app expects.

import { APICache } from './cache.js';
import { addMetadataToAudio } from './metadata.js';
import { DashDownloader } from './dash-downloader.js';
import { getExtensionFromBlob, isLossyCodec, isLossyContainer, RATE_LIMIT_ERROR_MESSAGE } from './utils.js';

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

// Classifies an addon's base URL to explain why it works on one origin (the
// dev monitor) but not another (a deployed/hosted site).
export function classifyAddonHost(baseUrl) {
    try {
        const u = new URL(String(baseUrl || '').split('#')[0]);
        const hostname = u.hostname.toLowerCase();
        const isLoopback =
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1' ||
            hostname === '[::1]' ||
            /^127\./.test(hostname);
        const isPrivateIp =
            !isLoopback &&
            (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) ||
                hostname.endsWith('.local') ||
                hostname.endsWith('.lan') ||
                hostname.endsWith('.internal'));
        const isInsecure = u.protocol === 'http:' && hostname !== 'localhost' && hostname !== '127.0.0.1';
        return {
            protocol: u.protocol,
            hostname,
            isLoopback,
            isPrivateIp,
            isInsecure,
        };
    } catch {
        return { protocol: '', hostname: '', isLoopback: false, isPrivateIp: false, isInsecure: false };
    }
}

// Probes whether this browser can actually reach an installed addon. Returns a
// classification plus a fetched flag so the UI can explain the failure.
export async function probeAddonReachability(addon) {
    const baseUrl = String(addon?.baseUrl || '').replace(/\/+$/, '');
    const host = classifyAddonHost(baseUrl);
    if (!baseUrl) return { reachable: false, ...host, error: 'No addon URL configured.', hint: null };
    const manifestUrl = `${baseUrl}/manifest.json`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 7000) : null;
    try {
        const res = await fetch(manifestUrl, controller ? { signal: controller.signal } : undefined);
        if (res.ok) {
            return { reachable: true, ...host, manifestUrl };
        }
        return { reachable: false, ...host, error: `HTTP ${res.status}`, manifestUrl };
    } catch (error) {
        let branch = null;
        let errorName = 'network error';
        if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) errorName = 'timed out';
        if (host.isLoopback || host.isPrivateIp) branch = 'localhost-or-lan';
        else if (host.isInsecure) branch = 'http-on-https';
        return {
            reachable: false,
            ...host,
            error: `${errorName}: ${error && error.message ? String(error.message) : ''}`,
            branch,
            manifestUrl,
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// Registers an addon-returned stream URL's host with the global CORS bypass.
// Addons may surface CDNs the app has never seen (e.g. a new Tidal/Qobuz host
// or an addon-hosted DASH/HLS manifest), so the host is added at runtime to the
// proxied set instead of waiting for a source redeploy.
function registerStreamHostForProxy(streamUrl) {
    if (typeof window === 'undefined' || !window.__corsBypass || !streamUrl) return;
    try {
        const parsed = new URL(streamUrl, window.location.href);
        if (!/^https?:$/i.test(parsed.protocol)) return;
        if (parsed.origin === window.location.origin) return;
        window.__corsBypass.addProxyHost(parsed.hostname);
    } catch {
        /* ignore malformed URLs */
    }
}

// Some Eclipse addons expose an HLS playlist through an extensionless
// `/dash/:id` route. The route name is legacy terminology: the response is
// still an HLS playlist, so the player must not treat it as a regular FLAC
// file. Explicit HLS/MPD URLs and addon mediaType values remain authoritative.
function isHlsStreamUrl(streamUrl) {
    if (!streamUrl) return false;
    try {
        const pathname = new URL(streamUrl, window.location.href).pathname.toLowerCase();
        return pathname.endsWith('.m3u8') || (/\/dash(?:\/|$)/.test(pathname) && !pathname.endsWith('.mpd'));
    } catch {
        const normalized = String(streamUrl).toLowerCase();
        return normalized.includes('.m3u8') || /\/dash(?:\/|$)/.test(normalized);
    }
}

const SEARCH_CACHE_TTL = 15 * 60 * 1000;

// Resolved stream URLs are persisted to localStorage so replaying a track
// (even after a page reload) skips the addon round-trip entirely. Entries are
// only reused while comfortably inside their server-reported expiry, and any
// stale URL that fails to load is re-resolved once (see player loaderror retry).
const STREAM_CACHE_LOCAL_PREFIX = 'mc_stream_v1_';
// Cap local persistence at 24h even if the addon reports a longer expiry, to
// bound the chance of replaying a URL the server has since invalidated.
const STREAM_CACHE_LOCAL_MAX_TTL_MS = 24 * 60 * 60 * 1000;
// Margin before the server expiry after which we stop reusing an entry.
const STREAM_CACHE_EXPIRY_MARGIN_S = 120;

// Minimum gap between addon requests. The addon rate-limits aggressively,
// and the app fires bursts (home = 7 parallel searches, search page = 4).
const MIN_REQUEST_GAP_MS = 180;
// Stream URL resolutions (playback) use a faster lane so a freshly-queued play
// never waits a full 180ms behind search/catalog pacing.
const PRIORITY_REQUEST_GAP_MS = 60;
// Background work (billboard resolution, etc.) uses a more polite pace and
// only runs when the interactive queues are idle.
const BACKGROUND_REQUEST_GAP_MS = 450;
const MAX_429_RETRIES = 2;

// Wall-clock budget for persistent requests stuck behind a rate limit. Stream
// resolution and user-facing searches keep retrying until the window clears,
// but never stall the queue longer than this.
const MAX_PERSISTENT_WALL_MS = 45 * 1000;

// Global rate-limit freeze: once the addon answers 429, every queued request
// pauses until the limits clear instead of each failing and retrying on its
// own (bursts of parallel searches hammer the limit harder).
let addonRateLimitUntil = 0;
let lastRateLimitAt = 0;
let rateLimitNotifiedAt = 0;
const RATE_LIMIT_NOTIFY_THROTTLE_MS = 30 * 1000;

// True while the addon is (or recently was) rate-limited. Non-essential
// background traffic (home recommendations, billboards, import matching) is
// dropped entirely under pressure so it can't keep re-tripping the limiter;
// user-facing searches and stream resolution still go through.
function isAddonUnderRatePressure() {
    return addonRateLimitUntil > Date.now() || (lastRateLimitAt !== 0 && Date.now() - lastRateLimitAt < 60000);
}

function notifyRateLimitedOnce() {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    if (now - rateLimitNotifiedAt < RATE_LIMIT_NOTIFY_THROTTLE_MS) return;
    rateLimitNotifiedAt = now;
    window.dispatchEvent(new CustomEvent('addon-rate-limited', { detail: { message: RATE_LIMIT_ERROR_MESSAGE } }));
}

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
    // 20s hung-addon timeout. Rate-limited addons can stall requests upstream,
    // so the timeout is generous while persistent retries still bound dwell.
    _fetchOptions(signal, useTimeout) {
        const timeoutMs = 20000;
        if (!useTimeout) return undefined;
        if (!signal) return { signal: AbortSignal.timeout(timeoutMs) };
        if (typeof AbortSignal.any === 'function') {
            return { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    _enqueueRequest(fn, priority = false, background = false, signal = null, persistent = false) {
        // Under rate pressure, non-essential background work is dropped on
        // arrival — it would only re-trip the limiter and delay recovery.
        if (background && isAddonUnderRatePressure()) {
            return Promise.reject(new Error(RATE_LIMIT_ERROR_MESSAGE));
        }
        return new Promise((resolve, reject) => {
            const item = { fn, resolve, reject, signal, persistent };
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
                // Drain priority (stream/playback) requests first; each lane
                // enforces its own pacing so priority fetches only wait a short
                // gap while regular search/catalog traffic stays polite.
                const fromPriority = this._priorityQueue.length > 0;
                const item = fromPriority ? this._priorityQueue.shift() : this._requestQueue.shift();
                const gapMs = fromPriority ? PRIORITY_REQUEST_GAP_MS : MIN_REQUEST_GAP_MS;
                // While the addon is rate-limited, only persistent requests
                // (stream resolution) keep trying — everything else is dropped
                // instantly instead of queuing behind a doomed fetch that would
                // only re-trip the limiter and extend the freeze.
                if (isAddonUnderRatePressure() && !item.persistent) {
                    notifyRateLimitedOnce();
                    item.reject(new Error(RATE_LIMIT_ERROR_MESSAGE));
                    continue;
                }
                if (item.signal?.aborted) {
                    item.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                    continue;
                }
                try {
                    const now = performance.now();
                    const rateLimitWait = addonRateLimitUntil - Date.now();
                    const waitMs = Math.max(0, this._lastRequestAt + gapMs - now, rateLimitWait);
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
                // Same pressure gate as the interactive queues: background work
                // enqueued before a rate-limit window must not fire into it.
                if (isAddonUnderRatePressure() && !item.persistent) {
                    notifyRateLimitedOnce();
                    item.reject(new Error(RATE_LIMIT_ERROR_MESSAGE));
                    continue;
                }
                if (item.signal?.aborted) {
                    item.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                    continue;
                }
                try {
                    const now = performance.now();
                    const rateLimitWait = addonRateLimitUntil - Date.now();
                    const waitMs = Math.max(0, this._lastRequestAt + BACKGROUND_REQUEST_GAP_MS - now, rateLimitWait);
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
        signal = null,
        startedAt = null
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
                signal,
                persistent
            );
        } catch (error) {
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
                // A rate-limited addon can stall requests so long they trip the
                // fetch timeout. Persistent requests treat that like a 429 and
                // retry within their wall-clock budget instead of dying.
                if (persistent && error?.name === 'TimeoutError') {
                    const start = startedAt ?? Date.now();
                    if (Date.now() - start <= MAX_PERSISTENT_WALL_MS) {
                        addonRateLimitUntil = Math.max(addonRateLimitUntil, Date.now() + 3000);
                        return this._request(
                            path,
                            retries,
                            priority,
                            background,
                            persistent,
                            attempt + 1,
                            signal,
                            start
                        );
                    }
                }
                throw new Error('Addon timed out');
            }
            throw new Error(`Addon unreachable: ${error.message}`);
        }

        if (res.status === 429) {
            lastRateLimitAt = Date.now();
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
            // Freeze the whole queue behind this backoff so sibling requests
            // (parallel searches) don't keep re-tripping the addon's limiter.
            addonRateLimitUntil = Math.max(addonRateLimitUntil, Date.now() + Math.max(backoffMs, 2000));
            await this._sleep(Math.max(backoffMs, 0));
            // Persistent requests (stream resolution, user-facing searches)
            // only give up after a wall-clock budget, so transient rate
            // windows don't kill playback mid-queue.
            if (persistent) {
                const start = startedAt ?? Date.now();
                if (Date.now() - start > MAX_PERSISTENT_WALL_MS) {
                    notifyRateLimitedOnce();
                    throw new Error(RATE_LIMIT_ERROR_MESSAGE);
                }
                return this._request(path, retries, priority, background, persistent, attempt + 1, signal, start);
            }
            if (retries > 0) {
                return this._request(path, retries - 1, priority, background, false, 0, signal);
            }
            notifyRateLimitedOnce();
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

    // A stream entry is reusable only while comfortably inside its server
    // reported expiry (same margin for memory and persistent copies).
    _streamEntryUsable(entry) {
        return Boolean(
            entry && entry.expiresAt && Math.floor(Date.now() / 1000) < entry.expiresAt - STREAM_CACHE_EXPIRY_MARGIN_S
        );
    }

    _getStreamCacheLocal(key) {
        try {
            const raw = localStorage.getItem(STREAM_CACHE_LOCAL_PREFIX + key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            return this._streamEntryUsable(entry) ? entry : null;
        } catch {
            return null;
        }
    }

    // Reads a persisted stream entry even when it has expired (rate-limited
    // resolution fallback). The entry is not treated as fresh — it is only a
    // best-effort URL for a degraded play attempt.
    _getStaleStreamCacheLocal(key) {
        try {
            const raw = localStorage.getItem(STREAM_CACHE_LOCAL_PREFIX + key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    // A stale entry may only substitute when its delivered quality is at least
    // the requested tier. Lossy requests accept anything; lossless requests
    // reject lossy entries (crisis-session caches hold AAC-320 downgrades);
    // Atmos requests additionally accept lossy entries that advertise Atmos,
    // since Atmos is legitimately delivered as lossy E-AC3 JOC.
    _staleStreamMeetsTier(entry, requestedQuality) {
        const q = String(requestedQuality || '').toUpperCase();
        if (/^(LOW|HIGH)$/.test(q)) return true;
        const lossy =
            isLossyCodec(entry.codec || entry.fileCodec) ||
            isLossyContainer(entry.format || entry.containerFormat || entry.mediaType);
        if (!lossy) return true;
        const atmos = /atmos|dolby/i.test(
            String(entry.audioMode || entry.audioQuality || entry.quality || entry.streamQuality || '')
        );
        return /DOLBY_ATMOS/.test(q) && atmos;
    }

    _setStreamCacheLocal(key, entry) {
        try {
            if (!entry) return;
            const nowMs = Date.now();
            const serverExpiryMs = (entry.expiresAt || 0) * 1000;
            const maxExpiryMs = Math.min(serverExpiryMs, nowMs + STREAM_CACHE_LOCAL_MAX_TTL_MS);
            localStorage.setItem(
                STREAM_CACHE_LOCAL_PREFIX + key,
                JSON.stringify({ ...entry, expiresAt: Math.floor(maxExpiryMs / 1000) })
            );
        } catch {
            // Quota exceeded / storage disabled — fall back to in-memory only.
        }
    }

    _forgetStreamCacheLocal(key) {
        try {
            localStorage.removeItem(STREAM_CACHE_LOCAL_PREFIX + key);
        } catch {
            /* ignore */
        }
    }

    _pruneStreamCacheLocal() {
        try {
            const now = Math.floor(Date.now() / 1000);
            for (let i = 0; i < localStorage.length; i++) {
                const storageKey = localStorage.key(i);
                if (!storageKey || !storageKey.startsWith(STREAM_CACHE_LOCAL_PREFIX)) continue;
                try {
                    const entry = JSON.parse(localStorage.getItem(storageKey));
                    if (!entry || !entry.expiresAt || now >= entry.expiresAt) {
                        localStorage.removeItem(storageKey);
                    }
                } catch {
                    localStorage.removeItem(storageKey);
                }
            }
        } catch {
            /* ignore */
        }
    }

    /**
     * Remove a single cached stream URL (memory + persistent) so the next
     * resolution fetches a fresh one.
     */
    forgetStreamUrl(id, quality) {
        const key = `stream_${String(id)}_${quality || 'LOSSLESS'}`;
        this.streamCache.delete(key);
        this._forgetStreamCacheLocal(key);
    }

    async getStreamUrl(id, quality = 'LOSSLESS') {
        const trackId = String(id);
        const key = `stream_${trackId}_${quality || 'LOSSLESS'}`;
        const now = Math.floor(Date.now() / 1000);

        // In-memory cache (fastest).
        const cached = this.streamCache.get(key);
        if (this._streamEntryUsable(cached)) {
            return cached;
        }

        // Persistent cache: instant replay across sessions without an addon hit.
        const local = this._getStreamCacheLocal(key);
        if (local) {
            this.streamCache.set(key, local);
            return local;
        }

        // Some addons (TIDAL/Qobuz) honor a quality hint and can serve higher
        // tiers like Dolby Atmos when asked; the hint is a no-op for addons that
        // always pick a single canonical stream. The cache key already includes
        // the quality, so a fresh tier is requested (and cached) independently.
        let data;
        try {
            data = await this._request(
                `stream/${trackId}?quality=${encodeURIComponent(quality || 'LOSSLESS')}`,
                MAX_429_RETRIES,
                true,
                false,
                true
            );
        } catch (error) {
            // Under rate pressure a cached URL (even past its nominal expiry)
            // is worth trying — Tidal CDN URLs commonly outlive their expiry,
            // and playback degrades gracefully instead of failing outright.
            // A stale entry must still MEET the requested tier though: silently
            // playing "High · AAC · 320 kbps" for a lossless request is not
            // graceful — it is a quiet downgrade. Quality-crisis sessions have
            // poisoned the persisted cache with exactly such lossy entries.
            if (error?.message === RATE_LIMIT_ERROR_MESSAGE) {
                const stale = this._getStaleStreamCacheLocal(key);
                if (stale?.url && this._staleStreamMeetsTier(stale, quality)) {
                    console.warn('[Eclipse] Addon rate-limited — reusing stale stream URL for', trackId);
                    data = stale;
                } else {
                    if (stale?.url) {
                        console.warn(
                            '[Eclipse] Stale stream URL for',
                            trackId,
                            'does not meet requested tier',
                            quality,
                            '— failing playback'
                        );
                    }
                    throw error;
                }
            } else {
                throw error;
            }
        }
        const stream = {
            url: data.url,
            format: data.format,
            quality: data.quality,
            streamQuality: data.streamQuality,
            expiresAt: data.expiresAt || now + 3600,
            bitDepth: extractBitDepth(data),
            sampleRate: extractSampleRate(data),
            audioQuality: data.streamQuality || data.quality || data.audioQuality || null,
            audioMode:
                data.audioMode ||
                (Array.isArray(data.audioModes) ? data.audioModes.find((m) => /atmos|dolby/i.test(String(m))) : null) ||
                null,
            // The reference addon serves an HLS playlist from an extensionless
            // `/dash/:id` URL while reporting `format: "flac"`. Keep `format`
            // for quality/codec metadata, but expose the transport separately
            // so Eclipse playback goes through the HLS engine.
            mediaType: data.mediaType || (isHlsStreamUrl(data.url) ? 'HLS' : data.format || null),
            mimeType: data.mimeType || null,
            codec: data.codec || data.fileCodec || null,
            containerFormat: data.containerFormat || null,
            bitrateKbps: extractBitrateKbps(data),
        };
        this.streamCache.set(key, stream);
        this._setStreamCacheLocal(key, stream);
        registerStreamHostForProxy(stream.url);
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
            audioMode: stream.audioMode,
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
        this._pruneStreamCacheLocal();
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

        // During rate-limit windows the whole synthesis cascade (seed detail +
        // up to three searches per artist) is dropped at the source — it is
        // invisible homepage decoration, not worth re-tripping the limiter.
        if (isAddonUnderRatePressure()) {
            console.warn('[Eclipse] Skipping similar-artist synthesis for', seedId, '— addon under rate pressure');
            return [];
        }

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
        // Under rate pressure, only the artist query runs (the "artist title"
        // combo query doubles volume for marginal relevance).
        const queries = isAddonUnderRatePressure() ? [artistName] : [artistName, `${artistName} ${title}`];
        const queriesToRun = queries.filter(Boolean).slice(0, 2);

        const seedId = String(id);
        const candidates = [];
        for (const query of queriesToRun) {
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
        // Under rate pressure, cap to two seeds so the home page can't fan out
        // into a fresh search burst while the addon is already throttled.
        const maxSeeds = isAddonUnderRatePressure() ? 2 : 3;
        const seeds = (tracks || [])
            .filter((track) => track?.id && (track.title || track.artist?.name))
            .slice(0, maxSeeds);
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
        this._clearStreamCacheLocalAll();
    }

    getCacheStats() {
        return {
            ...this.cache.getCacheStats(),
            streamUrls: this.streamCache.size,
        };
    }

    async clearStreamCache() {
        this.streamCache.clear();
        this._clearStreamCacheLocalAll();
    }

    _clearStreamCacheLocalAll() {
        try {
            const removals = [];
            for (let i = 0; i < localStorage.length; i++) {
                const storageKey = localStorage.key(i);
                if (storageKey && storageKey.startsWith(STREAM_CACHE_LOCAL_PREFIX)) {
                    removals.push(storageKey);
                }
            }
            for (const storageKey of removals) {
                localStorage.removeItem(storageKey);
            }
        } catch {
            /* ignore */
        }
    }
}
