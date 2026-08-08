// Global CORS bypass for all environments.
// Local dev: Uses Vite proxy via /cors-proxy/ prefix
// Production: Routes through a chain of public CORS proxies with automatic
// fallback (a dead proxy is skipped and a working one is remembered).

const CORS_PROXY_PREFIX = '/cors-proxy/';
const PROXY_STORAGE_KEY = 'mono-cors-proxy-index';

// Public proxy fallback chain (production only). Ordered by preference.
const PROXY_TEMPLATES = [
    (encoded) => `https://corsproxy.io/proxy?url=${encoded}`,
    (encoded) => `https://api.allorigins.win/raw?url=${encoded}`,
    (encoded) => `https://cors-proxy.htmldriven.com/?url=${encoded}`,
];

// Hosts that need proxying. This Set is used by rewriteUrl/needsProxy and can
// grow at runtime — addProxyHost() registers unknown stream hosts on the fly so
// new CDNs (from user-configured addons) are proxied without a redeploy.
const NEEDS_PROXY_HOSTS = new Set([
    'resources.tidal.com',
    'sp-ad-fa.audio.tidal.com',
    'lgf.audio.tidal.com',
    'audio.tidal.com',
    'hifi-two.spotisaver.net',
    'hifi.geeked.wtf',
    'maus.qqdl.site',
    'vogel.qqdl.site',
    'katze.qqdl.site',
    'hund.qqdl.site',
    'wolf.qqdl.site',
    'monochrome-api.samidy.com',
    'tidal.kinoplus.online',
    'lyricsplus.binimum.org',
    'lyricsplus.atomix.one',
    'lyricsplus-seven.vercel.app',
    'lyrics-plus-backend.vercel.app',
    'storage.lyrics-api.binimum.org',
    'sheets.artistgrid.cx',
    'trends.artistgrid.cx',
    'tracker.israeli.ovh',
    'www.youtube.com',
    'youtube.com',
]);

// Hosts that support CORS natively (never need proxy)
const CORS_SUPPORTED_HOSTS = new Set([
    'sgp.cloud.appwrite.io',
    'cloud.appwrite.io',
    'fra.cloud.appwrite.io',
    'nyc.cloud.appwrite.io',
    'lon.cloud.appwrite.io',
    'auth.tidal.com',
    'api.tidal.com',
    'openapi.tidal.com',
    'triton.squid.wtf',
    'arran.monochrome.tf',
    'eu-central.monochrome.tf',
    'ohio-1.monochrome.tf',
    'us-west.monochrome.tf',
]);

function isLocalBrowserDev() {
    if (typeof window === 'undefined' || !window.location) return false;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
}

// Returns the index of the currently active public proxy, or 0 by default.
function getActiveProxyIndex() {
    if (typeof window === 'undefined' || !window.localStorage) return 0;
    try {
        const idx = parseInt(window.localStorage.getItem(PROXY_STORAGE_KEY), 10);
        if (Number.isInteger(idx) && idx >= 0 && idx < PROXY_TEMPLATES.length) return idx;
    } catch {
        /* ignore storage errors */
    }
    return 0;
}

// Remembers a proxy that actually worked so later requests skip the dead ones.
function setActiveProxyIndex(idx) {
    if (idx == null || idx >= PROXY_TEMPLATES.length) return;
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        window.localStorage.setItem(PROXY_STORAGE_KEY, String(idx));
    } catch {
        /* ignore storage errors */
    }
}

function sanitizeHost(hostname) {
    const host = String(hostname || '')
        .toLowerCase()
        .trim();
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host) ? host : null;
}

// Registers an unknown remote host so future requests to it are proxied.
function addProxyHost(hostname) {
    const host = sanitizeHost(hostname);
    if (!host || host === window.location.hostname || CORS_SUPPORTED_HOSTS.has(host)) return false;
    if (NEEDS_PROXY_HOSTS.has(host)) return true;
    NEEDS_PROXY_HOSTS.add(host);
    return true;
}

