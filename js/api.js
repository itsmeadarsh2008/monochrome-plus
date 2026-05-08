//js/api.js
import {
    RATE_LIMIT_ERROR_MESSAGE,
    deriveTrackQuality,
    delay,
    isTrackUnavailable,
    getExtensionFromBlob,
    createTimeoutSignal,
} from './utils.js';
import { trackDateSettings, audioProcessingSettings, proxySettings } from './storage.js';
import { APICache } from './cache.js';
import { addMetadataToAudio } from './metadata.js';
import { DashDownloader } from './dash-downloader.js';
import { HiFiClient, TidalResponse } from './HiFi.js';
import { HlsDownloader } from './hls-downloader.js';

export const DASH_MANIFEST_UNAVAILABLE_CODE = 'DASH_MANIFEST_UNAVAILABLE';
const TIDAL_V2_TOKEN = 'txNoH4kkV41MfH25';

export class LosslessAPI {
    constructor(settings) {
        this.settings = settings;
        this.cache = new APICache({
            maxSize: 200,
            ttl: 1000 * 60 * 30,
        });
        this.streamCache = new Map();

        this.hifi = new HiFiClient();
        this.hlsDownloader = new HlsDownloader();

        setInterval(
            () => {
                this.cache.clearExpired();
                this.pruneStreamCache();
            },
            1000 * 60 * 5
        );
    }

    pruneStreamCache() {
        if (this.streamCache.size > 50) {
            const entries = Array.from(this.streamCache.entries());
            const toDelete = entries.slice(0, entries.length - 50);
            toDelete.forEach(([key]) => this.streamCache.delete(key));
        }
    }

    clearStreamCache(trackId) {
        if (trackId != null) {
            for (const key of this.streamCache.keys()) {
                if (key.startsWith(`stream_${trackId}_`)) {
                    this.streamCache.delete(key);
                }
            }
            // Also clear the track lookup from memoryCache so a fresh fetch is forced
            for (const key of this.cache.memoryCache.keys()) {
                if (key.startsWith(`track:${trackId}_`)) {
                    this.cache.memoryCache.delete(key);
                }
            }
        }
    }

