// js/desktop/discord-rpc.js
import { getTrackTitle, getTrackArtists } from '../utils.js';

export function initializeDiscordRPC(player) {
    const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

    const sendViaTauri = async (payload) => {
        const core = await import('@tauri-apps/api/core');
        await core.invoke('update_discord_presence', { payload });
    };

    async function sendUpdate(track, isPaused = false) {
        if (!track) return;

        let coverUrl = 'monochrome';
        if (track.album?.cover) {
            const coverId = track.album.cover.replace(/-/g, '/');
            coverUrl = `https://resources.tidal.com/images/${coverId}/320x320.jpg`;
        }

        const data = {
            details: getTrackTitle(track),
            state: getTrackArtists(track),
            largeImageKey: coverUrl,
            largeImageText: track.album?.title || 'Monochrome+',
            smallImageKey: isPaused ? 'pause' : 'play',
            smallImageText: isPaused ? 'Paused' : 'Playing',
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

    // Send initial status
    if (player.currentTrack) {
        void sendUpdate(player.currentTrack, player.audio.paused);
    } else {
        const idlePayload = {
            details: 'Idling',
            state: 'Monochrome+',
            largeImageKey: 'monochrome',
            largeImageText: 'Monochrome+',
            smallImageKey: 'pause',
            smallImageText: 'Paused',
        };
        if (isTauri) {
            void sendViaTauri(idlePayload).catch(() => {});
        }
    }
}
