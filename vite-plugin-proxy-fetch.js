/**
 * Vite plugin: server-side proxy for upstream endpoints with broken TLS or CORS.
 *
 * Handles /artistgrid-api/* and /tracker-api/* routes by fetching them
 * from Node.js (bypassing browser CORS) with TLS errors suppressed.
 * Falls back to Web Archive cache when upstream is unreachable.
 */
import https from 'node:https';
import http from 'node:http';

const ROUTE_MAP = [
    {
        prefix: '/artistgrid-api/',
        upstreams: [
            'https://sheets.artistgrid.cx/',
            'https://web.archive.org/web/2026id_/https://sheets.artistgrid.cx/',
        ],
    },
    {
        prefix: '/tracker-api/',
        upstreams: ['https://tracker.israeli.ovh/'],
    },
];

const agent = new https.Agent({ rejectUnauthorized: false });

function nodeGet(url, timeoutMs = 12000, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 3) return reject(new Error('Too many redirects'));
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { agent, timeout: timeoutMs }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(nodeGet(res.headers.location, timeoutMs, redirects + 1));
            }

            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                })
            );
            res.on('error', reject);
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('upstream timeout'));
        });
    });
}

export default function proxyFetchPlugin() {
    return {
        name: 'vite-plugin-proxy-fetch',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                let route = null;
                let rest = '';

                for (const r of ROUTE_MAP) {
                    if (req.url.startsWith(r.prefix)) {
                        route = r;
                        rest = req.url.slice(r.prefix.length);
                        break;
                    }
                }

                if (!route) return next();

                let lastErr = null;
                for (const upstream of route.upstreams) {
                    try {
                        const result = await nodeGet(upstream + rest);
                        if (result.status >= 200 && result.status < 400) {
                            res.setHeader('Access-Control-Allow-Origin', '*');
                            if (result.headers['content-type']) {
                                res.setHeader('Content-Type', result.headers['content-type']);
                            }
                            res.statusCode = result.status;
                            res.end(result.body);
                            return;
                        }
                        lastErr = new Error(`HTTP ${result.status}`);
                    } catch (err) {
                        lastErr = err;
                    }
                }

                console.error(`[proxy-fetch] all upstreams failed for ${req.url}:`, lastErr?.message);
                res.statusCode = 502;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Bad Gateway: all upstreams unreachable');
            });
        },
    };
}
