import { discordPresenceStorage } from './storage.js';
import { deriveTrackQuality, extractCodecFromMime, isLossyCodec, isLossyContainer, toPositiveInt } from './utils.js';

const RPC_PORTS = [6463, 6464, 6465, 6466, 6467, 6468, 6469, 6470, 6471, 6472];
const CONNECT_TIMEOUT_MS = 1500;
const READY_TIMEOUT_MS = 2000;
const AUTHORIZE_TIMEOUT_MS = 20000;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const RPC_SCOPE = 'rpc.activities.write';

const QUALITY_LABELS = {
    DOLBY_ATMOS: 'Dolby Atmos',
    HI_RES_LOSSLESS: 'Hi-Res Lossless',
    LOSSLESS: 'Lossless',
    HIGH: 'High',
    LOW: 'Low',
};

function formatSampleRate(sampleRate) {
    const rate = toPositiveInt(sampleRate);
    if (!rate) return null;
    if (rate >= 1000) return `${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)} kHz`;
    return `${rate} Hz`;
}

// Mirrors createFullscreenQualityHTML so the Discord presence reads exactly
// like the fullscreen quality line (label · bit depth · sample rate · codec · bitrate).
export function buildQualitySummary(track) {
    if (!track) return null;

    const bitDepth = toPositiveInt(track.bitDepth || track.album?.bitDepth);
    const sampleRate = formatSampleRate(track.sampleRate || track.album?.sampleRate);

    const codec = extractCodecFromMime(track.codec || track.mimeType || track.format || track.mediaType);
    const rawFormat = String(track.format || track.mediaType || '').toUpperCase();
    const containerFormat = rawFormat && !/UNKNOWN|AUDIO|HLS|ADAPTIVE|DASH/i.test(rawFormat) ? rawFormat : null;
    const formatStr = codec || containerFormat || null;

    const lossy = codec ? isLossyCodec(codec) : isLossyContainer(track.format || track.mediaType);
    const bitrateStr = toPositiveInt(track.bitrateKbps) ? `${track.bitrateKbps} kbps` : null;

    const qualityToken = deriveTrackQuality(track);
    let qualityLabel;
    if (qualityToken === 'DOLBY_ATMOS') {
        qualityLabel = 'Dolby Atmos';
    } else if (lossy) {
        qualityLabel = 'High';
    } else if (QUALITY_LABELS[qualityToken]) {
        qualityLabel = QUALITY_LABELS[qualityToken];
    } else if (bitDepth || sampleRate) {
        const rate = toPositiveInt(track.sampleRate || track.album?.sampleRate);
        if (bitDepth >= 24 && rate > 48000) {
            qualityLabel = 'Hi-Res Lossless';
        } else if (bitDepth || rate) {
            qualityLabel = 'Lossless';
        } else {
            qualityLabel = 'Lossless';
        }
    } else {
        qualityLabel = 'Lossless';
    }

    const parts = [qualityLabel];
    if (bitDepth) parts.push(`${bitDepth}-bit`);
    if (sampleRate) parts.push(sampleRate);
    if (formatStr) parts.push(formatStr);
    if (bitrateStr) parts.push(bitrateStr);

    const validParts = parts.filter((part) => part && typeof part === 'string' && part.trim());
    return validParts.length ? validParts.join(' \u00b7 ') : null;
}

function getTrackArtist(track) {
    if (!track) return 'Unknown Artist';
    const artists = Array.isArray(track.artists)
        ? track.artists.map((artist) => (typeof artist === 'string' ? artist : artist?.name || null)).filter(Boolean)
        : [];
    if (artists.length) return artists.join(', ');
    if (track.artist?.name) return track.artist.name;
    if (typeof track.artist === 'string') return track.artist;
    return 'Unknown Artist';
}

function getTrackAlbum(track) {
    return track?.album?.title || track?.albumTitle || null;
}

function resolveCoverUrl(track, api) {
    if (!track || !api || typeof api.getCoverUrl !== 'function') return null;
    try {
        const cover = track.album?.cover || track.albumCover || null;
        if (!cover) return null;
        const url = api.getCoverUrl(cover);
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
    } catch {
        return null;
    }
    return null;
}

export class DiscordPresence {
    constructor() {
        this.socket = null;
        this.enabled = false;
        this.disposed = false;
        this.permanentlyBlocked = false;
        this.retryDelayIndex = 0;
        this.reconnectTimer = null;
        this.authorized = false;
        this.pendingActivity = null;
        this.nonceHandlers = new Map();
        this.onStatusChange = null;
        this.connectPromise = null;
        this.clientId = null;
        this.api = null;
        this.status = 'disabled';
        this.socketOpen = false;
    }

