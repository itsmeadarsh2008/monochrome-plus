// js/music-api.js
// Unified API wrapper backed by an Eclipse addon (search/stream/catalog).
// `tidalAPI` is kept as a legacy alias for the addon client so existing
// call sites (player cache clearing, etc.) keep working.

import { EclipseAPI } from './eclipse.js';
import { musicProviderSettings } from './storage.js';
import { fetchLastFmPersonalizedArtists, fetchLastFmSimilarArtists, fetchLastFmSimilarTracks } from './lastfm.js';

export class MusicAPI {
    static instance = null;

    constructor() {
        MusicAPI.instance = this;
        this.tidalAPI = new EclipseAPI();
    }

    getCurrentProvider() {
        return musicProviderSettings.getProvider();
    }

    getAPI(_provider = null) {
        return this.tidalAPI;
    }

    // Search methods
    async searchTracks(query, options = {}) {
        return this.tidalAPI.searchTracks(query, options);
    }

    async searchArtists(query, options = {}) {
        return this.tidalAPI.searchArtists(query, options);
    }

    async resolveArtistIdByName(name) {
        return this.tidalAPI.resolveArtistIdByName(name);
    }

    async searchAlbums(query, options = {}) {
        return this.tidalAPI.searchAlbums(query, options);
    }

    async searchPlaylists(query, options = {}) {
        return this.tidalAPI.searchPlaylists(query, options);
    }

    // Get methods
    async getTrack(id, quality, _provider = null) {
        return this.tidalAPI.getTrack(this.stripProviderPrefix(id), quality);
    }

    async getTrackMetadata(id, _provider = null) {
        return this.tidalAPI.getTrackMetadata(this.stripProviderPrefix(id));
    }

    async getAlbum(id, _provider = null) {
        return this.tidalAPI.getAlbum(this.stripProviderPrefix(id));
    }

    async getArtist(id, _provider = null) {
        return this.tidalAPI.getArtist(this.stripProviderPrefix(id));
    }

    async getArtistBiography(id, _provider = null) {
        return this.tidalAPI.getArtistBiography(this.stripProviderPrefix(id));
    }

    async getArtistWebImage(artistName, options = {}) {
        return this.tidalAPI.getArtistWebImage(artistName, options);
    }

    async getLastFmArtistImage(artistName, options = {}) {
        return this.tidalAPI.getLastFmArtistImage(artistName, options);
    }

    async getPlaylist(id, _provider = null) {
        return this.tidalAPI.getPlaylist(id);
    }

    async getMix(id, _provider = null) {
        return this.tidalAPI.getMix(id);
    }

    // Stream methods
    async getStreamUrl(id, quality, _provider = null, track = null) {
        return this.tidalAPI.getStreamUrl(this.stripProviderPrefix(id), quality, track);
    }

    // Cover/artwork methods
    getCoverUrl(id, size = '320') {
        return this.tidalAPI.getCoverUrl(id, size);
    }

    getArtistPictureUrl(id, size = '320') {
        return this.tidalAPI.getArtistPictureUrl(id, size);
    }

    getVideoCoverUrl(id, size = '1280') {
        return this.tidalAPI.getVideoCoverUrl(id, size);
    }

    getPreferredVisualUrl(source, size = '1280') {
        return this.tidalAPI.getPreferredVisualUrl(source, size);
    }

    extractStreamUrlFromManifest(manifest) {
        return this.tidalAPI.extractStreamUrlFromManifest(manifest);
    }

    // Helper methods
    getProviderFromId(id) {
        if (typeof id === 'string' && (id.startsWith('q:') || id.startsWith('t:'))) {
            return 'tidal';
        }
        return null;
    }

    stripProviderPrefix(id) {
        if (typeof id === 'string' && (id.startsWith('q:') || id.startsWith('t:'))) {
            return id.slice(2);
        }
        return id;
    }

    // Download methods
    async downloadTrack(id, quality, filename, options = {}) {
        return this.tidalAPI.downloadTrack(this.stripProviderPrefix(id), quality, filename, options);
    }

    // Similar/recommendation methods
    async getSimilarArtists(artistId, options = {}) {
        const artistName = options.seedName || options.artistName;
        if (!artistName) return this.tidalAPI.getSimilarArtists(this.stripProviderPrefix(artistId), options);

        const similar = await fetchLastFmSimilarArtists(artistName, { limit: options.limit || 20 });
        const candidates = similar.length
            ? similar
            : await fetchLastFmPersonalizedArtists({
                  limit: options.limit || 12,
                  skipCache: options.skipCache,
              });
        return this._resolveArtists(candidates, { ...options, resolveLimit: options.resolveLimit || 12 });
    }

