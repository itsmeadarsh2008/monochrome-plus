import { getTrackArtists, getTrackTitle, deriveTrackQuality } from '../utils.js';
import { invokeTauri, isTauriRuntime } from './tauri-runtime.js';

const DISCORD_CLIENT_ID = '1478608904609857576';

const QUALITY_LABELS = {
    HI_RES_LOSSLESS: 'Hi-Res Lossless',
    LOSSLESS: 'Lossless',
    HIGH: 'High',
    LOW: 'Low',
};

const RPC_START_TIMEOUT_MS = 1500;
const RPC_RETRY_INTERVAL_MS = 5000;

function toUnixSecondsFromNow(msFromNow = 0) {
    return Math.floor((Date.now() + msFromNow) / 1000);
}

function buildTidalCoverUrl(coverId, size = 320) {
    if (typeof coverId !== 'string') return null;
    const normalized = coverId.trim().replace(/-/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) return null;
    return `https://resources.tidal.com/images/${normalized}/${size}x${size}.jpg`;
}

function uniqueNonEmptyStrings(values = []) {
    const seen = new Set();
    const output = [];
    values.forEach((value) => {
        if (typeof value !== 'string') return;
        const normalized = value.trim();
        if (!normalized) return;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        output.push(normalized);
    });
    return output;
}

