import { getTrackArtists, getTrackTitle, deriveTrackQuality } from '../utils.js';
import { invokeTauri, isTauriRuntime } from './tauri-runtime.js';

const DISCORD_CLIENT_ID = '1478608904609857576';

const QUALITY_LABELS = {
    HI_RES_LOSSLESS: 'Hi-Res Lossless',
    LOSSLESS: 'Lossless',
    HIGH: 'High',
    LOW: 'Low',
};

// Small image keys for play/pause status (Discord asset names from Rich Presence Assets portal)
const PLAYING_ASSET_NAME = 'play';
const PAUSED_ASSET_NAME = 'pause';

const RPC_START_TIMEOUT_MS = 1500;
const RPC_RETRY_INTERVAL_MS = 5000;

function toUnixSecondsFromNow(msFromNow = 0) {
    return Math.floor((Date.now() + msFromNow) / 1000);
}

/**
 * Build Tidal cover URL from cover ID
 */
function buildTidalCoverUrl(coverId, size = 320) {
    if (typeof coverId !== 'string') return null;
    const normalized = coverId
        .trim()
        .replace(/-/g, '/')
        .replace(/^\/+|\/+$/g, '');
    if (!normalized) return null;
    return `https://resources.tidal.com/images/${normalized}/${size}x${size}.jpg`;
}

/**
 * Build Qobuz cover URL
 */
function buildQobuzCoverUrl(coverId, size = 600) {
    if (typeof coverId !== 'string') return null;
    // Qobuz uses different URL format
    return `https://static.qobuz.com/images/covers/${coverId.slice(0, 2)}/${coverId.slice(2, 4)}/${coverId}_${size}.jpg`;
}

/**
 * Get unique non-empty strings from array
 */
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

/**
 * Invoke Tauri command with timeout
 */
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

/**
 * Resolve track cover candidates from various sources
 * Returns array of HTTPS URLs to try in order of preference
 */
function resolveTrackCoverCandidates(player, track) {
    if (!track) return [];

    const candidates = [];

    // 1. Direct URL from track object
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
        // Ensure HTTPS for Discord
        const httpsUrl = directUrl.replace(/^http:/i, 'https:');
        candidates.push(httpsUrl);
    }

    // 2. Tidal-style cover ID
    const coverId = track.album?.cover || track.cover;
    if (coverId && typeof coverId === 'string') {
        // Try multiple sizes (largest first for best quality)
        candidates.push(buildTidalCoverUrl(coverId, 1280));
        candidates.push(buildTidalCoverUrl(coverId, 640));
        candidates.push(buildTidalCoverUrl(coverId, 320));
    }

    // 3. Qobuz-style cover
    if (coverId && typeof coverId === 'string' && coverId.length === 32) {
        candidates.push(buildQobuzCoverUrl(coverId, 600));
        candidates.push(buildQobuzCoverUrl(coverId, 300));
    }

    // 4. API-provided cover URL
    if (coverId && typeof player?.api?.getCoverUrl === 'function') {
        try {
            const apiUrl = player.api.getCoverUrl(coverId, '1280');
            if (apiUrl) candidates.push(apiUrl.replace(/^http:/i, 'https:'));
        } catch {
            // ignore and rely on other candidates
        }
    }

    return uniqueNonEmptyStrings(candidates).filter((url) => /^https:\/\//i.test(url));
}

/**
 * Encode string to base64 for transmission to Rust
 */
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

/**
 * Build the Discord Rich Presence payload
 * Apple Music style with album cover, track info, and progress bar
 */
function buildPayload(player, track, isPaused = false) {
    const title = getTrackTitle(track) || 'Unknown Track';
    const artists = getTrackArtists(track) || 'Unknown Artist';
    const coverCandidates = resolveTrackCoverCandidates(player, track) || [];
    const [coverUrl, ...fallbackCoverUrls] = coverCandidates;

    // Album name for large image text
    const albumName = track?.album?.title || track?.album || 'Unknown Album';

    // Quality label for state
    const qualityToken = track?.streamedQuality || track?.audioQuality || deriveTrackQuality(track) || player?.quality;
    const qualityLabel = QUALITY_LABELS[qualityToken] || String(qualityToken || '').replace(/_/g, ' ');

    // Build state text (artists + album or quality)
    let stateText = artists;
    if (albumName && albumName !== 'Unknown Album') {
        stateText = `${artists} • ${albumName}`;
    } else if (qualityLabel) {
        stateText = `${artists} • ${qualityLabel}`;
    }

    // Use playing/paused asset names (must be uploaded to Discord Developer Portal)
    const smallImageKey = isPaused ? PAUSED_ASSET_NAME : PLAYING_ASSET_NAME;
    const smallImageText = isPaused ? 'Paused' : 'Playing';

    const payload = {
        details: title,
        state: stateText,
        largeImageKey: coverUrl || 'monochrome',
        largeImageBase64: encodeBase64Utf8(coverUrl),
        largeImageFallbackBase64: fallbackCoverUrls.map((url) => encodeBase64Utf8(url)).filter(Boolean),
        largeImageText: albumName,
        smallImageKey: smallImageKey,
        smallImageText: smallImageText,
        // Apple Music style button
        buttonLabel: 'Listen to this song',
        buttonUrl: 'https://github.com/itsmeadarsh2008/monochrome-plus',
    };

    // Add timestamps for progress bar (Apple Music style)
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
            // Start timestamp = now - current position
            payload.startTimestamp = toUnixSecondsFromNow(-Math.floor(currentTime * 1000));
            // End timestamp = now + remaining time
            payload.endTimestamp = toUnixSecondsFromNow(Math.floor(remaining * 1000));
        }
    }

    return payload;
}

/**
 * Initialize Discord Rich Presence bridge
 */
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

    // Track events
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
        // Throttle updates to avoid spamming Discord
        if (player.audio.paused || !player.currentTrack) return;
        // Periodic heartbeat handles this; keep handler lightweight
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

    const startBridge = async () => {
        if (startInFlight) return;
        startInFlight = true;
        try {
            const result = await invokeWithTimeout(
                'discord_bridge_start',
                { clientId: DISCORD_CLIENT_ID },
                RPC_START_TIMEOUT_MS
            );
            if (result) {
                bridgeActive = true;
                stopReconnectLoop();
                void sendCurrent(player.audio.paused);
            } else {
                bridgeActive = false;
                ensureReconnectLoop();
            }
        } catch (error) {
            console.warn('[DiscordBridge] start failed:', error);
            bridgeActive = false;
            ensureReconnectLoop();
        } finally {
            startInFlight = false;
        }
    };

    // Heartbeat to update timestamps and keep connection alive
    heartbeatId = window.setInterval(() => {
        if (!bridgeActive) return;
        void sendCurrent(player.audio.paused);
    }, 15000);

    void startBridge();
}

/**
 * Check if Discord bridge is available
 */
export async function isDiscordBridgeAvailable() {
    return await isTauriRuntime();
}

/**
 * Manually update Discord presence (for external control)
 */
export async function updateDiscordPresence(player, track, isPaused) {
    if (!(await isTauriRuntime())) return;
    const payload = buildPayload(player, track, isPaused);
    try {
        await invokeTauri('discord_bridge_update', { payload });
    } catch (error) {
        console.warn('[DiscordBridge] manual update failed:', error);
    }
}

/**
 * Clear Discord presence
 */
export async function clearDiscordPresence() {
    if (!(await isTauriRuntime())) return;
    try {
        await invokeTauri('discord_bridge_clear');
    } catch (error) {
        console.warn('[DiscordBridge] clear failed:', error);
    }
}
