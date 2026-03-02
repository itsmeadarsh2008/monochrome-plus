// js/desktop/discord-rpc.js
import { getTrackTitle, getTrackArtists } from '../utils.js';

export function initializeDiscordRPC(player) {
    const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

    const sendViaTauri = async (payload) => {
        const core = await import('@tauri-apps/api/core');
        await core.invoke('update_discord_presence', { payload });
    };

    const clearViaTauri = async () => {
        const core = await import('@tauri-apps/api/core');
        await core.invoke('clear_discord_presence');
    };

    async function sendUpdate(track, isPaused = false) {
        if (!track) return;

        const data = {
            details: getTrackTitle(track),
            state: getTrackArtists(track),
            instance: false,
        };

        if (!isPaused && track.duration) {
            const now = Date.now();
            const elapsed = player.audio.currentTime * 1000;
            const remaining = (track.duration - player.audio.currentTime) * 1000;

            data.startTimestamp = Math.floor((now - elapsed) / 1000);
            data.endTimestamp = Math.floor((now + remaining) / 1000);
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
