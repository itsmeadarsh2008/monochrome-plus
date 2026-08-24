//js/lastfm.js
import { lastFMStorage } from './storage.js';

const LASTFM_DEFAULT_API_KEY = '85214f5abbc730e78770f27784b9bdf7';
const LASTFM_PLACEHOLDER_HASHES = new Set([
    '2a96cbd8b46e442fc41c2b86b821562f',
    'c6f59c1e5e7240a4c0d427abd71f3dbb',
    '4128a6eb29f94943c9d206c08e625904',
]);
const LASTFM_IMAGE_PRIORITY = ['mega', 'extralarge', 'large', 'medium', 'small'];

const recommendationCache = new Map();
const RECOMMENDATION_CACHE_TTL = 10 * 60 * 1000;
let personalizedRecommendationPromise = null;

function resolveLastFmApiKey() {
    if (lastFMStorage.useCustomCredentials()) {
        return lastFMStorage.getCustomApiKey() || LASTFM_DEFAULT_API_KEY;
    }
    return LASTFM_DEFAULT_API_KEY;
}

async function lastFmRecommendationRequest(method, params = {}, options = {}) {
    const query = new URLSearchParams({
        method,
        api_key: options.apiKey || resolveLastFmApiKey(),
        format: 'json',
        ...params,
    });
    const cacheKey = query.toString();
    const cached = recommendationCache.get(cacheKey);
    if (cached && Date.now() - cached.at < RECOMMENDATION_CACHE_TTL) return cached.data;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 3500);
    try {
        const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Last.fm request failed (${response.status})`);
        const data = await response.json();
        if (data.error) throw new Error(data.message || 'Last.fm API error');
        recommendationCache.set(cacheKey, { at: Date.now(), data });
        return data;
    } finally {
        clearTimeout(timeout);
    }
}

const normalizeRecommendationText = (value) => String(value || '').trim().toLowerCase();

export async function fetchLastFmSimilarTracks(track, options = {}) {
    const title = typeof track === 'string' ? track : track?.title;
    const artist = typeof track === 'string' ? options.artist : track?.artist?.name || track?.artists?.[0]?.name;
    if (!title || !artist) return [];
    try {
        const data = await lastFmRecommendationRequest('track.getSimilar', {
            artist,
            track: title,
            autocorrect: 1,
            limit: options.limit || 20,
        }, options);
        return (data?.similartracks?.track || []).map((candidate) => ({
            title: candidate.name,
            artist: { name: candidate.artist?.name || '' },
            match: Number(candidate.match) || 0,
            image: getBestLastFmImage(candidate.image, { tryUpscale: false }),
        })).filter((candidate) => candidate.title && candidate.artist.name);
    } catch (error) {
        console.warn('[Last.fm] Similar track lookup failed:', error?.message || error);
        return [];
    }
}

/**
 * Last.fm's authenticated recommendation feed is artist-based. The API does
 * not currently expose a personalized recommended-tracks method, so callers
 * can use these artists as seeds for artist.getTopTracks/getTopAlbums.
 */
export async function fetchLastFmPersonalizedArtists(options = {}) {
    if (personalizedRecommendationPromise && !options.skipCache) return personalizedRecommendationPromise;

    const scrobbler = new LastFMScrobbler();
    if (!scrobbler.isAuthenticated()) return [];

    const request = scrobbler
        .makeRequest(
            'user.getRecommendedArtists',
            {
                user: scrobbler.username,
                limit: options.limit || 30,
            },
            true
        )
        .then(
            (data) =>
                data?.recommendations?.artist ||
                data?.recommendedartists?.artist ||
                data?.artists?.artist ||
                []
        )
        .catch((error) => {
            console.warn('[Last.fm] Personalized recommendations unavailable:', error?.message || error);
            return [];
        });
    personalizedRecommendationPromise = Promise.race([
        request,
        new Promise((resolve) => setTimeout(() => resolve([]), options.timeoutMs || 3500)),
    ]);

    try {
        return await personalizedRecommendationPromise;
    } finally {
        if (options.skipCache) personalizedRecommendationPromise = null;
    }
}

export async function fetchLastFmUserRecentTracks(options = {}) {
    const scrobbler = new LastFMScrobbler();
    if (!scrobbler.isAuthenticated() || !scrobbler.username) return [];

    try {
        const data = await lastFmRecommendationRequest('user.getRecentTracks', {
            user: scrobbler.username,
            limit: options.limit || 50,
            extended: 1,
        }, options);
        return (data?.recenttracks?.track || [])
            .filter(
                (track) =>
                    track?.name &&
                    track?.artist?.name &&
                    track?.['@attr']?.nowplaying !== 'true' &&
                    track?.['@attr']?.nowplaying !== true
            )
            .map((track) => ({
                title: track.name,
                artist: { name: track.artist.name },
                album: track.album?.['#text']
                    ? { title: track.album['#text'], artist: { name: track.artist.name } }
                    : null,
                cover: getBestLastFmImage(track.image, { tryUpscale: false }),
                playedAt: track.date?.uts ? Number(track.date.uts) * 1000 : null,
            }));
    } catch (error) {
        console.warn('[Last.fm] Recent tracks lookup failed:', error?.message || error);
        return [];
    }
}

export async function fetchAllLastFmUserRecentTracks(options = {}) {
    const scrobbler = new LastFMScrobbler();
    if (!scrobbler.isAuthenticated() || !scrobbler.username) return [];

    const pageSize = Math.min(200, Math.max(1, options.limit || 200));
    const allTracks = [];
    let page = 1;
    let totalPages = 1;

    do {
        const query = new URLSearchParams({
            user: scrobbler.username,
            limit: pageSize,
            page,
            extended: 1,
        });
        const data = await lastFmRecommendationRequest('user.getRecentTracks', Object.fromEntries(query), options);
        const recentTracks = data?.recenttracks?.track || [];
        totalPages = Math.max(1, Number(data?.recenttracks?.['@attr']?.totalPages) || page);
        allTracks.push(
            ...recentTracks
                .filter(
                    (track) =>
                        track?.name &&
                        track?.artist?.name &&
                        track?.['@attr']?.nowplaying !== 'true' &&
                        track?.['@attr']?.nowplaying !== true
                )
                .map((track) => ({
                    title: track.name,
                    artist: { name: track.artist.name },
                    album: track.album?.['#text']
                        ? { title: track.album['#text'], artist: { name: track.artist.name } }
                        : null,
                    cover: getBestLastFmImage(track.image, { tryUpscale: false }),
                    playedAt: track.date?.uts ? Number(track.date.uts) * 1000 : null,
                }))
        );
        page++;
    } while (page <= totalPages);

    return allTracks;
}

export async function fetchLastFmArtistTopTracks(artist, options = {}) {
    const name = typeof artist === 'string' ? artist : artist?.name;
    if (!name) return [];
    try {
        const data = await lastFmRecommendationRequest('artist.getTopTracks', {
            artist: name,
            autocorrect: 1,
            limit: options.limit || 8,
        }, options);
        return (data?.toptracks?.track || []).map((track) => ({
            title: track.name,
            artist: { name: track.artist?.name || name },
            match: Number(track.listeners) || 0,
        })).filter((track) => track.title && track.artist.name);
    } catch (error) {
        console.warn('[Last.fm] Artist top tracks lookup failed:', error?.message || error);
        return [];
    }
}

export async function fetchLastFmSimilarArtists(artist, options = {}) {
    const name = typeof artist === 'string' ? artist : artist?.name;
    if (!name) return [];
    try {
        const data = await lastFmRecommendationRequest('artist.getSimilar', {
            artist: name,
            autocorrect: 1,
            limit: options.limit || 20,
        }, options);
        return (data?.similarartists?.artist || []).map((candidate) => ({
            name: candidate.name,
            match: Number(candidate.match) || 0,
            picture: getBestLastFmImage(candidate.image, { tryUpscale: false }),
        })).filter((candidate) => candidate.name);
    } catch (error) {
        console.warn('[Last.fm] Similar artist lookup failed:', error?.message || error);
        return [];
    }
}

export function isSameLastFmTrack(candidate, track) {
    return normalizeRecommendationText(candidate?.title) === normalizeRecommendationText(track?.title) &&
        normalizeRecommendationText(candidate?.artist?.name) ===
            normalizeRecommendationText(track?.artist?.name || track?.artists?.[0]?.name);
}

function isValidLastFmImageUrl(url) {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    return !Array.from(LASTFM_PLACEHOLDER_HASHES).some((hash) => trimmed.includes(hash));
}

function tryUpscaleLastFmImage(url) {
    if (typeof url !== 'string' || !url) return url;
    if (/\/i\/u\/500x500\//.test(url) || /\/i\/u\/500\//.test(url)) return url;
    if (/\/i\/u\/300x300\//.test(url)) return url.replace('/300x300/', '/500x500/');
    if (/\/i\/u\/300\//.test(url)) return url.replace('/300/', '/500/');
    return url;
}

export function getBestLastFmImage(images, options = {}) {
    if (!images) return null;
    const list = Array.isArray(images) ? images : [images];
    const shouldUpscale = options.tryUpscale !== false;

    for (const size of LASTFM_IMAGE_PRIORITY) {
        const hit = list.find((img) => img?.size === size && isValidLastFmImageUrl(img?.['#text']));
        if (hit) {
            const picked = hit['#text'].trim();
            return shouldUpscale ? tryUpscaleLastFmImage(picked) : picked;
        }
    }

    const fallback = list.find((img) => isValidLastFmImageUrl(img?.['#text']));
    if (!fallback) return null;
    const picked = fallback['#text'].trim();
    return shouldUpscale ? tryUpscaleLastFmImage(picked) : picked;
}

export async function fetchLastFmArtistImage(artistName, options = {}) {
    const name = typeof artistName === 'string' ? artistName.trim() : '';
    if (!name) return null;

    const apiKey = options.apiKey || resolveLastFmApiKey();
    const endpoint =
        `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}` +
        `&autocorrect=1&api_key=${apiKey}&format=json`;

    try {
        const response = await fetch(endpoint);
        if (!response.ok) return null;
        const data = await response.json();
        return getBestLastFmImage(data?.artist?.image, { tryUpscale: options.tryUpscale !== false });
    } catch (error) {
        console.warn('Failed to fetch Last.fm artist image:', error);
        return null;
    }
}

// ---- scrobble metadata resolution ---------------------------------------
//
// Last.fm matches a scrobble against its own (MusicBrainz-backed) database
// using artist + track + album. When the source addon reports a sloppy
// album title (trailing spaces, partial titles, "Artist - Single" place-
// holders) or a non-canonical artist credit, the scrobble lands on the
// wrong release — and the Last.fm dashboard shows the generic placeholder
// instead of the real album art. Resolve the canonical release first:
//
//   1. track.isrc  -> MusicBrainz recording lookup (exact, ISRC is unique
//                     per recording; the recording's releases are real
//                     releases, earliest date preferred unless the local
//                     album title matches one exactly)
//   2. otherwise   -> Last.fm track.getInfo with autocorrect=1 (canonical
//                     artist/track/album as Last.fm itself stores them)
//
// Results are cached (30 days positive, 1 day miss) in memory + localStorage
// so a lookup costs nothing on repeat plays. MusicBrainz requests are
// serialized with 1.1 s spacing to respect their rate limit.

const MUSICBRAINZ_API = 'https://musicbrainz.org/ws/2';
// v2: v1 cached album-less getInfo results as 30-day positives, which
// short-circuited the spelling bridge added later. Bump to invalidate.
const METADATA_CACHE_KEY = 'lastfm-scrobble-metadata-v2';
const METADATA_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const METADATA_MISS_TTL = 24 * 60 * 60 * 1000;
const METADATA_CACHE_MAX = 500;

const metadataCache = new Map();
let metadataQueue = Promise.resolve();

function loadMetadataCache() {
    try {
        const raw = localStorage.getItem(METADATA_CACHE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        for (const [key, entry] of Object.entries(data.entries || {})) {
            if (entry && typeof entry === 'object') metadataCache.set(key, entry);
        }
    } catch {
        console.warn('Failed to load scrobble metadata cache');
    }
}

function persistMetadataCache() {
    try {
        const entries = {};
        let count = 0;
        for (const [key, entry] of metadataCache) {
            entries[key] = entry;
            count += 1;
            if (count >= METADATA_CACHE_MAX) break;
        }
        localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify({ version: 2, entries }));
    } catch {
        // Storage full or unavailable — the in-memory cache still works.
    }
}

function getCachedMetadata(key) {
    const entry = metadataCache.get(key);
    if (!entry) return null;
    const ttl = entry.miss ? METADATA_MISS_TTL : METADATA_CACHE_TTL;
    if (Date.now() - entry.ts < ttl) return entry;
    metadataCache.delete(key);
    return null;
}

function setCachedMetadata(key, data, miss) {
    if (metadataCache.size >= METADATA_CACHE_MAX) {
        metadataCache.delete(metadataCache.keys().next().value);
    }
    metadataCache.set(key, { data, miss: !!miss, ts: Date.now() });
    persistMetadataCache();
}

function enqueueMusicBrainz(path) {
    const run = metadataQueue.then(async () => {
        const response = await fetch(`${MUSICBRAINZ_API}${path}`, {
            headers: { 'User-Agent': 'MonochromePlus/1.0 (https://github.com/itsmeadarsh2008/monochrome-plus)' },
        });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return response;
    });
    metadataQueue = run.catch(() => {});
    return run;
}

function normalizeTitle(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201C\u201D"']/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Primary artist name for scrobbling: first artist credit, stripped of
// featured-artist suffixes ("feat.", "ft.", "&", "with", "x", …).
export function getScrobbleArtist(track) {
    if (!track) return 'Unknown Artist';

    let artistName = 'Unknown Artist';

    if (track.artist?.name) {
        artistName = track.artist.name;
    } else if (typeof track.artist === 'string') {
        artistName = track.artist;
    } else if (track.artists && track.artists.length > 0) {
        const first = track.artists[0];
        artistName = typeof first === 'string' ? first : first.name || 'Unknown Artist';
    }

    if (typeof artistName !== 'string') return 'Unknown Artist';

    // Strip featured artists: split on &, feat., ft., featuring, x, etc.
    // NOTE: "with" is deliberately NOT split on — "MAN WITH A MISSION" is a
    // band name, and splitting it truncated real credits to "milet, MAN".
    artistName = artistName.split(/\s*[&]\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+x\s+/i)[0].trim();

    return artistName || 'Unknown Artist';
}

async function resolveByIsrc(isrc, localAlbumTitle, localTrackTitle) {
    const normalizedLocalAlbum = normalizeTitle(localAlbumTitle);
    const cacheKey = `isrc:${isrc}\u0000${normalizedLocalAlbum}`;
    const cached = getCachedMetadata(cacheKey);
    if (cached) return cached.data;

    // The MusicBrainz recording itself is cached once per ISRC; only the
    // release choice depends on the local album context.
    const rawKey = `isrcraw:${isrc}`;
    let recording = getCachedMetadata(rawKey)?.data || null;
    if (!recording) {
        try {
            const path = `/recording?query=${encodeURIComponent(`isrc:${isrc}`)}&fmt=json&limit=5`;
            const response = await enqueueMusicBrainz(path);
            if (!response.ok) {
                setCachedMetadata(cacheKey, null, true);
                return null;
            }
            const data = await response.json();
            const found = data?.recordings?.[0];
            if (!found) {
                setCachedMetadata(cacheKey, null, true);
                return null;
            }

            const artistCredit = (found['artist-credit'] || [])
                .map((credit) => credit.name || credit.artist?.name || '')
                .filter(Boolean)
                .join(', ');

            recording = {
                title: found.title || null,
                artist: artistCredit || null,
                mbid: found.id || null,
                releases: (found.releases || []).map((release) => ({
                    title: release.title || null,
                    date: release.date || null,
                })),
            };
            setCachedMetadata(rawKey, recording, false);
        } catch (error) {
            console.warn('MusicBrainz ISRC lookup failed:', error);
            setCachedMetadata(cacheKey, null, true);
            return null;
        }
    }
    if (!recording) return null;

    const releases = recording.releases || [];
    let release = null;
    if (releases.length > 0) {
        release =
            releases.find((candidate) => normalizeTitle(candidate.title) === normalizedLocalAlbum) ||
            releases.slice().sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')))[0];
    }

    // Keep the source's track title when it matches the chosen release —
    // that is the release's own track name (e.g. "Kesariya (From
    // "Brahmastra")" for the single), which is what Last.fm stores too.
    // Otherwise fall back to the bare MusicBrainz recording title.
    let title = recording.title || null;
    if (release && localTrackTitle && normalizeTitle(localTrackTitle) === normalizeTitle(release.title)) {
        title = localTrackTitle;
    }

    const result = {
        title,
        artist: recording.artist || null,
        mbid: recording.mbid || null,
        album: release?.title || null,
        releaseDate: release?.date || null,
    };

    // Last.fm's database sometimes names the same release differently than
    // MusicBrainz (e.g. MB "コイコガレ" -> Last.fm "絆ノ奇跡 / コイコガレ").
    // Verify against Last.fm itself so the scrobble lands on a release it
    // actually has — that is what puts album art on the dashboard.
    const lfm = await lastFmGetInfo(recording.artist, result.title);
    let final = result;
    if (lfm?.album) {
        const wasLocalExact = normalizedLocalAlbum && normalizeTitle(result.album) === normalizedLocalAlbum;
        if (!wasLocalExact || normalizeTitle(lfm.album) === normalizeTitle(result.album)) {
            final = lfm;
        }
    } else {
        const bridged = await resolveByLastFm(recording.artist, result.title);
        if (bridged?.album) final = bridged;
    }
    setCachedMetadata(cacheKey, final, false);
    return final;
}

async function lastFmGetInfo(artist, title) {
    const endpoint =
        `https://ws.audioscrobbler.com/2.0/?method=track.getInfo` +
        `&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}` +
        `&autocorrect=1&api_key=${resolveLastFmApiKey()}&format=json`;
    const response = await fetch(endpoint);
    if (!response.ok) return null;
    const data = await response.json();
    const info = data?.track;
    if (!info || data.error) return null;
    return {
        title: info.name || null,
        artist: info.artist?.name || null,
        mbid: info.mbid || null,
        album: info.album?.title || null,
        releaseDate: null,
    };
}

