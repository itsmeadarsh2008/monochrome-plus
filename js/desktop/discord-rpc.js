import { getTrackTitle, getTrackArtists, getShareUrl } from '../utils.js';
import { isNeutralinoRuntime } from './runtime.js';

const DISCORD_CLIENT_ID = '1466351059843809282';
const DISCORD_RPC_PORT_START = 6463;
const DISCORD_RPC_PORT_END = 6472;

function createNonce() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, max = 120) {
    const text = String(value || '').trim();
    if (!text) return undefined;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function getTrackCoverUrl(track) {
    const domCover = document.querySelector('.now-playing-bar .cover')?.src;
    if (domCover && /^https?:\/\//i.test(domCover)) return domCover;

    const candidates = [
        track?.album?.coverUrl,
        track?.album?.image,
        track?.album?.artwork,
        track?.coverUrl,
        track?.image,
        track?.artwork,
    ].filter(Boolean);

    return candidates.find((url) => /^https?:\/\//i.test(String(url))) || null;
}

function getTrackPath(track) {
    if (track?.id) return `/track/${track.id}`;
    return window.location.pathname || '/';
}

class DiscordRpcWebSocketBridge {
    constructor(clientId) {
        this.clientId = clientId;
        this.socket = null;
        this.pending = new Map();
        this.connectedPort = null;
    }

    async connect() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
        if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
            await new Promise((resolve) => {
                this.socket.addEventListener('open', () => resolve(), { once: true });
                this.socket.addEventListener('error', () => resolve(), { once: true });
            });
            if (this.socket.readyState === WebSocket.OPEN) return;
        }

        for (let port = DISCORD_RPC_PORT_START; port <= DISCORD_RPC_PORT_END; port += 1) {
            const url = `ws://127.0.0.1:${port}/?v=1&client_id=${this.clientId}`;
            try {
                await this.connectToPort(url, port);
                this.connectedPort = port;
                return;
            } catch {
                // Try next port.
            }
        }

        throw new Error('Discord RPC websocket endpoint is unavailable.');
    }

    connectToPort(url, port) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            let settled = false;
            const timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                ws.close();
                reject(new Error(`Discord RPC handshake timeout on port ${port}`));
            }, 1200);

            ws.addEventListener('open', () => {
                ws.send(
                    JSON.stringify({
                        v: 1,
                        client_id: this.clientId,
                    })
                );
            });

            ws.addEventListener('message', (event) => {
                let payload;
                try {
                    payload = JSON.parse(event.data);
                } catch {
                    return;
                }

                if (!settled && payload?.evt === 'READY') {
                    settled = true;
                    clearTimeout(timeoutId);
                    this.attachSocket(ws);
                    resolve();
                    return;
                }

                if (payload?.nonce && this.pending.has(payload.nonce)) {
                    const pending = this.pending.get(payload.nonce);
                    this.pending.delete(payload.nonce);
                    if (payload.evt === 'ERROR') {
                        pending.reject(new Error(payload?.data?.message || 'Discord RPC returned an error.'));
                    } else {
                        pending.resolve(payload);
                    }
                }
            });

            ws.addEventListener('error', () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                reject(new Error(`Discord RPC websocket error on port ${port}`));
            });

            ws.addEventListener('close', () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(new Error(`Discord RPC websocket closed on port ${port}`));
                }
                if (this.socket === ws) {
                    this.socket = null;
                    this.connectedPort = null;
                }
            });
        });
    }

    attachSocket(ws) {
        this.socket = ws;
    }

    async send(command, args = {}) {
        await this.connect();
        const nonce = createNonce();

        const payload = {
            cmd: command,
            args,
            nonce,
        };

        return new Promise((resolve, reject) => {
            this.pending.set(nonce, { resolve, reject });
            this.socket.send(JSON.stringify(payload));
            setTimeout(() => {
                if (!this.pending.has(nonce)) return;
                this.pending.delete(nonce);
                reject(new Error('Discord RPC command timeout.'));
            }, 2500);
        });
    }

    async setActivity(activity) {
        await this.send('SET_ACTIVITY', {
            pid: Number(window.NL_PID || 1),
            activity,
        });
    }

    async clearActivity() {
        await this.send('SET_ACTIVITY', {
            pid: Number(window.NL_PID || 1),
            activity: null,
        });
    }
}