    _buildFetchUrl(baseUrl, relativePath, proxy) {
        const url = baseUrl.endsWith('/') ? `${baseUrl}${relativePath.substring(1)}` : `${baseUrl}${relativePath}`;
        if (proxy) {
            return proxySettings.buildProxiedUrl(proxy.url, url);
        }

        const isLocalDevBrowser =
            typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        if (isLocalDevBrowser && /^https?:\/\//i.test(url)) {
            return `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
        }

        return url;
    }

    _shouldSkipInstanceForCors(baseUrl) {
        if (typeof window === 'undefined') return false;
        if (proxySettings.isEnabled()) return false;
        if (window.__TAURI_INTERNALS__ || window.__TAURI__ || window.__TAURI_IPC__) return false;

        const host = (() => {
            try {
                return new URL(baseUrl).hostname.toLowerCase();
            } catch {
                return '';
            }
        })();
        if (!host) return false;

        // Known browser-hostile CORS/redirect behavior for general API calls.
        if (host === 'streamex.sh') return true;

        // Never call upstream TIDAL endpoints directly from browser API rotation.
        if (host.endsWith('tidal.com')) return true;

        return false;
    }

    async fetchWithRetry(relativePath, options = {}) {
        const type = options.type || 'api';
        const instanceRoutes = ['/track', '/album/similar', '/artist/similar', '/video', '/recommendations'];

        // If it's a route not on our whitelist or if allTidal is enabled, try HiFiClient first
        if (window.allTidal === true || !instanceRoutes.some((route) => relativePath.startsWith(route))) {
            try {
                const response = await this.hifi.queryResponse(relativePath);
                if (response.ok) return response;
            } catch (err) {
                console.warn(`Direct HiFi fetch failed for ${relativePath}. Falling back...`, err);
            }
        }

        let instances = await this.settings.getInstances(type);
        if (instances.length === 0) {
            throw new Error(`No API instances configured for type: ${type}`);
        }

        if (options.minVersion) {
            instances = instances.filter((instance) => {
                if (!instance.version) return false;
                return parseFloat(instance.version) >= parseFloat(options.minVersion);
            });
            if (instances.length === 0) {
                throw new Error(`No API instances configured for type: ${type} with minVersion: ${options.minVersion}`);
            }
        }

        if (options.allowedDomains) {
            instances = instances.filter((instance) => {
                const url = typeof instance === 'string' ? instance : instance.url;
                return options.allowedDomains.some((domain) => url.includes(domain));
            });
            if (instances.length === 0) {
                throw new Error(
                    `No API instances configured for type: ${type} matching allowedDomains: ${options.allowedDomains.join(', ')}`
                );
            }
        }

        const useProxy = proxySettings.isEnabled();
        const proxies = useProxy ? proxySettings.getProxies() : [];
        const activeProxy = proxies.length > 0 ? proxies[0] : null;

        const maxTotalAttempts = instances.length * 2;
        let lastError = null;
        let instanceIndex = Math.floor(Math.random() * instances.length);

        for (let attempt = 1; attempt <= maxTotalAttempts; attempt++) {
            const instance = instances[instanceIndex % instances.length];
            const baseUrl = typeof instance === 'string' ? instance : instance.url;
            if (this._shouldSkipInstanceForCors(baseUrl)) {
                instanceIndex++;
                continue;
            }
            const url = this._buildFetchUrl(baseUrl, relativePath, activeProxy);

            try {
                const response = await fetch(url, {
                    signal: options.signal,
                    cache: options.cacheControl || 'default',
                });

                if (response.status === 429) {
                    console.warn(`Rate limit hit on ${baseUrl}. Trying next instance...`);
                    instanceIndex++;
                    await delay(500);
                    continue;
                }

                if (response.ok) {
                    return response;
                }

                if (response.status === 401) {
                    let errorData = null;
                    try {
                        errorData = await response.clone().json();
                    } catch (jsonError) {
                        // Some API instances may return empty or invalid JSON on auth errors.
                        // Avoid unhandled SyntaxError: Unexpected end of input.
                        console.warn(`Could not parse 401 error body from ${baseUrl}:`, jsonError);
                    }

                    if (errorData?.subStatus === 11002) {
                        console.warn(`Auth failed on ${baseUrl}. Trying next instance...`);
                        instanceIndex++;
                        continue;
                    }
                }

                if (response.status >= 500) {
                    console.warn(`Server error ${response.status} on ${baseUrl}. Trying next instance...`);
                    instanceIndex++;
                    continue;
                }

                lastError = new Error(`Request failed with status ${response.status}`);
                instanceIndex++;
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                lastError = error;
                console.warn(`Network error on ${baseUrl}: ${error.message}. Trying next instance...`);
                instanceIndex++;
                await delay(200);
            }
        }

        throw lastError || new Error(`All API instances failed for: ${relativePath}`);
    }

    findSearchSection(source, key, visited) {
        if (!source || typeof source !== 'object') return;

        if (Array.isArray(source)) {
            for (const e of source) {
                const f = this.findSearchSection(e, key, visited);
                if (f) return f;
            }
            return;
        }

        if (visited.has(source)) return;
        visited.add(source);

        if ('items' in source && Array.isArray(source.items)) return source;

        if (key in source) {
            const f = this.findSearchSection(source[key], key, visited);
            if (f) return f;
        }

        for (const v of Object.values(source)) {
            const f = this.findSearchSection(v, key, visited);
            if (f) return f;
        }
    }

    buildSearchResponse(section) {
        const items = section?.items ?? [];
        return {
            items,
            limit: section?.limit ?? items.length,
            offset: section?.offset ?? 0,
            totalNumberOfItems: section?.totalNumberOfItems ?? items.length,
        };
    }

    normalizeSearchResponse(data, key) {
        const section = this.findSearchSection(data, key, new Set());
        return this.buildSearchResponse(section);
    }

    normalizeHifiArtist(artist) {
        if (!artist || typeof artist !== 'object') return artist;

        const normalizedTypes = Array.isArray(artist.artistTypes)
            ? artist.artistTypes.filter(Boolean)
            : artist.type
              ? [artist.type]
              : [];

        return {
            ...artist,
            id: artist.id ?? null,
            name: artist.name || 'Unknown Artist',
            handle: artist.handle ?? null,
            type: artist.type || normalizedTypes[0] || null,
            picture: artist.picture || artist.image || null,
            artistTypes: normalizedTypes,
            url: artist.url || null,
            selectedAlbumCoverFallback: artist.selectedAlbumCoverFallback ?? null,
            popularity: Number.isFinite(artist.popularity) ? artist.popularity : null,
            artistRoles: Array.isArray(artist.artistRoles) ? artist.artistRoles : [],
            mixes: artist.mixes && typeof artist.mixes === 'object' ? artist.mixes : {},
            userId: artist.userId ?? null,
            spotlighted: !!artist.spotlighted,
        };
    }

    normalizeHifiAlbum(album) {
        if (!album || typeof album !== 'object') return album;

        const artists = Array.isArray(album.artists)
            ? album.artists.map((artist) => this.normalizeHifiArtist(artist)).filter(Boolean)
            : [];
        const artist = album.artist ? this.normalizeHifiArtist(album.artist) : artists.length > 0 ? artists[0] : null;

        const mediaMetadata =
            album.mediaMetadata && typeof album.mediaMetadata === 'object'
                ? {
                      ...album.mediaMetadata,
                      tags: Array.isArray(album.mediaMetadata.tags) ? album.mediaMetadata.tags : [],
                  }
                : null;

        return {
            ...album,
            id: album.id ?? null,
            title: album.title || 'Unknown Album',
            cover: album.cover || null,
            vibrantColor: album.vibrantColor || null,
            videoCover: album.videoCover || null,
            artist,
            artists,
            releaseDate: album.releaseDate || null,
            numberOfTracks: Number.isFinite(album.numberOfTracks) ? album.numberOfTracks : null,
            explicit: !!album.explicit,
            audioQuality: album.audioQuality || null,
            audioModes: Array.isArray(album.audioModes) ? album.audioModes : [],
            mediaMetadata,
            url: album.url || null,
            type: album.type || null,
        };
    }

    normalizeHifiTrack(track) {
        if (!track || typeof track !== 'object') return track;

        const artists = Array.isArray(track.artists)
            ? track.artists.map((artist) => this.normalizeHifiArtist(artist)).filter(Boolean)
            : [];
        const artist = track.artist ? this.normalizeHifiArtist(track.artist) : artists.length > 0 ? artists[0] : null;

        const mediaMetadata =
            track.mediaMetadata && typeof track.mediaMetadata === 'object'
                ? {
                      ...track.mediaMetadata,
                      tags: Array.isArray(track.mediaMetadata.tags) ? track.mediaMetadata.tags : [],
                  }
                : null;

        const normalized = {
            ...track,
            id: track.id ?? null,
            title: track.title || 'Unknown Track',
            duration: Number.isFinite(track.duration) ? track.duration : 0,
            replayGain: Number.isFinite(track.replayGain) ? track.replayGain : null,
            peak: Number.isFinite(track.peak) ? track.peak : null,
            allowStreaming: track.allowStreaming !== false,
            streamReady: track.streamReady !== false,
            payToStream: !!track.payToStream,
            adSupportedStreamReady: !!track.adSupportedStreamReady,
            djReady: !!track.djReady,
            stemReady: !!track.stemReady,
            streamStartDate: track.streamStartDate || null,
            premiumStreamingOnly: !!track.premiumStreamingOnly,
            trackNumber: Number.isFinite(track.trackNumber) ? track.trackNumber : null,
            volumeNumber: Number.isFinite(track.volumeNumber) ? track.volumeNumber : null,
            discNumber: Number.isFinite(track.discNumber)
                ? track.discNumber
                : Number.isFinite(track.volumeNumber)
                  ? track.volumeNumber
                  : null,
            version: track.version || null,
            popularity: Number.isFinite(track.popularity) ? track.popularity : null,
            copyright: track.copyright || null,
            bpm: Number.isFinite(track.bpm) ? track.bpm : null,
            key: track.key || null,
            keyScale: track.keyScale || null,
            url: track.url || null,
            isrc: track.isrc || null,
            editable: !!track.editable,
            explicit: !!track.explicit,
            audioQuality: track.audioQuality || null,
            audioModes: Array.isArray(track.audioModes) ? track.audioModes : [],
            mediaMetadata,
            upload: !!track.upload,
            accessType: track.accessType ?? null,
            spotlighted: !!track.spotlighted,
            artist,
            artists,
            album: track.album ? this.normalizeHifiAlbum(track.album) : null,
            mixes: track.mixes && typeof track.mixes === 'object' ? track.mixes : {},
        };

        return normalized;
    }

    normalizeHifiTrackStreamInfo(info) {
        if (!info || typeof info !== 'object') return info;

        return {
            ...info,
            trackId: info.trackId ?? null,
            assetPresentation: info.assetPresentation || null,
            audioMode: info.audioMode || null,
            audioQuality: info.audioQuality || null,
            manifestMimeType: info.manifestMimeType || null,
            manifestHash: info.manifestHash || null,
            manifest: info.manifest || null,
            albumReplayGain: Number.isFinite(info.albumReplayGain) ? info.albumReplayGain : null,
            albumPeakAmplitude: Number.isFinite(info.albumPeakAmplitude) ? info.albumPeakAmplitude : null,
            trackReplayGain: Number.isFinite(info.trackReplayGain) ? info.trackReplayGain : null,
            trackPeakAmplitude: Number.isFinite(info.trackPeakAmplitude) ? info.trackPeakAmplitude : null,
            bitDepth: Number.isFinite(info.bitDepth) ? info.bitDepth : null,
            sampleRate: Number.isFinite(info.sampleRate) ? info.sampleRate : null,
        };
    }

    prepareTrack(track) {
        let normalized = this.normalizeHifiTrack(track);

        if (!track.artist && Array.isArray(track.artists) && track.artists.length > 0) {
            normalized = { ...track, artist: track.artists[0] };
        }

        const derivedQuality = deriveTrackQuality(normalized);
        if (derivedQuality && normalized.audioQuality !== derivedQuality) {
            normalized = { ...normalized, audioQuality: derivedQuality };
        }

        normalized.isUnavailable = isTrackUnavailable(normalized);

        return normalized;
    }

    prepareAlbum(album) {
        return this.normalizeHifiAlbum(album);
    }

    preparePlaylist(playlist) {
        return playlist;
    }

    prepareArtist(artist) {
        return this.normalizeHifiArtist(artist);
    }

    async enrichTracksWithAlbumDates(tracks, maxRequests = 20) {
        if (!trackDateSettings.useAlbumYear()) return tracks;

        const albumIdsToFetch = [];
        for (const track of tracks) {
            if (!track.album?.releaseDate && track.album?.id && !albumIdsToFetch.includes(track.album.id)) {
                albumIdsToFetch.push(track.album.id);
            }
        }

        if (albumIdsToFetch.length === 0) return tracks;

        // Limit the number of albums to fetch to prevent spamming
        const limitedIds = albumIdsToFetch.slice(0, maxRequests);
        if (albumIdsToFetch.length > maxRequests) {
            console.warn(`[Enrich] Too many albums to fetch (${albumIdsToFetch.length}). limiting to ${maxRequests}.`);
        }

        const albumDateMap = new Map();

        // Chunk requests to avoid spamming
        const chunkSize = 5;
        for (let i = 0; i < limitedIds.length; i += chunkSize) {
            const chunk = limitedIds.slice(i, i + chunkSize);
            const results = await Promise.allSettled(chunk.map((id) => this.getAlbum(id)));

            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                const id = chunk[j];
                if (result.status === 'fulfilled' && result.value.album?.releaseDate) {
                    albumDateMap.set(id, result.value.album.releaseDate);
                }
            }
        }

        return tracks.map((track) => {
            if (!track.album?.releaseDate && track.album?.id && albumDateMap.has(track.album.id)) {
                return { ...track, album: { ...track.album, releaseDate: albumDateMap.get(track.album.id) } };
            }
            return track;
        });
    }

    parseTrackLookup(data) {
        const entries = Array.isArray(data) ? data : [data];
        let track, info, originalTrackUrl;

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;

            if (!track && 'duration' in entry) {
                track = entry;
                continue;
            }

            if (!info && 'manifest' in entry) {
                info = entry;
                continue;
            }

            if (!originalTrackUrl && 'OriginalTrackUrl' in entry) {
                const candidate = entry.OriginalTrackUrl;
                if (typeof candidate === 'string') {
                    originalTrackUrl = candidate;
                }
            }
        }

        if (!track || !info) {
            throw new Error('Malformed track response');
        }

        return { track, info, originalTrackUrl };
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

            // Check if it's a DASH manifest (XML)
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
        } catch (error) {
            console.error('Failed to decode manifest:', error);
            return null;
        }
    }

    deduplicateAlbums(albums) {
        const unique = new Map();

        for (const album of albums) {
            // Key based on title and numberOfTracks (excluding duration and explicit)
            const key = JSON.stringify([album.title, album.numberOfTracks || 0]);

            if (unique.has(key)) {
                const existing = unique.get(key);

                // Priority 1: Explicit
                if (album.explicit && !existing.explicit) {
                    unique.set(key, album);
                    continue;
                }
                if (!album.explicit && existing.explicit) {
                    continue;
                }

                // Priority 2: More Metadata Tags (if explicit status is same)
                const existingTags = existing.mediaMetadata?.tags?.length || 0;
                const newTags = album.mediaMetadata?.tags?.length || 0;

                if (newTags > existingTags) {
                    unique.set(key, album);
                }
            } else {
                unique.set(key, album);
            }
        }

        return Array.from(unique.values());
    }

    async searchTracks(query, options = {}) {
        const cached = await this.cache.get('search_tracks', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?s=${encodeURIComponent(query)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'tracks');
            const preparedTracks = normalized.items.map((t) => this.prepareTrack(t));
            const result = {
                ...normalized,
                items: preparedTracks,
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_tracks', query, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Track search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchArtists(query, options = {}) {
        const cached = await this.cache.get('search_artists', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?a=${encodeURIComponent(query)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'artists');
            const result = {
                ...normalized,
                items: normalized.items
                    .map((a) => this.prepareArtist(a))
                    .filter((a) => a?.id && a?.name && !a?.duration),
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_artists', query, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Artist search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchAlbums(query, options = {}) {
        const cached = await this.cache.get('search_albums', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?al=${encodeURIComponent(query)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'albums');
            const preparedItems = normalized.items.map((a) => this.prepareAlbum(a));
            const result = {
                ...normalized,
                items: this.deduplicateAlbums(preparedItems),
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_albums', query, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Album search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchPlaylists(query, options = {}) {
        const cached = await this.cache.get('search_playlists', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?p=${encodeURIComponent(query)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'playlists');
            const result = {
                ...normalized,
                items: normalized.items.map((p) => this.preparePlaylist(p)),
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_playlists', query, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Playlist search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async getAlbum(id) {
        const cached = await this.cache.get('album', id);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/album/?id=${id}`);
        const jsonData = await response.json();

        // Unwrap the data property if it exists
        const data = jsonData.data || jsonData;

        let album, tracksSection;

        if (data && typeof data === 'object' && !Array.isArray(data)) {
            // Check for album metadata at root level
            if ('numberOfTracks' in data || 'title' in data) {
                album = this.prepareAlbum(data);
            }

            // Set tracksSection if items exist
            if ('items' in data) {
                tracksSection = data;

                // If we still don't have album but have items with tracks, try to extract album from first track
                if (!album && data.items && data.items.length > 0) {
                    const firstItem = data.items[0];
                    const track = firstItem.item || firstItem;

                    // Check if track has album property
                    if (track && track.album) {
                        album = this.prepareAlbum(track.album);
                    }
                }
            }
        }

        if (!album) throw new Error('Album not found');

        // If album exists but has no artist, try to extract from tracks
        if (!album.artist && tracksSection?.items && tracksSection.items.length > 0) {
            const firstTrack = tracksSection.items[0];
            const track = firstTrack.item || firstTrack;
            if (track && track.artist) {
                album = { ...album, artist: track.artist };
            }
        }

        // If album exists but has no releaseDate, try to extract from tracks
        if (!album.releaseDate && tracksSection?.items && tracksSection.items.length > 0) {
            const firstTrack = tracksSection.items[0];
            const track = firstTrack.item || firstTrack;

            if (track) {
                if (track.album && track.album.releaseDate) {
                    album = { ...album, releaseDate: track.album.releaseDate };
                } else if (track.streamStartDate) {
                    album = { ...album, releaseDate: track.streamStartDate.split('T')[0] };
                }
            }
        }

        let tracks = (tracksSection?.items || []).map((i) => this.prepareTrack(i.item || i));

        // Handle pagination if there are more tracks
        if (album && album.numberOfTracks > tracks.length) {
            let offset = tracks.length;
            const SAFE_MAX_TRACKS = 10000;

            while (tracks.length < album.numberOfTracks && tracks.length < SAFE_MAX_TRACKS) {
                try {
                    const nextResponse = await this.fetchWithRetry(`/album/?id=${id}&offset=${offset}&limit=500`);
                    const nextJson = await nextResponse.json();
                    const nextData = nextJson.data || nextJson;

                    let nextItems = [];

                    if (nextData.items) {
                        nextItems = nextData.items;
                    } else if (Array.isArray(nextData)) {
                        for (const entry of nextData) {
                            if (entry && typeof entry === 'object' && 'items' in entry && Array.isArray(entry.items)) {
                                nextItems = entry.items;
                                break;
                            }
                        }
                    }

                    if (!nextItems || nextItems.length === 0) break;

                    const preparedItems = nextItems.map((i) => this.prepareTrack(i.item || i));
                    if (preparedItems.length === 0) break;

                    // Safeguard: If API ignores offset, it returns the first page again.
                    // Check if the first new item matches the very first track we have.
                    if (tracks.length > 0 && preparedItems[0].id === tracks[0].id) {
                        break;
                    }

                    // Also check if the first new item matches the last track we have (overlap check)
                    if (tracks.length > 0 && preparedItems[0].id === tracks[tracks.length - 1].id) {
                        // If it's just one overlap, maybe we should skip it?
                        // But usually offset should be precise.
                        // If we see exact same id as first track, it's definitely a loop.
                    }

                    tracks = tracks.concat(preparedItems);
                    offset += preparedItems.length;
                } catch (error) {
                    console.error(`Error fetching album tracks at offset ${offset}:`, error);
                    break;
                }
            }
        }

        // Enrich tracks with album releaseDate if available
        if (album?.releaseDate) {
            tracks = tracks.map((track) => {
                if (track.album && !track.album.releaseDate) {
                    return { ...track, album: { ...track.album, releaseDate: album.releaseDate } };
                }
                return track;
            });
        }

        const result = { album, tracks };

        if (!(response.constructor.name === 'TidalResponse')) {
            await this.cache.set('album', id, result);
        }
        return result;
    }

