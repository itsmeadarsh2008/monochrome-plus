/**
 * Discord Rich Presence bridge for Monochrome.
 *
 * Talks to Discord Desktop's local IPC socket (no origin whitelist needed —
 * IPC connections are implicitly authenticated) and exposes a tiny HTTP API
 * for the browser:
 *
 *   GET  /api/discord/status                 -> { connected, user, error }
 *   POST /api/discord/activity               -> body { clientId, activity }
 *   OPTIONS                                  -> CORS preflight
 *
 * Runs in two modes:
 *   - Embedded in the Vite dev server via vite-plugin-discord-bridge.js
 *   - Standalone: `node server/discord-bridge.js [--port 37710]`
 *
 * Zero runtime dependencies. Binds to 127.0.0.1 only.
 *
 * IPC wire format: <4-byte LE opcode><4-byte LE length><UTF-8 JSON>.
 * Ops: HANDSHAKE=0, FRAME=1, CLOSE=2, PING=3, PONG=4.
 */
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';

const DISCORD_OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const HANDSHAKE_TIMEOUT_MS = 8000;
const IPC_SOCKET_COUNT = 10;

function ipcCandidatePaths() {
    if (process.platform === 'win32') {
        const out = [];
        for (let i = 0; i < IPC_SOCKET_COUNT; i++) out.push(`\\\\.\\pipe\\discord-ipc-${i}`);
        return out;
    }

    const roots = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp']
        .filter(Boolean)
        .map((root) => path.resolve(root));
    const dirs = [];
    for (const root of roots) {
        dirs.push(root);
        dirs.push(path.join(root, 'app', 'com.discordapp.Discord'));
        dirs.push(path.join(root, 'snap.discord'));
    }
    const out = [];
    for (let i = 0; i < IPC_SOCKET_COUNT; i++) {
        for (const dir of dirs) out.push(path.join(dir, `discord-ipc-${i}`));
    }
    return out;
}