async function lastFmSearch(query) {
    const endpoint =
        `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(query)}` +
        `&limit=10&api_key=${resolveLastFmApiKey()}&format=json`;
    const response = await fetch(endpoint);
    if (!response.ok) return [];
    const data = await response.json();
    return (data?.results?.trackmatches?.track || []).map((t) => ({ artist: t.artist, name: t.name }));
}

// Splits a bilingual track name into its parts ("コイコガレ - Koi Kogare"
// -> ["コイコガレ - Koi Kogare", "コイコガレ", "Koi Kogare"]) so the bridge
// can try each spelling against Last.fm's database.
function candidateSpellings(name) {
    const spellings = new Set([String(name || '')]);
    for (const segment of String(name || '').split(/\s*[-–—·]\s*|\s*\/\s*/)) {
        if (segment.trim()) spellings.add(segment);
    }
    spellings.delete('');
    return [...spellings];
}

// Resolves the canonical Last.fm metadata for a track. First a direct
// track.getInfo; if that yields no album (Last.fm has no release attached to
// that exact spelling), a track.search bridge hunts for alternate spellings —
// e.g. "Koi Kogare" -> "コイコガレ - Koi Kogare" -> "コイコガレ", which is the
// spelling Last.fm's database actually links to an album (and its art).
async function resolveByLastFm(artist, title) {
    const cacheKey = `lfm:${artist.toLowerCase()}\u0000${title.toLowerCase()}`;
    const cached = getCachedMetadata(cacheKey);
    if (cached) return cached.data;

    const tried = new Set();
    const tryInfo = async (candidateArtist, candidateTitle, paced = true) => {
        const marker = `${candidateArtist.toLowerCase()}\u0000${candidateTitle.toLowerCase()}`;
        if (tried.has(marker)) return null;
        tried.add(marker);
        if (paced) await new Promise((resolve) => setTimeout(resolve, 350));
        return lastFmGetInfo(candidateArtist, candidateTitle);
    };

    const direct = await tryInfo(artist, title, false);
    if (direct?.album) {
        setCachedMetadata(cacheKey, direct, false);
        return direct;
    }

    const matches = await lastFmSearch(`${title} ${artist}`);
    for (const match of matches.slice(0, 6)) {
        for (const spelling of candidateSpellings(match.name)) {
            const info = await tryInfo(match.artist, spelling);
            if (info?.album) {
                setCachedMetadata(cacheKey, info, false);
                return info;
            }
        }
    }

    // Nothing with an album found — keep the direct match (if any) so the
    // scrobble still goes out with best-effort metadata. Cache as a miss
    // (short TTL) when the result carries no album: an album-less result must
    // never block the bridge from re-running on a later play.
    const miss = !direct?.album;
    setCachedMetadata(cacheKey, direct || null, miss);
    return direct || null;
}

