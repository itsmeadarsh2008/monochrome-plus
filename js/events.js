//js/events.js
import {
    SVG_PLAY,
    SVG_PAUSE,
    SVG_PLAY_MINI,
    SVG_PAUSE_MINI,
    SVG_VOLUME,
    SVG_MUTE,
    REPEAT_MODE,
    trackDataStore,
    formatTime,
    SVG_BIN,
    getTrackArtists,
    positionMenu,
    getShareUrl,
    copyTextToClipboard,
    escapeHtml,
} from './utils.js';
import {
    lastFMStorage,
    libreFmSettings,
    waveformSettings,
    hifiVisualSettings,
    discordPresenceStorage,
} from './storage.js';
import { showNotification, downloadTrackWithMetadata, downloadAlbumAsZip, downloadPlaylistAsZip } from './downloads.js';
import { downloadQualitySettings } from './storage.js';
import { updateTabTitle, navigate } from './router.js';
import { db } from './db.js';
import { syncManager } from './accounts/appwrite-sync.js';
import { authManager } from './accounts/auth.js';
import { waveformGenerator } from './waveform.js';
import { audioContextManager } from './audio-context.js';
import { DiscordPresence } from './discord-presence.js';

let currentTrackIdForWaveform = null;

export function initializePlayerEvents(player, audioPlayer, scrobbler, ui, discord) {
    const playPauseBtn = document.querySelector('.now-playing-bar .play-pause-btn');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const sleepTimerBtnDesktop = document.getElementById('sleep-timer-btn-desktop');
    const sleepTimerBtnMobile = document.getElementById('sleep-timer-btn');

    // History tracking – record only after real listening starts.
    const HISTORY_RECORD_DEDUPE_MS = 5000; // avoid flood when replaying same track instantly
    const HISTORY_RECORD_MIN_SECONDS = 5; // only count plays after at least 5 seconds

    let historyLoggedTrackKey = null;
    let historyLoggedTimestamp = 0;
    let historyCandidateTrackKey = null;
    let historyCandidateStartTime = 0;
    let historyHasRecordedCurrentPlay = false;
    const STATUS_HEARTBEAT_MS = 25_000;
    const STATUS_INACTIVE_GRACE_MS = 3 * 60 * 1000;
    let lastStatusHeartbeatAt = 0;
    let statusClearedForInactivity = false;
    let lastUserInteractionAt = Date.now();

    const markUserInteraction = () => {
        lastUserInteractionAt = Date.now();
        if (statusClearedForInactivity && player.currentTrack && !audioPlayer.paused) {
            statusClearedForInactivity = false;
            lastStatusHeartbeatAt = 0;
        }
    };

    const isUserActive = () => {
        if (document.visibilityState !== 'visible') return false;
        return Date.now() - lastUserInteractionAt <= STATUS_INACTIVE_GRACE_MS;
    };

    window.addEventListener('pointerdown', markUserInteraction, { passive: true });
    window.addEventListener('keydown', markUserInteraction, { passive: true });
    window.addEventListener('touchstart', markUserInteraction, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            markUserInteraction();
            return;
        }

        if (!audioPlayer.paused && player.currentTrack) {
            syncManager.clearPlaybackStatus();
            statusClearedForInactivity = true;
        }
    });

    let playbackBuffering = false;

    const syncMiniPlayPauseIcon = () => {
        if (!playPauseBtn) return;
        playPauseBtn.classList.toggle('buffering', playbackBuffering);
        if (playbackBuffering) return;
        const isHowlerPlaying = Boolean(
            player._howlerSound && typeof player._howlerSound.playing === 'function' && player._howlerSound.playing()
        );
        const isAudioPlaying = !audioPlayer.paused && !audioPlayer.ended;
        playPauseBtn.innerHTML = isHowlerPlaying || isAudioPlaying ? SVG_PAUSE_MINI : SVG_PLAY_MINI;
    };

    const setPlaybackBuffering = (state) => {
        if (playbackBuffering === state) return;
        playbackBuffering = state;
        syncMiniPlayPauseIcon();
    };

    // A track is loading from the moment its stream is being fetched until
    // actual playback begins — show the play button as buffering then.
    audioPlayer.addEventListener('loadstart', () => setPlaybackBuffering(true));
    audioPlayer.addEventListener('waiting', () => setPlaybackBuffering(true));
    ['playing', 'pause', 'ended', 'error', 'abort', 'emptied'].forEach((eventName) => {
        audioPlayer.addEventListener(eventName, () => setPlaybackBuffering(false));
    });

    const getHistoryTrackKey = (track) => {
        if (!track || typeof track !== 'object') return null;
        const trackId = track.id || track.trackId || track.uuid || track.isrc;
        if (trackId) return String(trackId);

        const title = String(track.title || track.name || '')
            .trim()
            .toLowerCase();
        const artists = Array.isArray(track.artists)
            ? track.artists
                  .map((artist) =>
                      String(artist?.name || artist || '')
                          .trim()
                          .toLowerCase()
                  )
                  .filter(Boolean)
                  .join(',')
            : String(track.artist?.name || track.artist || '')
                  .trim()
                  .toLowerCase();

        if (!title && !artists) return null;
        const duration = Number(track.duration || track.length || 0) || 0;
        return `meta:${title}:${artists}:${duration}`;
    };

    const recordCurrentTrackHistory = async () => {
        if (!player.currentTrack) return;
        const currentTrackKey = getHistoryTrackKey(player.currentTrack);
        if (!currentTrackKey) return;

        const now = Date.now();
        if (currentTrackKey === historyLoggedTrackKey && now - historyLoggedTimestamp < HISTORY_RECORD_DEDUPE_MS) {
            return;
        }

        historyLoggedTrackKey = currentTrackKey;
        historyLoggedTimestamp = now;

        try {
            await db.addToHistory(player.currentTrack);
        } catch (error) {
            console.warn('[Events] Failed to add history:', error);
        }

        if (window.location.pathname === '/recent') {
            ui.renderRecentPage();
        }

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('history-changed'));
        }
    };

    audioPlayer.addEventListener('loadstart', () => {
        historyLoggedTrackKey = null;
        historyLoggedTimestamp = 0;
        historyCandidateTrackKey = null;
        historyHasRecordedCurrentPlay = false;
    });

    audioPlayer.addEventListener('timeupdate', () => {
        if (!player.currentTrack || !historyCandidateTrackKey || historyHasRecordedCurrentPlay) {
            return;
        }

        const trackKey = getHistoryTrackKey(player.currentTrack);
        if (!trackKey || trackKey !== historyCandidateTrackKey) {
            return;
        }

        if (
            audioPlayer.currentTime >= HISTORY_RECORD_MIN_SECONDS ||
            (audioPlayer.duration > 0 && audioPlayer.currentTime / audioPlayer.duration >= 0.1)
        ) {
            historyHasRecordedCurrentPlay = true;
            recordCurrentTrackHistory().catch((error) => {
                console.warn('[Events] recordCurrentTrackHistory failed:', error);
            });
        }
    });

    audioPlayer.addEventListener('ended', () => {
        if (player.currentTrack && historyCandidateTrackKey && !historyHasRecordedCurrentPlay) {
            const playedTime = Math.max(0, audioPlayer.duration - historyCandidateStartTime);
            if (playedTime >= 1) {
                historyHasRecordedCurrentPlay = true;
                recordCurrentTrackHistory().catch((error) => {
                    console.warn('[Events] recordCurrentTrackHistory failed:', error);
                });
            }
        }
    });

    // Sync UI with player state on load
    if (player.shuffleActive) {
        shuffleBtn.classList.add('active');
    }

    if (player.repeatMode && player.repeatMode !== REPEAT_MODE.OFF) {
        repeatBtn.classList.add('active');
        if (player.repeatMode === REPEAT_MODE.ONE) {
            repeatBtn.classList.add('repeat-one');
        }
        repeatBtn.title = player.repeatMode === REPEAT_MODE.ALL ? 'Repeat Queue' : 'Repeat One';
    } else {
        repeatBtn.title = 'Repeat';
    }

    const updateDiscordPresence = () => {
        if (!discord || !discordPresenceStorage.isEnabled()) return;
        if (player.currentTrack) {
            discord.setTrack(player.currentTrack);
        }
    };

    const clearDiscordPresenceOnQueueEnd = () => {
        if (!discord) return;
        const queue = player.shuffleActive ? player.shuffledQueue : player.queue;
        const isLastTrack = player.currentQueueIndex >= (Array.isArray(queue) ? queue.length - 1 : -1);
        const willStop = isLastTrack && player.repeatMode !== REPEAT_MODE.ALL && player.repeatMode !== REPEAT_MODE.ONE;
        if (willStop) {
            discord.clear();
        }
    };

    if (discord && discordPresenceStorage.isEnabled()) {
        discord.connect().catch((error) => {
            console.info('[Discord] Rich Presence unavailable:', error);
        });
    }

    audioPlayer.addEventListener('play', () => {
        // Initialize audio context manager for EQ (only once)
        if (!audioContextManager.isReady()) {
            audioContextManager.init(audioPlayer);
        }
        audioContextManager.resume();

        if (player.currentTrack) {
            // Scrobble
            if (scrobbler.isAuthenticated()) {
                scrobbler.updateNowPlaying(player.currentTrack);
            }

            // Update Appwrite Status
            syncManager.updatePlaybackStatus(player.currentTrack, {
                positionSec: audioPlayer.currentTime || 0,
                durationSec: audioPlayer.duration || player.currentTrack.duration || 0,
                force: true,
            });
            lastStatusHeartbeatAt = Date.now();
            statusClearedForInactivity = false;

            updateDiscordPresence();

            // Mark play candidate; commit to history only after enough playback progress.
            historyCandidateTrackKey = getHistoryTrackKey(player.currentTrack);
            historyCandidateStartTime = audioPlayer.currentTime || 0;
            historyHasRecordedCurrentPlay = false;

            updateWaveform();
        }

        syncMiniPlayPauseIcon();
        player.updateMediaSessionPlaybackState();
        player.updateMediaSessionPositionState();
        updateTabTitle(player);
    });

    audioPlayer.addEventListener('playing', () => {
        syncMiniPlayPauseIcon();
        player.updateMediaSessionPlaybackState();
        player.updateMediaSessionPositionState();
    });

    audioPlayer.addEventListener('pause', () => {
        // Clear Appwrite Status on pause
        syncManager.clearPlaybackStatus();
        statusClearedForInactivity = false;
        lastStatusHeartbeatAt = 0;

        if (discord) {
            discord.setPaused();
        }

        syncMiniPlayPauseIcon();
        player.updateMediaSessionPlaybackState();
        player.updateMediaSessionPositionState();
    });

    audioPlayer.addEventListener('ended', () => {
        syncManager.clearPlaybackStatus();
        statusClearedForInactivity = false;
        lastStatusHeartbeatAt = 0;
        clearDiscordPresenceOnQueueEnd();
        syncMiniPlayPauseIcon();
    });

    document.addEventListener('monochrome:track-quality-updated', () => {
        updateDiscordPresence();

        const fullscreenOverlay = document.getElementById('fullscreen-cover-overlay');
        if (fullscreenOverlay && getComputedStyle(fullscreenOverlay).display !== 'none' && player.currentTrack) {
            ui.updateFullscreenMetadata(player.currentTrack, player.getNextTrack());
        }
    });

    window.addEventListener('beforeunload', () => {
        if (discord) {
            discord.clear();
        }
    });

    audioPlayer.addEventListener('timeupdate', () => {
        const { currentTime, duration } = audioPlayer;
        if (duration) {
            const progressFill = document.getElementById('progress-fill');
            const currentTimeEl = document.getElementById('current-time');
            if (progressFill) progressFill.style.width = `${(currentTime / duration) * 100}%`;
            if (currentTimeEl) currentTimeEl.textContent = formatTime(currentTime);
        }

        if (player.currentTrack && !audioPlayer.paused) {
            const now = Date.now();
            if (!isUserActive()) {
                if (!statusClearedForInactivity) {
                    syncManager.clearPlaybackStatus();
                    statusClearedForInactivity = true;
                }
            } else if (now - lastStatusHeartbeatAt >= STATUS_HEARTBEAT_MS) {
                syncManager.updatePlaybackStatus(player.currentTrack, {
                    positionSec: currentTime || 0,
                    durationSec: duration || player.currentTrack.duration || 0,
                });
                lastStatusHeartbeatAt = now;
                statusClearedForInactivity = false;
            }
        }

        if (!player.currentTrack || !historyCandidateTrackKey || historyHasRecordedCurrentPlay) {
            return;
        }

        const trackKey = getHistoryTrackKey(player.currentTrack);
        if (!trackKey || trackKey !== historyCandidateTrackKey) {
            return;
        }

        const playedTime = Math.max(0, currentTime - historyCandidateStartTime);
        const shouldLogByTime = playedTime >= HISTORY_RECORD_MIN_SECONDS;
        const shouldLogByProgress = duration > 0 && playedTime >= Math.max(1, duration * 0.1);

        if (shouldLogByTime || shouldLogByProgress) {
            historyHasRecordedCurrentPlay = true;
            recordCurrentTrackHistory().catch((error) => {
                console.warn('[Events] recordCurrentTrackHistory failed:', error);
            });
        }
    });

    audioPlayer.addEventListener('loadedmetadata', () => {
        const totalDurationEl = document.getElementById('total-duration');
        totalDurationEl.textContent = formatTime(audioPlayer.duration);
        player.updateMediaSessionPositionState();
    });

    audioPlayer.addEventListener('error', async (e) => {
        console.error('Audio playback error:', e);
        syncMiniPlayPauseIcon();

        // A decoder failure ("No decoders for requested formats", typically a
        // Dolby Atmos EC-3/AC-3 stream the browser can't render) is terminal
        // for the current track AND its fallback tiers — the addon serves the
        // same undecodable format for every quality of an Atmos release.
        const targetError = e.target?.error;
        const errorMessage = String(targetError?.message || targetError || e.type || '');
        const isDecoderFailure = /no decoders|no supported decoder|decoder not|cannot play media/i.test(errorMessage);
        const badTrack = player.currentTrack;

        if (isDecoderFailure && badTrack && !badTrack.isLocal) {
            player._decoderFailedTrackId = badTrack.id;
            // Discard every cached URL for this track (memory + localStorage)
            // so a later replay re-resolves instead of retrying the poison URL.
            try {
                player.api.clearStreamCache?.(badTrack.id);
                player.preloadCache.delete(badTrack.id);
                ['DOLBY_ATMOS', 'HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'].forEach((q) =>
                    player.api.forgetStreamUrl?.(badTrack.id, q)
                );
            } catch {
                /* cache cleanup is best-effort */
            }
            let decoderNoticeAt = player._decoderNoticeAt || 0;
            if (Date.now() - decoderNoticeAt > 30000) {
                player._decoderNoticeAt = Date.now();
                showNotification('This track uses Dolby audio your browser can\u2019t decode \u2014 skipping.');
            }
        } else if (!isDecoderFailure && player._decoderFailedTrackId) {
            player._decoderFailedTrackId = null;
        }

        const currentQuality = player.quality;

        // Check if we can fallback to a lower quality
        const fallbackQualities =
            currentQuality === 'DOLBY_ATMOS'
                ? ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH']
                : currentQuality === 'HI_RES_LOSSLESS'
                  ? ['LOSSLESS', 'HIGH']
                  : [];

        if (
            player.currentTrack &&
            fallbackQualities.length > 0 &&
            !player.currentTrack.isLocal &&
            !player.currentTrack.isTracker &&
            !player.isFallbackRetry
        ) {
            console.warn(`Playback failed, attempting fallback from ${currentQuality} quality...`);
            player.isFallbackRetry = true; // Set flag to prevent infinite loops

            try {
                const trackId = player.currentTrack.id;

                // Clear cached stream data so we get a fresh URL
                player.api.clearStreamCache(trackId);
                player.preloadCache.delete(trackId);

                for (const fallbackQuality of fallbackQualities) {
                    try {
                        // A previous tier already failed to decode (e.g. Atmos
                        // EC-3 at every quality) — don't replay the same poison.
                        if (player._decoderFailedTrackId === player.currentTrack?.id) {
                            console.warn(
                                `Skipping fallback quality ${fallbackQuality}: track already failed to decode.`
                            );
                            break;
                        }

                        const streamResult = await player.api.getStreamUrl(
                            trackId,
                            fallbackQuality,
                            null,
                            player.currentTrack
                        );
                        const actualUrl =
                            typeof streamResult === 'object' && streamResult.url ? streamResult.url : streamResult;

                        if (!actualUrl) continue;

                        // A Dolby tier can't decode in this browser; loading it
                        // again just re-triggers the identical element error.
                        // Skip straight to the next quality tier.
                        if (
                            typeof streamResult === 'object' &&
                            player._isAtmosStream(streamResult, actualUrl) &&
                            !player._supportsDolbyAtmosWebPlayback()
                        ) {
                            console.warn(
                                `Fallback quality ${fallbackQuality} is Dolby Atmos — this browser has no decoder, skipping.`
                            );
                            continue;
                        }

                        // Reset player state for standard playback (non-DASH if possible)
                        if (player.dashInitialized) {
                            player.dashPlayer.reset();
                            player.dashInitialized = false;
                        }

                        // #audio-player carries crossorigin="anonymous" for
                        // dash.js; a direct CDN file (no CORS headers) would
                        // be blocked when loaded on that element, so clear the
                        // attribute for plain-file fallback playback.
                        audioPlayer.removeAttribute('crossorigin');
                        audioPlayer.src = actualUrl;
                        audioPlayer.load();
                        await audioPlayer.play();

                        // Reset flag after successful start
                        setTimeout(() => {
                            player.isFallbackRetry = false;
                        }, 5000);
                        return; // Successfully handled
                    } catch (qualityFallbackError) {
                        console.warn(`Fallback quality ${fallbackQuality} failed:`, qualityFallbackError);
                    }
                }
            } catch (fallbackError) {
                console.error('Fallback failed:', fallbackError);
            }
        }

        player.isFallbackRetry = false;

        // Skip to next track on error to prevent queue stalling
        if (player.currentTrack) {
            console.warn('Skipping to next track due to playback error');
            setTimeout(() => player.playNext(), 1000); // Small delay to avoid rapid skipping
        }
    });

    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            player.handlePlayPause();
            // Handle non-audio-backed playback paths where HTMLAudio events may not fire.
            requestAnimationFrame(syncMiniPlayPauseIcon);
            setTimeout(syncMiniPlayPauseIcon, 80);
        });
    }
    nextBtn.addEventListener('click', () => {
        player.playNext();
    });
    prevBtn.addEventListener('click', () => {
        player.playPrev();
    });

    shuffleBtn.addEventListener('click', () => {
        player.toggleShuffle();
        shuffleBtn.classList.toggle('active', player.shuffleActive);
        if (window.renderQueueFunction) window.renderQueueFunction();
    });

    repeatBtn.addEventListener('click', () => {
        const mode = player.toggleRepeat();
        repeatBtn.classList.toggle('active', mode !== REPEAT_MODE.OFF);
        repeatBtn.classList.toggle('repeat-one', mode === REPEAT_MODE.ONE);
        repeatBtn.title =
            mode === REPEAT_MODE.OFF ? 'Repeat' : mode === REPEAT_MODE.ALL ? 'Repeat Queue' : 'Repeat One';
    });

    // Sleep Timer for desktop
    if (sleepTimerBtnDesktop) {
        sleepTimerBtnDesktop.addEventListener('click', () => {
            if (player.isSleepTimerActive()) {
                player.clearSleepTimer();
                showNotification('Sleep timer cancelled');
            } else {
                showSleepTimerModal(player);
            }
        });
    }

    // Sleep Timer for mobile
    if (sleepTimerBtnMobile) {
        sleepTimerBtnMobile.addEventListener('click', () => {
            if (player.isSleepTimerActive()) {
                player.clearSleepTimer();
                showNotification('Sleep timer cancelled');
            } else {
                showSleepTimerModal(player);
            }
        });
    }

    // Volume controls
    syncMiniPlayPauseIcon();
    const volumeBar = document.getElementById('volume-bar');
    const volumeFill = document.getElementById('volume-fill');
    const volumeBtn = document.getElementById('volume-btn');
    const circularVolume = document.getElementById('circular-volume');
    const circularVolumeProgress = document.getElementById('circular-volume-progress');
    const CIRCUMFERENCE = 97.39;

    // Waveform Masking Logic
    const updateWaveform = async () => {
        const progressBar = document.getElementById('progress-bar');
        const playerControls = document.querySelector('.player-controls');

        const isTracker =
            player.currentTrack &&
            (player.currentTrack.isTracker ||
                (player.currentTrack.id && String(player.currentTrack.id).startsWith('tracker-')));

        if (!waveformSettings.isEnabled() || !player.currentTrack || isTracker) {
            if (progressBar) {
                progressBar.style.webkitMaskImage = '';
                progressBar.style.maskImage = '';
                progressBar.classList.remove('has-waveform', 'waveform-loaded');
            }
            if (playerControls) {
                playerControls.classList.remove('waveform-loaded');
            }
            currentTrackIdForWaveform = null;
            return;
        }

        if (progressBar && currentTrackIdForWaveform !== player.currentTrack.id) {
            currentTrackIdForWaveform = player.currentTrack.id;
            progressBar.classList.add('has-waveform');
            progressBar.classList.remove('waveform-loaded');
            if (playerControls) {
                playerControls.classList.remove('waveform-loaded');
            }

            // Clear current mask while loading
            progressBar.style.webkitMaskImage = '';
            progressBar.style.maskImage = '';

            try {
                const streamUrl = await player.api.getStreamUrl(
                    player.currentTrack.id,
                    'LOW',
                    null,
                    player.currentTrack
                );
                const waveformData = await waveformGenerator.getWaveform(streamUrl, player.currentTrack.id);

                if (waveformData && currentTrackIdForWaveform === player.currentTrack.id) {
                    let { peaks, duration } = waveformData;
                    const trackDuration = player.currentTrack.duration;

                    // Padding logic for sync
                    if (trackDuration && duration && duration < trackDuration) {
                        const diff = trackDuration - duration;
                        if (diff > 0.5) {
                            // If difference is significant (> 500ms)
                            // Calculate how many peaks represent the missing time
                            // peaks.length represents 'duration'
                            // X peaks represent 'diff'
                            const peaksPerSecond = peaks.length / duration;
                            const paddingPeaksCount = Math.floor(diff * peaksPerSecond);

                            if (paddingPeaksCount > 0) {
                                const newPeaks = new Float32Array(peaks.length + paddingPeaksCount);
                                // Fill start with 0s (implied by new Float32Array)
                                newPeaks.set(peaks, paddingPeaksCount);
                                peaks = newPeaks;
                            }
                        }
                    }

                    // Create a temporary canvas to generate the mask
                    const canvas = document.createElement('canvas');
                    const rect = progressBar.getBoundingClientRect();
                    canvas.width = rect.width || 500;
                    canvas.height = 28; // Fixed height for mask generation

                    waveformGenerator.drawWaveform(canvas, peaks);

                    const dataUrl = canvas.toDataURL();
                    progressBar.style.webkitMaskImage = `url(${dataUrl})`;
                    progressBar.style.webkitMaskSize = '100% 100%';
                    progressBar.style.webkitMaskRepeat = 'no-repeat';
                    progressBar.style.maskImage = `url(${dataUrl})`;
                    progressBar.style.maskSize = '100% 100%';
                    progressBar.style.maskRepeat = 'no-repeat';

                    progressBar.classList.add('waveform-loaded');
                    if (playerControls) {
                        playerControls.classList.add('waveform-loaded');
                    }
                }
            } catch (e) {
                console.error('Failed to load waveform mask:', e);
            }
        }
    };

    window.addEventListener('waveform-toggle', (e) => {
        if (!e.detail.enabled) {
            const progressBar = document.getElementById('progress-bar');
            const playerControls = document.querySelector('.player-controls');
            if (progressBar) {
                progressBar.style.webkitMaskImage = '';
                progressBar.style.maskImage = '';
                progressBar.classList.remove('has-waveform', 'waveform-loaded');
            }
            if (playerControls) {
                playerControls.classList.remove('waveform-loaded');
            }
        }
        updateWaveform();
    });

    const updateVolumeUI = () => {
        const { muted } = audioPlayer;
        const volume = player.userVolume;
        volumeBtn.innerHTML = muted || volume === 0 ? SVG_MUTE : SVG_VOLUME;
        const effectiveVolume = muted ? 0 : volume * 100;
        if (volumeFill) {
            volumeFill.style.setProperty('--volume-level', `${effectiveVolume}%`);
            volumeFill.style.width = `${effectiveVolume}%`;
        }
        if (circularVolumeProgress) {
            const offset = CIRCUMFERENCE - (CIRCUMFERENCE * effectiveVolume) / 100;
            circularVolumeProgress.style.strokeDashoffset = offset;
        }
    };

    volumeBtn.addEventListener('click', () => {
        audioPlayer.muted = !audioPlayer.muted;
        localStorage.setItem('muted', audioPlayer.muted);
    });

    audioPlayer.addEventListener('volumechange', updateVolumeUI);

    // Initialize volume and mute from localStorage
    const savedVolume = parseFloat(localStorage.getItem('volume') || '0.7');
    const savedMuted = localStorage.getItem('muted') === 'true';

    player.setVolume(savedVolume);
    audioPlayer.muted = savedMuted;

    if (volumeFill) {
        volumeFill.style.width = `${savedVolume * 100}%`;
    }
    if (volumeBar) {
        volumeBar.style.setProperty('--volume-level', `${savedVolume * 100}%`);
    }
    updateVolumeUI();

    initializeSmoothSliders(audioPlayer, player);
}

