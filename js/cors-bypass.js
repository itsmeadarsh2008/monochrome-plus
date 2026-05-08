// Global CORS bypass for all environments.
// Local dev: Uses Vite proxy via /cors-proxy/ prefix
// Production: Routes through public CORS proxy

const CORS_PROXY_PREFIX = '/cors-proxy/';

// Hosts that need proxying in local dev (Vite handles it server-side)
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

function needsProxy(hostname) {
    const host = hostname.toLowerCase();
    if (host === window.location.hostname) return false;
    if (CORS_SUPPORTED_HOSTS.has(host)) return false;
    if (host.endsWith('.cloud.appwrite.io')) return false;
    if (host.endsWith('.monochrome.tf')) return false;
    if (NEEDS_PROXY_HOSTS.has(host)) return true;
    return false;
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

        // Production: use public CORS proxy
        return `https://corsproxy.io/proxy?url=${encodeURIComponent(parsed.toString())}`;
    } catch {
        return rawUrl;
    }
}

function installGlobalCorsBypass() {
    if (typeof window === 'undefined' || window.__globalCorsBypassInstalled) return;
    window.__globalCorsBypassInstalled = true;

    if (isLocalBrowserDev()) {
        console.log('[CORS Bypass] Local dev mode — routing through Vite proxy.');
    } else {
        console.log('[CORS Bypass] Production mode — routing through public proxy.');
    }

    if (!window.__originalFetch && typeof window.fetch === 'function') {
        window.__originalFetch = window.fetch.bind(window);

        window.fetch = async (input, init) => {
            const originalUrl = typeof input === 'string' ? input : input.url;
            const rewrittenUrl = rewriteUrl(originalUrl);

            if (rewrittenUrl !== originalUrl) {
                const request = typeof input === 'string' ? rewrittenUrl : new Request(rewrittenUrl, input);
                return window.__originalFetch(request, init);
            }

            return window.__originalFetch(input, init);
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