    setStatus(status) {
        this.status = status;
        if (typeof this.onStatusChange === 'function') {
            try {
                this.onStatusChange(status);
            } catch {
                // status observers must never break presence
            }
        }
    }

    setApi(api) {
        this.api = api;
    }

    isActive() {
        return this.enabled && this.authorized && this.socketOpen;
    }

    async connect() {
        if (this.disposed) return;
        const clientId = discordPresenceStorage.getClientId();
        if (!clientId) {
            this.setStatus('no-client-id');
            return;
        }
        this.enabled = true;
        this.permanentlyBlocked = false;
        this.clientId = clientId;
        if (this.socketOpen || (this.socket && this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        this.setStatus('connecting');
        this.connectPromise = this._tryConnect().catch(() => {});
        await this.connectPromise;
    }

    disconnect() {
        this.enabled = false;
        this.clearReconnectTimer();
        this.closeSocket();
        this.authorized = false;
        this.socketOpen = false;
        this.clientId = null;
        this.setStatus('disabled');
    }

    setTrack(track) {
        if (!track) return;
        const title = track.title || track.name || 'Unknown Track';
        const artist = getTrackArtist(track);
        const album = getTrackAlbum(track);
        const quality = buildQualitySummary(track);
        const coverUrl = resolveCoverUrl(track, this.api);

        const trackKey = `${title}\u0000${artist}\u0000${album}\u0000${quality || ''}`;
        const existing = this.pendingActivity;

        const activity = {
            type: 2,
            details: title,
            state: [artist, quality].filter(Boolean).join(' \u00b7 '),
            timestamps: {
                start: Date.now(),
            },
            assets: {},
        };
        if (album) activity.assets.large_text = album;
        if (coverUrl) {
            activity.assets.large_image = coverUrl;
            if (album) activity.assets.small_text = album;
        }
        if (track.duration && toPositiveInt(track.duration)) {
            activity.secrets = { end: String(Date.now() + toPositiveInt(track.duration) * 1000) };
        }

        this.pendingActivity = activity;

        // Keep the original start timestamp for updates of the same playing
        // track (e.g. quality metadata arriving late), but restart the timer
        // after a pause so Discord's elapsed counter stays honest.
        if (existing && existing._trackKey === trackKey && !existing.timestamps?.end) {
            activity.timestamps.start = existing.timestamps.start;
        }
        activity._trackKey = trackKey;

        if (this.isActive()) {
            this.sendActivity(activity);
        }
    }

    setPaused() {
        if (!this.pendingActivity) return;
        this.pendingActivity = {
            ...this.pendingActivity,
            _trackKey: this.pendingActivity._trackKey,
            timestamps: { end: Date.now() },
        };
        if (this.isActive()) {
            this.sendActivity(this.pendingActivity);
        }
    }

    clear() {
        this.pendingActivity = null;
        if (this.isActive()) {
            this.sendClear();
        }
    }

    sendActivity(activity) {
        const payload = {
            type: activity.type,
            details: activity.details,
            state: activity.state,
            timestamps: activity.timestamps,
            assets: Object.keys(activity.assets || {}).length ? activity.assets : undefined,
            secrets: activity.secrets,
        };
        this.send({ cmd: 'SET_ACTIVITY', args: { pid: 0, activity: payload } }).catch(() => {});
    }

    sendClear() {
        this.send({ cmd: 'SET_ACTIVITY', args: { pid: 0, activity: null } }).catch(() => {});
    }

    async send(payload) {
        if (!this.socketOpen) return;
        const nonce = crypto.randomUUID();
        payload.nonce = nonce;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.nonceHandlers.delete(nonce);
                reject(new Error('Discord RPC command timed out'));
            }, 10000);
            this.nonceHandlers.set(nonce, (data) => {
                clearTimeout(timeout);
                if (data.evt === 'ERROR') {
                    reject(new Error(`Discord RPC error: ${JSON.stringify(data.data?.error || data.data || data)}`));
                } else {
                    resolve(data.data);
                }
            });
            try {
                this.socket.send(JSON.stringify(payload));
            } catch (error) {
                clearTimeout(timeout);
                this.nonceHandlers.delete(nonce);
                reject(error);
            }
        });
    }

    async _tryConnect() {
        for (const port of RPC_PORTS) {
            if (!this.enabled || this.disposed) return;
            const socket = await this._openPort(port);
            if (!socket) continue;
            this.socket = socket;
            this.socketOpen = true;
            this.retryDelayIndex = 0;
            this._wireSocket(socket);
            try {
                const ready = await this._waitForReady(socket);
                if (!ready) {
                    this.closeSocket();
                    continue;
                }
                const auth = await this._authorize(socket);
                if (!auth) {
                    this.closeSocket();
                    continue;
                }
                this.authorized = true;
                this.setStatus('connected');
                if (this.pendingActivity) {
                    this.sendActivity(this.pendingActivity);
                }
                return;
            } catch (error) {
                if (error && error.permanent) {
                    this.permanentlyBlocked = true;
                    this.closeSocket();
                    this.setStatus('blocked');
                    return;
                }
                this.closeSocket();
                if (!this.enabled) return;
            }
        }
        if (this.enabled) {
            this.scheduleReconnect();
        }
    }

    _openPort(port) {
        return new Promise((resolve) => {
            let socket;
            try {
                socket = new WebSocket(
                    `ws://127.0.0.1:${port}/?v=1&client_id=${encodeURIComponent(this.clientId)}&encoding=json`
                );
            } catch {
                resolve(null);
                return;
            }
            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                try {
                    socket.close();
                } catch {
                    // ignore
                }
                resolve(null);
            }, CONNECT_TIMEOUT_MS);
            socket.onopen = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(socket);
            };
            socket.onerror = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(null);
            };
        });
    }

    _waitForReady(socket) {
        return new Promise((resolve) => {
            const handler = (event) => {
                let data;
                try {
                    data = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (data.cmd === 'DISPATCH' && data.evt === 'READY') {
                    this._messageHandler = null;
                    resolve(true);
                }
            };
            this._messageHandler = handler;
            setTimeout(() => {
                if (this._messageHandler === handler) {
                    this._messageHandler = null;
                    resolve(false);
                }
            }, READY_TIMEOUT_MS);
        });
    }

    _authorize(socket) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (result === true) {
                    resolve(true);
                } else if (result === 'permanent') {
                    reject(
                        Object.assign(new Error('Discord RPC authorization permanently failed'), { permanent: true })
                    );
                } else {
                    resolve(false);
                }
            };
            const timer = setTimeout(() => finish(false), AUTHORIZE_TIMEOUT_MS);
            const nonce = crypto.randomUUID();
            this.nonceHandlers.set(nonce, (data) => {
                if (data.evt === 'ERROR') {
                    const errorCode = data.data?.error?.code ?? data.data?.code;
                    if (errorCode === 4001 || errorCode === 4002) {
                        finish('permanent');
                    } else {
                        finish(false);
                    }
                    return;
                }
                if (data.data && typeof data.data === 'object') {
                    finish(true);
                }
            });
            try {
                socket.send(
                    JSON.stringify({
                        cmd: 'AUTHORIZE',
                        args: { client_id: this.clientId, scopes: [RPC_SCOPE] },
                        nonce,
                    })
                );
            } catch {
                finish(false);
            }
        });
    }

    _wireSocket(socket) {
        socket.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            if (this._messageHandler) {
                this._messageHandler(event);
            }
            if (data.nonce && this.nonceHandlers.has(data.nonce)) {
                const handler = this.nonceHandlers.get(data.nonce);
                this.nonceHandlers.delete(data.nonce);
                handler(data);
            }
        };
        socket.onclose = (event) => {
            if (this.socket !== socket) return;
            this.socket = null;
            this.socketOpen = false;
            this.authorized = false;
            if (this.disposed || !this.enabled) return;
            if (event.code === 4001 || event.code === 4002 || event.code === 4004) {
                this.permanentlyBlocked = true;
                this.setStatus('blocked');
                return;
            }
            this.scheduleReconnect();
        };
        socket.onerror = () => {
            // handled via onclose
        };
    }

    closeSocket() {
        if (this.socket) {
            try {
                this.socket.onclose = null;
                this.socket.close();
            } catch {
                // ignore
            }
            this.socket = null;
        }
        this.socketOpen = false;
        this.authorized = false;
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    scheduleReconnect() {
        if (!this.enabled || this.disposed || this.permanentlyBlocked) return;
        const delay = RECONNECT_DELAYS_MS[this.retryDelayIndex] || RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1];
        this.retryDelayIndex = Math.min(this.retryDelayIndex + 1, RECONNECT_DELAYS_MS.length - 1);
        this.setStatus('offline');
        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.enabled && !this.disposed && !this.permanentlyBlocked) {
                this.connect().catch(() => {});
            }
        }, delay);
    }

    destroy() {
        this.disposed = true;
        this.clearReconnectTimer();
        this.closeSocket();
    }
}
