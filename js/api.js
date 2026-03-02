//js/api.js
import {
    RATE_LIMIT_ERROR_MESSAGE,
    deriveTrackQuality,
    delay,
    isTrackUnavailable,
    getExtensionFromBlob,
} from './utils.js';
import { trackDateSettings, audioProcessingSettings } from './storage.js';
import { APICache } from './cache.js';
import { addMetadataToAudio } from './metadata.js';
import { DashDownloader } from './dash-downloader.js';

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

    async fetchWithRetry(relativePath, options = {}) {
        const type = options.type || 'api';
        const instances = await this.settings.getInstances(type);
        if (instances.length === 0) {
            throw new Error(`No API instances configured for type: ${type}`);
        }

        const maxTotalAttempts = instances.length * 2; // Allow some retries across instances
        let lastError = null;
        let instanceIndex = Math.floor(Math.random() * instances.length);

        for (let attempt = 1; attempt <= maxTotalAttempts; attempt++) {
            const baseUrl = instances[instanceIndex % instances.length];
            const url = baseUrl.endsWith('/') ? `${baseUrl}${relativePath.substring(1)}` : `${baseUrl}${relativePath}`;

            try {
                const response = await fetch(url, { signal: options.signal });

                if (response.status === 429) {
                    console.warn(`Rate limit hit on ${baseUrl}. Trying next instance...`);
                    instanceIndex++;
                    await delay(500); // Small delay before trying next instance
                    continue;
                }

                if (response.ok) {
                    return response;
                }

                if (response.status === 401) {
                    let errorData = await response.clone().json();
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
        try {
            const decoded = atob(manifest);

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
            // Skip enrichment for search to be fast and lightweight
            // const enrichedTracks = await this.enrichTracksWithAlbumDates(preparedTracks);
            const result = {
                ...normalized,
                items: preparedTracks,
            };

            await this.cache.set('search_tracks', query, result);
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

            await this.cache.set('search_artists', query, result);
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

            await this.cache.set('search_albums', query, result);
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

            await this.cache.set('search_playlists', query, result);
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

        await this.cache.set('album', id, result);
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

        await this.cache.set('playlist', id, result);
        return result;
    }

    async getMix(id) {
        const cached = await this.cache.get('mix', id);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/mix/?id=${id}`, { type: 'api' });
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
        await this.cache.set('mix', id, result);
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
            picture: rawArtist.picture || primaryData.cover || null,
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

    async getSimilarArtists(artistId) {
        const cached = await this.cache.get('similar_artists', artistId);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/artist/similar/?id=${artistId}`, { type: 'api' });
            const data = await response.json();

            // Handle various response structures
            const items = data.artists || data.items || data.data || (Array.isArray(data) ? data : []);

            const result = items.map((artist) => this.prepareArtist(artist));

            await this.cache.set('similar_artists', artistId, result);
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

    async getSimilarAlbums(albumId) {
        const cached = await this.cache.get('similar_albums', albumId);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/album/similar/?id=${albumId}`, { type: 'api' });
            const data = await response.json();

            const items = data.items || data.albums || data.data || (Array.isArray(data) ? data : []);

            const result = items.map((album) => this.prepareAlbum(album));

            await this.cache.set('similar_albums', albumId, result);
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

            for (const track of tracks.slice(0, 5)) {
                try {
                    // Search for the track to get full metadata
                    const searchQuery = `"${track.title}" ${track.artist?.name || ''}`.trim();
                    const searchResult = await this.searchTracks(searchQuery, { signal: AbortSignal.timeout(5000) });

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
                } catch (e) {
                    console.warn(`Search failed for track "${track.title}":`, e);
                }
            }
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
                seenTrackIds.add(...tracks.map((t) => t.id));
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
        const cached = await this.cache.get('recommendations', cacheKey);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/recommendations/?id=${trackId}`, options);
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

            await this.cache.set('recommendations', cacheKey, result);
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
            await this.cache.set('track', cacheKey, track);
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

        await this.cache.set('track', cacheKey, result);
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

        this.streamCache.set(cacheKey, streamUrl);
        return streamUrl;
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
        if (!id) {
            return `https://picsum.photos/seed/${Math.random()}/${size}`;
        }

        if (typeof id === 'string' && (id.startsWith('http') || id.startsWith('blob:') || id.startsWith('assets/'))) {
            return id;
        }

        const formattedId = id.replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
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
            return `https://picsum.photos/seed/${Math.random()}/${size}`;
        }

        if (typeof id === 'string' && (id.startsWith('blob:') || id.startsWith('assets/'))) {
            return id;
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