    async getSimilarAlbums(albumId, options = {}) {
        // Last.fm has no album-to-album similarity endpoint. Its artist graph is
        // a better signal than the catalog provider's generic album search.
        const artistName = options.seedArtistName || options.artistName;
        if (!artistName) return this.tidalAPI.getSimilarAlbums(this.stripProviderPrefix(albumId), options);

        const similarArtists = await fetchLastFmSimilarArtists(artistName, {
            limit: options.artistLimit || 10,
        });
        const artistCandidates = similarArtists.length
            ? similarArtists
            : await fetchLastFmPersonalizedArtists({
                  limit: options.artistLimit || 6,
                  skipCache: options.skipCache,
              });
        const albums = await Promise.all(
            artistCandidates.slice(0, 4).map((artist) => this.searchAlbums(artist.name, { limit: 4 }))
        );
        return albums.flatMap((result) => (Array.isArray(result) ? result : result?.items || []));
    }

    async getRecommendedTracksForPlaylist(tracks, limit = 20, options = {}) {
        const seeds = Array.isArray(tracks) ? tracks.filter((track) => track?.title) : [];
        if (seeds.length === 0) return [];

        // The supplied playlist/history tracks are the recommendation seeds.
        // Use Last.fm's track similarity graph directly; do not replace these
        // seeds with the account's broad personalized artist feed.
        const similarBySeed = await Promise.all(
            seeds.slice(0, 4).map((seed) => fetchLastFmSimilarTracks(seed, { limit: 8 }))
        );
        const candidates = similarBySeed.flat();
        const resolved = await this._resolveTracks(candidates, { ...options, resolveLimit: options.resolveLimit || 18 });
        return this._dedupeResolvedTracks(resolved).slice(0, limit);
    }

    async getRecommendations(trackId, options = {}) {
        const cleanId = this.stripProviderPrefix(trackId);
        if (!cleanId) return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        let seedTrack = options.seedTrack;
        if (!seedTrack) {
            seedTrack = await this.getTrackMetadata(cleanId).catch(() => null);
        }
        const candidates = await fetchLastFmSimilarTracks(seedTrack, { limit: options.limit || 20 });
        const items = this._dedupeResolvedTracks(
            await this._resolveTracks(candidates, { ...options, resolveLimit: options.resolveLimit || 18 })
        );
        return { items, limit: items.length, offset: 0, totalNumberOfItems: items.length };
    }

    async _resolveTracks(candidates, options = {}) {
        const limitedCandidates = candidates.slice(0, options.resolveLimit || 18);
        const groups = new Map();
        limitedCandidates.forEach((candidate) => {
            const artist = String(candidate?.artist?.name || '').trim();
            if (!artist) return;
            const key = artist.toLowerCase();
            if (!groups.has(key)) groups.set(key, { name: artist, candidates: [] });
            groups.get(key).candidates.push(candidate);
        });

        const resolvedGroups = await Promise.all(
            Array.from(groups.values()).slice(0, 8).map(async (group) => {
                const found = await this.searchTracks(group.name, {
                    limit: Math.min(20, Math.max(8, group.candidates.length * 3)),
                    background: true,
                    signal: typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(3500) : undefined,
                }).catch(() => []);
                const items = Array.isArray(found) ? found : found?.items || [];
                const artistName = group.name.toLowerCase();
                return group.candidates.map((candidate) => {
                    const title = candidate.title.toLowerCase();
                    return items.find((item) => {
                        const itemArtist = String(item.artist?.name || item.artists?.[0]?.name || '').toLowerCase();
                        return itemArtist === artistName && String(item.title || '').toLowerCase() === title;
                    });
                }).filter(Boolean);
            })
        );
        return resolvedGroups.flat();
    }

    async _resolveArtists(candidates, options = {}) {
        const results = await Promise.all(
            candidates.slice(0, options.resolveLimit || 12).map(async (candidate) => {
                const found = await this.searchArtists(candidate.name, {
                    limit: 4,
                    background: true,
                    signal: typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(3500) : undefined,
                }).catch(() => []);
                const items = Array.isArray(found) ? found : found?.items || [];
                return items.find((item) => String(item.name || '').toLowerCase() === candidate.name.toLowerCase()) || items[0];
            })
        );
        return results.filter(Boolean);
    }

    _dedupeResolvedTracks(tracks) {
        const seen = new Set();
        return tracks.filter((track) => {
            const key = track.id || `${track.title}:${track.artist?.name || track.artists?.[0]?.name}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // Cache methods
    async clearCache() {
        await this.tidalAPI.clearCache();
    }

    async clearStreamCache() {
        await this.tidalAPI.clearStreamCache();
    }

    getCacheStats() {
        return this.tidalAPI.getCacheStats();
    }

    // Settings accessor for compatibility
    get settings() {
        return undefined;
    }
}
