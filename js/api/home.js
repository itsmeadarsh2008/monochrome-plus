// js/api/home.js

import { settingsStorage } from '../storage.js';

const TIDAL_V2_TOKEN = 'txNoH4kkV41MfH25';

/**
 * Get user's preferred country code from settings
 */
export function getUserCountryCode() {
  return localStorage.getItem('userCountryCode') || 'US';
}

/**
 * Set user's preferred country code
 */
export function setUserCountryCode(countryCode) {
  localStorage.setItem('userCountryCode', countryCode);
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
  const apiInstances = await settingsStorage.getInstances('api');
  if (apiInstances.length === 0) {
    throw new Error('No API instances available');
  }

  // Try each instance until one works
  let lastError = null;
  for (const baseUrl of apiInstances) {
    try {
      const url = buildUrl(baseUrl, '/pages/home', { locale, deviceType: 'BROWSER', countryCode });
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        return normalizeHomeData(data);
      }
      
      if (response.status === 404) {
        // This instance doesn't support /pages/home, try next
        console.warn(`Instance ${baseUrl} doesn't support /pages/home, trying next...`);
        continue;
      }
      
      if (response.status === 429) {
        // Rate limited, try next instance
        console.warn(`Rate limited on ${baseUrl}, trying next...`);
        continue;
      }
    } catch (error) {
      console.warn(`Failed to fetch from ${baseUrl}:`, error.message);
      lastError = error;
    }
  }

  // If all instances fail, try direct Tidal API as fallback
  try {
    return await getHomeSectionsDirectTidal(countryCode, locale);
  } catch (e) {
    throw lastError || new Error('Failed to fetch home sections from all instances');
  }
}

/**
 * Build URL properly handling baseUrl trailing slashes
 */
function buildUrl(baseUrl, path, params) {
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
      'Authorization': `Bearer ${await getTidalToken()}`,
      'X-Tidal-Token': TIDAL_V2_TOKEN,
    },
  });

  if (!response.ok) {
    throw new Error(`Tidal API returned ${response.status}`);
  }

  const data = await response.json();
  return normalizeHomeData(data);
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

/**
 * Extract a module from modules array by title keyword
 */
function extractModule(modules, titleKeyword) {
  const mod = modules.find((m) =>
    (m?.title ?? '').toLowerCase().includes(titleKeyword)
  );
  
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
