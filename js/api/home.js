// js/api/home.js

import { apiSettings } from '../storage.js';

const TIDAL_V2_TOKEN = 'txNoH4kkV41MfH25';
const HOME_INSTANCE_404_COOLDOWN_MS = 30 * 60 * 1000;
const home404UntilByInstance = new Map();

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
    const stored = String(localStorage.getItem('userCountryCode') || '').trim().toUpperCase();
    if (stored) return stored;

    // Persist default so it behaves as a true local setting from first launch.
    localStorage.setItem('userCountryCode', 'US');
    return 'US';
}

/**
 * Set user's preferred country code
 */
export function setUserCountryCode(countryCode) {
    const normalized = String(countryCode || 'US').trim().toUpperCase();
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

/**
 * Fetches all home page sections from the Tidal API.
 * Returns an object with named section arrays.
 */
export async function getHomeSections(countryCode, locale) {
    // Use settings if not provided
    if (!countryCode) countryCode = getUserCountryCode();
    if (!locale) locale = getUserLocale();

    // Get API instances
    const apiInstances = await apiSettings.getInstances('api');
    if (apiInstances.length === 0) {
        throw new Error('No API instances available');
    }

    const now = Date.now();
    const availableInstances = apiInstances.filter((instance) => {
        const baseUrl = typeof instance === 'string' ? instance : instance?.url;
        if (!baseUrl || typeof baseUrl !== 'string') return false;
        const retryAfter = home404UntilByInstance.get(baseUrl);
        return !retryAfter || retryAfter <= now;
    });
    const instancesToTry = availableInstances.length > 0 ? availableInstances : apiInstances;

    // Try each instance until one works
    let lastError = null;
    for (const instance of instancesToTry) {
        const baseUrl = typeof instance === 'string' ? instance : instance?.url;
        if (!baseUrl || typeof baseUrl !== 'string') continue;

        try {
            const possiblePaths = ['/pages/home', '/pages/home/'];
            let response = null;

            for (const path of possiblePaths) {
                const url = buildUrl(baseUrl, path, { locale, deviceType: 'BROWSER', countryCode });
                response = await fetch(url);
                if (response.ok) break;
                if (response.status !== 404) break;
            }

            if (response?.ok) {
                const data = await response.json();
                const normalized = normalizeHomeData(data);
                if (hasAnyHomeContent(normalized)) {
                    return normalized;
                }
                console.warn(`Instance ${baseUrl} returned empty home modules, trying next source...`);
                continue;
            }

            if (response?.status === 404) {
                // This instance doesn't support /pages/home, try next
                console.warn(`Instance ${baseUrl} doesn't support /pages/home, trying next...`);
                home404UntilByInstance.set(baseUrl, Date.now() + HOME_INSTANCE_404_COOLDOWN_MS);
                continue;
            }

            if (response?.status === 429) {
                // Rate limited, try next instance
                console.warn(`Rate limited on ${baseUrl}, trying next...`);
                continue;
            }
        } catch (error) {
            console.warn(`Failed to fetch from ${baseUrl}:`, error.message);
            lastError = error;
        }
    }

    // Direct TIDAL web endpoint is CORS-blocked in normal browser mode.
    // Keep this fallback only for trusted desktop/runtime contexts.
    if (isRuntimeAllowedForDirectTidalFallback()) {
        try {
            const direct = await getHomeSectionsDirectTidal(countryCode, locale);
            if (hasAnyHomeContent(direct)) {
                return direct;
            }
        } catch {
            // continue to legacy fallback
        }
    }

    // Legacy Monochrome fallback (works with hifi-api ecosystem)
    try {
        const legacy = await getHomeSectionsLegacyHot();
        if (hasAnyHomeContent(legacy)) {
            return legacy;
        }
    } catch (error) {
        console.warn('[Home] Legacy hot fallback failed:', error?.message || error);
    }

    throw lastError || new Error('Failed to fetch home sections from all sources');
}

/**
 * Build URL properly handling baseUrl trailing slashes
 */
function buildUrl(baseUrl, path, params) {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
        throw new Error('Invalid base URL for Home sections');
    }
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const queryString = new URLSearchParams(params).toString();
    return `${cleanBase}${cleanPath}?${queryString}`;
}

/**
 * Fallback: Direct Tidal API call (requires authentication token)
 */
async function getHomeSectionsDirectTidal(countryCode = 'US', locale = 'en_US') {
    const url = `https://listen.tidal.com/v2/pages/home?locale=${locale}&deviceType=BROWSER&countryCode=${countryCode}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${await getTidalToken()}`,
            'X-Tidal-Token': TIDAL_V2_TOKEN,
        },
    });

    if (!response.ok) {
        throw new Error(`Tidal API returned ${response.status}`);
    }

    const data = await response.json();
    return normalizeHomeData(data);
}