async function invokeWithTimeout(command, payload, timeoutMs = RPC_START_TIMEOUT_MS) {
    let timeoutId = null;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve(false), timeoutMs);
    });

    try {
        const result = await Promise.race([invokeTauri(command, payload), timeoutPromise]);
        return result;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

function resolveTrackCoverCandidates(player, track) {
    if (!track) return null;

    const candidates = [];

    const directUrl =
        track.cover ||
        track.image ||
        track.artwork ||
        track.thumbnail ||
        track.album?.image ||
        track.album?.coverUrl;
    if (typeof directUrl === 'string' && /^https?:\/\//i.test(directUrl)) {
        candidates.push(directUrl);
    }

    const coverId = track.album?.cover || track.cover;
    if (coverId) {
        candidates.push(buildTidalCoverUrl(coverId, 640));
        candidates.push(buildTidalCoverUrl(coverId, 320));
        candidates.push(buildTidalCoverUrl(coverId, 160));
    }

    if (coverId && typeof player?.api?.getCoverUrl === 'function') {
        try {
            candidates.push(player.api.getCoverUrl(coverId, '640'));
            candidates.push(player.api.getCoverUrl(coverId, '320'));
            candidates.push(player.api.getCoverUrl(coverId));
        } catch {
            // ignore and rely on other candidates
        }
    }

    return uniqueNonEmptyStrings(candidates).filter((url) => /^https?:\/\//i.test(url));
}

function encodeBase64Utf8(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        const bytes = new TextEncoder().encode(value);
        let binary = '';
        for (const byte of bytes) {
            binary += String.fromCharCode(byte);
        }
        return btoa(binary);
    } catch {
        return null;
    }
}

function buildPayload(player, track, isPaused = false) {
    const title = getTrackTitle(track) || 'Unknown Track';
    const artists = getTrackArtists(track) || 'Unknown Artist';
    const coverCandidates = resolveTrackCoverCandidates(player, track) || [];
    const [coverUrl, ...fallbackCoverUrls] = coverCandidates;
    const qualityToken = track?.streamedQuality || track?.audioQuality || deriveTrackQuality(track) || player?.quality;
    const qualityLabel = QUALITY_LABELS[qualityToken] || String(qualityToken || 'Unknown Quality').replace(/_/g, ' ');

    const payload = {
        details: title,
        state: `${artists} • ${qualityLabel}`,
        largeImageKey: coverUrl || 'monochrome',
        largeImageBase64: encodeBase64Utf8(coverUrl),
        largeImageFallbackBase64: fallbackCoverUrls.map((url) => encodeBase64Utf8(url)).filter(Boolean),
        largeImageText: `Listening on Monochrome+`,
        smallImageKey: isPaused ? 'paused_icon' : 'playing_icon',
        smallImageText: isPaused ? 'Paused' : 'Playing',
        buttonLabel: 'Try Monochrome+',
        buttonUrl: 'https://github.com/itsmeadarsh2008/monochrome-plus',
    };

    if (!isPaused && track?.duration && player?.audio) {
        const rawDuration = Number(track.duration);
        const trackDurationSeconds = Number.isFinite(rawDuration)
            ? rawDuration > 10000
                ? rawDuration / 1000
                : rawDuration
            : 0;
        const currentTime = Number(player.audio.currentTime) || 0;

        if (trackDurationSeconds > 0) {
            const remaining = Math.max(0, trackDurationSeconds - Math.min(currentTime, trackDurationSeconds));
            payload.startTimestamp = toUnixSecondsFromNow(-Math.floor(currentTime * 1000));
            payload.endTimestamp = toUnixSecondsFromNow(Math.floor(remaining * 1000));
        }
    }

    return payload;
}

export function initializeDiscordBridge(player) {
    if (!player?.audio) return;
    if (window.__monochromeDiscordBridgeCleanup) {
        window.__monochromeDiscordBridgeCleanup();
        window.__monochromeDiscordBridgeCleanup = null;
    }

    const cleanups = [];
    let lastSentKey = '';
    let bridgeActive = false;
    let heartbeatId = null;
    let reconnectTimerId = null;
    let startInFlight = false;

    const stopReconnectLoop = () => {
        if (reconnectTimerId) {
            clearInterval(reconnectTimerId);
            reconnectTimerId = null;
        }
    };

    const ensureReconnectLoop = () => {
        if (reconnectTimerId) return;
        reconnectTimerId = window.setInterval(() => {
            void startBridge();
        }, RPC_RETRY_INTERVAL_MS);
    };

    const send = async (payload) => {
        if (!bridgeActive) return;
        const key = JSON.stringify(payload);
        if (key === lastSentKey) return;
        lastSentKey = key;
        try {
            await invokeTauri('discord_bridge_update', { payload });
        } catch (error) {
            console.warn('[DiscordBridge] update failed:', error);
            bridgeActive = false;
            ensureReconnectLoop();
            void startBridge();
        }
    };

    const sendCurrent = async (pausedOverride = null) => {
        const track = player.currentTrack;
        if (!track) {
            try {
                await invokeTauri('discord_bridge_clear');
            } catch {}
            return;
        }

        const isPaused = pausedOverride === null ? !!player.audio.paused : !!pausedOverride;
        await send(buildPayload(player, track, isPaused));
    };

    const bind = (eventName, handler) => {
        player.audio.addEventListener(eventName, handler);
        cleanups.push(() => player.audio.removeEventListener(eventName, handler));
    };

    bind('play', () => {
        void sendCurrent(false);
    });

    bind('pause', () => {
        void sendCurrent(true);
    });

    bind('loadedmetadata', () => {
        void sendCurrent(player.audio.paused);
    });

    bind('seeking', () => {
        void sendCurrent(player.audio.paused);
    });

    bind('ended', () => {
        void invokeTauri('discord_bridge_clear').catch(() => {});
    });

    bind('timeupdate', () => {
        if (player.audio.paused || !player.currentTrack) return;
        if (!heartbeatId) return;
        // periodic heartbeat handles this; keep handler lightweight
    });

    const cleanup = async () => {
        if (heartbeatId) {
            clearInterval(heartbeatId);
            heartbeatId = null;
        }

        stopReconnectLoop();

        for (const fn of cleanups) {
            try {
                fn();
            } catch {}
        }

        if (bridgeActive) {
            try {
                await invokeTauri('discord_bridge_stop');
            } catch {}
            bridgeActive = false;
        }
    };

    window.__monochromeDiscordBridgeCleanup = cleanup;

    const onBeforeUnload = () => {
        void cleanup();
    };
    window.addEventListener('beforeunload', onBeforeUnload, { once: true });
    cleanups.push(() => window.removeEventListener('beforeunload', onBeforeUnload));

    const startBridge = async () => {
        if (startInFlight || bridgeActive) return;

        const isTauri = await isTauriRuntime();
        if (!isTauri) return;

        startInFlight = true;

        try {
            const started = await invokeWithTimeout('discord_bridge_start', { clientId: DISCORD_CLIENT_ID });
            bridgeActive = !!started;
            if (!bridgeActive) {
                console.info('[DiscordBridge] Discord RPC inactive (Discord not running or timed out).');
                ensureReconnectLoop();
                return;
            }
        } catch (error) {
            bridgeActive = false;
            console.warn('[DiscordBridge] start failed:', error);
            ensureReconnectLoop();
            return;
        } finally {
            startInFlight = false;
        }

        stopReconnectLoop();
        lastSentKey = '';
        await sendCurrent(player.audio.paused);

        if (!heartbeatId) {
            heartbeatId = window.setInterval(() => {
                void sendCurrent(player.audio.paused);
            }, 12000);
        }
    };

    ensureReconnectLoop();
    void startBridge();
}