    async getPlaylist(id) {
        const cached = await this.cache.get('playlist', id);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/playlist/?id=${id}`);
        const jsonData = await response.json();

        // Unwrap the data property if it exists
        const data = jsonData.data || jsonData;

        let playlist = null;
        let tracksSection = null;

        // Check for direct playlist property (common in v2 responses)
        if (data.playlist) {
            playlist = data.playlist;
        }

        // Check for direct items property
        if (data.items) {
            tracksSection = { items: data.items };
        }

        // Fallback: iterate if we still missed something or if structure is flat array
        if (!playlist || !tracksSection) {
            const entries = Array.isArray(data) ? data : [data];
            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') continue;

                if (
                    !playlist &&
                    ('uuid' in entry || 'numberOfTracks' in entry || ('title' in entry && 'id' in entry))
                ) {
                    playlist = entry;
                }

                if (!tracksSection && 'items' in entry) {
                    tracksSection = entry;
                }
            }
        }

        // Fallback 2: If we have a list of entries but no explicit playlist object, try to find one that looks like a playlist
        if (!playlist && Array.isArray(data)) {
            for (const entry of data) {
                if (entry && typeof entry === 'object' && ('uuid' in entry || 'numberOfTracks' in entry)) {
                    playlist = entry;
                    break;
                }
            }
        }

        if (!playlist) throw new Error('Playlist not found');

        let tracks = (tracksSection?.items || []).map((i) => this.prepareTrack(i.item || i));

        // Handle pagination if there are more tracks
        if (playlist.numberOfTracks > tracks.length) {
            let offset = tracks.length;
            const SAFE_MAX_TRACKS = 10000;

            while (tracks.length < playlist.numberOfTracks && tracks.length < SAFE_MAX_TRACKS) {
                try {
                    const nextResponse = await this.fetchWithRetry(`/playlist/?id=${id}&offset=${offset}`);
                    const nextJson = await nextResponse.json();
                    const nextData = nextJson.data || nextJson;

                    let nextItems = [];

                    if (nextData.items) {
                        nextItems = nextData.items;
                    } else if (Array.isArray(nextData)) {
                        for (const entry of nextData) {
                            if (entry && typeof entry === 'object' && 'items' in entry && Array.isArray(entry.items)) {
                                nextItems = entry.items;
                                break;
                            }
                        }
                    }

                    if (!nextItems || nextItems.length === 0) break;

                    const preparedItems = nextItems.map((i) => this.prepareTrack(i.item || i));
                    if (preparedItems.length === 0) break;

                    // Safeguard: If API ignores offset, it returns the first page again.
                    // Check if the first new item matches the very first track we have.
                    if (tracks.length > 0 && preparedItems[0].id === tracks[0].id) {
                        break;
                    }

                    tracks = tracks.concat(preparedItems);
                    offset += preparedItems.length;
                } catch (error) {
                    console.error(`Error fetching playlist tracks at offset ${offset}:`, error);
                    break;
                }
            }
        }

        // Enrich tracks with album release dates
        // Removed to reduce API load. Playlists can be very large.
        // tracks = await this.enrichTracksWithAlbumDates(tracks);

        const result = { playlist, tracks };

        if (!(response instanceof TidalResponse)) {
            await this.cache.set('playlist', id, result);
        }
        return result;
    }

    async getMix(id) {
        const cached = await this.cache.get('mix', id);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/mix/?id=${id}`, { type: 'api', minVersion: '2.3' });
        const data = await response.json();

