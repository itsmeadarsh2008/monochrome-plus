import { getTrackArtists, getTrackTitle, deriveTrackQuality } from '../utils.js';
import { invokeTauri, isTauriRuntime } from './tauri-runtime.js';

const DISCORD_CLIENT_ID = '1478608904609857576';

const QUALITY_LABELS = {
    HI_RES_LOSSLESS: 'Hi-Res Lossless',
    LOSSLESS: 'Lossless',
    HIGH: 'High',
    LOW: 'Low',
};

const PLAYING_ASSET_NAME = 'play';
const PAUSED_ASSET_NAME = 'pause';

function toUnixSecondsFromNow(msFromNow = 0) {
    return Math.floor((Date.now() + msFromNow) / 1000);
}

function buildTidalCoverUrl(coverId, size = 320) {
    if (typeof coverId !== 'string') return null;
    const normalized = coverId
        .trim()
        .replace(/-/g, '/')
        .replace(/^\/+|\/+$/g, '');
    if (!normalized) return null;
    return `https://resources.tidal.com/images/${normalized}/${size}x${size}.jpg`;
}

function buildQobuzCoverUrl(coverId, size = 600) {
    if (typeof coverId !== 'string') return null;
    return `https://static.qobuz.com/images/covers/${coverId.slice(0, 2)}/${coverId.slice(2, 4)}/${coverId}_${size}.jpg`;
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

function resolveTrackCoverCandidates(player, track) {
    if (!track) return [];

    const candidates = [];

    const directUrl =
        track.coverUrl ||
        track.cover ||
        track.image ||
        track.artwork ||
        track.thumbnail ||
        track.album?.coverUrl ||
        track.album?.image ||
        track.album?.cover;

    if (typeof directUrl === 'string' && /^https?:\/\//i.test(directUrl)) {
        const httpsUrl = directUrl.replace(/^http:/i, 'https:');
        candidates.push(httpsUrl);
    }

    const coverId = track.album?.cover || track.cover;
    if (coverId && typeof coverId === 'string') {
        candidates.push(buildTidalCoverUrl(coverId, 1280));
        candidates.push(buildTidalCoverUrl(coverId, 640));
        candidates.push(buildTidalCoverUrl(coverId, 320));
    }

    if (coverId && typeof coverId === 'string' && coverId.length === 32) {
        candidates.push(buildQobuzCoverUrl(coverId, 600));
        candidates.push(buildQobuzCoverUrl(coverId, 300));
    }

    if (coverId && typeof player?.api?.getCoverUrl === 'function') {
        try {
            const apiUrl = player.api.getCoverUrl(coverId, '1280');
            if (apiUrl) candidates.push(apiUrl.replace(/^http:/i, 'https:'));
        } catch {
            // ignore
        }
    }

    return uniqueNonEmptyStrings(candidates)
        .map((url) => url.replace(/^http:\/\//i, 'https://'))
        .filter((url) => /^https:\/\//i.test(url))
        .filter((url) => url.length <= 1800);
}

function buildPayload(player, track, isPaused = false) {
    const title = getTrackTitle(track) || 'Unknown Track';
    const artists = getTrackArtists(track) || 'Unknown Artist';
    const coverCandidates = resolveTrackCoverCandidates(player, track) || [];
    const coverUrl = coverCandidates[0] || null;

    const albumName = track?.album?.title || track?.album || 'Unknown Album';

    const qualityToken = track?.streamedQuality || track?.audioQuality || deriveTrackQuality(track) || player?.quality;
    const qualityLabel = QUALITY_LABELS[qualityToken] || String(qualityToken || '').replace(/_/g, ' ');

    let stateText = artists;
    if (albumName && albumName !== 'Unknown Album') {
        stateText = `${artists} • ${albumName}`;
    } else if (qualityLabel) {
        stateText = `${artists} • ${qualityLabel}`;
    }

    const smallImageKey = isPaused ? PAUSED_ASSET_NAME : PLAYING_ASSET_NAME;
    const smallImageText = isPaused ? 'Paused' : 'Playing';

    const payload = {
        details: title,
        state: stateText,
        largeImageKey: coverUrl || 'monochrome',
        largeImageText: albumName,
        smallImageKey: smallImageKey,
        smallImageText: smallImageText,
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
    let heartbeatId = null;

    const send = async (payload) => {
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
            } catch (_error) {
                void _error;
                // ignore clear failures during teardown
            }
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

    const cleanup = async () => {
        if (heartbeatId) {
            clearInterval(heartbeatId);
            heartbeatId = null;
        }

        for (const fn of cleanups) {
            try {
                fn();
            } catch (_error) {
                void _error;
                // ignore listener cleanup failures
            }
        }

        try {
            await invokeTauri('discord_bridge_stop');
        } catch (_error) {
            void _error;
            // ignore stop failures during teardown
        }
    };

    window.__monochromeDiscordBridgeCleanup = cleanup;

    // Heartbeat for timestamp/cover refresh
    heartbeatId = window.setInterval(() => {
        void sendCurrent(player.audio.paused);
    }, 10000);

    // Start the bridge (fire and forget - Rust handles connection)
    invokeTauri('discord_bridge_start', { clientId: DISCORD_CLIENT_ID }).catch((error) => {
        console.warn('[DiscordBridge] start failed:', error);
    });
}

export async function isDiscordBridgeAvailable() {
    return await isTauriRuntime();
}

export async function updateDiscordPresence(player, track, isPaused) {
    if (!(await isTauriRuntime())) return;
    const payload = buildPayload(player, track, isPaused);
    try {
        await invokeTauri('discord_bridge_update', { payload });
    } catch (error) {
        console.warn('[DiscordBridge] manual update failed:', error);
    }
}

export async function clearDiscordPresence() {
    if (!(await isTauriRuntime())) return;
    try {
        await invokeTauri('discord_bridge_clear');
    } catch (error) {
        console.warn('[DiscordBridge] clear failed:', error);
    }
}