function initializeSmoothSliders(audioPlayer, player) {
    const progressBar = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');
    const currentTimeEl = document.getElementById('current-time');
    const volumeBar = document.getElementById('volume-bar');
    const volumeFill = document.getElementById('volume-fill');
    const volumeBtn = document.getElementById('volume-btn');

    let isSeeking = false;
    let wasPlaying = false;
    let isAdjustingVolume = false;
    let lastSeekPosition = 0;

    const seek = (bar, event, setter) => {
        const rect = bar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        setter(position);
    };

    const updateSeekUI = (position) => {
        if (!isNaN(audioPlayer.duration)) {
            progressFill.style.width = `${position * 100}%`;
            if (currentTimeEl) {
                currentTimeEl.textContent = formatTime(position * audioPlayer.duration);
            }
        }
    };

    // Progress bar with smooth dragging
    progressBar.addEventListener('mousedown', (e) => {
        isSeeking = true;
        wasPlaying = !audioPlayer.paused;
        if (wasPlaying) audioPlayer.pause();

        seek(progressBar, e, (position) => {
            lastSeekPosition = position;
            updateSeekUI(position);
        });
    });

    // Touch events for mobile
    progressBar.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isSeeking = true;
        wasPlaying = !audioPlayer.paused;
        if (wasPlaying) audioPlayer.pause();

        const touch = e.touches[0];
        const rect = progressBar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));

        lastSeekPosition = position;
        updateSeekUI(position);
    });

    document.addEventListener('mousemove', (e) => {
        if (isSeeking) {
            seek(progressBar, e, (position) => {
                lastSeekPosition = position;
                updateSeekUI(position);
            });
        }

        if (isAdjustingVolume && volumeBar) {
            seek(volumeBar, e, (position) => {
                if (audioPlayer.muted) {
                    audioPlayer.muted = false;
                    localStorage.setItem('muted', false);
                }
                player.setVolume(position);
                if (volumeFill) volumeFill.style.width = `${position * 100}%`;
                if (volumeBar) volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
            });
        }
    });

    document.addEventListener('touchmove', (e) => {
        if (isSeeking) {
            const touch = e.touches[0];
            const rect = progressBar.getBoundingClientRect();
            const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));

            lastSeekPosition = position;
            updateSeekUI(position);
        }

        if (isAdjustingVolume && volumeBar) {
            const touch = e.touches[0];
            const rect = volumeBar.getBoundingClientRect();
            const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
            if (audioPlayer.muted) {
                audioPlayer.muted = false;
                localStorage.setItem('muted', false);
            }
            player.setVolume(position);
            if (volumeFill) volumeFill.style.width = `${position * 100}%`;
            if (volumeBar) volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
        }
    });

    document.addEventListener('mouseup', () => {
        if (isSeeking) {
            // Commit the seek
            if (!isNaN(audioPlayer.duration)) {
                audioPlayer.currentTime = lastSeekPosition * audioPlayer.duration;
                player.updateMediaSessionPositionState();
                if (wasPlaying) audioPlayer.play();
            }
            isSeeking = false;
        }

        if (isAdjustingVolume) {
            isAdjustingVolume = false;
        }
    });

    document.addEventListener('touchend', () => {
        if (isSeeking) {
            if (!isNaN(audioPlayer.duration)) {
                audioPlayer.currentTime = lastSeekPosition * audioPlayer.duration;
                player.updateMediaSessionPositionState();
                if (wasPlaying) audioPlayer.play();
            }
            isSeeking = false;
        }

        if (isAdjustingVolume) {
            isAdjustingVolume = false;
        }
    });

    progressBar.addEventListener('click', (e) => {
        if (!isSeeking) {
            // Only handle click if not result of a drag release
            seek(progressBar, e, (position) => {
                if (!isNaN(audioPlayer.duration) && audioPlayer.duration > 0 && audioPlayer.duration !== Infinity) {
                    audioPlayer.currentTime = position * audioPlayer.duration;
                    player.updateMediaSessionPositionState();
                } else if (player.currentTrack && player.currentTrack.duration) {
                    const targetTime = position * player.currentTrack.duration;
                    const progressFill = document.querySelector('.progress-fill');
                    if (progressFill) progressFill.style.width = `${position * 100}%`;
                    player.playTrackFromQueue(targetTime);
                }
            });
        }
    });

    if (volumeBar) {
        volumeBar.addEventListener('mousedown', (e) => {
            isAdjustingVolume = true;
            seek(volumeBar, e, (position) => {
                if (audioPlayer.muted) {
                    audioPlayer.muted = false;
                    localStorage.setItem('muted', false);
                }
                player.setVolume(position);
                if (volumeFill) volumeFill.style.width = `${position * 100}%`;
                volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
            });
        });

        volumeBar.addEventListener('touchstart', (e) => {
            e.preventDefault();
            isAdjustingVolume = true;
            const touch = e.touches[0];
            const rect = volumeBar.getBoundingClientRect();
            const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
            if (audioPlayer.muted) {
                audioPlayer.muted = false;
                localStorage.setItem('muted', false);
            }
            player.setVolume(position);
            if (volumeFill) volumeFill.style.width = `${position * 100}%`;
            volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
        });

        volumeBar.addEventListener('click', (e) => {
            if (!isAdjustingVolume) {
                seek(volumeBar, e, (position) => {
                    if (audioPlayer.muted) {
                        audioPlayer.muted = false;
                        localStorage.setItem('muted', false);
                    }
                    player.setVolume(position);
                    if (volumeFill) volumeFill.style.width = `${position * 100}%`;
                    volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
                });
            }
        });

        volumeBar.addEventListener(
            'wheel',
            (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.05 : 0.05;
                const newVolume = Math.max(0, Math.min(1, player.userVolume + delta));

                if (delta > 0 && audioPlayer.muted) {
                    audioPlayer.muted = false;
                    localStorage.setItem('muted', false);
                }

                player.setVolume(newVolume);
                if (volumeFill) volumeFill.style.width = `${newVolume * 100}%`;
                volumeBar.style.setProperty('--volume-level', `${newVolume * 100}%`);
            },
            { passive: false }
        );
    }

    volumeBtn?.addEventListener(
        'wheel',
        (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            const newVolume = Math.max(0, Math.min(1, player.userVolume + delta));

            if (delta > 0 && audioPlayer.muted) {
                audioPlayer.muted = false;
                localStorage.setItem('muted', false);
            }

            player.setVolume(newVolume);
            if (volumeFill) volumeFill.style.width = `${newVolume * 100}%`;
            if (volumeBar) volumeBar.style.setProperty('--volume-level', `${newVolume * 100}%`);
        },
        { passive: false }
    );

    // Circular volume knob interaction
    const circularVolume = document.getElementById('circular-volume');
    const circularVolumeProgress = document.getElementById('circular-volume-progress');
    const CIRCUMFERENCE = 97.39;

    if (circularVolume) {
        const getVolumeFromAngle = (e) => {
            const rect = circularVolume.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            let angle = Math.atan2(e.clientX - cx, -(e.clientY - cy));
            if (angle < 0) angle += 2 * Math.PI;
            return Math.max(0, Math.min(1, angle / (2 * Math.PI)));
        };

        const applyCircularVolume = (position) => {
            if (audioPlayer.muted) {
                audioPlayer.muted = false;
                localStorage.setItem('muted', false);
            }
            player.setVolume(position);
            if (volumeFill) {
                volumeFill.style.width = `${position * 100}%`;
            }
            if (volumeBar) {
                volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
            }
            if (circularVolumeProgress) {
                const offset = CIRCUMFERENCE - CIRCUMFERENCE * position;
                circularVolumeProgress.style.strokeDashoffset = offset;
            }
        };

        let isAdjustingCircularVolume = false;

        circularVolume.addEventListener('mousedown', (e) => {
            if (e.target.closest('.circular-volume-icon')) return;
            isAdjustingCircularVolume = true;
            applyCircularVolume(getVolumeFromAngle(e));
        });

        document.addEventListener('mousemove', (e) => {
            if (isAdjustingCircularVolume) {
                applyCircularVolume(getVolumeFromAngle(e));
            }
        });

        document.addEventListener('mouseup', () => {
            isAdjustingCircularVolume = false;
        });

        circularVolume.addEventListener(
            'wheel',
            (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.05 : 0.05;
                const newVolume = Math.max(0, Math.min(1, player.userVolume + delta));
                if (delta > 0 && audioPlayer.muted) {
                    audioPlayer.muted = false;
                    localStorage.setItem('muted', false);
                }
                player.setVolume(newVolume);
                if (volumeFill) {
                    volumeFill.style.width = `${newVolume * 100}%`;
                }
                if (volumeBar) {
                    volumeBar.style.setProperty('--volume-level', `${newVolume * 100}%`);
                }
                if (circularVolumeProgress) {
                    const offset = CIRCUMFERENCE - CIRCUMFERENCE * newVolume;
                    circularVolumeProgress.style.strokeDashoffset = offset;
                }
            },
            { passive: false }
        );
    }
}

