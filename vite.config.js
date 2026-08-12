import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { VitePWA } from 'vite-plugin-pwa';
import authGatePlugin from './vite-plugin-auth-gate.js';
import nodeFetch from './vite-plugin-proxy-fetch.js';

const APP_REPO_URL = 'https://github.com/itsmeadarsh2008/monochrome-plus';
const APP_COMMIT = (() => {
    try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
        return 'unknown';
    }
})();
const APP_COMMIT_SHORT = APP_COMMIT === 'unknown' ? 'unknown' : APP_COMMIT.slice(0, 7);

export default defineConfig(() => {
    return {
        base: '/',
        define: {
            __APP_COMMIT__: JSON.stringify(APP_COMMIT),
            __APP_COMMIT_SHORT__: JSON.stringify(APP_COMMIT_SHORT),
            __APP_REPO_URL__: JSON.stringify(APP_REPO_URL),
        },
        resolve: {
            alias: {
                pocketbase: '/node_modules/pocketbase/dist/pocketbase.es.js',
            },
        },
        optimizeDeps: {
            exclude: ['pocketbase'],
        },
        server: {
            host: true,
            port: 5173,
            strictPort: true,
            hmr: {
                host: 'localhost',
                protocol: 'ws',
                port: 5173,
            },
            allowedHosts: true,
            historyApiFallback: true,
            fs: {
                allow: ['.', 'node_modules'],
            },
            proxy: {
                '/appwrite/v1': {
                    target: 'https://sgp.cloud.appwrite.io',
                    changeOrigin: true,
                    secure: true,
                },
                '/artistgrid-trends': {
                    target: 'https://trends.artistgrid.cx',
                    changeOrigin: true,
                    secure: false,
                    rewrite: (path) => path.replace(/^\/artistgrid-trends/, ''),
                },
                '/artistgrid-assets': {
                    target: 'https://assets.artistgrid.cx',
                    changeOrigin: true,
                    secure: false,
                    rewrite: (path) => path.replace(/^\/artistgrid-assets/, ''),
                },
                '/cors-proxy': {
                    target: 'https://corsproxy.io',
                    changeOrigin: true,
                    secure: true,
                    rewrite: (path) => {
                        const encodedUrl = path.replace(/^\/cors-proxy\//, '');
                        return `/proxy?url=${encodedUrl}`;
                    },
                },
            },
        },
        preview: {
            proxy: {
                '/appwrite/v1': {
                    target: 'https://sgp.cloud.appwrite.io',
                    changeOrigin: true,
                    secure: true,
                },
                '/cors-proxy': {
                    target: 'https://corsproxy.io',
                    changeOrigin: true,
                    secure: true,
                    rewrite: (path) => {
                        const encodedUrl = path.replace(/^\/cors-proxy\//, '');
                        return `/proxy?url=${encodedUrl}`;
                    },
                },
            },
        },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
        },
        plugins: [
            nodeFetch(),
            authGatePlugin(),
            VitePWA({
                registerType: 'prompt',
                workbox: {
                    globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
                    cleanupOutdatedCaches: true,
                    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB limit
                    // Define runtime caching strategies
                    runtimeCaching: [
                        {
                            // Proxied third-party traffic (covers via public CORS
                            // proxies, or the same-origin /cors-proxy route) must
                            // never be intercepted: the SW network path rejects
                            // with "no-response" when a proxy dies, and the page's
                            // own fallback chain can't advance past a failed
                            // respondWith(). Let those reach the network directly.
                            urlPattern: ({ request }) => {
                                try {
                                    const url = request.url;
                                    if (url.includes('/cors-proxy/')) return false;
                                    const host = new URL(url).hostname;
                                    if (
                                        host === 'corsproxy.io' ||
                                        host.endsWith('.allorigins.win') ||
                                        host === 'cors-proxy.htmldriven.com'
                                    ) {
                                        return false;
                                    }
                                } catch {
                                    /* fall through to default handling */
                                }
                                return request.destination === 'image';
                            },
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'images',
                                expiration: {
                                    maxEntries: 100,
                                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                                },
                            },
                        },
                        {
                            urlPattern: ({ request }) => {
                                try {
                                    const url = request.url;
                                    if (url.includes('/cors-proxy/')) return false;
                                    const host = new URL(url).hostname;
                                    if (
                                        host === 'corsproxy.io' ||
                                        host.endsWith('.allorigins.win') ||
                                        host === 'cors-proxy.htmldriven.com'
                                    ) {
                                        return false;
                                    }
                                } catch {
                                    /* fall through to default handling */
                                }
                                return request.destination === 'audio' || request.destination === 'video';
                            },
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'media',
                                expiration: {
                                    maxEntries: 50,
                                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                                },
                                rangeRequests: true, // Support scrubbing
                            },
                        },
                    ],
                },
                includeAssets: ['discord.html'],
                manifest: false, // Use existing public/manifest.json
            }),
        ],
    };
});
