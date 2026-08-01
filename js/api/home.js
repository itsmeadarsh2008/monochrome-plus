// js/api/home.js

import { MusicAPI } from '../music-api.js';
import { EclipseAPI, eclipseAddonStorage } from '../eclipse.js';

export const HOME_COUNTRY_OPTIONS = Object.freeze([
    { code: 'US', label: 'United States' },
    { code: 'GB', label: 'United Kingdom' },
    { code: 'CA', label: 'Canada' },
    { code: 'AU', label: 'Australia' },
    { code: 'IN', label: 'India' },
    { code: 'DE', label: 'Germany' },
    { code: 'FR', label: 'France' },
    { code: 'IT', label: 'Italy' },
    { code: 'ES', label: 'Spain' },
    { code: 'NL', label: 'Netherlands' },
    { code: 'SE', label: 'Sweden' },
    { code: 'NO', label: 'Norway' },
    { code: 'DK', label: 'Denmark' },
    { code: 'FI', label: 'Finland' },
    { code: 'BR', label: 'Brazil' },
    { code: 'MX', label: 'Mexico' },
    { code: 'JP', label: 'Japan' },
    { code: 'KR', label: 'South Korea' },
    { code: 'SG', label: 'Singapore' },
    { code: 'ZA', label: 'South Africa' },
]);

/**
 * Get user's preferred country code from settings
 */
export function getUserCountryCode() {
    const stored = String(localStorage.getItem('userCountryCode') || '')
        .trim()
        .toUpperCase();
    if (stored) return stored;

    // Persist default so it behaves as a true local setting from first launch.
    localStorage.setItem('userCountryCode', 'US');
    return 'US';
}

/**
 * Set user's preferred country code
 */
export function setUserCountryCode(countryCode) {
    const normalized = String(countryCode || 'US')
        .trim()
        .toUpperCase();
    localStorage.setItem('userCountryCode', normalized || 'US');
}

/**
 * Get user's preferred locale from settings
 */
export function getUserLocale() {
    return localStorage.getItem('userLocale') || 'en_US';
}

/**
 * Set user's preferred locale
 */
export function setUserLocale(locale) {
    localStorage.setItem('userLocale', locale);
}

let eclipseAPI = null;

function getEclipseAPI() {
    if (MusicAPI.instance?.tidalAPI) return MusicAPI.instance.tidalAPI;
    if (!eclipseAPI) eclipseAPI = new EclipseAPI();
    return eclipseAPI;
}

const HOME_SECTIONS = [
    { key: 'trendingTracks', query: 'top hits', type: 'tracks' },
    { key: 'trendingAlbums', query: 'top albums', type: 'albums' },
    { key: 'featuredPlaylists', query: 'essentials', type: 'playlists' },
    { key: 'newTracks', query: 'new music', type: 'tracks' },
    { key: 'newAlbums', query: 'new album', type: 'albums' },
    { key: 'fromEditors', query: 'editor picks', type: 'playlists' },
    { key: 'spotlightedUploads', query: 'fresh finds', type: 'tracks' },
];

/**
 * The Eclipse addon has no editorial/home endpoint, so home sections are
 * synthesized from curated searches against the installed addon.
 * Returns an object with named section arrays (same shape as before).
 */
export async function getHomeSections(_countryCode, _locale) {
    if (!eclipseAddonStorage.getAddon()) return {};

    const api = getEclipseAPI();
    const sections = {};

    await Promise.all(
        HOME_SECTIONS.map(async (definition) => {
            try {
                const items =
                    definition.type === 'tracks'
                        ? await api.searchTracks(definition.query, { limit: 20 })
                        : definition.type === 'albums'
                          ? await api.searchAlbums(definition.query, { limit: 20 })
                          : await api.searchPlaylists(definition.query, { limit: 20 });
                sections[definition.key] = Array.isArray(items)
                    ? items
                    : Array.isArray(items?.items)
                      ? items.items
                      : [];
            } catch (error) {
                console.warn(`[Home] Section "${definition.key}" failed:`, error?.message || error);
                sections[definition.key] = [];
            }
        })
    );

    return ensureDistinctDiscoveryBuckets(sections);
}

function getEntityKey(item) {
    if (!item || typeof item !== 'object') return '';
    const entity = item.item && typeof item.item === 'object' ? item.item : item;
    return String(entity.uuid || entity.id || '').trim();
}

function removeOverlaps(primary = [], secondary = []) {
    const primaryKeys = new Set(primary.map((entry) => getEntityKey(entry)).filter(Boolean));
    return secondary.filter((entry) => {
        const key = getEntityKey(entry);
        return !key || !primaryKeys.has(key);
    });
}

function ensureDistinctDiscoveryBuckets(homeData) {
    if (!homeData || typeof homeData !== 'object') return homeData;
    const normalized = { ...homeData };

    // Keep "New" sections semantically distinct from "Trending/Hot" sections.
    // Some upstream fallbacks currently return overlapping (or identical) lists.
    normalized.newTracks = removeOverlaps(normalized.trendingTracks || [], normalized.newTracks || []);
    normalized.newAlbums = removeOverlaps(normalized.trendingAlbums || [], normalized.newAlbums || []);

    return normalized;
}