// Standalone function to show add to playlist modal
export async function showAddToPlaylistModal(track) {
    const modal = document.getElementById('playlist-select-modal');
    const list = document.getElementById('playlist-select-list');
    const cancelBtn = document.getElementById('playlist-select-cancel');
    const overlay = modal.querySelector('.modal-overlay');

    const renderModal = async () => {
        const playlists = await db.getPlaylists(true);

        const trackId = track.id;
        const playlistsWithTrack = new Set();

        for (const playlist of playlists) {
            if (playlist.tracks && playlist.tracks.some((t) => t.id == trackId)) {
                playlistsWithTrack.add(playlist.id);
            }
        }

        list.innerHTML =
            `
            <div class="modal-option create-new-option" style="border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;">
                <span style="font-weight: 600; color: var(--primary);">+ Create New Playlist</span>
            </div>
        ` +
            playlists
                .map((p) => {
                    const alreadyContains = playlistsWithTrack.has(p.id);
                    return `
                <div class="modal-option ${alreadyContains ? 'already-contains' : ''}" data-id="${p.id}">
                    <span>${p.name}</span>
                    ${
                        alreadyContains
                            ? `<button class="remove-from-playlist-btn-modal" title="Remove from playlist" style="background: transparent; border: none; color: inherit; cursor: pointer; padding: 4px; display: flex; align-items: center;">${SVG_BIN}</button>`
                            : ''
                    }
                </div>
            `;
                })
                .join('');
        return true;
    };

    if (!(await renderModal())) return;

    const closeModal = () => {
        modal.classList.remove('active');
        cleanup();
    };

    const handleOptionClick = async (e) => {
        const removeBtn = e.target.closest('.remove-from-playlist-btn-modal');
        const option = e.target.closest('.modal-option');

        if (!option) return;

        if (option.classList.contains('create-new-option')) {
            closeModal();
            const createModal = document.getElementById('playlist-modal');
            document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
            document.getElementById('playlist-name-input').value = '';
            document.getElementById('playlist-cover-input').value = '';
            document.getElementById('playlist-cover-file-input').value = '';
            document.getElementById('playlist-description-input').value = '';
            createModal.dataset.editingId = '';
            document.getElementById('import-section').style.display = 'none';

            // Reset cover upload state
            const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
            const coverUrlInput = document.getElementById('playlist-cover-input');
            const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
            if (coverUploadBtn) {
                coverUploadBtn.style.flex = '1';
                coverUploadBtn.style.display = 'flex';
            }
            if (coverUrlInput) coverUrlInput.style.display = 'none';
            if (coverToggleUrlBtn) {
                coverToggleUrlBtn.textContent = 'or URL';
                coverToggleUrlBtn.title = 'Switch to URL input';
            }

            // Pass track
            createModal._pendingTracks = [track];

            createModal.classList.add('active');
            document.getElementById('playlist-name-input').focus();
            return;
        }

        const playlistId = option.dataset.id;

        if (removeBtn) {
            e.stopPropagation();
            await db.removeTrackFromPlaylist(playlistId, track.id);
            const updatedPlaylist = await db.getPlaylist(playlistId);
            syncManager.syncUserPlaylist(updatedPlaylist, 'update');
            showNotification(`Removed from playlist: ${option.querySelector('span').textContent}`);
            await renderModal();
        } else {
            if (option.classList.contains('already-contains')) return;

            await db.addTrackToPlaylist(playlistId, track);
            const updatedPlaylist = await db.getPlaylist(playlistId);
            syncManager.syncUserPlaylist(updatedPlaylist, 'update');
            showNotification(`Added to playlist: ${option.querySelector('span').textContent}`);
            closeModal();
        }
    };

    const cleanup = () => {
        cancelBtn.removeEventListener('click', closeModal);
        overlay.removeEventListener('click', closeModal);
        list.removeEventListener('click', handleOptionClick);
    };

    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);
    list.addEventListener('click', handleOptionClick);

    modal.classList.add('active');
}