async function getHomeSectionsLegacyHot() {
    const response = await fetch('https://hot.monochrome.tf/');
    if (!response.ok) {
        throw new Error(`Legacy hot endpoint returned ${response.status}`);
    }
    const data = await response.json();
    return normalizeLegacyHotData(data);
}

function isRuntimeAllowedForDirectTidalFallback() {
    if (typeof window === 'undefined') return false;
    const protocol = String(window.location?.protocol || '').toLowerCase();
    const hostname = String(window.location?.hostname || '').toLowerCase();
    const hasTauriRuntime = Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__ || window.__TAURI_IPC__);
    return hasTauriRuntime || protocol === 'tauri:' || hostname === 'tauri.localhost';
}

/**
 * Get Tidal session token from storage
 */
async function getTidalToken() {
    // Try to get token from existing storage
    const stored = localStorage.getItem('tidalToken') || localStorage.getItem('sessionToken');
    if (stored) return stored;

    // If no token, we can't make authenticated requests
    // This is expected for unauthenticated users
    console.warn('No Tidal session token found. Using public token.');
    return '';
}

/**
 * Normalize the API response into named sections
 */
function normalizeHomeData(data) {
    // TIDAL pages structure: top-level rows[] OR data.rows[]
    const rows = data?.rows ?? data?.data?.rows ?? [];
    const modules = rows.flatMap((r) => r?.modules ?? []);

    return {
        genres: extractModule(modules, 'genres'),
        trendingAlbums: extractModule(modules, 'trending albums'),
        trendingTracks: extractModule(modules, 'trending tracks'),
        featuredPlaylists: extractModule(modules, 'featured playlists'),
        newTracks: extractModule(modules, 'new tracks'),
        newAlbums: extractModule(modules, 'new albums'),
        spotlightedUploads: extractModule(modules, 'spotlighted uploads'),
        fromEditors: extractModule(modules, 'from our editors'),
    };
}

function normalizeLegacyHotData(data) {
    const sections = Array.isArray(data?.sections) ? data.sections : [];

    const findSectionItems = (matcher) => {
        const section = sections.find((s) => matcher(String(s?.title || '').toLowerCase(), String(s?.type || '')));
        return Array.isArray(section?.items) ? section.items : [];
    };

    return {
        genres: [],
        trendingAlbums: Array.isArray(data?.top_albums) ? data.top_albums : findSectionItems((title, type) => {
            return type === 'ALBUM_LIST' && title.includes('trend');
        }),
        trendingTracks: Array.isArray(data?.top_tracks) ? data.top_tracks : findSectionItems((title, type) => {
            return type === 'TRACK_LIST' && title.includes('trend');
        }),
        featuredPlaylists: Array.isArray(data?.featured_playlists)
            ? data.featured_playlists
            : findSectionItems((title, type) => {
                  return type === 'PLAYLIST_LIST' && title.includes('featured');
              }),
        newTracks: findSectionItems((title, type) => {
            return type === 'TRACK_LIST' && (title.includes('new') || title.includes('fresh'));
        }),
        newAlbums: findSectionItems((title, type) => {
            return type === 'ALBUM_LIST' && (title.includes('new') || title.includes('fresh'));
        }),
        spotlightedUploads: findSectionItems((title, type) => {
            return type === 'TRACK_LIST' && (title.includes('spotlight') || title.includes('upload'));
        }),
        fromEditors: findSectionItems((title, type) => {
            return type === 'PLAYLIST_LIST' && (title.includes('editor') || title.includes('curated'));
        }),
    };
}

function hasAnyHomeContent(homeData) {
    if (!homeData || typeof homeData !== 'object') return false;
    const keys = [
        'trendingAlbums',
        'trendingTracks',
        'featuredPlaylists',
        'newTracks',
        'newAlbums',
        'spotlightedUploads',
        'fromEditors',
    ];
    return keys.some((key) => Array.isArray(homeData[key]) && homeData[key].length > 0);
}

/**
 * Extract a module from modules array by title keyword
 */
function extractModule(modules, titleKeyword) {
    const mod = modules.find((m) => (m?.title ?? '').toLowerCase().includes(titleKeyword));

    if (!mod) return [];

    const items = mod?.pagedList?.items ?? mod?.items ?? [];

    // Deduplicate by id/uuid
    const seen = new Set();
    return items.filter((item) => {
        const key = item.uuid ?? item.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
