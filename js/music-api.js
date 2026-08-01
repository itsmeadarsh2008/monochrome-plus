// js/music-api.js
// Unified API wrapper backed by an Eclipse addon (search/stream/catalog).
// `tidalAPI` is kept as a legacy alias for the addon client so existing
// call sites (player cache clearing, etc.) keep working.

import { EclipseAPI } from './eclipse.js';
import { musicProviderSettings } from './storage.js';

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
    async getStreamUrl(id, quality, _provider = null) {
        return this.tidalAPI.getStreamUrl(this.stripProviderPrefix(id), quality);
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
        return this.tidalAPI.getSimilarArtists(this.stripProviderPrefix(artistId), options);
    }

    async getSimilarAlbums(albumId, options = {}) {
        return this.tidalAPI.getSimilarAlbums(this.stripProviderPrefix(albumId), options);
    }

    async getRecommendedTracksForPlaylist(tracks, limit = 20, options = {}) {
        return this.tidalAPI.getRecommendedTracksForPlaylist(tracks, limit, options);
    }

    async getRecommendations(trackId, options = {}) {
        const cleanId = this.stripProviderPrefix(trackId);
        if (!cleanId) return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        return this.tidalAPI.getRecommendations(cleanId, options);
    }

    // Cache methods
    async clearCache() {
        await this.tidalAPI.clearCache();
    }

    getCacheStats() {
        return this.tidalAPI.getCacheStats();
    }

    // Settings accessor for compatibility
    get settings() {
        return undefined;
    }
}