export function initializeDiscordRPC(player) {
    if (!isNeutralinoRuntime()) return;

    let lastRefreshAt = 0;
    let lastPayload = null;
    let rpcHealthy = false;
    let heartbeatId = null;

    const rpc = new DiscordRpcWebSocketBridge(DISCORD_CLIENT_ID);

    async function sendPresence(payload) {
        try {
            await rpc.setActivity(payload);
            lastPayload = payload;
            rpcHealthy = true;
        } catch (error) {
            rpcHealthy = false;
            console.warn('[Desktop][DiscordRPC] Failed to send update:', error?.message || error);
        }
    }

    async function clearPresence() {
        try {
            await rpc.clearActivity();
            rpcHealthy = true;
        } catch {
            rpcHealthy = false;
        }
    }

    async function sendUpdate(track, isPaused = false) {
        if (!track) return;

        const rawDuration = Number(track.duration);
        const trackDurationSeconds = Number.isFinite(rawDuration)
            ? rawDuration > 10000
                ? rawDuration / 1000
                : rawDuration
            : 0;
        const currentTimeSeconds = Number(player.audio.currentTime) || 0;

        const title = clamp(getTrackTitle(track), 128) || 'Unknown Track';
        const artists = clamp(getTrackArtists(track), 128) || 'Unknown Artist';
        const trackUrl = getShareUrl(getTrackPath(track));

        const payload = {
            details: clamp('Listening to Monochrome+', 128),
            state: clamp(`${title} — ${artists}`, 128),
            instance: false,
            buttons: [
                {
                    label: 'Listen to this song',
                    url: trackUrl,
                },
            ],
        };

        const coverUrl = getTrackCoverUrl(track);
        if (coverUrl) {
            payload.large_image = coverUrl;
            payload.large_text = title;
        } else {
            payload.large_image = 'appicon';
            payload.large_text = 'Monochrome+';
        }

        if (!isPaused && trackDurationSeconds > 0 && currentTimeSeconds >= 0) {
            const elapsed = Math.min(currentTimeSeconds, trackDurationSeconds);
            if (Number.isFinite(elapsed)) {
                payload.timestamps = {
                    start: Math.floor(Date.now() / 1000 - elapsed),
                };
            }
        }

        await sendPresence(payload);
    }

    async function sendIdle() {
        await sendPresence({
            details: 'Idle',
            state: 'Monochrome+',
            instance: false,
        });
    }

    async function heartbeat() {
        const activeTrack = player.currentTrack;
        if (activeTrack) {
            await sendUpdate(activeTrack, player.audio.paused);
            return;
        }

        if (!rpcHealthy && lastPayload) {
            await sendPresence(lastPayload);
            return;
        }

        await sendIdle();
    }

    player.audio.addEventListener('play', () => {
        void sendUpdate(player.currentTrack);
    });

    player.audio.addEventListener('pause', () => {
        void sendUpdate(player.currentTrack, true);
    });

    player.audio.addEventListener('loadedmetadata', () => {
        if (!player.audio.paused) {
            void sendUpdate(player.currentTrack);
        }
    });

    player.audio.addEventListener('timeupdate', () => {
        if (player.audio.paused || !player.currentTrack) return;
        const now = Date.now();
        if (now - lastRefreshAt < 15000) return;
        lastRefreshAt = now;
        void sendUpdate(player.currentTrack);
    });

    player.audio.addEventListener('ended', () => {
        void sendIdle();
    });

    window.addEventListener('beforeunload', () => {
        if (heartbeatId) {
            clearInterval(heartbeatId);
            heartbeatId = null;
        }
        void clearPresence();
    });

    if (player.currentTrack) {
        void sendUpdate(player.currentTrack, player.audio.paused);
    } else {
        void sendIdle();
    }

    heartbeatId = window.setInterval(() => {
        void heartbeat();
    }, 10000);
}
