import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import authGatePlugin from './vite-plugin-auth-gate.js';
import nodeFetch from './vite-plugin-proxy-fetch.js';

export default defineConfig(() => {
    const hmrHost = process.env.TAURI_DEV_HOST || 'localhost';

    return {
        base: '/',
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
            watch: {
                usePolling: process.env.VITE_USE_POLLING === 'true',
                interval: 100,
            },
            hmr: {
                host: hmrHost,
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
            },
        },
        preview: {
            proxy: {
                '/appwrite/v1': {
                    target: 'https://sgp.cloud.appwrite.io',
                    changeOrigin: true,
                    secure: true,
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
                            urlPattern: ({ request }) => request.destination === 'image',
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
                            urlPattern: ({ request }) =>
                                request.destination === 'audio' || request.destination === 'video',
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
                includeAssets: ['instances.json', 'discord.html'],
                manifest: false, // Use existing public/manifest.json
            }),
        ],
    };
});