export async function handleTrackAction(
    action,
    item,
    player,
    api,
    lyricsManager,
    type = 'track',
    ui = null,
    scrobbler = null,
    extraData = null
) {
    if (!item) return;

    // Actions not allowed for unavailable tracks
    const forbiddenForUnavailable = ['add-to-queue', 'play-next', 'track-mix', 'download', 'start-infinite-radio'];
    if (item.isUnavailable && forbiddenForUnavailable.includes(action)) {
        showNotification('This track is unavailable.');
        return;
    }

    if (action === 'track-mix' && type === 'track') {
        if (item.mixes && item.mixes.TRACK_MIX) {
            navigate(`/mix/${item.mixes.TRACK_MIX}`);
        }
        return;
    }

    // Collection Actions (Album, Playlist, Mix)
    const isCollection = ['album', 'playlist', 'user-playlist', 'mix'].includes(type);
    const collectionActions = [
        'play-card',
        'shuffle-play-card',
        'add-to-queue',
        'play-next',
        'download',
        'start-mix',
        'start-infinite-radio',
    ];

    if (isCollection && collectionActions.includes(action)) {
        try {
            // Check if album/artist is blocked
            const { contentBlockingSettings } = await import('./storage.js');
            if (type === 'album' && contentBlockingSettings.shouldHideAlbum(item)) {
                showNotification('This album is blocked');
                return;
            }

            let tracks = [];
            let collectionItem = item;

            if (type === 'album') {
                const data = await api.getAlbum(item.id);
                tracks = data.tracks;
                collectionItem = data.album || item;
            } else if (type === 'playlist') {
                const data = await api.getPlaylist(item.uuid);
                tracks = data.tracks;
                collectionItem = data.playlist || item;
            } else if (type === 'user-playlist') {
                let playlist = await db.getPlaylist(item.id);
                if (!playlist) {
                    try {
                        playlist = await syncManager.getPublicPlaylist(item.id);
                    } catch {
                        /* ignore */
                    }
                }
                tracks = playlist ? playlist.tracks : item.tracks || [];
                collectionItem = playlist || item;
            } else if (type === 'mix') {
                const data = await api.getMix(item.id);
                tracks = data.tracks;
                collectionItem = data.mix || item;
            }

            if (tracks.length === 0 && action !== 'start-mix') {
                showNotification(`No tracks found in this ${type}`);
                return;
            }

            if (action === 'download') {
                if (type === 'album') {
                    await downloadAlbumAsZip(
                        collectionItem,
                        tracks,
                        api,
                        downloadQualitySettings.getQuality(),
                        lyricsManager
                    );
                } else {
                    await downloadPlaylistAsZip(
                        collectionItem,
                        tracks,
                        api,
                        downloadQualitySettings.getQuality(),
                        lyricsManager
                    );
                }
                return;
            }

            // Filter blocked tracks from collections
            tracks = contentBlockingSettings.filterTracks(tracks);

            if (action === 'add-to-queue') {
                player.addToQueue(tracks);
                if (window.renderQueueFunction) window.renderQueueFunction();
                showNotification(`Added ${tracks.length} tracks to queue`);
                return;
            }

            if (action === 'play-next') {
                player.addNextToQueue(tracks);
                if (window.renderQueueFunction) window.renderQueueFunction();
                showNotification(`Playing next: ${tracks.length} tracks`);
                return;
            }

            if (action === 'start-mix') {
                if (type === 'album' && collectionItem.artist?.id) {
                    const artistData = await api.getArtist(collectionItem.artist.id);
                    if (artistData.mixes?.ARTIST_MIX) {
                        navigate(`/mix/${artistData.mixes.ARTIST_MIX}`);
                        return;
                    }
                }
                // Fallback to item's own page or first track's mix
                if (tracks.length > 0 && tracks[0].mixes?.TRACK_MIX) {
                    navigate(`/mix/${tracks[0].mixes.TRACK_MIX}`);
                } else {
                    navigate(`/${type.replace('user-', '')}/${item.id || item.uuid}`);
                }
                return;
            }

            if (action === 'start-infinite-radio') {
                const seeds = tracks.slice(0, 10);
                const recommended = await api.getRecommendedTracksForPlaylist(seeds, 50);
                const merged = [...seeds, ...recommended];
                const seen = new Set();
                const queue = merged.filter((track) => {
                    const key = String(track?.id || '');
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                if (!queue.length) {
                    showNotification('No recommendations available for Infinite Radio');
                    return;
                }
                player.setQueue(queue, 0);
                player.playAtIndex(0);
                showNotification(`Infinite Radio started from ${queue.length} tracks`);
                return;
            }

            // play-card and shuffle-play-card
            if (action === 'shuffle-play-card') {
                player.shuffleActive = true;
                const tracksToShuffle = [...tracks];
                tracksToShuffle.sort(() => Math.random() - 0.5);
                player.setQueue(tracksToShuffle, 0);
                const shuffleBtn = document.getElementById('shuffle-btn');
                if (shuffleBtn) shuffleBtn.classList.add('active');
            } else {
                player.setQueue(tracks, 0);
                const shuffleBtn = document.getElementById('shuffle-btn');
                if (shuffleBtn) shuffleBtn.classList.remove('active');
            }
            player.playAtIndex(0);
            const name = type === 'user-playlist' ? collectionItem.name : collectionItem.title;
            showNotification(`Playing ${type.replace('user-', '')}: ${name}`);
        } catch (error) {
            console.error('Failed to handle collection action:', error);
            showNotification(`Failed to process ${type} action`);
        }
        return;
    }

    if (action === 'toggle-pin') {
        const pinned = await db.togglePinned(item, type);
        showNotification(pinned ? `Pinned to sidebar` : `Unpinned from sidebar`);

        if (ui && typeof ui.renderPinnedItems === 'function') {
            ui.renderPinnedItems();
        }
    }

    // Individual Track Actions
    // Check if track/artist is blocked
    const { contentBlockingSettings } = await import('./storage.js');
    if (type === 'track' && contentBlockingSettings.shouldHideTrack(item)) {
        showNotification('This track is blocked');
        return;
    }

    if (action === 'add-to-queue') {
        player.addToQueue(item);
        if (window.renderQueueFunction) window.renderQueueFunction();
        showNotification(`Added to queue: ${item.title}`);
    } else if (action === 'play-next') {
        player.addNextToQueue(item);
        if (window.renderQueueFunction) window.renderQueueFunction();
        showNotification(`Playing next: ${item.title}`);
    } else if (action === 'play-card') {
        player.setQueue([item], 0);
        player.playAtIndex(0);
        showNotification(`Playing track: ${item.title}`);
    } else if (action === 'start-mix') {
        if (item.mixes?.TRACK_MIX) {
            navigate(`/mix/${item.mixes.TRACK_MIX}`);
        } else {
            showNotification('No mix available for this track');
        }
    } else if (action === 'start-infinite-radio') {
        const recommendationData = await api.getRecommendations(item.id);
        const recommended = Array.isArray(recommendationData?.items) ? recommendationData.items : [];
        const queue = [item, ...recommended].filter((track, index, list) => {
            const trackId = String(track?.id || '');
            return trackId && list.findIndex((other) => String(other?.id || '') === trackId) === index;
        });
        if (!queue.length) {
            showNotification('No recommendations available for Infinite Radio');
            return;
        }
        player.setQueue(queue, 0);
        player.playAtIndex(0);
        showNotification('Infinite Radio started');
    } else if (action === 'download') {
        await downloadTrackWithMetadata(item, downloadQualitySettings.getQuality(), api, lyricsManager);
    } else if (action === 'toggle-like') {
        const added = await db.toggleFavorite(type, item);

        if (added && type === 'track' && scrobbler) {
            if (lastFMStorage.isEnabled() && lastFMStorage.shouldLoveOnLike()) {
                scrobbler.loveTrack(item);
            }
            if (libreFmSettings.isEnabled() && libreFmSettings.shouldLoveOnLike()) {
                scrobbler.loveTrack(item);
            }
        }

        // Update all instances of this item's like button on the page
        const id = type === 'playlist' ? item.uuid : item.id;
        const selector =
            type === 'track'
                ? `[data-track-id="${id}"] .like-btn`
                : `.card[data-${type}-id="${id}"] .like-btn, .card[data-playlist-id="${id}"] .like-btn`;

        // Also check header buttons
        const headerBtn = document.getElementById(`like-${type}-btn`);

        const elementsToUpdate = [...document.querySelectorAll(selector)];
        if (headerBtn) elementsToUpdate.push(headerBtn);

        const nowPlayingLikeBtn = document.getElementById('now-playing-like-btn');
        if (
            nowPlayingLikeBtn &&
            type === 'track' &&
            String(player?.currentTrack?.id || '') === String(item?.id || '')
        ) {
            elementsToUpdate.push(nowPlayingLikeBtn);
        }

        const fsLikeBtn = document.getElementById('fs-like-btn');
        if (fsLikeBtn && type === 'track' && String(player?.currentTrack?.id || '') === String(item?.id || '')) {
            elementsToUpdate.push(fsLikeBtn);
        }

        elementsToUpdate.forEach((btn) => {
            const heartIcon = btn.querySelector('svg');
            if (heartIcon) {
                heartIcon.classList.toggle('filled', added);
                if (heartIcon.hasAttribute('fill')) {
                    heartIcon.setAttribute('fill', added ? 'currentColor' : 'none');
                }
            }
            btn.classList.toggle('active', added);
            btn.title = added ? 'Remove from Favorites' : 'Add to Favorites';
        });

        // Handle Library Page Update
        if (window.location.hash === '#library') {
            const itemSelector =
                type === 'track'
                    ? `.track-item[data-track-id="${id}"]`
                    : `.card[data-${type}-id="${id}"], .card[data-playlist-id="${id}"]`;

            const itemEl = document.querySelector(itemSelector);

            if (!added && itemEl) {
                // Remove item
                const container = itemEl.parentElement;
                itemEl.remove();
                if (container && container.children.length === 0) {
                    const msg = type === 'track' ? 'No liked tracks yet.' : `No liked ${type}s yet.`;
                    container.innerHTML = `<div class="placeholder-text">${msg}</div>`;
                }
            } else if (added && !itemEl && ui && type === 'track') {
                // Add item (specifically for tracks currently)
                const tracksContainer = document.getElementById('library-tracks-container');
                if (tracksContainer) {
                    // Remove placeholder if it exists
                    const placeholder = tracksContainer.querySelector('.placeholder-text');
                    if (placeholder) placeholder.remove();

                    // Create track element
                    const index = tracksContainer.children.length;
                    const trackHTML = ui.createTrackItemHTML(item, index, true, false);

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = trackHTML;
                    const newEl = tempDiv.firstElementChild;

                    if (newEl) {
                        tracksContainer.appendChild(newEl);
                        trackDataStore.set(newEl, item);
                        ui.updateLikeState(newEl, 'track', item.id);
                    }
                }
            }
        }
    } else if (action === 'add-to-playlist') {
        const modal = document.getElementById('playlist-select-modal');
        const list = document.getElementById('playlist-select-list');
        const cancelBtn = document.getElementById('playlist-select-cancel');
        const overlay = modal.querySelector('.modal-overlay');

        const renderModal = async () => {
            const playlists = await db.getPlaylists(true);
            // Removed empty check to allow creating new playlist

            const trackId = item.id;
            const playlistsWithTrack = new Set();

            for (const playlist of playlists) {
                if (playlist.tracks && playlist.tracks.some((track) => track.id == trackId)) {
                    playlistsWithTrack.add(playlist.id);
                }
            }

            list.innerHTML =
                `
                <div class="modal-option create-new-option" style="border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;">
                    <span style="font-weight: 600; color: var(--primary);">+ Create New Playlist</span>
                </div>
            ` +
                playlists
                    .map((p) => {
                        const alreadyContains = playlistsWithTrack.has(p.id);
                        return `
                    <div class="modal-option ${alreadyContains ? 'already-contains' : ''}" data-id="${p.id}">
                        <span>${p.name}</span>
                        ${
                            alreadyContains
                                ? `<button class="remove-from-playlist-btn-modal" title="Remove from playlist" style="background: transparent; border: none; color: inherit; cursor: pointer; padding: 4px; display: flex; align-items: center;">${SVG_BIN}</button>`
                                : ''
                        }
                    </div>
                `;
                    })
                    .join('');
            return true;
        };

        if (!(await renderModal())) return;

        const closeModal = () => {
            modal.classList.remove('active');
            cleanup();
        };

        const handleOptionClick = async (e) => {
            const removeBtn = e.target.closest('.remove-from-playlist-btn-modal');
            const option = e.target.closest('.modal-option');

            if (!option) return;

            if (option.classList.contains('create-new-option')) {
                closeModal();
                const createModal = document.getElementById('playlist-modal');
                document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
                document.getElementById('playlist-name-input').value = '';
                document.getElementById('playlist-cover-input').value = '';
                document.getElementById('playlist-cover-file-input').value = '';
                document.getElementById('playlist-description-input').value = '';
                createModal.dataset.editingId = '';
                document.getElementById('import-section').style.display = 'none';

                // Reset cover upload state
                const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
                const coverUrlInput = document.getElementById('playlist-cover-input');
                const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
                if (coverUploadBtn) {
                    coverUploadBtn.style.flex = '1';
                    coverUploadBtn.style.display = 'flex';
                }
                if (coverUrlInput) coverUrlInput.style.display = 'none';
                if (coverToggleUrlBtn) {
                    coverToggleUrlBtn.textContent = 'or URL';
                    coverToggleUrlBtn.title = 'Switch to URL input';
                }

                // Pass track
                createModal._pendingTracks = [item];

                createModal.classList.add('active');
                document.getElementById('playlist-name-input').focus();
                return;
            }

            const playlistId = option.dataset.id;

            if (removeBtn) {
                e.stopPropagation();
                await db.removeTrackFromPlaylist(playlistId, item.id);
                const updatedPlaylist = await db.getPlaylist(playlistId);
                syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                showNotification(`Removed from playlist: ${option.querySelector('span').textContent}`);
                await renderModal();
            } else {
                if (option.classList.contains('already-contains')) return;

                await db.addTrackToPlaylist(playlistId, item);
                const updatedPlaylist = await db.getPlaylist(playlistId);
                syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                showNotification(`Added to playlist: ${option.querySelector('span').textContent}`);
                closeModal();
            }
        };

        const cleanup = () => {
            cancelBtn.removeEventListener('click', closeModal);
            overlay.removeEventListener('click', closeModal);
            list.removeEventListener('click', handleOptionClick);
        };

        cancelBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', closeModal);
        list.addEventListener('click', handleOptionClick);

        modal.classList.add('active');
    } else if (action === 'add-to-collab-playlist') {
        const collabPlaylists = await db.getCollaborativePlaylists();
        if (!collabPlaylists || collabPlaylists.length === 0) {
            showNotification('No collaborative playlists yet. Create one from the Friends page.');
            return;
        }
        const modal = document.getElementById('playlist-select-modal');
        const list = document.getElementById('playlist-select-list');
        if (!modal || !list) return;
        list.innerHTML = collabPlaylists
            .map(
                (p) =>
                    `<div class="modal-option" data-id="${p.id}" data-collab="true">${escapeHtml(p.name)} <span style="color: var(--muted-foreground); font-size: 0.8em;">(collab)</span></div>`
            )
            .join('');
        const overlay = modal.querySelector('.modal-overlay');
        const cancelBtn = document.getElementById('playlist-select-cancel');
        const closeModal = () => {
            modal.classList.remove('active');
            list.removeEventListener('click', handleOptionClick);
            if (overlay) overlay.removeEventListener('click', closeModal);
            if (cancelBtn) cancelBtn.removeEventListener('click', closeModal);
        };
        const handleOptionClick = async (e) => {
            const option = e.target.closest('.modal-option');
            if (option) {
                const playlistId = option.dataset.id;
                try {
                    await db.addTracksToCollaborativePlaylist(playlistId, [item]);
                    showNotification('Added to collaborative playlist!');
                } catch (error) {
                    console.error('Failed to add to collaborative playlist:', error);
                    showNotification('Failed to add track.');
                }
                closeModal();
            }
        };
        if (overlay) overlay.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
        list.addEventListener('click', handleOptionClick);
        modal.classList.add('active');
    } else if (action === 'go-to-artist') {
        const artistId = extraData?.artistId || item.artist?.id || item.artists?.[0]?.id;
        const trackerSheetId = extraData?.trackerSheetId || (item.isTracker ? item.trackerInfo?.sheetId : null);

        if (trackerSheetId) {
            navigate(`/unreleased/${trackerSheetId}`);
        } else if (artistId) {
            navigate(`/artist/${artistId}`);
        }
    } else if (action === 'go-to-album') {
        if (item.album?.id) {
            navigate(`/album/${item.album.id}`);
        }
    } else if (action === 'copy-link' || action === 'share') {
        // Use stored href from card if available, otherwise construct URL
        const contextMenu = document.getElementById('context-menu');
        const storedHref = contextMenu?._contextHref;
        const url = getShareUrl(storedHref ? storedHref : `/track/${item.id || item.uuid}`);

        copyTextToClipboard(url).then((copied) => {
            if (!copied) {
                showNotification('Could not copy link on this browser.');
                return;
            }
            showNotification('Link copied to clipboard!');
        });
    } else if (action === 'open-in-new-tab') {
        // Use stored href from card if available, otherwise construct URL
        const contextMenu = document.getElementById('context-menu');
        const storedHref = contextMenu?._contextHref;
        const url = storedHref
            ? `${window.location.origin}${storedHref}`
            : `${window.location.origin}/track/${item.id || item.uuid}`;

        window.open(url, '_blank');
    } else if (action === 'track-info') {
        // Show detailed track info modal
        const isTracker = item.isTracker;
        let infoHTML = '';

        if (isTracker && item.trackerInfo) {
            // Detailed unreleased/tracker track info
            const releaseDate = item.trackerInfo.releaseDate || item.streamStartDate;
            const dateDisplay = releaseDate ? new Date(releaseDate).toLocaleDateString() : 'Unknown';
            const addedDate = item.trackerInfo.addedDate
                ? new Date(item.trackerInfo.addedDate).toLocaleDateString()
                : 'Unknown';

            infoHTML = `
                <div style="padding: 1.5rem; max-width: 500px; max-height: 80vh; overflow-y: auto;">
                    <h3 style="margin-bottom: 1rem; font-size: 1.3rem; font-weight: 600;">${escapeHtml(item.title)}</h3>
                    <div style="color: var(--muted-foreground); font-size: 0.9rem; line-height: 1.8;">
                        <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                            <p style="color: var(--primary); font-weight: 500;">Unreleased Track</p>
                        </div>
                        
                        <div style="display: grid; gap: 0.5rem;">
                            ${item.artists ? `<p><strong style="color: var(--foreground);">Artist:</strong> ${escapeHtml(Array.isArray(item.artists) ? item.artists.map((a) => a.name || a).join(', ') : item.artists)}</p>` : ''}
                            ${item.trackerInfo.artist ? `<p><strong style="color: var(--foreground);">Tracked Artist:</strong> ${escapeHtml(item.trackerInfo.artist)}</p>` : ''}
                            ${item.trackerInfo.project ? `<p><strong style="color: var(--foreground);">Project:</strong> ${escapeHtml(item.trackerInfo.project)}</p>` : ''}
                            ${item.trackerInfo.era ? `<p><strong style="color: var(--foreground);">Era:</strong> ${escapeHtml(item.trackerInfo.era)}</p>` : ''}
                            ${item.trackerInfo.timeline ? `<p><strong style="color: var(--foreground);">Timeline:</strong> ${escapeHtml(item.trackerInfo.timeline)}</p>` : ''}
                            ${item.trackerInfo.category ? `<p><strong style="color: var(--foreground);">Category:</strong> ${escapeHtml(item.trackerInfo.category)}</p>` : ''}
                            ${item.trackerInfo.trackNumber ? `<p><strong style="color: var(--foreground);">Track Number:</strong> ${escapeHtml(String(item.trackerInfo.trackNumber))}</p>` : ''}
                            <p><strong style="color: var(--foreground);">Duration:</strong> ${escapeHtml(formatTime(item.duration))}</p>
                            ${releaseDate !== 'Unknown' ? `<p><strong style="color: var(--foreground);">Release Date:</strong> ${escapeHtml(dateDisplay)}</p>` : ''}
                            ${item.trackerInfo.addedDate ? `<p><strong style="color: var(--foreground);">Added to Tracker:</strong> ${escapeHtml(addedDate)}</p>` : ''}
                            ${item.trackerInfo.leakedDate ? `<p><strong style="color: var(--foreground);">Leak Date:</strong> ${escapeHtml(new Date(item.trackerInfo.leakedDate).toLocaleDateString())}</p>` : ''}
                            ${item.trackerInfo.recordingDate ? `<p><strong style="color: var(--foreground);">Recording Date:</strong> ${escapeHtml(new Date(item.trackerInfo.recordingDate).toLocaleDateString())}</p>` : ''}
                        </div>
                        
                        ${
                            item.trackerInfo.description
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Description</p>
                                <p style="font-size: 0.85rem; line-height: 1.6;">${escapeHtml(item.trackerInfo.description)}</p>
                            </div>
                        `
                                : ''
                        }
                        
                        ${
                            item.trackerInfo.notes
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Notes</p>
                                <p style="font-size: 0.85rem; line-height: 1.6;">${escapeHtml(item.trackerInfo.notes)}</p>
                            </div>
                        `
                                : ''
                        }
                        
                        ${
                            item.trackerInfo.sourceUrl
                                ? `
                            <div style="margin-top: 1rem;">
                                <p style="margin-bottom: 0.5rem;"><strong style="color: var(--foreground);">Source URL:</strong></p>
                                <a href="${escapeHtml(item.trackerInfo.sourceUrl)}" target="_blank" style="color: var(--primary); word-break: break-all; font-size: 0.85rem; display: block; padding: 0.5rem; background: var(--accent); border-radius: 6px; text-decoration: none;">
                                    ${escapeHtml(item.trackerInfo.sourceUrl)}
                                </a>
                            </div>
                        `
                                : ''
                        }
                        
                        ${item.id ? `<p style="margin-top: 1rem; font-size: 0.8rem; color: var(--muted);"><strong>Track ID:</strong> ${escapeHtml(item.id)}</p>` : ''}
                    </div>
                    <button class="btn-primary track-info-close-btn" style="margin-top: 1.5rem; width: 100%;">Close</button>
                </div>
            `;
        } else {
            // Detailed normal track info
            const releaseDate = item.album?.releaseDate || item.streamStartDate;
            const dateDisplay = releaseDate ? new Date(releaseDate).toLocaleDateString() : 'Unknown';
            const quality = item.audioQuality || 'Unknown';
            const bitrate = item.bitrate ? `${item.bitrate} kbps` : '';
            const mediaTags = Array.isArray(item.mediaMetadata?.tags) ? item.mediaMetadata.tags : [];
            const audioModes = Array.isArray(item.audioModes) ? item.audioModes : [];
            const showFullHifiMetadata = hifiVisualSettings.showsFullMetadata();

            const normalizedPayload = {
                id: item.id,
                title: item.title,
                duration: item.duration,
                replayGain: item.replayGain,
                peak: item.peak,
                allowStreaming: item.allowStreaming,
                streamReady: item.streamReady,
                payToStream: item.payToStream,
                adSupportedStreamReady: item.adSupportedStreamReady,
                djReady: item.djReady,
                stemReady: item.stemReady,
                streamStartDate: item.streamStartDate,
                premiumStreamingOnly: item.premiumStreamingOnly,
                trackNumber: item.trackNumber,
                volumeNumber: item.volumeNumber,
                discNumber: item.discNumber,
                version: item.version,
                popularity: item.popularity,
                copyright: item.copyright,
                bpm: item.bpm,
                key: item.key,
                keyScale: item.keyScale,
                url: item.url,
                isrc: item.isrc,
                editable: item.editable,
                explicit: item.explicit,
                audioQuality: item.audioQuality,
                audioModes: item.audioModes,
                mediaMetadata: item.mediaMetadata,
                upload: item.upload,
                accessType: item.accessType,
                spotlighted: item.spotlighted,
                mixes: item.mixes,
                artists: item.artists,
                album: item.album,
                info: item.info,
            };

            infoHTML = `
                <div style="padding: 1.5rem; max-width: 500px; max-height: 80vh; overflow-y: auto;">
                    <h3 style="margin-bottom: 1rem; font-size: 1.3rem; font-weight: 600;">${escapeHtml(item.title)}</h3>
                    <div style="color: var(--muted-foreground); font-size: 0.9rem; line-height: 1.8;">
                        <div style="display: grid; gap: 0.5rem;">
                            <p><strong style="color: var(--foreground);">Artist:</strong> ${escapeHtml(getTrackArtists(item))}</p>
                            <p><strong style="color: var(--foreground);">Album:</strong> ${escapeHtml(item.album?.title || 'Unknown')}</p>
                            ${item.album?.artist?.name ? `<p><strong style="color: var(--foreground);">Album Artist:</strong> ${escapeHtml(item.album.artist.name)}</p>` : ''}
                            <p><strong style="color: var(--foreground);">Release Date:</strong> ${escapeHtml(dateDisplay)}</p>
                            <p><strong style="color: var(--foreground);">Duration:</strong> ${escapeHtml(formatTime(item.duration))}</p>
                            ${item.trackNumber ? `<p><strong style="color: var(--foreground);">Track Number:</strong> ${escapeHtml(String(item.trackNumber))}</p>` : ''}
                            ${item.discNumber ? `<p><strong style="color: var(--foreground);">Disc Number:</strong> ${escapeHtml(String(item.discNumber))}</p>` : ''}
                            ${item.version ? `<p><strong style="color: var(--foreground);">Version:</strong> ${escapeHtml(item.version)}</p>` : ''}
                            ${item.explicit ? `<p><strong style="color: var(--foreground);">Explicit:</strong> Yes</p>` : ''}
                            <p><strong style="color: var(--foreground);">Quality:</strong> ${escapeHtml(quality)} ${bitrate ? `(${escapeHtml(bitrate)})` : ''}</p>
                            ${audioModes.length > 0 ? `<p><strong style="color: var(--foreground);">Audio Modes:</strong> ${escapeHtml(audioModes.join(', '))}</p>` : ''}
                            ${mediaTags.length > 0 ? `<p><strong style="color: var(--foreground);">Media Tags:</strong> ${escapeHtml(mediaTags.join(', '))}</p>` : ''}
                            ${item.isrc ? `<p><strong style="color: var(--foreground);">ISRC:</strong> ${escapeHtml(item.isrc)}</p>` : ''}
                            ${item.replayGain != null ? `<p><strong style="color: var(--foreground);">Replay Gain:</strong> ${escapeHtml(String(item.replayGain))}</p>` : ''}
                            ${item.peak != null ? `<p><strong style="color: var(--foreground);">Peak:</strong> ${escapeHtml(String(item.peak))}</p>` : ''}
                            ${item.album?.vibrantColor ? `<p><strong style="color: var(--foreground);">Vibrant Color:</strong> ${escapeHtml(item.album.vibrantColor)}</p>` : ''}
                            ${item.album?.videoCover ? `<p><strong style="color: var(--foreground);">Video Cover:</strong> ${escapeHtml(String(item.album.videoCover))}</p>` : ''}
                        </div>
                        
                        ${
                            item.credits && item.credits.length > 0
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Credits</p>
                                <div style="font-size: 0.85rem; line-height: 1.6;">
                                    ${item.credits.map((c) => `<p>${escapeHtml(c.type)}: ${escapeHtml(c.name)}</p>`).join('')}
                                </div>
                            </div>
                        `
                                : ''
                        }
                        
                        ${
                            item.composers && item.composers.length > 0
                                ? `
                            <p style="margin-top: 0.5rem;"><strong style="color: var(--foreground);">Composers:</strong> ${escapeHtml(item.composers.map((c) => c.name).join(', '))}</p>
                        `
                                : ''
                        }
                        
                        ${
                            item.lyrics?.text
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Has Lyrics</p>
                            </div>
                        `
                                : ''
                        }
                        
                        ${item.id ? `<p style="margin-top: 1rem; font-size: 0.8rem; color: var(--muted);"><strong>Track ID:</strong> ${escapeHtml(item.id)}</p>` : ''}
                        ${item.album?.id ? `<p style="font-size: 0.8rem; color: var(--muted);"><strong>Album ID:</strong> ${escapeHtml(item.album.id)}</p>` : ''}

                        ${
                            showFullHifiMetadata
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Full HiFi Metadata</p>
                                <pre style="margin: 0; font-size: 0.75rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word; color: var(--foreground);">${escapeHtml(
                                    JSON.stringify(normalizedPayload, null, 2)
                                )}</pre>
                            </div>
                        `
                                : ''
                        }
                    </div>
                    <button class="btn-primary track-info-close-btn" style="margin-top: 1.5rem; width: 100%;">Close</button>
                </div>
            `;
        }

        // Create and show modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText =
            'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        modal.innerHTML = infoHTML;
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
        const closeBtn = modal.querySelector('.track-info-close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => modal.remove();
        }
        document.body.appendChild(modal);
    } else if (action === 'open-original-url') {
        // Open the original source URL for the track
        let url = null;

        if (item.isTracker && item.trackerInfo && item.trackerInfo.sourceUrl) {
            url = item.trackerInfo.sourceUrl;
        } else if (item.remoteUrl) {
            url = item.remoteUrl;
        }

        if (url) {
            window.open(url, '_blank');
        } else {
            showNotification('No original URL available for this track.');
        }
    } else if (action === 'block-track') {
        const { contentBlockingSettings } = await import('./storage.js');
        if (contentBlockingSettings.isTrackBlocked(item.id)) {
            contentBlockingSettings.unblockTrack(item.id);
            showNotification(`Unblocked track: ${item.title}`);
        } else {
            contentBlockingSettings.blockTrack(item);
            showNotification(`Blocked track: ${item.title}`);
        }
    } else if (action === 'block-album') {
        const { contentBlockingSettings } = await import('./storage.js');
        const albumId = type === 'album' ? item.id : item.album?.id;
        const albumTitle = type === 'album' ? item.title : item.album?.title;
        const albumArtist = type === 'album' ? item.artist : item.album?.artist;

        if (!albumId) {
            showNotification('No album information available');
            return;
        }

        const albumObj = { id: albumId, title: albumTitle, artist: albumArtist };

        if (contentBlockingSettings.isAlbumBlocked(albumId)) {
            contentBlockingSettings.unblockAlbum(albumId);
            showNotification(`Unblocked album: ${albumTitle || 'Unknown Album'}`);
        } else {
            contentBlockingSettings.blockAlbum(albumObj);
            showNotification(`Blocked album: ${albumTitle || 'Unknown Album'}`);
        }
    } else if (action === 'block-artist') {
        const { contentBlockingSettings } = await import('./storage.js');
        const artistId = item.artist?.id || item.artists?.[0]?.id;
        const artistName = item.artist?.name || item.artists?.[0]?.name || item.name;

        if (!artistId) {
            showNotification('No artist information available');
            return;
        }

        const artistObj = { id: artistId, name: artistName };

        if (contentBlockingSettings.isArtistBlocked(artistId)) {
            contentBlockingSettings.unblockArtist(artistId);
            showNotification(`Unblocked artist: ${artistName || 'Unknown Artist'}`);
        } else {
            contentBlockingSettings.blockArtist(artistObj);
            showNotification(`Blocked artist: ${artistName || 'Unknown Artist'}`);
        }
    }
}

async function updateContextMenuLikeState(contextMenu, contextTrack) {
    if (!contextMenu || !contextTrack) return;

    const type = contextMenu._contextType || 'track';
    const favoriteType = type === 'user-playlist' ? 'playlist' : type;
    const favoriteKey =
        favoriteType === 'playlist'
            ? contextTrack.uuid || contextTrack.id
            : favoriteType === 'track'
              ? contextTrack.id || contextTrack.trackId || contextTrack.uuid || contextTrack.isrc
              : contextTrack.id || contextTrack.uuid;

    const likeItem = contextMenu.querySelector('li[data-action="toggle-like"]');
    let isLiked = false;
    if (likeItem) {
        if (favoriteType && favoriteKey) {
            isLiked = await db.isFavorite(favoriteType, favoriteKey);
        }
        likeItem.classList.toggle('is-active-like', isLiked);

        if (isLiked) {
            likeItem.textContent = favoriteType === 'track' ? 'Unlike' : 'Remove from library';
        }
    }

    const pinItem = contextMenu.querySelector('li[data-action="toggle-pin"]');
    if (pinItem) {
        const isPinned = await db.isPinned(contextTrack.id || contextTrack.uuid);
        pinItem.textContent = isPinned ? 'Unpin' : 'Pin';
    }

    const trackMixItem = contextMenu.querySelector('li[data-action="track-mix"]');
    if (trackMixItem) {
        const hasMix = contextTrack.mixes && contextTrack.mixes.TRACK_MIX;
        trackMixItem.style.display = hasMix ? 'block' : 'none';
    }

    // Show/hide "Open Original URL" only for unreleased/tracker tracks
    const openOriginalUrlItem = contextMenu.querySelector('li[data-action="open-original-url"]');
    if (openOriginalUrlItem) {
        const isUnreleased = contextTrack.isTracker || (contextTrack.trackerInfo && contextTrack.trackerInfo.sourceUrl);
        openOriginalUrlItem.style.display = isUnreleased ? 'block' : 'none';
    }

    // Update block/unblock labels
    const { contentBlockingSettings } = await import('./storage.js');

    const blockTrackItem = contextMenu.querySelector('li[data-action="block-track"]');
    if (blockTrackItem) {
        const isBlocked = contentBlockingSettings.isTrackBlocked(contextTrack.id);
        blockTrackItem.textContent = isBlocked
            ? blockTrackItem.dataset.labelUnblock || 'Unblock track'
            : blockTrackItem.dataset.labelBlock || 'Block track';
    }

    const blockAlbumItem = contextMenu.querySelector('li[data-action="block-album"]');
    if (blockAlbumItem) {
        const albumId = type === 'album' ? contextTrack.id : contextTrack.album?.id;
        const isBlocked = albumId ? contentBlockingSettings.isAlbumBlocked(albumId) : false;
        blockAlbumItem.textContent = isBlocked
            ? blockAlbumItem.dataset.labelUnblock || 'Unblock album'
            : blockAlbumItem.dataset.labelBlock || 'Block album';
    }

    const blockArtistItem = contextMenu.querySelector('li[data-action="block-artist"]');
    if (blockArtistItem) {
        const artistId = contextTrack.artist?.id || contextTrack.artists?.[0]?.id;
        const isBlocked = artistId ? contentBlockingSettings.isArtistBlocked(artistId) : false;
        blockArtistItem.textContent = isBlocked
            ? blockArtistItem.dataset.labelUnblock || 'Unblock artist'
            : blockArtistItem.dataset.labelBlock || 'Block artist';
    }

    // Filter items based on type
    contextMenu.querySelectorAll('li[data-action]').forEach((item) => {
        const filter = item.dataset.typeFilter;
        if (filter) {
            const types = filter.split(',');
            item.style.display = types.includes(type) ? 'block' : 'none';
        } else {
            item.style.display = 'block';
        }

        // Update labels for Like/Save
        if (item.dataset.action === 'toggle-like') {
            if (!isLiked) {
                const normalizedType = type.replace('user-playlist', 'playlist');
                const labelKey = `label${normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)}`;
                const label = item.dataset[labelKey] || item.dataset.labelTrack || 'Like';
                item.textContent = label;
            }
        }
    });

    // Handle multiple artists for "Go to artist"
    const artistItem = contextMenu.querySelector('li[data-action="go-to-artist"]');
    if (artistItem) {
        const artists = Array.isArray(contextTrack.artists)
            ? contextTrack.artists
            : contextTrack.artist
              ? [contextTrack.artist]
              : [];
        const canShowArtist = type === 'track' || type === 'album';

        if (artists.length > 1 && canShowArtist) {
            artistItem.style.display = 'block';
            artistItem.textContent = 'Go to artists';
            artistItem.dataset.hasMultipleArtists = 'true';
        } else {
            const hasArtist = artists.length > 0;
            artistItem.style.display = hasArtist && canShowArtist ? 'block' : 'none';
            artistItem.dataset.hasMultipleArtists = 'false';
            artistItem.textContent = artists.length > 1 ? 'Go to artists' : 'Go to artist';
            delete artistItem.dataset.artistId;
            delete artistItem.dataset.trackerSheetId;
        }
    }
}

export function initializeTrackInteractions(player, api, mainContent, contextMenu, lyricsManager, ui, scrobbler) {
    let contextTrack = null;

    mainContent.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('.track-action-btn, .like-btn, .play-btn');
        if (actionBtn && actionBtn.dataset.action) {
            e.preventDefault(); // Prevent card navigation
            e.stopPropagation();
            const itemElement = actionBtn.closest('.track-item, .card');
            const action = actionBtn.dataset.action;
            const type = actionBtn.dataset.type || 'track';

            let item = itemElement ? trackDataStore.get(itemElement) : trackDataStore.get(actionBtn);

            // If no item from element (e.g. header buttons), try to get from hash
            if (!item && action === 'toggle-like') {
                const id = window.location.pathname.split('/')[2];
                if (id) {
                    try {
                        if (type === 'album') {
                            const data = await api.getAlbum(id);
                            item = data.album;
                        } else if (type === 'artist') {
                            item = await api.getArtist(id);
                        } else if (type === 'playlist') {
                            const data = await api.getPlaylist(id);
                            item = data.playlist;
                        } else if (type === 'mix') {
                            const data = await api.getMix(id);
                            item = data.mix;
                        } else if (type === 'track') {
                            const data = await api.getTrack(id);
                            item = data.track;
                        }
                    } catch (err) {
                        console.error(err);
                    }
                }
            }

            if (item) {
                await handleTrackAction(action, item, player, api, lyricsManager, type, ui, scrobbler);
            }
            return;
        }

        const cardMenuBtn = e.target.closest('.card-menu-btn');
        if (cardMenuBtn) {
            e.stopPropagation();
            const card = cardMenuBtn.closest('.card');
            const type = cardMenuBtn.dataset.type;
            const id = cardMenuBtn.dataset.id;

            let item = card ? trackDataStore.get(card) : null;

            if (!item) {
                // Fallback: create a shell item
                item = { id, uuid: id, title: card.querySelector('.card-title')?.textContent || 'Item' };
            }

            if (contextMenu._originalHTML) {
                contextMenu.innerHTML = contextMenu._originalHTML;
                contextMenu._originalHTML = null;
            }

            contextTrack = item;
            contextMenu._contextTrack = item;
            contextMenu._contextType = type;

            await updateContextMenuLikeState(contextMenu, item);
            const rect = cardMenuBtn.getBoundingClientRect();
            positionMenu(contextMenu, rect.left, rect.bottom + 5, rect);
            return;
        }

        const menuBtn = e.target.closest('.track-menu-btn');
        if (menuBtn) {
            e.stopPropagation();
            const trackItem = menuBtn.closest('.track-item');
            if (trackItem && !trackItem.dataset.queueIndex) {
                const clickedTrack = trackDataStore.get(trackItem);

                if (clickedTrack && clickedTrack.isLocal) return;

                if (
                    contextMenu.style.display === 'block' &&
                    contextTrack &&
                    clickedTrack &&
                    contextTrack.id === clickedTrack.id
                ) {
                    if (contextMenu._originalHTML) {
                        contextMenu.innerHTML = contextMenu._originalHTML;
                    }
                    contextMenu.style.display = 'none';
                    contextMenu._contextType = null;
                    contextMenu._originalHTML = null;
                    return;
                }

                contextTrack = clickedTrack;
                if (contextTrack) {
                    if (contextMenu._originalHTML) {
                        contextMenu.innerHTML = contextMenu._originalHTML;
                        contextMenu._originalHTML = null;
                    }
                    contextMenu._contextTrack = contextTrack;
                    contextMenu._contextType = 'track';
                    await updateContextMenuLikeState(contextMenu, contextTrack);
                    const rect = menuBtn.getBoundingClientRect();
                    positionMenu(contextMenu, rect.left, rect.bottom + 5, rect);
                }
            }
            return;
        }

        const trackItem = e.target.closest('.track-item');
        if (trackItem && (trackItem.classList.contains('unavailable') || trackItem.classList.contains('blocked'))) {
            return;
        }
        if (
            trackItem &&
            !trackItem.dataset.queueIndex &&
            !e.target.closest('.remove-from-playlist-btn') &&
            !e.target.closest('.artist-link')
        ) {
            const parentList = trackItem.closest('.track-list');
            const allTrackElements = Array.from(parentList.querySelectorAll('.track-item'));
            const indexedTracks = allTrackElements
                .map((el, index) => ({ el, index, track: trackDataStore.get(el) }))
                .filter((entry) => Boolean(entry.track));
            const trackList = indexedTracks.map((entry) => entry.track);

            if (trackList.length > 0) {
                // Use the clicked row position, not just track id, so duplicate songs
                // in history/lists don't all resolve to the first occurrence.
                const clickedEntry = indexedTracks.find((entry) => entry.el === trackItem);
                const startIndex = clickedEntry ? indexedTracks.indexOf(clickedEntry) : 0;

                player._activeTrackElement = trackItem;
                player.setQueue(trackList, startIndex);
                document.getElementById('shuffle-btn').classList.remove('active');
                player.playTrackFromQueue();
            }
        }

        // Handle artist link clicks in track lists
        const artistLink = e.target.closest('.artist-link');
        if (artistLink) {
            e.stopPropagation();
            const artistId = artistLink.dataset.artistId;
            const trackerSheetId = artistLink.dataset.trackerSheetId;
            if (trackerSheetId) {
                navigate(`/unreleased/${trackerSheetId}`);
            } else if (artistId) {
                navigate(`/artist/${artistId}`);
            } else {
                // Addon tracks have no artist id on search results - resolve by name
                const name = artistLink.textContent.trim();
                if (name) {
                    try {
                        const resolvedId = await ui.api.resolveArtistIdByName(name);
                        if (resolvedId) navigate(`/artist/${resolvedId}`);
                    } catch (resolveError) {
                        console.warn('Failed to resolve artist by name:', name, resolveError);
                    }
                }
            }
            return;
        }

        const card = e.target.closest('.card');
        if (card) {
            // Don't navigate if card is blocked (unless clicking menu button)
            if (card.classList.contains('blocked') && !e.target.closest('.card-menu-btn')) {
                return;
            }

            if (e.target.closest('.edit-playlist-btn') || e.target.closest('.delete-playlist-btn')) {
                return;
            }

            const href = card.dataset.href;
            if (href) {
                // Allow native links inside card to work if any exist
                if (e.target.closest('a')) return;

                e.preventDefault();
                navigate(href);
            }
        }
    });

    mainContent.addEventListener('contextmenu', async (e) => {
        const trackItem = e.target.closest('.track-item, .queue-track-item');
        const card = e.target.closest('.card');

        if (trackItem) {
            e.preventDefault();
            if (trackItem.classList.contains('queue-track-item')) {
                // For queue items, get track from player's queue
                const queueIndex = parseInt(trackItem.dataset.queueIndex);
                contextTrack = player.getCurrentQueue()[queueIndex];
            } else {
                // For regular track items
                contextTrack = trackDataStore.get(trackItem);
            }

            if (contextTrack) {
                if (contextTrack.isLocal) return;

                if (contextMenu._originalHTML) {
                    contextMenu.innerHTML = contextMenu._originalHTML;
                    contextMenu._originalHTML = null;
                }

                // Hide actions for unavailable tracks
                const unavailableActions = ['play-next', 'add-to-queue', 'download', 'track-mix'];
                contextMenu.querySelectorAll('[data-action]').forEach((btn) => {
                    if (unavailableActions.includes(btn.dataset.action)) {
                        btn.style.display = contextTrack.isUnavailable ? 'none' : 'block';
                    }
                });

                contextMenu._contextTrack = contextTrack;
                contextMenu._contextType = 'track';
                await updateContextMenuLikeState(contextMenu, contextTrack);
                positionMenu(contextMenu, e.clientX, e.clientY);
            }
        } else if (card) {
            e.preventDefault();
            const type = card.dataset.albumId
                ? 'album'
                : card.dataset.playlistId
                  ? 'playlist'
                  : card.dataset.mixId
                    ? 'mix'
                    : card.dataset.href
                      ? card.dataset.href.split('/')[1]
                      : 'item';
            const id = card.dataset.albumId || card.dataset.playlistId || card.dataset.mixId;

            const item = trackDataStore.get(card) || {
                id,
                uuid: id,
                title: card.querySelector('.card-title')?.textContent,
            };

            if (contextMenu._originalHTML) {
                contextMenu.innerHTML = contextMenu._originalHTML;
                contextMenu._originalHTML = null;
            }

            contextTrack = item;
            contextMenu._contextTrack = item;
            contextMenu._contextType = type.replace('userplaylist', 'user-playlist');
            contextMenu._contextHref = card.dataset.href;

            await updateContextMenuLikeState(contextMenu, item);
            positionMenu(contextMenu, e.clientX, e.clientY);
        }
    });

    document.addEventListener('click', () => {
        if (contextMenu.style.display === 'block') {
            if (contextMenu._originalHTML) {
                contextMenu.innerHTML = contextMenu._originalHTML;
            }
            contextMenu.style.display = 'none';
            contextMenu._contextType = null;
            contextMenu._originalHTML = null;
        }
    });

    contextMenu.addEventListener('click', async (e) => {
        e.stopPropagation();
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const track = contextMenu._contextTrack || contextTrack;
        const type = contextMenu._contextType || 'track';

        if (action === 'go-to-artists' || (action === 'go-to-artist' && target.dataset.hasMultipleArtists === 'true')) {
            const artists = Array.isArray(track.artists) ? track.artists : track.artist ? [track.artist] : [];
            if (artists.length > 1) {
                // Save original HTML if not already saved
                if (!contextMenu._originalHTML) {
                    contextMenu._originalHTML = contextMenu.innerHTML;
                }

                // Render sub-menu
                let subMenuHTML =
                    '<li data-action="back-to-main-menu" style="font-weight: bold; border-bottom: 1px solid var(--border); margin-bottom: 0.5rem; padding: 0.75rem 1rem; cursor: pointer;">← Back</li>';
                artists.forEach((artist) => {
                    subMenuHTML += `<li data-action="go-to-artist" data-artist-id="${artist.id}" style="padding: 0.75rem 1rem; cursor: pointer;">${escapeHtml(artist.name || 'Unknown Artist')}</li>`;
                });
                contextMenu.innerHTML = `<ul>${subMenuHTML}</ul>`;
                return;
            }
        }

        if (action === 'back-to-main-menu') {
            if (contextMenu._originalHTML) {
                contextMenu.innerHTML = contextMenu._originalHTML;
                contextMenu._originalHTML = null;
                // Re-update like state since we replaced the HTML
                await updateContextMenuLikeState(contextMenu, track);
            }
            return;
        }

        if (action && track) {
            await handleTrackAction(action, track, player, api, lyricsManager, type, ui, scrobbler, target.dataset);
        }

        // Reset menu state before closing
        if (contextMenu._originalHTML) {
            contextMenu.innerHTML = contextMenu._originalHTML;
            contextMenu._originalHTML = null;
        }
        contextMenu.style.display = 'none';
        contextMenu._contextType = null;
    });

    // Now playing bar interactions
    document.querySelector('.now-playing-bar .title').addEventListener('click', () => {
        const track = player.currentTrack;
        if (track?.album?.id) {
            navigate(`/album/${track.album.id}`);
        }
    });

    document.querySelector('.now-playing-bar .album').addEventListener('click', () => {
        const track = player.currentTrack;
        if (track?.album?.id) {
            navigate(`/album/${track.album.id}`);
        }
    });

    document.querySelector('.now-playing-bar .artist').addEventListener('click', (e) => {
        const link = e.target.closest('.artist-link');
        if (link) {
            e.stopPropagation();
            const artistId = link.dataset.artistId;
            const trackerSheetId = link.dataset.trackerSheetId;
            if (trackerSheetId) {
                // Navigate to tracker artist page
                navigate(`/unreleased/${trackerSheetId}`);
            } else if (artistId) {
                navigate(`/artist/${artistId}`);
            } else {
                // Addon tracks have no artist id on search results - resolve by name
                const name = link.textContent.trim();
                if (name) {
                    ui.api
                        .resolveArtistIdByName(name)
                        .then((resolvedId) => {
                            if (resolvedId) navigate(`/artist/${resolvedId}`);
                        })
                        .catch((err) => console.warn('Failed to resolve artist by name:', name, err));
                }
            }
            return;
        }

        // Fallback for non-link clicks (e.g. separators) or single artist legacy
        const track = player.currentTrack;
        if (track) {
            // Check if this is a tracker track
            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
            if (isTracker && track.trackerInfo?.sheetId) {
                navigate(`/unreleased/${track.trackerInfo.sheetId}`);
            } else if (track.artist?.id) {
                navigate(`/artist/${track.artist.id}`);
            } else if (track.artist?.name) {
                ui.api
                    .resolveArtistIdByName(track.artist.name)
                    .then((resolvedId) => {
                        if (resolvedId) navigate(`/artist/${resolvedId}`);
                    })
                    .catch((err) => console.warn('Failed to resolve artist by name:', track.artist.name, err));
            }
        }
    });

    const nowPlayingLikeBtn = document.getElementById('now-playing-like-btn');
    if (nowPlayingLikeBtn) {
        nowPlayingLikeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (player.currentTrack) {
                await handleTrackAction(
                    'toggle-like',
                    player.currentTrack,
                    player,
                    api,
                    lyricsManager,
                    'track',
                    ui,
                    scrobbler
                );
            }
        });
    }

    const nowPlayingMixBtn = document.getElementById('now-playing-mix-btn');
    if (nowPlayingMixBtn) {
        nowPlayingMixBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (player.currentTrack) {
                await handleTrackAction(
                    'track-mix',
                    player.currentTrack,
                    player,
                    api,
                    lyricsManager,
                    'track',
                    ui,
                    scrobbler
                );
            }
        });
    }

    const nowPlayingAddPlaylistBtn = document.getElementById('now-playing-add-playlist-btn');
    if (nowPlayingAddPlaylistBtn) {
        nowPlayingAddPlaylistBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (player.currentTrack) {
                await handleTrackAction(
                    'add-to-playlist',
                    player.currentTrack,
                    player,
                    api,
                    lyricsManager,
                    'track',
                    ui,
                    scrobbler
                );
            }
        });
    }

    // Mobile add playlist button functionality
    const mobileAddPlaylistBtn = document.getElementById('mobile-add-playlist-btn');

    if (mobileAddPlaylistBtn) {
        mobileAddPlaylistBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (player.currentTrack) {
                await handleTrackAction(
                    'add-to-playlist',
                    player.currentTrack,
                    player,
                    api,
                    lyricsManager,
                    'track',
                    ui,
                    scrobbler
                );
            }
        });
    }
}

function showSleepTimerModal(player) {
    const modal = document.getElementById('sleep-timer-modal');
    if (!modal) return;

    const closeModal = () => {
        modal.classList.remove('active');
        cleanup();
    };

    const handleOptionClick = (e) => {
        const timerOption = e.target.closest('.timer-option');
        if (timerOption) {
            let minutes;
            if (timerOption.id === 'custom-timer-btn') {
                const customInput = document.getElementById('custom-minutes');
                minutes = parseInt(customInput.value);
                if (!minutes || minutes < 1) {
                    showNotification('Please enter a valid number of minutes');
                    return;
                }
            } else {
                minutes = parseInt(timerOption.dataset.minutes);
            }

            if (minutes) {
                player.setSleepTimer(minutes);
                showNotification(`Sleep timer set for ${minutes} minute${minutes === 1 ? '' : 's'}`);
                closeModal();
            }
        }
    };

    const handleCancel = (e) => {
        if (e.target.id === 'cancel-sleep-timer' || e.target.classList.contains('modal-overlay')) {
            closeModal();
        }
    };

    const cleanup = () => {
        modal.removeEventListener('click', handleOptionClick);
        modal.removeEventListener('click', handleCancel);
    };

    modal.addEventListener('click', handleOptionClick);
    modal.addEventListener('click', handleCancel);

    modal.classList.add('active');
}