        const mixData = data.mix;
        const items = data.items || [];

        if (!mixData) {
            throw new Error('Mix metadata not found');
        }

        let tracks = items.map((i) => this.prepareTrack(i.item || i));

        // Enrich tracks with album release dates
        // Limited to reduce API load
        tracks = await this.enrichTracksWithAlbumDates(tracks, 10);

        const mix = {
            id: mixData.id,
            title: mixData.title,
            subTitle: mixData.subTitle,
            description: mixData.description,
            mixType: mixData.mixType,
            cover: mixData.images?.LARGE?.url || mixData.images?.MEDIUM?.url || mixData.images?.SMALL?.url || null,
        };

        const result = { mix, tracks };
        if (!(response instanceof TidalResponse)) {
            await this.cache.set('mix', id, result);
        }
        return result;
    }

    async getArtist(artistId, options = {}) {
        const cacheKey = options.lightweight ? `artist_${artistId}_light` : `artist_${artistId}`;
        if (!options.skipCache) {
            const cached = await this.cache.get('artist', cacheKey);
            if (cached) return cached;
        }

        const [primaryResponse, contentResponse] = await Promise.all([
            this.fetchWithRetry(`/artist/?id=${artistId}`),
            this.fetchWithRetry(`/artist/?f=${artistId}&skip_tracks=true`),
        ]);

        const primaryJsonData = await primaryResponse.json();

        // Unwrap data property if it exists, then unwrap artist property if it exists
        let primaryData = primaryJsonData.data || primaryJsonData;
        const rawArtist = primaryData.artist || (Array.isArray(primaryData) ? primaryData[0] : primaryData);

        if (!rawArtist) throw new Error('Primary artist details not found.');

        const artist = {
            ...this.prepareArtist(rawArtist),
            picture: rawArtist.picture || rawArtist.selectedAlbumCoverFallback || primaryData.cover || null,
            selectedAlbumCoverFallback: rawArtist.selectedAlbumCoverFallback || null,
            name: rawArtist.name || 'Unknown Artist',
        };

        const contentJsonData = await contentResponse.json();
        // Unwrap data property if it exists
        const contentData = contentJsonData.data || contentJsonData;
        const entries = Array.isArray(contentData) ? contentData : [contentData];

        const albumMap = new Map();
        const trackMap = new Map();

        const isTrack = (v) => v?.id && v.duration && v.album;
        const isAlbum = (v) => v?.id && 'numberOfTracks' in v;

        const scan = (value, visited = new Set()) => {
            if (!value || typeof value !== 'object' || visited.has(value)) return;
            visited.add(value);

            if (Array.isArray(value)) {
                value.forEach((item) => scan(item, visited));
                return;
            }

            const item = value.item || value;
            if (isAlbum(item)) albumMap.set(item.id, this.prepareAlbum(item));
            if (isTrack(item)) trackMap.set(item.id, this.prepareTrack(item));

            Object.values(value).forEach((nested) => scan(nested, visited));
        };

        entries.forEach((entry) => scan(entry));

        if (!options.lightweight) {
            // Attempt to find more albums/EPs via search since the direct feed might be limited
            try {
                const searchResults = await this.searchAlbums(artist.name);
                if (searchResults && searchResults.items) {
                    const numericArtistId = Number(artistId);

                    for (const item of searchResults.items) {
                        const itemArtistId = item.artist?.id;
                        const matchesArtist =
                            itemArtistId === numericArtistId ||
                            (Array.isArray(item.artists) && item.artists.some((a) => a.id === numericArtistId));

                        if (matchesArtist && !albumMap.has(item.id)) {
                            albumMap.set(item.id, item);
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch additional albums via search:', e);
            }
        }

        const rawReleases = Array.from(albumMap.values());
        const allReleases = this.deduplicateAlbums(rawReleases).sort(
            (a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0)
        );

        const eps = allReleases.filter((a) => a.type === 'EP' || a.type === 'SINGLE');
        const albums = allReleases.filter((a) => !eps.includes(a));

        const topTracks = Array.from(trackMap.values())
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, 15);

        // Enrich tracks with album release dates
        const tracks = options.lightweight ? topTracks : await this.enrichTracksWithAlbumDates(topTracks);

        const result = { ...artist, albums, eps, tracks };

        await this.cache.set('artist', cacheKey, result);
        return result;
    }

    async getSimilarArtists(artistId, options = {}) {
        if (!options.skipCache) {
            const cached = await this.cache.get('similar_artists', artistId);
            if (cached) return cached;
        }

        try {
            const response = await this.fetchWithRetry(`/artist/similar/?id=${artistId}`, {
                type: 'api',
                minVersion: '2.3',
                cacheControl: options.cacheControl,
            });
            const data = await response.json();

            // Handle various response structures
            const items = data.artists || data.items || data.data || (Array.isArray(data) ? data : []);

            const result = items.map((artist) => this.prepareArtist(artist));

            if (!options.skipCache && !(response instanceof TidalResponse)) {
                await this.cache.set('similar_artists', artistId, result);
            }
            return result;
        } catch (e) {
            console.warn('Failed to fetch similar artists:', e);
            return [];
        }
    }

    async getArtistBiography(artistId) {
        const cacheKey = `artist_bio_v1_${artistId}`;
        const cached = await this.cache.get('artist', cacheKey);
        if (cached) return cached;

        try {
            const url = `https://api.tidal.com/v1/artists/${artistId}/bio?locale=en_US&countryCode=GB`;
            const response = await fetch(url, {
                headers: {
                    'X-Tidal-Token': TIDAL_V2_TOKEN,
                },
            });

            if (response.ok) {
                const data = await response.json();
                if (data && data.text) {
                    const bio = {
                        text: data.text,
                        source: data.source || 'Tidal',
                    };
                    await this.cache.set('artist', cacheKey, bio);
                    return bio;
                }
            }
        } catch (e) {
            console.warn('Failed to fetch Tidal biography:', e);
        }
        return null;
    }

    async getArtistWebImage(artistName, options = {}) {
        const name = typeof artistName === 'string' ? artistName.trim() : '';
        if (!name) return null;

        const buildProxiedUrl = (rawUrl) => `https://corsproxy.io/?url=${encodeURIComponent(rawUrl)}`;
        const fetchNoStore = (url, init = {}) =>
            fetch(url, {
                ...init,
                cache: 'no-store',
            });
        const toCorsSafeImageUrl = (rawUrl) => {
            if (typeof rawUrl !== 'string') return null;
            const trimmed = rawUrl.trim();
            if (!trimmed) return null;
            if (!/^https?:/i.test(trimmed)) return trimmed;
            return buildProxiedUrl(trimmed);
        };
        const searchTerms = [`${name} singer`, `${name} musician`, `${name} artist`, name];
        const artistTokens = name
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((token) => token.length > 2 && token !== 'the' && token !== 'and');

        const normalizeText = (text) =>
            String(text || '')
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

        const normalizedArtistName = normalizeText(name);

        const computeRelevance = (text) => {
            if (!text) return 0;
            if (artistTokens.length === 0) return 1;
            const haystack = normalizeText(text);
            let hits = 0;
            for (const token of artistTokens) {
                if (haystack.includes(token)) hits += 1;
            }
            return hits / artistTokens.length;
        };

        const hasStrictArtistIdentity = (text) => {
            const haystack = normalizeText(text);
            if (!haystack) return false;

            // Full-stage-name match wins immediately.
            if (normalizedArtistName && haystack.includes(normalizedArtistName)) return true;

            if (artistTokens.length === 0) return false;
            if (artistTokens.length === 1) {
                return haystack.includes(artistTokens[0]);
            }

            // For multi-token names, require every token (strict lock).
            return artistTokens.every((token) => haystack.includes(token));
        };

        const currentYear = new Date().getFullYear();

        const extractYear = (text) => {
            if (!text) return null;
            const match = String(text).match(/(19\d{2}|20\d{2})/g);
            if (!match || match.length === 0) return null;
            const years = match
                .map((value) => Number.parseInt(value, 10))
                .filter((value) => value >= 1900 && value <= currentYear);
            if (years.length === 0) return null;
            return Math.max(...years);
        };

        const getFreshnessBonus = (candidate) => {
            const yearFromText = extractYear(
                `${candidate.title || ''} ${candidate.context || ''} ${candidate.url || ''}`
            );
            const yearFromTimestamp = candidate.timestamp
                ? Number.parseInt(String(candidate.timestamp).slice(0, 4), 10)
                : null;
            const year = Math.max(yearFromText || 0, yearFromTimestamp || 0);
            if (!year) return 0;
            const age = currentYear - year;
            if (age <= 1) return 720000;
            if (age <= 3) return 520000;
            if (age <= 6) return 260000;
            if (age <= 10) return 50000;
            return -220000;
        };

        const getBannerRatioBonus = (ratio) => {
            if (!Number.isFinite(ratio)) return -1;
            if (ratio < 1.25 || ratio > 3.2) return -1;
            const target = 1.85;
            const distance = Math.abs(ratio - target);
            return Math.max(-120000, 260000 - distance * 210000);
        };

        const getFaceCoverageBonus = (candidateText) => {
            const text = String(candidateText || '').toLowerCase();
            if (!text) return 0;

            const strongFaceSignals = [
                'portrait',
                'headshot',
                'close-up',
                'closeup',
                'face',
                'publicity',
                'press photo',
                'promo photo',
            ];
            const weakFaceSignals = ['singer', 'musician', 'artist', 'photograph', 'photo'];
            const antiSignals = ['logo', 'icon', 'album cover', 'poster', 'illustration', 'drawing'];

            let bonus = 0;
            strongFaceSignals.forEach((token) => {
                if (text.includes(token)) bonus += 90000;
            });
            weakFaceSignals.forEach((token) => {
                if (text.includes(token)) bonus += 28000;
            });
            antiSignals.forEach((token) => {
                if (text.includes(token)) bonus -= 140000;
            });
            return bonus;
        };

        const hasFaceLikeSignals = (candidateText) => {
            const text = String(candidateText || '').toLowerCase();
            if (!text) return false;

            const strong = [
                'portrait',
                'headshot',
                'close-up',
                'closeup',
                'press photo',
                'publicity photo',
                'publicity still',
                'photograph',
                'photo of',
                'singer',
                'musician',
                'artist',
                'head',
                'upper body',
                'waist up',
            ];

            return strong.some((token) => text.includes(token));
        };

        const hasHardVisualExclusion = (candidateText, url) => {
            const text = `${String(candidateText || '')} ${String(url || '')}`.toLowerCase();
            const banned = [
                'map',
                'world map',
                'countries',
                'choropleth',
                'heatmap',
                'infographic',
                'chart',
                'graph',
                'diagram',
                'timeline',
                'discography',
                'logo',
                'flag',
                'symbol',
                'cover art',
                'album cover',
                'single cover',
                'perfume',
                'fragrance',
                'cosmetic',
                'advertisement',
                'campaign',
                'product shot',
                'promotional product',
                'billboard chart',
                'streaming chart',
                'sales chart',
                'tour poster',
                'flyer',
                'wallpaper',
                'collage',
                'meme',
                'screenshot',
                'fanart',
                'render',
                'vector',
            ];

            return banned.some((token) => text.includes(token));
        };

        const scoreImageCandidate = (candidate) => {
            if (!candidate || typeof candidate.url !== 'string') return -1;
            const url = candidate.url.toLowerCase();
            if (!url || url.endsWith('.svg') || url.includes('/logo')) return -1;

            const source = String(candidate.source || '').toLowerCase();
            const isWikimediaLinked =
                source === 'commons-category' || source === 'wikidata' || source === 'wikidata-p18';

            const width = Number(candidate.width) || 0;
            const height = Number(candidate.height) || 0;
            if (width < 900 || height < 360) return -1;

            const ratio = width / Math.max(height, 1);
            if (ratio < 1.25 || ratio > 3.2) return -1;

            const candidateText = `${candidate.title || ''} ${candidate.context || ''} ${candidate.metaText || ''} ${candidate.url || ''}`;
            if (hasHardVisualExclusion(candidateText, candidate.url)) return -1;
            const strictIdentity = hasStrictArtistIdentity(candidateText);
            if (!strictIdentity && !isWikimediaLinked) return -1;

            const relevance = computeRelevance(candidateText);
            // Wikimedia-linked sources are already entity-bound, so allow a slightly lower text match.
            if (relevance < (isWikimediaLinked ? 0.4 : 0.67)) return -1;

            // Strict mode: require person-photo cues for all candidates.
            if (!hasFaceLikeSignals(candidateText)) return -1;

            const area = width * height;
            const ratioPenalty = Math.abs(1.7 - ratio) * 150000;
            const jpegBonus = /\.jpe?g(\?|$)/.test(url) ? 30000 : 0;
            const webpBonus = /\.webp(\?|$)/.test(url) ? 20000 : 0;
            const relevanceBonus = relevance * 1_800_000;
            const freshnessBonus = getFreshnessBonus(candidate);
            const sourceBonus = candidate.source === 'commons' ? 85000 : 0;
            const bannerBonus = getBannerRatioBonus(ratio);
            const faceBonus = getFaceCoverageBonus(candidateText);
            return (
                area -
                ratioPenalty +
                jpegBonus +
                webpBonus +
                relevanceBonus +
                freshnessBonus +
                sourceBonus +
                bannerBonus +
                faceBonus
            );
        };

        const validateImageLooksLikePhoto = async (url) => {
            try {
                const response = await fetchNoStore(url);
                if (!response.ok) return false;

                const blob = await response.blob();
                if (!blob || !String(blob.type || '').startsWith('image/')) return false;
                if (blob.size < 10 * 1024) return false;

                const objectUrl = URL.createObjectURL(blob);
                try {
                    const img = await new Promise((resolve, reject) => {
                        const image = new Image();
                        image.onload = () => resolve(image);
                        image.onerror = () => reject(new Error('image decode failed'));
                        image.src = objectUrl;
                    });

                    const sampleW = 48;
                    const sampleH = 28;
                    const canvas = document.createElement('canvas');
                    canvas.width = sampleW;
                    canvas.height = sampleH;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    if (!ctx) return false;

                    ctx.drawImage(img, 0, 0, sampleW, sampleH);
                    const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

                    const colorBins = new Map();
                    let lumSum = 0;
                    let lumSqSum = 0;
                    const totalPx = sampleW * sampleH;

                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i];
                        const g = data[i + 1];
                        const b = data[i + 2];
                        const a = data[i + 3];
                        if (a < 20) continue;

                        const qr = r >> 4;
                        const qg = g >> 4;
                        const qb = b >> 4;
                        const key = `${qr}-${qg}-${qb}`;
                        colorBins.set(key, (colorBins.get(key) || 0) + 1);

                        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                        lumSum += lum;
                        lumSqSum += lum * lum;
                    }

                    const uniqueColors = colorBins.size;
                    if (uniqueColors < 14) return false;

                    const dominantCount = Math.max(...colorBins.values());
                    const dominantRatio = dominantCount / totalPx;
                    if (dominantRatio > 0.62) return false;

                    const meanLum = lumSum / totalPx;
                    const variance = lumSqSum / totalPx - meanLum * meanLum;
                    if (variance < 120) return false;

                    return true;
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            } catch {
                return false;
            }
        };

        const pickBestCandidate = async (candidates) => {
            if (!Array.isArray(candidates) || candidates.length === 0) return null;

            const ranked = candidates
                .map((candidate) => ({ candidate, score: scoreImageCandidate(candidate) }))
                .filter((entry) => entry.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 8);

            for (const entry of ranked) {
                if (await validateImageLooksLikePhoto(entry.candidate.url)) {
                    return entry.candidate.url;
                }
            }

            return null;
        };

        const buildCandidateFromCommonsPage = (page, source, fallbackContext = '') => {
            if (!page || typeof page !== 'object') return null;
            const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
            if (!info?.url) return null;
            const corsSafeUrl = toCorsSafeImageUrl(info.url);
            if (!corsSafeUrl) return null;

            const categories = Array.isArray(page.categories)
                ? page.categories
                      .map((cat) => cat?.title || '')
                      .filter(Boolean)
                      .join(' ')
                : '';
            const extMeta = info.extmetadata || {};
            const metaText = [
                extMeta?.ObjectName?.value,
                extMeta?.ImageDescription?.value,
                extMeta?.Categories?.value,
                categories,
            ]
                .filter(Boolean)
                .join(' ')
                .replace(/<[^>]+>/g, ' ');

            return {
                url: corsSafeUrl,
                width: info.width,
                height: info.height,
                title: page.title,
                context: fallbackContext || page.title,
                metaText,
                timestamp: info.timestamp,
                source,
            };
        };

        const fetchCommonsFileCandidates = async (fileNames, source, contextLabel = '') => {
            if (!Array.isArray(fileNames) || fileNames.length === 0) return [];

            const normalizedTitles = fileNames
                .map((name) => (typeof name === 'string' ? name.trim() : ''))
                .filter(Boolean)
                .map((name) => (name.startsWith('File:') ? name : `File:${name}`));

            if (normalizedTitles.length === 0) return [];

            const infoUrl =
                `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
                `&titles=${encodeURIComponent(normalizedTitles.join('|'))}` +
                `&prop=imageinfo|categories&iiprop=url|size|mime|timestamp|extmetadata&cllimit=20`;

            const response = await fetchNoStore(buildProxiedUrl(infoUrl));
            if (!response.ok) return [];

            const data = await response.json();
            const pages = data?.query?.pages;
            if (!pages || typeof pages !== 'object') return [];

            return Object.values(pages)
                .map((page) => buildCandidateFromCommonsPage(page, source, contextLabel))
                .filter(Boolean);
        };

        const fetchCommonsCategoryCandidates = async (categoryName, contextLabel = '') => {
            if (typeof categoryName !== 'string' || !categoryName.trim()) return [];

            const normalized = categoryName.replace(/^Category:/i, '').trim();
            if (!normalized) return [];

            const membersUrl =
                `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=categorymembers` +
                `&cmtitle=${encodeURIComponent(`Category:${normalized}`)}` +
                `&cmtype=file&cmlimit=36&cmsort=timestamp&cmdir=newer`;

            const membersResponse = await fetchNoStore(buildProxiedUrl(membersUrl));
            if (!membersResponse.ok) return [];

            const membersData = await membersResponse.json();
            const members = Array.isArray(membersData?.query?.categorymembers) ? membersData.query.categorymembers : [];
            if (members.length === 0) return [];

            const latestMembers = [...members].sort((a, b) => {
                const aTs = Date.parse(a?.timestamp || 0) || 0;
                const bTs = Date.parse(b?.timestamp || 0) || 0;
                return bTs - aTs;
            });

            const fileTitles = latestMembers
                .map((member) => member?.title)
                .filter((title) => typeof title === 'string' && title.startsWith('File:'))
                .slice(0, 16);
            if (fileTitles.length === 0) return [];

            return fetchCommonsFileCandidates(fileTitles, 'commons-category', contextLabel);
        };

        const fetchWikidataImageCandidates = async (term) => {
            const searchUrl =
                `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=8` +
                `&search=${encodeURIComponent(term)}`;
            const searchResponse = await fetchNoStore(buildProxiedUrl(searchUrl));
            if (!searchResponse.ok) return [];

            const searchData = await searchResponse.json();
            const entities = Array.isArray(searchData?.search) ? searchData.search : [];
            if (entities.length === 0) return [];

            const candidates = [];
            const likelyArtistEntity = (entity) => {
                const text = `${entity?.label || ''} ${entity?.description || ''}`.toLowerCase();
                const hasRole =
                    text.includes('singer') ||
                    text.includes('musician') ||
                    text.includes('artist') ||
                    text.includes('band') ||
                    text.includes('rapper') ||
                    text.includes('composer');
                return hasRole && computeRelevance(text) >= 0.34;
            };

            for (const entity of entities) {
                if (!entity?.id || !likelyArtistEntity(entity)) continue;

                const claimsUrl =
                    `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json` +
                    `&entity=${encodeURIComponent(entity.id)}`;

                const claimsResponse = await fetchNoStore(buildProxiedUrl(claimsUrl));
                if (!claimsResponse.ok) continue;
                const claimsData = await claimsResponse.json();

                const categoryName = claimsData?.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
                if (typeof categoryName === 'string' && categoryName.trim()) {
                    const categoryCandidates = await fetchCommonsCategoryCandidates(
                        categoryName,
                        `${entity.label || ''} ${entity.description || ''}`
                    );
                    if (categoryCandidates.length > 0) {
                        candidates.push(...categoryCandidates);
                    }
                }

                const claims = claimsData?.claims?.P18;
                if (!Array.isArray(claims)) continue;

                const p18FileNames = claims
                    .map((claim) => claim?.mainsnak?.datavalue?.value)
                    .filter((value) => typeof value === 'string' && value.trim().length > 0);

                if (p18FileNames.length > 0) {
                    const p18Candidates = await fetchCommonsFileCandidates(
                        p18FileNames,
                        'wikidata-p18',
                        `${entity.label || ''} ${entity.description || ''}`
                    );
                    if (p18Candidates.length > 0) {
                        candidates.push(...p18Candidates);
                    }
                }
            }

            return candidates;
        };

        const fetchCommonsSearchCandidates = async (term) => {
            const commonsUrl =
                `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search` +
                `&gsrnamespace=6&gsrlimit=16&gsrsearch=${encodeURIComponent(`${term} portrait publicity photo`)}` +
                `&prop=imageinfo|categories&iiprop=url|size|mime|timestamp|extmetadata&cllimit=20`;

            const response = await fetchNoStore(buildProxiedUrl(commonsUrl));
            if (!response.ok) return [];
            const data = await response.json();
            const pages = data?.query?.pages;
            if (!pages || typeof pages !== 'object') return [];

            const candidates = [];
            Object.values(pages).forEach((page) => {
                const candidate = buildCandidateFromCommonsPage(page, 'commons-search', page?.title || term);
                if (candidate) candidates.push(candidate);
            });

            return candidates;
        };

        try {
            for (const term of searchTerms) {
                const commonsCandidates = await fetchCommonsSearchCandidates(term);
                const bestCommons = await pickBestCandidate(commonsCandidates);
                if (bestCommons) {
                    return bestCommons;
                }

                const wikidataCandidates = await fetchWikidataImageCandidates(term);
                const bestWikidata = await pickBestCandidate(wikidataCandidates);
                if (bestWikidata) {
                    return bestWikidata;
                }
            }
        } catch (error) {
            console.warn('Failed to fetch Wikimedia artist image:', error);
        }

        return null;
    }

    async getLastFmArtistImage(artistName, options = {}) {
        // Backward compatibility for existing call sites.
        return this.getArtistWebImage(artistName, options);
    }

    async getSimilarAlbums(albumId, options = {}) {
        if (!options.skipCache) {
            const cached = await this.cache.get('similar_albums', albumId);
            if (cached) return cached;
        }

        try {
            const response = await this.fetchWithRetry(`/album/similar/?id=${albumId}`, {
                type: 'api',
                minVersion: '2.3',
                cacheControl: options.cacheControl,
            });
            const data = await response.json();

            const items = data.items || data.albums || data.data || (Array.isArray(data) ? data : []);

            const result = items.map((album) => this.prepareAlbum(album));

            if (!options.skipCache && !(response instanceof TidalResponse)) {
                await this.cache.set('similar_albums', albumId, result);
            }
            return result;
        } catch (e) {
            console.warn('Failed to fetch similar albums:', e);
            return [];
        }
    }

    async getRecommendedTracksForPlaylist(tracks, limit = 20, options = {}) {
        const artistMap = new Map();

        // Check if tracks already have artist info (some might)
        for (const track of tracks) {
            if (track.artist && track.artist.id) {
                artistMap.set(track.artist.id, track.artist);
            }
            if (track.artists && Array.isArray(track.artists)) {
                for (const artist of track.artists) {
                    if (artist.id) {
                        artistMap.set(artist.id, artist);
                    }
                }
            }
        }

        if (artistMap.size < 3) {
            console.log('Not enough artists from stored data, trying search approach...');

            const searchTargets = tracks.slice(0, 5);
            const searchResults = await Promise.allSettled(
                searchTargets.map((track) => {
                    // Search for the track to get full metadata
                    const searchQuery = `"${track.title}" ${track.artist?.name || ''}`.trim();
                    return this.searchTracks(searchQuery, {
                        signal: createTimeoutSignal(5000),
                        cacheControl: options.cacheControl,
                    });
                })
            );

            searchResults.forEach((result, index) => {
                if (result.status !== 'fulfilled') {
                    console.warn(
                        `Search failed for track "${searchTargets[index]?.title || 'unknown'}":`,
                        result.reason
                    );
                    return;
                }

                const searchResult = result.value;
                if (searchResult.items && searchResult.items.length > 0) {
                    const foundTrack = searchResult.items[0];
                    if (foundTrack.artist && foundTrack.artist.id) {
                        artistMap.set(foundTrack.artist.id, foundTrack.artist);
                    }
                    if (foundTrack.artists && Array.isArray(foundTrack.artists)) {
                        for (const artist of foundTrack.artists) {
                            if (artist.id) {
                                artistMap.set(artist.id, artist);
                            }
                        }
                    }
                }
            });
        }

        const artists = Array.from(artistMap.values());
        console.log(`Found ${artists.length} unique artists from ${tracks.length} tracks`);

        if (artists.length === 0) {
            console.log('No artists found, cannot generate recommendations');
            return [];
        }

        const recommendedTracks = [];
        const seenTrackIds = new Set(tracks.map((t) => t.id));

        const artistsToProcess = artists.slice(0, Math.min(5, artists.length));

        const artistPromises = artistsToProcess.map(async (artist) => {
            try {
                console.log(`Fetching tracks for artist: ${artist.name} (ID: ${artist.id})`);
                const artistData = await this.getArtist(artist.id, { lightweight: true, skipCache: options.skipCache });
                if (artistData && artistData.tracks && artistData.tracks.length > 0) {
                    const newTracks = artistData.tracks.filter((track) => !seenTrackIds.has(track.id)).slice(0, 4);
                    return newTracks;
                } else {
                    console.warn(`No tracks found for artist ${artist.name}`);
                    return [];
                }
            } catch (e) {
                console.warn(`Failed to get tracks for artist ${artist.name}:`, e);
                return [];
            }
        });

        const results = await Promise.all(artistPromises);
        results.forEach((tracks) => {
            if (tracks.length > 0) {
                recommendedTracks.push(...tracks);
                tracks.forEach((track) => {
                    if (track?.id) seenTrackIds.add(track.id);
                });
            }
        });

        const shuffled = recommendedTracks.sort(() => 0.5 - Math.random());
        return shuffled.slice(0, limit);
    }

    normalizeTrackResponse(apiResponse) {
        if (!apiResponse || typeof apiResponse !== 'object') {
            return apiResponse;
        }

        // unwrap { version, data } if present
        const raw = apiResponse.data ?? apiResponse;

        const normalizedInfo = this.normalizeHifiTrackStreamInfo(raw);

        // fabricate the track object expected by parseTrackLookup
        const trackStub = {
            duration: raw.duration ?? 0,
            id: raw.trackId ?? null,
        };

        // return exactly what parseTrackLookup expects
        return [trackStub, normalizedInfo];
    }

    async getRecommendations(trackId, options = {}) {
        if (!trackId) return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };

        const cacheKey = `track_recommendations_${trackId}`;
        if (!options.skipCache) {
            const cached = await this.cache.get('recommendations', cacheKey);
            if (cached) return cached;
        }

        try {
            const response = await this.fetchWithRetry(`/recommendations/?id=${trackId}`, {
                ...options,
                type: 'api',
                minVersion: '2.4',
            });
            const payload = await response.json();
            const data = payload?.data || payload;
            const items = Array.isArray(data?.items) ? data.items : [];

            const tracks = items
                .map((entry) => entry?.track || entry?.item || entry)
                .map((track) => this.prepareTrack(track))
                .filter((track) => track?.id);

            const result = {
                items: tracks,
                limit: data?.limit ?? tracks.length,
                offset: data?.offset ?? 0,
                totalNumberOfItems: data?.totalNumberOfItems ?? tracks.length,
            };

            if (!options.skipCache && !(response instanceof TidalResponse)) {
                await this.cache.set('recommendations', cacheKey, result);
            }
            return result;
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            console.warn('Failed to fetch recommendations:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async getTrackMetadata(id) {
        const cacheKey = `meta_${id}`;
        const cached = await this.cache.get('track', cacheKey);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/info/?id=${id}`, { type: 'api' });
        const json = await response.json();
        const data = json.data || json;

        let track;
        const items = Array.isArray(data) ? data : [data];
        const found = items.find((i) => i.id == id || (i.item && i.item.id == id));

        if (found) {
            track = this.prepareTrack(found.item || found);
            if (!(response instanceof TidalResponse)) {
                await this.cache.set('track', cacheKey, track);
            }
            return track;
        }

        throw new Error('Track metadata not found');
    }

    async getTrack(id, quality = 'HI_RES_LOSSLESS') {
        const isPure = audioProcessingSettings.isPure();
        const cacheKey = `${id}_${quality}_${isPure ? 'pure' : 'norm'}`;
        const cached = await this.cache.get('track', cacheKey);
        if (cached) return cached;

        const loudnessParam = isPure ? '&loudnessNormalization=false' : '';
        const response = await this.fetchWithRetry(`/track/?id=${id}&quality=${quality}${loudnessParam}`, {
            type: 'streaming',
        });
        const jsonResponse = await response.json();
        const result = this.parseTrackLookup(this.normalizeTrackResponse(jsonResponse));

        if (!(response instanceof TidalResponse)) {
            await this.cache.set('track', cacheKey, result);
        }
        return result;
    }

    async getStreamUrl(id, quality = 'HI_RES_LOSSLESS') {
        const cacheKey = `stream_${id}_${quality}`;

        if (this.streamCache.has(cacheKey)) {
            return this.streamCache.get(cacheKey);
        }

        const lookup = await this.getTrack(id, quality);

        let streamUrl;
        if (lookup.originalTrackUrl) {
            streamUrl = lookup.originalTrackUrl;
        } else {
            streamUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
            if (!streamUrl) {
                throw new Error('Could not resolve stream URL');
            }
        }

        const info = lookup.info || {};
        const result = {
            url: streamUrl,
            bitDepth: info.bitDepth ?? null,
            sampleRate: info.sampleRate ?? null,
            audioQuality: info.audioQuality ?? null,
            audioMode: info.audioMode ?? null,
            mediaType: info.manifestMimeType?.includes('dash')
                ? 'DASH'
                : info.manifestMimeType?.includes('mpegURL')
                  ? 'HLS'
                  : null,
            trackReplayGain: info.trackReplayGain ?? null,
            trackPeakAmplitude: info.trackPeakAmplitude ?? null,
            albumReplayGain: info.albumReplayGain ?? null,
            albumPeakAmplitude: info.albumPeakAmplitude ?? null,
        };

        this.streamCache.set(cacheKey, result);
        return result;
    }

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

            // Handle DASH streams (blob URLs)
            if (streamUrl.startsWith('blob:')) {
                try {
                    const downloader = new DashDownloader();
                    blob = await downloader.downloadDashStream(streamUrl, {
                        signal: options.signal,
                        onProgress: options.onProgress,
                    });
                } catch (dashError) {
                    console.error('DASH download failed:', dashError);
                    // Fallback to LOSSLESS if DASH fails
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

                // ... (standard handling for Content-Length and body reader)
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

            // Add metadata if track information is provided
            if (track) {
                if (onProgress) {
                    onProgress({
                        stage: 'processing',
                        message: 'Adding metadata...',
                    });
                }
                blob = await addMetadataToAudio(blob, track, this, quality);
            }

            // Detect actual format and fix filename extension if needed
            const detectedExtension = await getExtensionFromBlob(blob);
            let finalFilename = filename;

            // Replace extension if it doesn't match detected format
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
            if (error.message === RATE_LIMIT_ERROR_MESSAGE) {
                throw error;
            }
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
            return `https://via.placeholder.com/${sizeToken}?text=No+Cover`;
        }

        if (
            normalizedInput.startsWith('http://') ||
            normalizedInput.startsWith('https://') ||
            normalizedInput.startsWith('blob:') ||
            normalizedInput.startsWith('assets/')
        ) {
            // For full Tidal image URLs, normalize to the requested size token.
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

        // If id is already a Tidal path (with slashes), accept as-is (normalize dashes)
        let formattedId = normalizedInput;

        if (formattedId.startsWith('/images/')) {
            formattedId = formattedId.replace(/^\/images\//, '');
        }

        // Handle styles like d84ff4a4/e926/48a4/9180/43e03dba3904 or d84ff4a4-e926-...
        if (formattedId.includes('/') || formattedId.includes('-')) {
            formattedId = formattedId.replace(/-/g, '/').replace(/^\/+|\/+$/g, '');

            // If the ID already includes a jpg at end, use direct normalized path without added size token
            if (/\.jpg$/i.test(formattedId)) {
                if (formattedId.startsWith('resources.tidal.com/images/')) {
                    return `https://${formattedId}`;
                }
                return `https://resources.tidal.com/images/${formattedId}`;
            }

            return `https://resources.tidal.com/images/${formattedId}/${sizeToken}.jpg`;
        }

        // Fallback to placeholder if cover ID can't be normalized
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

                // Fall back to the highest numeric key if present (e.g. {"80": "...", "640": "...", "750": "..."}).
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

    async clearCache() {
        await this.cache.clear();
        this.streamCache.clear();
    }

    getCacheStats() {
        return {
            ...this.cache.getCacheStats(),
            streamUrls: this.streamCache.size,
        };
    }
}
