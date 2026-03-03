// js/desktop/discord-rpc.js
import { deriveTrackQuality, getTrackTitle, getTrackArtists } from '../utils.js';
import { isTauriRuntime } from './tauri-runtime.js';

// tauri-plugin-drpc imports
let drpcStart, drpcStop, drpcSetActivity, drpcClearActivity, Activity, Assets, Timestamps;

export function initializeDiscordRPC(player) {
    if (!player?.audio) {
        console.warn('[Desktop][DiscordRPC] Player/audio is not ready, skipping initialization.');
        return;
    }

    if (window.__monochromeDiscordRpcCleanup) {
        window.__monochromeDiscordRpcCleanup();
        window.__monochromeDiscordRpcCleanup = null;
    }

    let drpcInitialized = false;
    let lastRefreshAt = 0;
    let lastPayload = null;
    let rpcHealthy = false;
    let heartbeatId = null;
    let monotoneTicker = 0;
    const cleanups = [];
    const DISCORD_APP_ID = '1466351059843809282'; // Hardcoded as requested

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

    const clamp = (value, max = 120) => {
        const text = String(value || '').trim();
        if (!text) return undefined;
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

    // Initialize DRPC module
    const initDRPC = async () => {
        try {
            const drpc = await import('tauri-plugin-drpc');
            drpcStart = drpc.start;
            drpcStop = drpc.stop;
            drpcSetActivity = drpc.setActivity;
            drpcClearActivity = drpc.clearActivity;
            
            const activity = await import('tauri-plugin-drpc/activity');
            Activity = activity.Activity;
            Assets = activity.Assets;
            Timestamps = activity.Timestamps;
            
            return true;
        } catch (error) {
            console.error('[DiscordRPC] Failed to load tauri-plugin-drpc:', error);
            return false;
        }
    };

    const startDRPC = async () => {
        if (drpcInitialized) return;
        
        const loaded = await initDRPC();
        if (!loaded) return;
        
        try {
            await drpcStart(DISCORD_APP_ID);
            drpcInitialized = true;
            console.log('[DiscordRPC] DRPC started successfully');
        } catch (error) {
            console.error('[DiscordRPC] Failed to start DRPC:', error);
        }
    };

    const buildActivity = (track, isPaused = false) => {
        if (!track) return null;

        const title = clamp(getTrackTitle(track), 128) || 'Unknown Track';
        const artists = clamp(getTrackArtists(track), 96) || 'Unknown Artist';
        const qualityLabel = clamp(getTrackQualityLabel(track), 36) || 'Quality unknown';
        const monochromeLabel = getDynamicMonochromeLabel(qualityLabel, isPaused);

        const activity = new Activity()
            .setDetails(title)
            .setState(`${artists} • ${qualityLabel}`);

        // Set assets
        const assets = new Assets()
            .setLargeImage('appicon')
            .setLargeText(`${title} • ${qualityLabel}`)
            .setSmallImage(isPaused ? 'paused_icon' : 'playing_icon')
            .setSmallText(monochromeLabel);
        
        activity.setAssets(assets);

        // Set timestamps if not paused
        if (!isPaused) {
            const rawDuration = Number(track.duration);
            const trackDurationSeconds = Number.isFinite(rawDuration)
                ? rawDuration > 10000 ? rawDuration / 1000 : rawDuration
                : 0;
            const currentTimeSeconds = Number(player.audio.currentTime) || 0;

            if (trackDurationSeconds > 0 && currentTimeSeconds >= 0) {
                const elapsed = Math.min(currentTimeSeconds, trackDurationSeconds);
                const startTimestamp = Date.now() - (elapsed * 1000);
                const endTimestamp = startTimestamp + (trackDurationSeconds * 1000);
                
                const timestamps = new Timestamps(startTimestamp)
                    .setEnd(endTimestamp);
                activity.setTimestamps(timestamps);
            }
        }

        return activity;
    };

    const sendUpdate = async (track, isPaused = false) => {
        if (!drpcInitialized) {
            await startDRPC();
        }
        
        if (!drpcInitialized) return;

        const activity = buildActivity(track, isPaused);
        if (!activity) return;

        const payloadHasChanged = JSON.stringify(activity) !== JSON.stringify(lastPayload);
        if (!payloadHasChanged && !isPaused) {
            return;
        }

        try {
            await drpcSetActivity(activity);
            lastPayload = activity;
            rpcHealthy = true;
        } catch (error) {
            rpcHealthy = false;
            console.error('[DiscordRPC] Failed to send update:', error);
        }
    };

    const sendIdle = async () => {
        if (!drpcInitialized) {
            await startDRPC();
        }
        
        if (!drpcInitialized) return;

        try {
            const label = MONOCHROME_ROTATION[monotoneTicker % MONOCHROME_ROTATION.length];
            monotoneTicker += 1;

            const activity = new Activity()
                .setDetails('Idling')
                .setState('No active track');

            const assets = new Assets()
                .setLargeImage('appicon')
                .setLargeText('Monochrome+')
                .setSmallText(label);
            
            activity.setAssets(assets);

            await drpcSetActivity(activity);
            lastPayload = activity;
            rpcHealthy = true;
        } catch (error) {
            rpcHealthy = false;
            console.error('[DiscordRPC] Failed to send idle:', error);
        }
    };

    const heartbeat = async () => {
        const activeTrack = player.currentTrack;
        if (activeTrack) {
            await sendUpdate(activeTrack, player.audio.paused);
            return;
        }

        if (!rpcHealthy && lastPayload) {
            try {
                await drpcSetActivity(lastPayload);
                rpcHealthy = true;
            } catch {
                rpcHealthy = false;
            }
            return;
        }

        await sendIdle();
    };

    const bindAudio = (eventName, handler) => {
        player.audio.addEventListener(eventName, handler);
        cleanups.push(() => player.audio.removeEventListener(eventName, handler));
    };

    const onPlay = () => {
        lastRefreshAt = 0;
        void sendUpdate(player.currentTrack, false);
    };

    const onPause = () => {
        void sendUpdate(player.currentTrack, true);
    };

    const onSeeking = () => {
        if (player.currentTrack) {
            void sendUpdate(player.currentTrack, player.audio.paused);
        }
    };

    const onLoadedMetadata = () => {
        void sendUpdate(player.currentTrack, player.audio.paused);
    };

    const onTimeUpdate = () => {
        if (player.audio.paused || !player.currentTrack) return;
        const now = Date.now();
        if (now - lastRefreshAt < 12000) return;
        lastRefreshAt = now;
        void sendUpdate(player.currentTrack);
    };

    const onEnded = () => {
        void sendIdle();
    };

    bindAudio('play', onPlay);
    bindAudio('pause', onPause);
    bindAudio('seeking', onSeeking);
    bindAudio('loadedmetadata', onLoadedMetadata);
    bindAudio('timeupdate', onTimeUpdate);
    bindAudio('ended', onEnded);

    const cleanup = async () => {
        if (heartbeatId) {
            clearInterval(heartbeatId);
            heartbeatId = null;
        }

        for (const dispose of cleanups) {
            try {
                dispose();
            } catch {
                // no-op
            }
        }

        if (drpcInitialized && drpcClearActivity) {
            try {
                await drpcClearActivity();
            } catch {
                // no-op
            }
        }
        
        if (drpcInitialized && drpcStop) {
            try {
                await drpcStop();
            } catch {
                // no-op
            }
        }
    };

    window.__monochromeDiscordRpcCleanup = cleanup;

    const onBeforeUnload = () => cleanup();
    window.addEventListener('beforeunload', onBeforeUnload, { once: true });
    cleanups.push(() => window.removeEventListener('beforeunload', onBeforeUnload));

    const start = async () => {
        const isTauri = await isTauriRuntime();
        if (!isTauri) {
            console.log('[DiscordRPC] Tauri runtime not detected; RPC disabled.');
            return;
        }

        await startDRPC();

        if (player.currentTrack) {
            await sendUpdate(player.currentTrack, player.audio.paused);
        } else {
            await sendIdle();
        }

        heartbeatId = window.setInterval(() => {
            void heartbeat();
        }, 10000);
    };

    void start();
}