function needsProxy(hostname) {
    const host = hostname.toLowerCase();
    if (host === window.location.hostname) return false;
    if (CORS_SUPPORTED_HOSTS.has(host)) return false;
    if (host.endsWith('.cloud.appwrite.io')) return false;
    if (host.endsWith('.monochrome.tf')) return false;
    if (NEEDS_PROXY_HOSTS.has(host)) return true;
    return false;
}

function encodeUrl(url) {
    return encodeURIComponent(new URL(url, window.location.href).toString());
}

function rewriteUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return rawUrl;

    try {
        const parsed = new URL(rawUrl, window.location.href);
        if (!/^https?:$/i.test(parsed.protocol)) return rawUrl;
        if (parsed.origin === window.location.origin) return rawUrl;

        // Special routes (always rewrite, works in both dev and prod)
        if (parsed.pathname.startsWith('/artistgrid-api/') || parsed.pathname.startsWith('/tracker-api/')) {
            return `${parsed.pathname}${parsed.search}`;
        }

        if (!needsProxy(parsed.hostname)) {
            return rawUrl;
        }

        // Local dev only: route through Vite proxy
        if (isLocalBrowserDev()) {
            return `${CORS_PROXY_PREFIX}${encodeURIComponent(parsed.toString())}`;
        }

        // Production: route through the active public CORS proxy
        return PROXY_TEMPLATES[getActiveProxyIndex()](encodeUrl(parsed.toString()));
    } catch {
        return rawUrl;
    }
}

function proxiedUrl(originalUrl, proxyIndex) {
    return PROXY_TEMPLATES[proxyIndex](encodeUrl(originalUrl));
}

function installGlobalCorsBypass() {
    if (typeof window === 'undefined') return;
    window.__corsBypass = window.__corsBypass || { addProxyHost };
    if (window.__globalCorsBypassInstalled) return;
    window.__globalCorsBypassInstalled = true;

    if (isLocalBrowserDev()) {
        console.log('[CORS Bypass] Local dev mode — routing through Vite proxy.');
    } else {
        console.log(`[CORS Bypass] Production mode — public CORS proxy #${getActiveProxyIndex()}.`);
    }

    if (!window.__originalFetch && typeof window.fetch === 'function') {
        window.__originalFetch = window.fetch.bind(window);

        window.fetch = async (input, init) => {
            const originalUrl = typeof input === 'string' ? input : input.url;
            const rewrittenUrl = rewriteUrl(originalUrl);

            if (rewrittenUrl === originalUrl) {
                return window.__originalFetch(input, init);
            }

            const buildRequest = (url) =>
                typeof input === 'string' ? url : new Request(url, init === undefined ? input : init);

            // Local dev: the Vite proxy is the only route — no fallback chain.
            if (isLocalBrowserDev()) {
                return window.__originalFetch(buildRequest(rewrittenUrl), init);
            }

            // Proxied request: try the active proxy first, then the remaining
            // chain in order. A successful retry becomes the new default.
            const startIndex = getActiveProxyIndex();
            let lastError = null;
            for (let i = 0; i < PROXY_TEMPLATES.length; i++) {
                const idx = (startIndex + i) % PROXY_TEMPLATES.length;
                const candidateUrl = i === 0 && idx === startIndex ? rewrittenUrl : proxiedUrl(originalUrl, idx);
                try {
                    const res = await window.__originalFetch(buildRequest(candidateUrl), init);
                    if (res.ok) {
                        if (idx !== startIndex) setActiveProxyIndex(idx);
                        return res;
                    }
                    lastError = new Error(`CORS proxy rejected with HTTP ${res.status}`);
                } catch (error) {
                    lastError = error;
                }
            }
            throw lastError || new Error('All CORS proxies failed');
        };
    }

    if (!window.__originalXHROpen && typeof XMLHttpRequest !== 'undefined') {
        window.__originalXHROpen = XMLHttpRequest.prototype.open;

        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            const rewrittenUrl = rewriteUrl(typeof url === 'string' ? url : String(url));
            return window.__originalXHROpen.call(this, method, rewrittenUrl, ...rest);
        };
    }
}

installGlobalCorsBypass();