// Resolves the canonical (artist, track, album, mbid) for a scrobble. Never
// throws; returns null when nothing could be resolved, in which case the
// caller keeps the track's own metadata.
export async function resolveScrobbleMetadata(track) {
    if (!track) return null;

    let resolved = null;
    if (track.mbid) {
        resolved = { title: null, artist: null, album: null, mbid: track.mbid, releaseDate: null };
    } else if (track.isrc) {
        resolved = await resolveByIsrc(track.isrc, track.album?.title, track.cleanTitle || track.title);
    }
    if (!resolved) {
        const artist = getScrobbleArtist(track);
        const title = track.cleanTitle || track.title;
        if (artist && artist !== 'Unknown Artist' && title && title !== 'Unknown Track') {
            resolved = await resolveByLastFm(artist, title);
        }
    }
    return resolved;
}

function applyResolvedMetadata(params, resolved) {
    if (!resolved) return;
    if (resolved.artist) params.artist = resolved.artist;
    if (resolved.title) params.track = resolved.title;
    if (resolved.album) params.album = resolved.album;
    if (resolved.mbid) params.mbid = resolved.mbid;
}

loadMetadataCache();

export class LastFMScrobbler {
    constructor() {
        this.DEFAULT_API_KEY = '85214f5abbc730e78770f27784b9bdf7';
        this.DEFAULT_API_SECRET = '2c2c37fd86739191860db810dd063292';
        this.API_URL = 'https://ws.audioscrobbler.com/2.0/';

        this.sessionKey = null;
        this.username = null;
        this.currentTrack = null;
        this.scrobbleTimer = null;
        this.scrobbleThreshold = 0;
        this.hasScrobbled = false;
        this.isScrobbling = false;

        this.loadCredentials();
        this.loadSession();
    }

