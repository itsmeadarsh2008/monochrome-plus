// js/desktop/discord-rpc.js
import { deriveTrackQuality, getTrackTitle, getTrackArtists } from '../utils.js';

export function initializeDiscordRPC(player) {
    const isTauri =
        typeof window !== 'undefined' &&
        (window.__TAURI_INTERNALS__ ||
            window.__TAURI__ ||
            window.__TAURI_IPC__ ||
            /\btauri\b/i.test(navigator.userAgent || ''));
    let lastRefreshAt = 0;
    let lastPayload = null;
    let rpcHealthy = false;
    let heartbeatId = null;
    let monotoneTicker = 0;

    const MONOCHROME_ROTATION = [
        'Monochrome+ • Hyper-fast playback',
        'Monochrome+ • Privacy-respecting audio',
        'Monochrome+ • High-fidelity streaming',
        'Monochrome+ • Built for focused listening',
    ];

    const QUALITY_LABELS = {
        HI_RES_LOSSLESS: 'Hi-Res Lossless',
        LOSSLESS: 'Lossless',
        HIGH: 'High',
        LOW: 'Low',
    };

    const sendViaTauri = async (payload) => {
        const core = await import('@tauri-apps/api/core');
        await core.invoke('update_discord_presence', { payload });
    };

    const clearViaTauri = async () => {
        const core = await import('@tauri-apps/api/core');
        await core.invoke('clear_discord_presence');
    };

    const clamp = (value, max = 120) => {
        const text = String(value || '').trim();
        if (!text) return undefined;
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };

    const getTrackCoverUrl = (track) => {
        const domCover = document.querySelector('.now-playing-bar .cover')?.src;
        if (domCover && /^https?:\/\//i.test(domCover)) return domCover;

        const candidates = [
            track?.album?.coverUrl,
            track?.album?.cover,
            track?.album?.image,
            track?.album?.artwork,
            track?.album?.images?.large,
            track?.album?.images?.medium,
            track?.album?.images?.small,
            track?.coverUrl,
            track?.cover,
            track?.image,
            track?.artwork,
            track?.images?.large,
            track?.images?.medium,
            track?.images?.small,
        ].filter(Boolean);

        const candidate = candidates.find((url) => /^https?:\/\//i.test(String(url)));
        if (!candidate) return null;

        const normalized = String(candidate).trim();
        if (normalized.length > 240) return null;
        return normalized;
    };

    const getTrackQualityLabel = (track) => {
        const qualityToken =
            track?.streamedQuality || track?.audioQuality || deriveTrackQuality(track) || player?.quality || null;

        if (!qualityToken) return 'Quality unknown';

        return QUALITY_LABELS[qualityToken] || String(qualityToken).replace(/_/g, ' ');
    };

    const getDynamicMonochromeLabel = (qualityLabel, isPaused = false) => {
        const base = MONOCHROME_ROTATION[monotoneTicker % MONOCHROME_ROTATION.length];
        monotoneTicker += 1;
        return isPaused ? `${base} • Paused • ${qualityLabel}` : `${base} • ${qualityLabel}`;
    };

    const buildPayload = (track, isPaused = false) => {
        if (!track) return null;

        const rawDuration = Number(track.duration);
        const trackDurationSeconds = Number.isFinite(rawDuration)
            ? rawDuration > 10000
                ? rawDuration / 1000
                : rawDuration
            : 0;
        const currentTimeSeconds = Number(player.audio.currentTime) || 0;

        const title = clamp(getTrackTitle(track), 128) || 'Unknown Track';
        const artists = clamp(getTrackArtists(track), 96) || 'Unknown Artist';
        const qualityLabel = clamp(getTrackQualityLabel(track), 36) || 'Quality unknown';

        const data = {
            details: title,
            state: clamp(`${artists} • ${qualityLabel}`, 128),
            largeImageText: clamp(`${title} • ${qualityLabel}`, 128),
            smallImageText: clamp(getDynamicMonochromeLabel(qualityLabel, isPaused), 128),
            instance: false,
        };

        const coverUrl = getTrackCoverUrl(track);
        data.largeImageKey = coverUrl ? `mp:${coverUrl}` : 'appicon';

        if (!isPaused && trackDurationSeconds > 0 && currentTimeSeconds >= 0) {
            const elapsed = Math.min(currentTimeSeconds, trackDurationSeconds);
            if (Number.isFinite(elapsed)) {
                const startTimestamp = Math.floor(Date.now() / 1000 - elapsed);
                data.startTimestamp = startTimestamp;
                data.endTimestamp = startTimestamp + Math.floor(trackDurationSeconds);
            }
        }

        return data;
    };

    async function sendUpdate(track, isPaused = false) {
        const data = buildPayload(track, isPaused);
        if (!data) return;

        const payloadHasChanged = JSON.stringify(data) !== JSON.stringify(lastPayload);
        if (!payloadHasChanged && !isPaused) {
            return;
        }

        try {
            if (isTauri) {
                await sendViaTauri(data);
                lastPayload = data;
                rpcHealthy = true;
            }
        } catch (error) {
            rpcHealthy = false;
            console.error('[Desktop][DiscordRPC] Failed to send update:', error);
        }
    }

    async function sendIdle() {
        if (!isTauri) return;
        try {
            const idlePayload = {
                details: 'Idling',
                state: 'No active track',
                largeImageKey: 'appicon',
                largeImageText: 'Monochrome+',
                smallImageText: clamp(MONOCHROME_ROTATION[monotoneTicker % MONOCHROME_ROTATION.length], 128),
                instance: false,
            };
            monotoneTicker += 1;

            await sendViaTauri(idlePayload);
            lastPayload = idlePayload;
            rpcHealthy = true;
        } catch {
            rpcHealthy = false;
            try {
                await clearViaTauri();
            } catch {
                // no-op
            }
        }
    }

    async function heartbeat() {
        if (!isTauri) return;

        const activeTrack = player.currentTrack;
        if (activeTrack) {
            await sendUpdate(activeTrack, player.audio.paused);
            return;
        }

        if (!rpcHealthy && lastPayload) {
            try {
                await sendViaTauri(lastPayload);
                rpcHealthy = true;
            } catch {
                rpcHealthy = false;
            }
            return;
        }

        await sendIdle();
    }

    player.audio.addEventListener('play', () => {
        lastRefreshAt = 0;
        void sendUpdate(player.currentTrack, false);
    });

    player.audio.addEventListener('pause', () => {
        void sendUpdate(player.currentTrack, true);
    });

    player.audio.addEventListener('seeking', () => {
        if (player.currentTrack) {
            void sendUpdate(player.currentTrack, player.audio.paused);
        }
    });

    player.audio.addEventListener('loadedmetadata', () => {
        void sendUpdate(player.currentTrack, player.audio.paused);
    });

    player.audio.addEventListener('timeupdate', () => {
        if (player.audio.paused || !player.currentTrack) return;
        const now = Date.now();
        if (now - lastRefreshAt < 12000) return;
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
        void clearViaTauri().catch(() => {});
    });

    // Send initial status
    if (player.currentTrack) {
        void sendUpdate(player.currentTrack, player.audio.paused);
    } else {
        void sendIdle();
    }

    heartbeatId = window.setInterval(() => {
        void heartbeat();
    }, 10000);
}