function encodeFrame(op, data) {
    const json = Buffer.from(JSON.stringify(data), 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(json.length, 4);
    return Buffer.concat([header, json]);
}

export function createDiscordBridge() {
    let socket = null;
    let clientId = null;
    let connected = false;
    let user = null;
    let readBuf = Buffer.alloc(0);
    let connecting = null;
    let handshakeTimer = null;
    let nonce = 0;

    function teardown() {
        connected = false;
        user = null;
        readBuf = Buffer.alloc(0);
        if (handshakeTimer) {
            clearTimeout(handshakeTimer);
            handshakeTimer = null;
        }
        if (socket) {
            try {
                socket.destroy();
            } catch {
                // ignore
            }
            socket = null;
        }
    }

    function parsePayload(payload) {
        try {
            return JSON.parse(payload);
        } catch {
            return null;
        }
    }

    function onData(chunk) {
        readBuf = Buffer.concat([readBuf, chunk]);
        while (readBuf.length >= 8) {
            const op = readBuf.readInt32LE(0);
            const len = readBuf.readInt32LE(4);
            if (readBuf.length < 8 + len) break;
            const payload = readBuf.slice(8, 8 + len).toString('utf8');
            readBuf = readBuf.slice(8 + len);

            const msg = parsePayload(payload);
            if (!msg) continue;

            if (op === DISCORD_OP.PING) {
                try {
                    socket.write(encodeFrame(DISCORD_OP.PONG, msg));
                } catch {
                    // ignore
                }
                continue;
            }
            if (op === DISCORD_OP.CLOSE) {
                teardown();
                continue;
            }
            if (msg?.cmd === 'DISPATCH' && msg.evt === 'READY') {
                const u = msg.data?.user;
                user = u ? { id: u.id, username: u.username, global_name: u.global_name || null } : null;
                connected = true;
                if (handshakeTimer) {
                    clearTimeout(handshakeTimer);
                    handshakeTimer = null;
                }
            }
        }
    }

    function connectSocket() {
        const paths = ipcCandidatePaths();
        return new Promise((resolve, reject) => {
            let idx = 0;
            const tryNext = () => {
                if (idx >= paths.length) {
                    reject(new Error('Discord Desktop not running (no IPC socket found)'));
                    return;
                }
                const candidate = paths[idx++];
                const sock = net.createConnection(candidate);
                sock.once('connect', () => {
                    sock.removeAllListeners('error');
                    resolve(sock);
                });
                sock.once('error', () => {
                    try {
                        sock.destroy();
                    } catch {
                        // ignore
                    }
                    tryNext();
                });
            };
            tryNext();
        });
    }

    function ensureConnected(requestedClientId) {
        if (socket && connected && clientId === requestedClientId) return Promise.resolve();
        if (connecting) return connecting;
        if (socket && clientId !== requestedClientId) teardown();

        clientId = requestedClientId;
        connecting = connectSocket()
            .then((sock) => {
                socket = sock;
                sock.on('data', onData);
                sock.on('close', () => {
                    if (socket === sock) {
                        teardown();
                    }
                });
                sock.on('error', () => {
                    /* 'close' follows and handles cleanup */
                });
                sock.write(encodeFrame(DISCORD_OP.HANDSHAKE, { v: 1, client_id: requestedClientId }));
                return new Promise((resolve, reject) => {
                    handshakeTimer = setTimeout(() => {
                        teardown();
                        reject(new Error('Discord handshake timed out'));
                    }, HANDSHAKE_TIMEOUT_MS);
                    const check = setInterval(() => {
                        if (connected) {
                            clearInterval(check);
                            clearTimeout(handshakeTimer);
                            handshakeTimer = null;
                            resolve();
                        }
                    }, 50);
                    sock.on('close', () => {
                        clearInterval(check);
                        if (!connected) reject(new Error('Discord closed the connection'));
                    });
                });
            })
            .catch((error) => {
                teardown();
                throw error;
            })
            .finally(() => {
                connecting = null;
            });
        return connecting;
    }

    function setActivity(requestedClientId, activity) {
        const normalized = String(requestedClientId || '').trim();
        if (!normalized) return Promise.resolve({ ok: false, error: 'Missing client_id' });
        return ensureConnected(normalized).then(() => {
            const frame = {
                cmd: 'SET_ACTIVITY',
                args: { pid: process.pid, activity: activity || null },
                nonce: String(++nonce),
            };
            socket.write(encodeFrame(DISCORD_OP.FRAME, frame));
            return { ok: true };
        });
    }

    function status() {
        return { connected, user, error: null };
    }

    function readBody(req) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
        });
    }

    function sendJson(res, statusCode, payload) {
        res.statusCode = statusCode;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
    }

    async function handler(req, res, next) {
        const url = (req.url || '').split('?')[0];
        if (url !== '/api/discord/status' && url !== '/api/discord/activity') {
            if (next) return next();
            return sendJson(res, 404, { error: 'Not found' });
        }

        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Access-Control-Max-Age', '86400');
            res.end();
            return;
        }

        if (url === '/api/discord/status' && req.method === 'GET') {
            sendJson(res, 200, status());
            return;
        }

        if (url === '/api/discord/activity' && req.method === 'POST') {
            try {
                const raw = await readBody(req);
                const body = JSON.parse(raw.toString('utf8') || '{}');
                const result = await setActivity(body.clientId, body.activity);
                sendJson(res, result.ok ? 200 : 400, result);
            } catch (error) {
                sendJson(res, 503, { ok: false, error: error?.message || 'Bridge error' });
            }
            return;
        }

        if (next) return next();
        sendJson(res, 404, { error: 'Not found' });
    }

    return { handler, status, setActivity, teardown };
}

function main() {
    const args = process.argv.slice(2);
    let port = 37710;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) {
            port = parseInt(args[i + 1], 10);
            i++;
        }
    }

    const bridge = createDiscordBridge();
    const server = http.createServer((req, res) => bridge.handler(req, res, null));
    server.listen(port, '127.0.0.1', () => {
        console.log(`[discord-bridge] listening on http://127.0.0.1:${port}/api/discord`);
    });

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
            bridge.teardown();
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 500).unref();
        });
    }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '');
if (isMain) {
    main();
}