    loadCredentials() {
        if (lastFMStorage.useCustomCredentials()) {
            this.API_KEY = lastFMStorage.getCustomApiKey() || this.DEFAULT_API_KEY;
            this.API_SECRET = lastFMStorage.getCustomApiSecret() || this.DEFAULT_API_SECRET;
        } else {
            this.API_KEY = this.DEFAULT_API_KEY;
            this.API_SECRET = this.DEFAULT_API_SECRET;
        }
    }

    reloadCredentials() {
        this.loadCredentials();
    }

    loadSession() {
        try {
            const session = localStorage.getItem('lastfm-session');
            if (session) {
                const data = JSON.parse(session);
                this.sessionKey = data.key;
                this.username = data.name;
            }
        } catch {
            console.error('Failed to load Last.fm session');
        }
    }

    saveSession(sessionKey, username) {
        this.sessionKey = sessionKey;
        this.username = username;
        localStorage.setItem(
            'lastfm-session',
            JSON.stringify({
                key: sessionKey,
                name: username,
            })
        );
    }

    clearSession() {
        this.sessionKey = null;
        this.username = null;
        localStorage.removeItem('lastfm-session');
    }

    isAuthenticated() {
        return !!this.sessionKey && lastFMStorage.isEnabled();
    }

    _getScrobbleArtist(track) {
        return getScrobbleArtist(track);
    }

