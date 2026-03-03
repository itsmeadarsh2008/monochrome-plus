import { getTrackArtists, getTrackTitle, deriveTrackQuality } from '../utils.js';
import { invokeTauri, isTauriRuntime } from './tauri-runtime.js';

const DISCORD_CLIENT_ID = '1466351059843809282';

const QUALITY_LABELS = {
    HI_RES_LOSSLESS: 'Hi-Res Lossless',
    LOSSLESS: 'Lossless',
    HIGH: 'High',
    LOW: 'Low',
};

const RPC_START_TIMEOUT_MS = 1500;

function toUnixSecondsFromNow(msFromNow = 0) {
    return Math.floor((Date.now() + msFromNow) / 1000);
}

function buildTidalCoverUrl(coverId, size = 320) {
    if (typeof coverId !== 'string') return null;
    const normalized = coverId.trim().replace(/-/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) return null;
    return `https://resources.tidal.com/images/${normalized}/${size}x${size}.jpg`;
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

function resolveTrackCoverUrl(player, track) {
    if (!track) return null;

    const directUrl =
        track.cover ||
        track.image ||
        track.artwork ||
        track.thumbnail ||
        track.album?.image ||
        track.album?.coverUrl;
    if (typeof directUrl === 'string' && /^https?:\/\//i.test(directUrl)) {
        return directUrl;
    }

    const coverId = track.album?.cover || track.cover;
    const tidalCover = buildTidalCoverUrl(coverId, 320);
    if (tidalCover) {
        return tidalCover;
    }

    if (!coverId || typeof player?.api?.getCoverUrl !== 'function') {
        return null;
    }

    try {
        return player.api.getCoverUrl(coverId, '640') || player.api.getCoverUrl(coverId) || null;
    } catch {
        return null;
    }
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
    const coverUrl = resolveTrackCoverUrl(player, track);
    const qualityToken = track?.streamedQuality || track?.audioQuality || deriveTrackQuality(track) || player?.quality;
    const qualityLabel = QUALITY_LABELS[qualityToken] || String(qualityToken || 'Unknown Quality').replace(/_/g, ' ');

    const payload = {
        details: title,
        state: `${artists} • ${qualityLabel}`,
        largeImageKey: coverUrl || 'monochrome',
        largeImageBase64: encodeBase64Utf8(coverUrl),
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

    const send = async (payload) => {
        if (!bridgeActive) return;
        const key = JSON.stringify(payload);
        if (key === lastSentKey) return;
        lastSentKey = key;
        try {
            await invokeTauri('discord_bridge_update', { payload });
        } catch (error) {
            console.warn('[DiscordBridge] update failed:', error);
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

    const start = async () => {
        const isTauri = await isTauriRuntime();
        if (!isTauri) return;

        try {
            const started = await invokeWithTimeout('discord_bridge_start', { clientId: DISCORD_CLIENT_ID });
            bridgeActive = !!started;
            if (!bridgeActive) {
                console.info('[DiscordBridge] Discord RPC inactive (Discord not running or timed out).');
            }
        } catch (error) {
            bridgeActive = false;
            console.warn('[DiscordBridge] start failed:', error);
        }

        if (!bridgeActive) return;

        await sendCurrent(player.audio.paused);

        heartbeatId = window.setInterval(() => {
            void sendCurrent(player.audio.paused);
        }, 12000);
    };

    void start();
}
