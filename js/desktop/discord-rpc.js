// js/desktop/discord-rpc.js
import { getTrackTitle, getTrackArtists } from '../utils.js';

export function initializeDiscordRPC(player) {
    const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
    let lastRefreshAt = 0;

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

    async function sendUpdate(track, isPaused = false) {
        if (!track) return;

        const rawDuration = Number(track.duration);
        const trackDurationSeconds = Number.isFinite(rawDuration)
            ? rawDuration > 10000
                ? rawDuration / 1000
                : rawDuration
            : 0;
        const currentTimeSeconds = Number(player.audio.currentTime) || 0;

        const data = {
            details: clamp(getTrackTitle(track), 128) || 'Monochrome+',
            state: clamp(getTrackArtists(track), 128) || 'Playing music',
            instance: false,
        };

        if (!isPaused && trackDurationSeconds > 0 && currentTimeSeconds >= 0) {
            const elapsed = Math.min(currentTimeSeconds, trackDurationSeconds);
            if (Number.isFinite(elapsed)) {
                data.startTimestamp = Math.floor(Date.now() / 1000 - elapsed);
            }
        }

        try {
            if (isTauri) {
                await sendViaTauri(data);
            }
        } catch (error) {
            console.error('[Desktop][DiscordRPC] Failed to send update:', error);
        }
    }

    async function sendIdle() {
        if (!isTauri) return;
        try {
            await sendViaTauri({
                details: 'Idling',
                state: 'Monochrome+',
                instance: false,
            });
        } catch {
            try {
                await clearViaTauri();
            } catch {
                // no-op
            }
        }
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
        void clearViaTauri().catch(() => {});
    });

    // Send initial status
    if (player.currentTrack) {
        void sendUpdate(player.currentTrack, player.audio.paused);
    } else {
        void sendIdle();
    }
}