    async generateSignature(params) {
        const filteredParams = { ...params };
        delete filteredParams.format;
        delete filteredParams.callback;

        const sortedKeys = Object.keys(filteredParams).sort();

        const signatureString = sortedKeys.map((key) => `${key}${filteredParams[key]}`).join('') + this.API_SECRET;

        console.log('Signature string:', signatureString);

        try {
            const { default: md5 } = await import('./md5.js');
            return md5(signatureString);
        } catch (e) {
            console.error('MD5 library not available', e);
            throw new Error('MD5 library required for Last.fm', { cause: e });
        }
    }

    async makeRequest(method, params = {}, requiresAuth = false) {
        const requestParams = {
            method,
            api_key: this.API_KEY,
            ...params,
        };

        if (requiresAuth && this.sessionKey) {
            requestParams.sk = this.sessionKey;
        }

        const signature = await this.generateSignature(requestParams);

        const formData = new URLSearchParams({
            ...requestParams,
            api_sig: signature,
            format: 'json',
        });

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData,
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.message || 'Last.fm API error');
            }

            return data;
        } catch (error) {
            console.error('Last.fm API request failed:', error);
            throw error;
        }
    }

    async getAuthUrl() {
        try {
            const data = await this.makeRequest('auth.getToken');
            const token = data.token;

            return {
                token,
                url: `https://www.last.fm/api/auth/?api_key=${this.API_KEY}&token=${token}`,
            };
        } catch (error) {
            console.error('Failed to get auth URL:', error);
            throw error;
        }
    }

    async completeAuthentication(token) {
        try {
            const data = await this.makeRequest('auth.getSession', { token });

            if (data.session) {
                this.saveSession(data.session.key, data.session.name);
                return {
                    success: true,
                    username: data.session.name,
                };
            }

            throw new Error('No session returned');
        } catch (error) {
            console.error('Authentication failed:', error);
            throw error;
        }
    }

    async authenticateWithCredentials(username, password) {
        try {
            const params = {
                username: username,
                password: password,
                api_key: this.API_KEY,
                method: 'auth.getMobileSession',
            };

            const signature = await this.generateSignature(params);

            const formData = new URLSearchParams({
                username: username,
                password: password,
                api_key: this.API_KEY,
                method: 'auth.getMobileSession',
                api_sig: signature,
                format: 'json',
            });

            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData,
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.message || 'Last.fm authentication error');
            }

            if (data.session) {
                this.saveSession(data.session.key, data.session.name);
                return {
                    success: true,
                    username: data.session.name,
                };
            }

            throw new Error('No session returned');
        } catch (error) {
            console.error('Mobile authentication failed:', error);
            throw error;
        }
    }

    async updateNowPlaying(track) {
        if (!this.isAuthenticated()) return;

        this.currentTrack = track;
        // Only reset hasScrobbled if we're not currently in the middle of scrobbling
        // to prevent race conditions that could cause double scrobbles
        if (!this.isScrobbling) {
            this.hasScrobbled = false;
        }
        this.clearScrobbleTimer();

        try {
            const scrobbleTitle = track.cleanTitle || track.title;
            const params = {
                artist: this._getScrobbleArtist(track),
                track: scrobbleTitle,
            };

            if (track.album?.title) {
                params.album = track.album.title;
            }

            if (track.duration) {
                params.duration = Math.floor(track.duration);
            }

            if (track.trackNumber) {
                params.trackNumber = track.trackNumber;
            }

            // Override with the canonical release metadata (MusicBrainz via
            // ISRC, or Last.fm's own autocorrected track info) so the scrobble
            // matches the artist's actual release — and its album art.
            applyResolvedMetadata(params, await resolveScrobbleMetadata(track));

            await this.makeRequest('track.updateNowPlaying', params, true);

            console.log('Now playing updated:', scrobbleTitle);

            const scrobblePercentage = lastFMStorage.getScrobblePercentage() / 100;
            this.scrobbleThreshold = Math.min(track.duration * scrobblePercentage, 240);
            this.scheduleScrobble(this.scrobbleThreshold * 1000);
        } catch (error) {
            console.error('Failed to update now playing:', error);
        }
    }

    scheduleScrobble(delay) {
        this.clearScrobbleTimer();

        this.scrobbleTimer = setTimeout(() => {
            this.scrobbleCurrentTrack();
        }, delay);
    }

    clearScrobbleTimer() {
        if (this.scrobbleTimer) {
            clearTimeout(this.scrobbleTimer);
            this.scrobbleTimer = null;
        }
    }

    async scrobbleCurrentTrack() {
        if (!this.isAuthenticated() || !this.currentTrack || this.hasScrobbled) return;

        this.isScrobbling = true;

        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const scrobbleTitle = this.currentTrack.cleanTitle || this.currentTrack.title;

            const params = {
                artist: this._getScrobbleArtist(this.currentTrack),
                track: scrobbleTitle,
                timestamp: timestamp,
            };

            if (this.currentTrack.album?.title) {
                params.album = this.currentTrack.album.title;
            }

            if (this.currentTrack.duration) {
                params.duration = Math.floor(this.currentTrack.duration);
            }

            if (this.currentTrack.trackNumber) {
                params.trackNumber = this.currentTrack.trackNumber;
            }

            applyResolvedMetadata(params, await resolveScrobbleMetadata(this.currentTrack));

            await this.makeRequest('track.scrobble', params, true);

            this.hasScrobbled = true;
            console.log('Scrobbled:', this.currentTrack.cleanTitle || this.currentTrack.title);
        } catch (error) {
            console.error('Failed to scrobble:', error);
        } finally {
            this.isScrobbling = false;
        }
    }

    async loveTrack(track) {
        if (!this.isAuthenticated()) return;

        try {
            const params = {
                artist: this._getScrobbleArtist(track),
                track: track.title,
            };

            applyResolvedMetadata(params, await resolveScrobbleMetadata(track));

            await this.makeRequest('track.love', params, true);
            console.log('Loved track on Last.fm:', track.title);
        } catch (error) {
            console.error('Failed to love track on Last.fm:', error);
        }
    }

    onTrackChange(track) {
        if (!this.isAuthenticated()) return;
        this.updateNowPlaying(track);
    }

    onPlaybackStop() {
        this.clearScrobbleTimer();
    }

    disconnect() {
        this.clearSession();
        this.clearScrobbleTimer();
        this.currentTrack = null;
    }

    async getArtistImage(artistName, options = {}) {
        return fetchLastFmArtistImage(artistName, {
            apiKey: this.API_KEY,
            tryUpscale: options.tryUpscale !== false,
        });
    }
}
