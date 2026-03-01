//js/app.js
import { MusicAPI } from './music-api.js';
import {
    apiSettings,
    themeManager,
    nowPlayingSettings,
    downloadQualitySettings,
    sidebarSettings,
    pwaUpdateSettings,
    modalSettings,
    rotatingCoverSettings,
} from './storage.js';
import { UIRenderer } from './ui.js';
import { Player } from './player.js';
import { MultiScrobbler } from './multi-scrobbler.js';
import { LyricsManager, openLyricsPanel, clearLyricsPanelSync } from './lyrics.js';
import { createRouter, updateTabTitle, navigate } from './router.js';
import { initializePlayerEvents, initializeTrackInteractions, handleTrackAction } from './events.js';
import { initializeUIInteractions } from './ui-interactions.js';
import { debounce, SVG_PLAY, getShareUrl } from './utils.js';
import { SearchEngine } from './search-engine.js';
import { storage } from './lib/appwrite.js';
import { ID } from 'appwrite';
import { sidePanelManager } from './side-panel.js';
import { db } from './db.js';
import { authManager } from './accounts/auth.js';
import { syncManager } from './accounts/appwrite-sync.js';
import { client } from './lib/appwrite.js';
import { registerSW } from 'virtual:pwa-register';
import './smooth-scrolling.js';
import { openEditProfile } from './profile.js';

import { initTracker } from './tracker.js';

import { parseCSV, parseJSPF, parseXSPF, parseXML, parseM3U } from './playlist-importer.js';

// Lazy-loaded modules
let settingsModule = null;
let downloadsModule = null;
let metadataModule = null;

async function loadSettingsModule() {
    if (!settingsModule) {
        settingsModule = await import('./settings.js');
    }
    return settingsModule;
}

async function loadDownloadsModule() {
    if (!downloadsModule) {
        downloadsModule = await import('./downloads.js');
    }
    return downloadsModule;
}

async function loadMetadataModule() {
    if (!metadataModule) {
        metadataModule = await import('./metadata.js');
    }
    return metadataModule;
}

function initializeCasting(audioPlayer, castBtn) {
    if (!castBtn) return;

    if ('remote' in audioPlayer) {
        audioPlayer.remote
            .watchAvailability((available) => {
                if (available) {
                    castBtn.style.display = 'flex';
                    castBtn.classList.add('available');
                }
            })
            .catch((err) => {
                console.log('Remote playback not available:', err);
                if (window.innerWidth > 768) {
                    castBtn.style.display = 'flex';
                }
            });

        castBtn.addEventListener('click', () => {
            if (!audioPlayer.src) {
                alert('Please play a track first to enable casting.');
                return;
            }
            audioPlayer.remote.prompt().catch((err) => {
                if (err.name === 'NotAllowedError') return;
                if (err.name === 'NotFoundError') {
                    alert('No remote playback devices (Chromecast/AirPlay) were found on your network.');
                    return;
                }
                console.log('Cast prompt error:', err);
            });
        });

        audioPlayer.addEventListener('playing', () => {
            if (audioPlayer.remote && audioPlayer.remote.state === 'connected') {
                castBtn.classList.add('connected');
            }
        });

        audioPlayer.addEventListener('pause', () => {
            if (audioPlayer.remote && audioPlayer.remote.state === 'disconnected') {
                castBtn.classList.remove('connected');
            }
        });
    } else if (audioPlayer.webkitShowPlaybackTargetPicker) {
        castBtn.style.display = 'flex';
        castBtn.classList.add('available');

        castBtn.addEventListener('click', () => {
            audioPlayer.webkitShowPlaybackTargetPicker();
        });

        audioPlayer.addEventListener('webkitplaybacktargetavailabilitychanged', (e) => {
            if (e.availability === 'available') {
                castBtn.classList.add('available');
            }
        });

        audioPlayer.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => {
            if (audioPlayer.webkitCurrentPlaybackTargetIsWireless) {
                castBtn.classList.add('connected');
            } else {
                castBtn.classList.remove('connected');
            }
        });
    } else if (window.innerWidth > 768) {
        castBtn.style.display = 'flex';
        castBtn.addEventListener('click', () => {
            alert('Casting is not supported in this browser. Try Chrome for Chromecast or Safari for AirPlay.');
        });
    }
}

function initializeKeyboardShortcuts(player, audioPlayer) {
    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, textarea')) return;

        switch (e.key.toLowerCase()) {
            case ' ':
                e.preventDefault();
                player.handlePlayPause();
                break;
            case 'arrowright':
                if (e.shiftKey) {
                    player.playNext();
                } else {
                    audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 10);
                }
                break;
            case 'arrowleft':
                if (e.shiftKey) {
                    player.playPrev();
                } else {
                    audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
                }
                break;
            case 'arrowup':
                e.preventDefault();
                player.setVolume(player.userVolume + 0.1);
                break;
            case 'arrowdown':
                e.preventDefault();
                player.setVolume(player.userVolume - 0.1);
                break;
            case 'm':
                audioPlayer.muted = !audioPlayer.muted;
                break;
            case 's':
                document.getElementById('shuffle-btn')?.click();
                break;
            case 'r':
                document.getElementById('repeat-btn')?.click();
                break;
            case 'q':
                document.getElementById('queue-btn')?.click();
                break;
            case '/':
                e.preventDefault();
                document.getElementById('search-input')?.focus();
                break;
            case 'escape':
                document.getElementById('search-input')?.blur();
                sidePanelManager.close();
                clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
                break;
            case 'l':
                document.querySelector('.now-playing-bar .cover')?.click();
                break;
        }
    });
}

function showOfflineNotification() {
    const notification = document.createElement('div');
    notification.className = 'offline-notification';
    notification.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>You are offline. Some features may not work.</span>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slide-out 0.3s ease forwards';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

function hideOfflineNotification() {
    const notification = document.querySelector('.offline-notification');
    if (notification) {
        notification.style.animation = 'slide-out 0.3s ease forwards';
        setTimeout(() => notification.remove(), 300);
    }
}

async function disablePwaForAuthGate() {
    if (!('serviceWorker' in navigator)) return;

    try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (error) {
        console.warn('Failed to unregister service workers:', error);
    }

    if ('caches' in window) {
        try {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((key) => caches.delete(key)));
        } catch (error) {
            console.warn('Failed to clear caches:', error);
        }
    }
}

async function uploadCoverImage(file) {
    try {
        const BUCKET_ID = 'profile-images';
        const fileId = ID.unique();

        console.log('[App] Uploading playlist cover to Appwrite Storage...');
        const result = await storage.createFile(BUCKET_ID, fileId, file);

        // Construct the view URL
        const endpoint = 'https://sgp.cloud.appwrite.io/v1';
        const projectId = 'monochrome-plus';
        const publicUrl = `${endpoint}/storage/buckets/${BUCKET_ID}/files/${result.$id}/view?project=${projectId}`;

        console.log('[App] Upload successful! URL:', publicUrl);
        return publicUrl;
    } catch (error) {
        console.error('[App] Upload failed:', error);
        throw error;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Ping Appwrite to verify setup
    client
        .ping()
        .then(() => console.log('[Appwrite] Connected'))
        .catch((err) => console.error('[Appwrite] Connection failed', err));

    // Wait for Auth initialization
    console.log('[Appwrite] Waiting for Auth initialization...');
    await authManager.initialized;
    console.log(
        '[Appwrite] Auth initialized. User:',
        authManager.user ? authManager.user.email || authManager.user.name : 'Guest'
    );

    // Ensure Auth UI is updated
    authManager.updateUI(authManager.user);

    // Preload profile data on app load if user is logged in
    if (authManager.user) {
        syncManager.getUserData().catch(() => {});
    }

    // Apply carousel mode on initial load
    const { responsiveSettings } = await import('./storage.js');
    if (responsiveSettings.isCarouselMode()) {
        document.documentElement.classList.add('carousel-mode');
    }

    const api = new MusicAPI(apiSettings);
    const audioPlayer = document.getElementById('audio-player');

    // i love ios and macos!!!! webkit fucking SUCKS BULLSHIT sorry ios/macos heads yall getting lossless only
    // Use window.__IS_IOS__ (set before UA spoof in index.html) so detection works on real iOS.
    const isIOS = typeof window !== 'undefined' && window.__IS_IOS__ === true;
    const ua = navigator.userAgent.toLowerCase();
    const isSafari =
        ua.includes('safari') && !ua.includes('chrome') && !ua.includes('crios') && !ua.includes('android');

    if (isIOS || isSafari) {
        const qualitySelect = document.getElementById('streaming-quality-setting');
        const downloadSelect = document.getElementById('download-quality-setting');

        const removeHiRes = (select) => {
            if (!select) return;
            const option = select.querySelector('option[value="HI_RES_LOSSLESS"]');
            if (option) option.remove();
        };

        removeHiRes(qualitySelect);
        removeHiRes(downloadSelect);

        const currentQualitySetting = localStorage.getItem('playback-quality');
        if (!currentQualitySetting || currentQualitySetting === 'HI_RES_LOSSLESS') {
            localStorage.setItem('playback-quality', 'LOSSLESS');
        }
    }

    const currentQuality = localStorage.getItem('playback-quality') || 'HI_RES_LOSSLESS';
    const player = new Player(audioPlayer, api, currentQuality);
    window.monochromePlayer = player;

    // Detect LDAC hint and suggest Lossless settings
    const checkLdacSupport = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const hasLdac = devices.some((d) => d.kind === 'audiooutput' && d.label.toLowerCase().includes('ldac'));
            if (hasLdac) {
                const { audioProcessingSettings } = await import('./storage.js');
                if (!audioProcessingSettings.isPure()) {
                    console.log('[LDAC/Lossless] LDAC device detected. Showing recommendation.');
                    const { showNotification } = await loadDownloadsModule();
                    showNotification(
                        'LDAC device detected! Consider enabling Pure Mode in Audio Settings for bit-perfect output.'
                    );
                }
            }
        } catch (err) {
            console.warn('[LDAC/Lossless] Device check failed:', err);
        }
    };

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', checkLdacSupport);
    }
    setTimeout(checkLdacSupport, 2000);

    // Prevent Android Chrome from throttling audio processing via background tab
    let swPingInterval;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            swPingInterval = setInterval(() => {
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: 'KEEPALIVE_PING' });
                }
            }, 10000);

            // Re-assert media session to prevent suspension
            if (player.currentTrack && navigator.mediaSession) {
                navigator.mediaSession.playbackState = player.audio.paused ? 'paused' : 'playing';
            }
        } else {
            clearInterval(swPingInterval);
        }
    });

    // Initialize tracker
    initTracker(player);

    // Linux Media Keys Fix
    if (window.NL_MODE) {
        import('./desktop/neutralino-bridge.js').then(({ events }) => {
            events.on('mediaNext', () => player.playNext());
            events.on('mediaPrevious', () => player.playPrev());
            events.on('mediaPlayPause', () => player.handlePlayPause());
            events.on('mediaStop', () => {
                player.audio.pause();
                player.audio.currentTime = 0;
            });
            console.log('Media keys initialized via bridge');
        });
    }

    // Initialize desktop features if in Neutralino mode
    if (
        typeof window !== 'undefined' &&
        (window.NL_MODE ||
            window.location.search.includes('mode=neutralino') ||
            window.location.search.includes('nl_port='))
    ) {
        window.NL_MODE = true;
        try {
            const desktopModule = await import('./desktop/desktop.js');
            await desktopModule.initDesktop(player);
        } catch (err) {
            console.error('Failed to load desktop module:', err);
        }
    }

    const castBtn = document.getElementById('cast-btn');
    initializeCasting(audioPlayer, castBtn);

    const ui = new UIRenderer(api, player);
    const scrobbler = new MultiScrobbler();
    const lyricsManager = new LyricsManager(api);

    // Check browser support for local files
    const selectLocalBtn = document.getElementById('select-local-folder-btn');
    const browserWarning = document.getElementById('local-browser-warning');

    if (selectLocalBtn && browserWarning) {
        const ua = navigator.userAgent;
        const isChromeOrEdge = (ua.indexOf('Chrome') > -1 || ua.indexOf('Edg') > -1) && !/Mobile|Android/.test(ua);
        const hasFileSystemApi = 'showDirectoryPicker' in window;
        const isNeutralino =
            window.NL_MODE ||
            window.location.search.includes('mode=neutralino') ||
            window.location.search.includes('nl_port=');

        if (!isNeutralino && (!isChromeOrEdge || !hasFileSystemApi)) {
            selectLocalBtn.style.display = 'none';
            browserWarning.style.display = 'block';
        } else if (isNeutralino) {
            selectLocalBtn.style.display = 'flex';
            browserWarning.style.display = 'none';
        }
    }

    // Kuroshiro is now loaded on-demand only when needed for Asian text with Romaji mode enabled

    const currentTheme = themeManager.getTheme();
    themeManager.setTheme(currentTheme);

    // Restore sidebar state
    sidebarSettings.restoreState();

    // Render pinned items
    await ui.renderPinnedItems();

    // Load settings module and initialize
    const { initializeSettings } = await loadSettingsModule();
    initializeSettings(scrobbler, player, api, ui);

    // Track sidebar navigation clicks
    document.querySelectorAll('.sidebar-nav a').forEach((link) => {
        link.addEventListener('click', () => {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('http')) {
                const item = link.querySelector('span')?.textContent || href;
            }
        });
    });

    initializePlayerEvents(player, audioPlayer, scrobbler, ui);
    initializeTrackInteractions(
        player,
        api,
        document.querySelector('.main-content'),
        document.getElementById('context-menu'),
        lyricsManager,
        ui,
        scrobbler
    );

    // Clear status on tab close
    window.addEventListener('beforeunload', () => {
        syncManager.clearPlaybackStatus();
    });
    initializeUIInteractions(player, api, ui);
    initializeKeyboardShortcuts(player, audioPlayer);

    // Restore UI state for the current track (like button, theme)
    if (player.currentTrack) {
        ui.setCurrentTrack(player.currentTrack);
    }

    document.querySelector('.now-playing-bar .cover').addEventListener('click', async () => {
        if (!player.currentTrack) {
            alert('No track is currently playing');
            return;
        }

        const mode = nowPlayingSettings.getMode();

        if (mode === 'lyrics') {
            const isActive = sidePanelManager.isActive('lyrics');

            if (isActive) {
                sidePanelManager.close();
                clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
            } else {
                openLyricsPanel(player.currentTrack, audioPlayer, lyricsManager);
            }
        } else if (mode === 'cover') {
            const overlay = document.getElementById('fullscreen-cover-overlay');
            if (overlay && overlay.style.display === 'flex') {
                if (window.location.hash === '#fullscreen') {
                    window.history.back();
                } else {
                    ui.closeFullscreenCover();
                }
            } else {
                const nextTrack = player.getNextTrack();
                ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
            }
        } else if (mode === 'album') {
            if (player.currentTrack.album?.id) {
                navigate(`/album/${player.currentTrack.album.id}`);
            }
        } else {
            const nextTrack = player.getNextTrack();
            ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
        }
    });

    // Toggle Share Button visibility on switch change
    document.getElementById('playlist-public-toggle')?.addEventListener('change', async (e) => {
        const shareBtn = document.getElementById('playlist-share-btn');
        if (e.target.checked) {
            await authManager.initialized.catch(() => {});
            if (!authManager.user) {
                e.target.checked = false;
                if (shareBtn) shareBtn.style.display = 'none';
                const { showNotification } = await loadDownloadsModule();
                showNotification('Sign in to publish playlists publicly.');
                return;
            }
        }

        if (shareBtn) shareBtn.style.display = e.target.checked ? 'flex' : 'none';
    });

    document.getElementById('close-fullscreen-cover-btn')?.addEventListener('click', () => {
        if (window.location.hash === '#fullscreen') {
            window.history.back();
        } else {
            ui.closeFullscreenCover();
        }
    });

    document.getElementById('fullscreen-cover-image')?.addEventListener('click', () => {
        if (window.location.hash === '#fullscreen') {
            window.history.back();
        } else {
            ui.closeFullscreenCover();
        }
    });

    // Touch Gestures for Mobile
    let touchStartY = 0;
    const nowPlayingBar = document.querySelector('.now-playing-bar');
    if (nowPlayingBar) {
        nowPlayingBar.addEventListener(
            'touchstart',
            (e) => {
                touchStartY = e.changedTouches[0].screenY;
            },
            { passive: true }
        );
        nowPlayingBar.addEventListener(
            'touchend',
            (e) => {
                const touchEndY = e.changedTouches[0].screenY;
                if (touchStartY - touchEndY > 50) {
                    // Swipe UP
                    // Avoid accidental clicks on controls
                    if (!e.target.closest('button') && !e.target.closest('.progress-bar')) {
                        document.querySelector('.now-playing-bar .cover')?.click();
                    }
                }
            },
            { passive: true }
        );
    }

    const fsOverlay = document.getElementById('fullscreen-cover-overlay');
    if (fsOverlay) {
        let fsSwipeStartX = 0;
        let fsSwipeStartY = 0;

        const FS_MODES = ['cover', 'lyrics', 'queue'];

        const cycleFsMode = (direction) => {
            const current = nowPlayingSettings?.getMode?.() || 'cover';
            const idx = FS_MODES.indexOf(current);
            const next = FS_MODES[(idx + direction + FS_MODES.length) % FS_MODES.length];
            nowPlayingSettings?.setMode?.(next);

            // Give visual feedback via a quick slide animation
            const mainView = fsOverlay.querySelector('.fullscreen-main-view');
            if (mainView) {
                mainView.style.transition = 'transform 0.28s cubic-bezier(0.22,0.61,0.36,1), opacity 0.22s ease';
                mainView.style.transform = `translateX(${direction * -40}px)`;
                mainView.style.opacity = '0';
                setTimeout(() => {
                    mainView.style.transform = 'translateX(0)';
                    mainView.style.opacity = '1';
                }, 280);
            }

            if (next === 'lyrics') {
                document.getElementById('toggle-fullscreen-lyrics-btn')?.click();
            }
        };

        fsOverlay.addEventListener(
            'touchstart',
            (e) => {
                // Skip scrollable or interactive inner elements
                if (
                    !e.target.closest('.lyrics-scroll-container') &&
                    !e.target.closest('.fs-volume-bar') &&
                    !e.target.closest('.progress-bar')
                ) {
                    fsSwipeStartX = e.changedTouches[0].screenX;
                    fsSwipeStartY = e.changedTouches[0].screenY;
                    touchStartY = e.changedTouches[0].screenY;
                } else {
                    fsSwipeStartX = null;
                    touchStartY = null;
                }
            },
            { passive: true }
        );

        fsOverlay.addEventListener(
            'touchend',
            (e) => {
                if (touchStartY === null && fsSwipeStartX === null) return;
                const touchEndY = e.changedTouches[0].screenY;
                const touchEndX = e.changedTouches[0].screenX;
                const deltaY = touchEndY - (touchStartY ?? touchEndY);
                const deltaX = touchEndX - (fsSwipeStartX ?? touchEndX);

                // Prioritise swipe down (dismiss) over horizontal
                if (Math.abs(deltaY) > Math.abs(deltaX)) {
                    if (deltaY > 60) {
                        // Swipe DOWN – close
                        document.getElementById('close-fullscreen-cover-btn')?.click();
                    }
                } else if (Math.abs(deltaX) > 60 && fsSwipeStartX !== null) {
                    // Swipe LEFT = next mode, RIGHT = prev mode
                    cycleFsMode(deltaX < 0 ? 1 : -1);
                }
            },
            { passive: true }
        );
    }

    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = isCollapsed
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
        }
        // Save sidebar state to localStorage
        sidebarSettings.setCollapsed(isCollapsed);
    });

    // Import tab switching in playlist modal
    document.querySelectorAll('.import-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const importType = tab.dataset.importType;

            // Update tab styles
            document.querySelectorAll('.import-tab').forEach((t) => {
                t.classList.remove('active');
                t.style.opacity = '0.7';
            });
            tab.classList.add('active');
            tab.style.opacity = '1';

            // Show/hide panels
            document.getElementById('csv-import-panel').style.display = importType === 'csv' ? 'block' : 'none';
            document.getElementById('jspf-import-panel').style.display = importType === 'jspf' ? 'block' : 'none';
            document.getElementById('xspf-import-panel').style.display = importType === 'xspf' ? 'block' : 'none';
            document.getElementById('xml-import-panel').style.display = importType === 'xml' ? 'block' : 'none';
            document.getElementById('m3u-import-panel').style.display = importType === 'm3u' ? 'block' : 'none';

            // Clear all file inputs except the active one
            document.getElementById('csv-file-input').value =
                importType === 'csv' ? document.getElementById('csv-file-input').value : '';
            document.getElementById('jspf-file-input').value =
                importType === 'jspf' ? document.getElementById('jspf-file-input').value : '';
            document.getElementById('xspf-file-input').value =
                importType === 'xspf' ? document.getElementById('xspf-file-input').value : '';
            document.getElementById('xml-file-input').value =
                importType === 'xml' ? document.getElementById('xml-file-input').value : '';
            document.getElementById('m3u-file-input').value =
                importType === 'm3u' ? document.getElementById('m3u-file-input').value : '';
        });
    });
    const spotifyBtn = document.getElementById('csv-spotify-btn');
    const appleBtn = document.getElementById('csv-apple-btn');
    const ytmBtn = document.getElementById('csv-ytm-btn');
    const spotifyGuide = document.getElementById('csv-spotify-guide');
    const appleGuide = document.getElementById('csv-apple-guide');
    const ytmGuide = document.getElementById('csv-ytm-guide');
    const inputContainer = document.getElementById('csv-input-container');

    if (spotifyBtn && appleBtn && ytmBtn) {
        spotifyBtn.addEventListener('click', () => {
            spotifyBtn.classList.remove('btn-secondary');
            spotifyBtn.classList.add('btn-primary');
            spotifyBtn.style.opacity = '1';

            appleBtn.classList.remove('btn-primary');
            appleBtn.classList.add('btn-secondary');
            appleBtn.style.opacity = '0.7';

            ytmBtn.classList.remove('btn-primary');
            ytmBtn.classList.add('btn-secondary');
            ytmBtn.style.opacity = '0.7';

            spotifyGuide.style.display = 'block';
            appleGuide.style.display = 'none';
            ytmGuide.style.display = 'none';
            inputContainer.style.display = 'block';
        });

        appleBtn.addEventListener('click', () => {
            appleBtn.classList.remove('btn-secondary');
            appleBtn.classList.add('btn-primary');
            appleBtn.style.opacity = '1';

            spotifyBtn.classList.remove('btn-primary');
            spotifyBtn.classList.add('btn-secondary');
            spotifyBtn.style.opacity = '0.7';

            ytmBtn.classList.remove('btn-primary');
            ytmBtn.classList.add('btn-secondary');
            ytmBtn.style.opacity = '0.7';

            appleGuide.style.display = 'block';
            spotifyGuide.style.display = 'none';
            ytmGuide.style.display = 'none';
            inputContainer.style.display = 'block';
        });

        ytmBtn.addEventListener('click', () => {
            ytmBtn.classList.remove('btn-secondary');
            ytmBtn.classList.add('btn-primary');
            ytmBtn.style.opacity = '1';

            spotifyBtn.classList.remove('btn-primary');
            spotifyBtn.classList.add('btn-secondary');
            spotifyBtn.style.opacity = '0.7';

            appleBtn.classList.remove('btn-primary');
            appleBtn.classList.add('btn-secondary');
            appleBtn.style.opacity = '0.7';

            ytmGuide.style.display = 'block';
            spotifyGuide.style.display = 'none';
            appleGuide.style.display = 'none';
            inputContainer.style.display = 'none';
        });
    }

    // Cover image upload functionality
    const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
    const coverFileInput = document.getElementById('playlist-cover-file-input');
    const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
    const coverUrlInput = document.getElementById('playlist-cover-input');
    const coverUploadStatus = document.getElementById('playlist-cover-upload-status');
    const coverUploadText = document.getElementById('playlist-cover-upload-text');

    let useUrlInput = false;

    coverUploadBtn?.addEventListener('click', () => {
        if (useUrlInput) return;
        coverFileInput?.click();
    });

    coverFileInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        // Show uploading status
        coverUploadStatus.style.display = 'block';
        coverUploadText.textContent = 'Uploading...';
        coverUploadBtn.disabled = true;

        try {
            const publicUrl = await uploadCoverImage(file);
            coverUrlInput.value = publicUrl;
            coverUploadText.textContent = 'Done!';
            coverUploadText.style.color = 'var(--success)';

            setTimeout(() => {
                coverUploadStatus.style.display = 'none';
            }, 2000);
        } catch (error) {
            coverUploadText.textContent = 'Failed - try URL';
            coverUploadText.style.color = 'var(--error)';
            console.error('Upload failed:', error);
        } finally {
            coverUploadBtn.disabled = false;
        }
    });

    coverToggleUrlBtn?.addEventListener('click', () => {
        useUrlInput = !useUrlInput;
        if (useUrlInput) {
            coverUploadBtn.style.flex = '0 0 auto';
            coverUploadBtn.style.display = 'none';
            coverUrlInput.style.display = 'block';
            coverToggleUrlBtn.textContent = 'Upload';
            coverToggleUrlBtn.title = 'Switch to file upload';
        } else {
            coverUploadBtn.style.flex = '1';
            coverUploadBtn.style.display = 'flex';
            coverUrlInput.style.display = 'none';
            coverToggleUrlBtn.textContent = 'or URL';
            coverToggleUrlBtn.title = 'Switch to URL input';
        }
    });

    document.getElementById('nav-back')?.addEventListener('click', () => {
        window.history.back();
    });

    document.getElementById('nav-forward')?.addEventListener('click', () => {
        window.history.forward();
    });

    document.getElementById('toggle-lyrics-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!player.currentTrack) {
            alert('No track is currently playing');
            return;
        }

        const isActive = sidePanelManager.isActive('lyrics');

        if (isActive) {
            sidePanelManager.close();
            clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
        } else {
            openLyricsPanel(player.currentTrack, audioPlayer, lyricsManager);
        }
    });

    document.getElementById('download-current-btn')?.addEventListener('click', () => {
        if (player.currentTrack) {
            handleTrackAction('download', player.currentTrack, player, api, lyricsManager, 'track', ui);
        }
    });

    // Auto-update lyrics when track changes
    let previousTrackId = null;
    audioPlayer.addEventListener('play', async () => {
        if (!player.currentTrack) return;

        // Update UI with current track info for theme
        ui.setCurrentTrack(player.currentTrack);

        // Update Media Session with new track
        player.updateMediaSession(player.currentTrack);

        const currentTrackId = player.currentTrack.id;
        if (currentTrackId === previousTrackId) return;
        previousTrackId = currentTrackId;

        // Update lyrics panel if it's open
        if (sidePanelManager.isActive('lyrics')) {
            // Re-open forces update/refresh of content and sync
            openLyricsPanel(player.currentTrack, audioPlayer, lyricsManager, true);
        }

        // Update Fullscreen if it's open
        const fullscreenOverlay = document.getElementById('fullscreen-cover-overlay');
        if (fullscreenOverlay && getComputedStyle(fullscreenOverlay).display !== 'none') {
            const nextTrack = player.getNextTrack();
            ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
        }

        // DEV: Auto-open fullscreen mode if ?fullscreen=1 in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (
            urlParams.get('fullscreen') === '1' &&
            fullscreenOverlay &&
            getComputedStyle(fullscreenOverlay).display === 'none'
        ) {
            const nextTrack = player.getNextTrack();
            ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#play-album-btn')) {
            const btn = e.target.closest('#play-album-btn');
            if (btn.disabled) return;

            const pathParts = window.location.pathname.split('/');
            const albumIndex = pathParts.indexOf('album');
            let albumId = albumIndex !== -1 ? pathParts[albumIndex + 1] : null;
            // Handle /album/t/ID format
            if (albumId === 't') {
                albumId = pathParts[albumIndex + 2];
            }

            if (!albumId) return;

            try {
                const { tracks } = await api.getAlbum(albumId);
                if (tracks && tracks.length > 0) {
                    // Sort tracks by disc and track number for consistent playback
                    const sortedTracks = [...tracks].sort((a, b) => {
                        const discA = a.volumeNumber ?? a.discNumber ?? 1;
                        const discB = b.volumeNumber ?? b.discNumber ?? 1;
                        if (discA !== discB) return discA - discB;
                        return a.trackNumber - b.trackNumber;
                    });

                    player.setQueue(sortedTracks, 0);
                    const shuffleBtn = document.getElementById('shuffle-btn');
                    if (shuffleBtn) shuffleBtn.classList.remove('active');
                    player.shuffleActive = false;
                    player.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to play album:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to play album');
            }
        }

        if (e.target.closest('#shuffle-album-btn')) {
            const btn = e.target.closest('#shuffle-album-btn');
            if (btn.disabled) return;

            const pathParts = window.location.pathname.split('/');
            const albumIndex = pathParts.indexOf('album');
            let albumId = albumIndex !== -1 ? pathParts[albumIndex + 1] : null;
            // Handle /album/t/ID format
            if (albumId === 't') {
                albumId = pathParts[albumIndex + 2];
            }

            if (!albumId) return;

            try {
                const { tracks } = await api.getAlbum(albumId);
                if (tracks && tracks.length > 0) {
                    const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
                    player.setQueue(shuffledTracks, 0);
                    const shuffleBtn = document.getElementById('shuffle-btn');
                    if (shuffleBtn) shuffleBtn.classList.remove('active');
                    player.shuffleActive = false;
                    player.playTrackFromQueue();

                    const { showNotification } = await loadDownloadsModule();
                    showNotification('Shuffling album');
                }
            } catch (error) {
                console.error('Failed to shuffle album:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to shuffle album');
            }
        }

        if (e.target.closest('#shuffle-artist-btn')) {
            const btn = e.target.closest('#shuffle-artist-btn');
            if (btn.disabled) return;
            document.getElementById('play-artist-radio-btn')?.click();
        }
        if (e.target.closest('#download-mix-btn')) {
            const btn = e.target.closest('#download-mix-btn');
            if (btn.disabled) return;

            const mixId = window.location.pathname.split('/')[2];
            if (!mixId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                const { mix, tracks } = await api.getMix(mixId);
                const { downloadPlaylistAsZip } = await loadDownloadsModule();
                await downloadPlaylistAsZip(mix, tracks, api, downloadQualitySettings.getQuality(), lyricsManager);
            } catch (error) {
                console.error('Mix download failed:', error);
                alert('Failed to download mix: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#download-playlist-btn')) {
            const btn = e.target.closest('#download-playlist-btn');
            if (btn.disabled) return;

            const playlistId = window.location.pathname.split('/')[2];
            if (!playlistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                let playlist, tracks;
                let userPlaylist = await db.getPlaylist(playlistId);

                if (!userPlaylist) {
                    try {
                        userPlaylist = await syncManager.getPublicPlaylist(playlistId);
                    } catch {
                        // Not a public playlist
                    }
                }

                if (userPlaylist) {
                    playlist = { ...userPlaylist, title: userPlaylist.name || userPlaylist.title };
                    tracks = userPlaylist.tracks || [];
                } else {
                    const data = await api.getPlaylist(playlistId);
                    playlist = data.playlist;
                    tracks = data.tracks;
                }

                const { downloadPlaylistAsZip } = await loadDownloadsModule();
                await downloadPlaylistAsZip(playlist, tracks, api, downloadQualitySettings.getQuality(), lyricsManager);
            } catch (error) {
                console.error('Playlist download failed:', error);
                alert('Failed to download playlist: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        // Collaborative playlist download handler
        if (e.target.closest('#collab-download-btn')) {
            const btn = e.target.closest('#collab-download-btn');
            if (btn.disabled) return;

            const playlistId = window.location.pathname.split('/')[2];
            if (!playlistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';

            try {
                const playlist = await db.getCollaborativePlaylist(playlistId);
                if (!playlist) {
                    alert('Playlist not found');
                    return;
                }

                const playlistData = { ...playlist, title: playlist.name };
                const tracks = playlist.tracks || [];

                const { downloadPlaylistAsZip } = await loadDownloadsModule();
                await downloadPlaylistAsZip(
                    playlistData,
                    tracks,
                    api,
                    downloadQualitySettings.getQuality(),
                    lyricsManager
                );
            } catch (error) {
                console.error('Collaborative playlist download failed:', error);
                alert('Failed to download playlist: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#create-playlist-btn')) {
            const modal = document.getElementById('playlist-modal');
            document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
            document.getElementById('playlist-name-input').value = '';
            document.getElementById('playlist-cover-input').value = '';
            document.getElementById('playlist-cover-file-input').value = '';
            document.getElementById('playlist-description-input').value = '';
            modal.dataset.editingId = '';
            document.getElementById('import-section').style.display = 'block';
            document.getElementById('csv-file-input').value = '';
            document.getElementById('ytm-url-input').value = '';
            document.getElementById('ytm-status').textContent = '';
            document.getElementById('jspf-file-input').value = '';
            document.getElementById('xspf-file-input').value = '';
            document.getElementById('xml-file-input').value = '';
            document.getElementById('m3u-file-input').value = '';

            // Reset import tabs to CSV
            document.querySelectorAll('.import-tab').forEach((tab) => {
                tab.classList.toggle('active', tab.dataset.importType === 'csv');
            });
            document.getElementById('csv-import-panel').style.display = 'block';
            document.getElementById('jspf-import-panel').style.display = 'none';
            document.getElementById('xspf-import-panel').style.display = 'none';
            document.getElementById('xml-import-panel').style.display = 'none';
            document.getElementById('m3u-import-panel').style.display = 'none';

            // Reset Public Toggle
            const publicToggle = document.getElementById('playlist-public-toggle');
            const shareBtn = document.getElementById('playlist-share-btn');
            if (publicToggle) publicToggle.checked = false;
            if (shareBtn) shareBtn.style.display = 'none';

            // Reset cover upload state
            const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
            const coverUrlInput = document.getElementById('playlist-cover-input');
            const coverUploadStatus = document.getElementById('playlist-cover-upload-status');
            const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
            if (coverUploadBtn) {
                coverUploadBtn.style.flex = '1';
                coverUploadBtn.style.display = 'flex';
            }
            if (coverUrlInput) coverUrlInput.style.display = 'none';
            if (coverUploadStatus) coverUploadStatus.style.display = 'none';
            if (coverToggleUrlBtn) {
                coverToggleUrlBtn.textContent = 'or URL';
                coverToggleUrlBtn.title = 'Switch to URL input';
            }

            modal.classList.add('active');
            document.getElementById('playlist-name-input').focus();
        }

        if (e.target.closest('#create-folder-btn')) {
            const modal = document.getElementById('folder-modal');
            document.getElementById('folder-name-input').value = '';
            document.getElementById('folder-cover-input').value = '';
            modal.classList.add('active');
            document.getElementById('folder-name-input').focus();
        }

        if (e.target.closest('#folder-modal-save')) {
            const name = document.getElementById('folder-name-input').value.trim();
            const cover = document.getElementById('folder-cover-input').value.trim();

            if (name) {
                const folder = await db.createFolder(name, cover);
                await syncManager.syncUserFolder(folder, 'create');
                ui.renderLibraryPage();
                document.getElementById('folder-modal').classList.remove('active');
            }
        }

        if (e.target.closest('#folder-modal-cancel')) {
            document.getElementById('folder-modal').classList.remove('active');
        }

        if (e.target.closest('#delete-folder-btn')) {
            const folderId = window.location.pathname.split('/')[2];
            if (folderId && confirm('Are you sure you want to delete this folder?')) {
                await db.deleteFolder(folderId);
                // Sync deletion to cloud
                await syncManager.syncUserFolder({ id: folderId }, 'delete');
                navigate('/library');
            }
        }

        if (e.target.closest('#playlist-modal-save')) {
            let name = document.getElementById('playlist-name-input').value.trim();
            let description = document.getElementById('playlist-description-input').value.trim();
            const isPublic = document.getElementById('playlist-public-toggle')?.checked;

            if (name) {
                const modal = document.getElementById('playlist-modal');
                const editingId = modal.dataset.editingId;

                const handlePublicStatus = async (playlist) => {
                    playlist.isPublic = isPublic;
                    if (isPublic) {
                        await authManager.initialized.catch(() => {});
                        if (!authManager.user) {
                            playlist.isPublic = false;
                            const { showNotification } = await loadDownloadsModule();
                            showNotification('Sign in to publish playlists publicly.');
                            return playlist;
                        }

                        try {
                            await syncManager.publishPlaylist(playlist);
                        } catch (e) {
                            console.error('Failed to publish playlist:', e);
                            playlist.isPublic = false;
                            const rawMessage = String(e?.message || '').toLowerCase();
                            let message = 'Failed to publish playlist. Please try again.';

                            if (
                                e?.code === 401 ||
                                e?.code === 403 ||
                                rawMessage.includes('not authorized') ||
                                rawMessage.includes('not authenticated') ||
                                rawMessage.includes('signed in')
                            ) {
                                message = 'Please sign in again to publish playlists.';
                            } else if (
                                rawMessage.includes('networkerror') ||
                                rawMessage.includes('failed to fetch') ||
                                rawMessage.includes('network')
                            ) {
                                message = 'Network error while publishing playlist. Check connection and retry.';
                            } else if (
                                rawMessage.includes('tracks') &&
                                (rawMessage.includes('size') || rawMessage.includes('too large'))
                            ) {
                                message = 'Playlist is too large to publish. Reduce track count and retry.';
                            }

                            const { showNotification } = await loadDownloadsModule();
                            showNotification(message);
                        }
                    } else {
                        try {
                            await syncManager.unpublishPlaylist(playlist.id);
                        } catch {
                            // Ignore error if it wasn't public
                        }
                    }
                    return playlist;
                };

                if (editingId) {
                    // Edit
                    const cover = document.getElementById('playlist-cover-input').value.trim();
                    db.getPlaylist(editingId).then(async (playlist) => {
                        if (playlist) {
                            playlist.name = name;
                            playlist.cover = cover;
                            playlist.description = description;
                            await handlePublicStatus(playlist);
                            await db.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
                            syncManager.syncUserPlaylist(playlist, 'update');
                            ui.renderLibraryPage();
                            // Also update current page if we are on it
                            if (window.location.pathname === `/userplaylist/${editingId}`) {
                                ui.renderPlaylistPage(editingId, 'user');
                            }
                            modal.classList.remove('active');
                            delete modal.dataset.editingId;
                        }
                    });
                } else {
                    // Create
                    const csvFileInput = document.getElementById('csv-file-input');
                    const jspfFileInput = document.getElementById('jspf-file-input');
                    const xspfFileInput = document.getElementById('xspf-file-input');
                    const xmlFileInput = document.getElementById('xml-file-input');
                    const m3uFileInput = document.getElementById('m3u-file-input');
                    let tracks = [];
                    let importSource = 'manual';
                    let cover = document.getElementById('playlist-cover-input').value.trim();

                    // Helper function for import progress
                    const setupProgressElements = () => {
                        const progressElement = document.getElementById('csv-import-progress');
                        const progressFill = document.getElementById('csv-progress-fill');
                        const progressCurrent = document.getElementById('csv-progress-current');
                        const progressTotal = document.getElementById('csv-progress-total');
                        const currentTrackElement = progressElement.querySelector('.current-track');
                        const currentArtistElement = progressElement.querySelector('.current-artist');
                        return {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        };
                    };

                    const isYTMActive = document.getElementById('csv-ytm-btn')?.classList.contains('btn-primary');
                    const ytmUrlInput = document.getElementById('ytm-url-input');

                    if (isYTMActive && ytmUrlInput.value.trim()) {
                        importSource = 'ytm_import';
                        const url = ytmUrlInput.value.trim();
                        const playlistId = url.split('list=')[1]?.split('&')[0];

                        const workerUrl = `https://ytmimport.samidy.workers.dev?playlistId=${playlistId}`;

                        if (!playlistId) {
                            alert("Invalid URL. Make sure it has 'list=' in it.");
                            return;
                        }

                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Fetching from YouTube...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const response = await fetch(workerUrl);
                            const songs = await response.json();

                            if (songs.error) throw new Error(songs.error);

                            currentTrackElement.textContent = `Processing ${songs.length} songs...`;

                            const headers = 'Title,Artist,URL\n';
                            const csvText =
                                headers +
                                songs
                                    .map(
                                        (s) =>
                                            `"${s.title.replace(/"/g, '""')}","${s.artist.replace(/"/g, '""')}","${s.url}"`
                                    )
                                    .join('\n');

                            const totalTracks = songs.length;
                            progressTotal.textContent = totalTracks.toString();

                            const result = await parseCSV(csvText, api, (progress) => {
                                const percentage = totalTracks > 0 ? (progress.current / totalTracks) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the YouTube playlist!');
                                progressElement.style.display = 'none';
                                return;
                            }

                            console.log(`Imported ${tracks.length} tracks from YouTube`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks);
                                }, 500);
                            }
                        } catch (err) {
                            console.error('YTM Import Error:', err);
                            alert(`Error importing from YouTube: ${err.message}`);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (jspfFileInput.files.length > 0) {
                        // Import from JSPF
                        importSource = 'jspf_import';
                        const file = jspfFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading JSPF file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const jspfText = await file.text();

                            const result = await parseJSPF(jspfText, api, (progress) => {
                                const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                progressTotal.textContent = progress.total.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the JSPF file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from JSPF`);

                            // Auto-fill playlist metadata from JSPF if not provided
                            const jspfData = result.jspfData;
                            if (jspfData && jspfData.playlist) {
                                const playlist = jspfData.playlist;
                                if (!name && playlist.title) {
                                    name = playlist.title;
                                }
                                if (!description && playlist.annotation) {
                                    description = playlist.annotation;
                                }
                                if (!cover && playlist.image) {
                                    cover = playlist.image;
                                }
                            }

                            // Track JSPF import
                            const jspfPlaylist = result.jspfData?.playlist;
                            const jspfCreator =
                                jspfPlaylist?.creator ||
                                jspfPlaylist?.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.creator ||
                                'unknown';

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks);
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse JSPF!', error);
                            alert('Failed to parse JSPF file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (csvFileInput.files.length > 0) {
                        // Import from CSV
                        importSource = 'csv_import';
                        const file = csvFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading CSV file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const csvText = await file.text();
                            const lines = csvText.trim().split('\n');
                            const totalTracks = Math.max(0, lines.length - 1);
                            progressTotal.textContent = totalTracks.toString();

                            const result = await parseCSV(csvText, api, (progress) => {
                                const percentage = totalTracks > 0 ? (progress.current / totalTracks) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the CSV file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from CSV`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks);
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse CSV!', error);
                            alert('Failed to parse CSV file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (xspfFileInput.files.length > 0) {
                        // Import from XSPF
                        importSource = 'xspf_import';
                        const file = xspfFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading XSPF file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const xspfText = await file.text();

                            const result = await parseXSPF(xspfText, api, (progress) => {
                                const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                progressTotal.textContent = progress.total.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the XSPF file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from XSPF`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks);
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse XSPF!', error);
                            alert('Failed to parse XSPF file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (xmlFileInput.files.length > 0) {
                        // Import from XML
                        importSource = 'xml_import';
                        const file = xmlFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading XML file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const xmlText = await file.text();

                            const result = await parseXML(xmlText, api, (progress) => {
                                const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                progressTotal.textContent = progress.total.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the XML file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from XML`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks);
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse XML!', error);
                            alert('Failed to parse XML file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (m3uFileInput.files.length > 0) {
                        // Import from M3U/M3U8
                        importSource = 'm3u_import';
                        const file = m3uFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading M3U file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const m3uText = await file.text();

                            const result = await parseM3U(m3uText, api, (progress) => {
                                const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                progressTotal.textContent = progress.total.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the M3U file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from M3U`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks);
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse M3U!', error);
                            alert('Failed to parse M3U file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    }

                    // Check for pending tracks (from Add to Playlist -> New Playlist)
                    const modal = document.getElementById('playlist-modal');
                    if (modal._pendingTracks && Array.isArray(modal._pendingTracks)) {
                        tracks = [...tracks, ...modal._pendingTracks];
                        delete modal._pendingTracks;
                        // Also clear CSV input if we came from there? No, keep it separate.
                        console.log(`Added ${tracks.length} tracks (including pending)`);
                    }

                    db.createPlaylist(name, tracks, cover, description).then(async (playlist) => {
                        await handlePublicStatus(playlist);
                        // Update DB again with isPublic flag
                        await db.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
                        await syncManager.syncUserPlaylist(playlist, 'create');
                        ui.renderLibraryPage();
                        modal.classList.remove('active');
                    });
                }
            }
        }

        if (e.target.closest('#playlist-modal-cancel')) {
            document.getElementById('playlist-modal').classList.remove('active');
        }

        if (e.target.closest('.edit-playlist-btn')) {
            const card = e.target.closest('.user-playlist');
            const playlistId = card.dataset.userPlaylistId;
            db.getPlaylist(playlistId).then(async (playlist) => {
                if (playlist) {
                    const modal = document.getElementById('playlist-modal');
                    document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                    document.getElementById('playlist-name-input').value = playlist.name;
                    document.getElementById('playlist-cover-input').value = playlist.cover || '';
                    document.getElementById('playlist-description-input').value = playlist.description || '';

                    // Set Public Toggle
                    const publicToggle = document.getElementById('playlist-public-toggle');
                    const shareBtn = document.getElementById('playlist-share-btn');

                    // Check if actually public in Pocketbase to be sure (async) or trust local flag
                    // We trust local flag for UI speed, but could verify.
                    if (publicToggle) publicToggle.checked = !!playlist.isPublic;

                    if (shareBtn) {
                        shareBtn.style.display = playlist.isPublic ? 'flex' : 'none';
                        shareBtn.onclick = async () => {
                            const url = getShareUrl(`/userplaylist/${playlist.id}`);
                            if (navigator.share) {
                                try {
                                    await navigator.share({ title: playlist.name, url });
                                } catch {
                                    /* user cancelled */
                                }
                            } else {
                                await navigator.clipboard.writeText(url);
                                const { showNotification } = await loadDownloadsModule();
                                showNotification('Link copied to clipboard!');
                            }
                        };
                    }

                    // Set cover upload state - show URL input if there's an existing cover
                    const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
                    const coverUrlInput = document.getElementById('playlist-cover-input');
                    const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
                    if (playlist.cover) {
                        if (coverUploadBtn) coverUploadBtn.style.display = 'none';
                        if (coverUrlInput) coverUrlInput.style.display = 'block';
                        if (coverToggleUrlBtn) {
                            coverToggleUrlBtn.textContent = 'Upload';
                            coverToggleUrlBtn.title = 'Switch to file upload';
                        }
                    } else {
                        if (coverUploadBtn) {
                            coverUploadBtn.style.flex = '1';
                            coverUploadBtn.style.display = 'flex';
                        }
                        if (coverUrlInput) coverUrlInput.style.display = 'none';
                        if (coverToggleUrlBtn) {
                            coverToggleUrlBtn.textContent = 'or URL';
                            coverToggleUrlBtn.title = 'Switch to URL input';
                        }
                    }

                    modal.dataset.editingId = playlistId;
                    document.getElementById('import-section').style.display = 'none';
                    modal.classList.add('active');
                    document.getElementById('playlist-name-input').focus();
                }
            });
        }

        if (e.target.closest('.delete-playlist-btn')) {
            const card = e.target.closest('.user-playlist');
            const playlistId = card.dataset.userPlaylistId;
            if (confirm('Are you sure you want to delete this playlist?')) {
                db.deletePlaylist(playlistId).then(() => {
                    syncManager.syncUserPlaylist({ id: playlistId }, 'delete');
                    ui.renderLibraryPage();
                });
            }
        }

        if (e.target.closest('#edit-playlist-btn')) {
            const playlistId = window.location.pathname.split('/')[2];
            db.getPlaylist(playlistId).then((playlist) => {
                if (playlist) {
                    const modal = document.getElementById('playlist-modal');
                    document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                    document.getElementById('playlist-name-input').value = playlist.name;
                    document.getElementById('playlist-cover-input').value = playlist.cover || '';
                    document.getElementById('playlist-description-input').value = playlist.description || '';

                    const publicToggle = document.getElementById('playlist-public-toggle');
                    const shareBtn = document.getElementById('playlist-share-btn');

                    if (publicToggle) publicToggle.checked = !!playlist.isPublic;
                    if (shareBtn) {
                        shareBtn.style.display = playlist.isPublic ? 'flex' : 'none';
                        shareBtn.onclick = async () => {
                            const url = getShareUrl(`/userplaylist/${playlist.id}`);
                            if (navigator.share) {
                                try {
                                    await navigator.share({ title: playlist.name, url });
                                } catch {
                                    /* user cancelled */
                                }
                            } else {
                                await navigator.clipboard.writeText(url);
                                const { showNotification } = await loadDownloadsModule();
                                showNotification('Link copied to clipboard!');
                            }
                        };
                    }

                    // Set cover upload state - show URL input if there's an existing cover
                    const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
                    const coverUrlInput = document.getElementById('playlist-cover-input');
                    const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
                    if (playlist.cover) {
                        if (coverUploadBtn) coverUploadBtn.style.display = 'none';
                        if (coverUrlInput) coverUrlInput.style.display = 'block';
                        if (coverToggleUrlBtn) {
                            coverToggleUrlBtn.textContent = 'Upload';
                            coverToggleUrlBtn.title = 'Switch to file upload';
                        }
                    } else {
                        if (coverUploadBtn) {
                            coverUploadBtn.style.flex = '1';
                            coverUploadBtn.style.display = 'flex';
                        }
                        if (coverUrlInput) coverUrlInput.style.display = 'none';
                        if (coverToggleUrlBtn) {
                            coverToggleUrlBtn.textContent = 'or URL';
                            coverToggleUrlBtn.title = 'Switch to URL input';
                        }
                    }

                    modal.dataset.editingId = playlistId;
                    document.getElementById('import-section').style.display = 'none';
                    modal.classList.add('active');
                    document.getElementById('playlist-name-input').focus();
                }
            });
        }

        if (e.target.closest('#delete-playlist-btn')) {
            const playlistId = window.location.pathname.split('/')[2];
            if (confirm('Are you sure you want to delete this playlist?')) {
                db.deletePlaylist(playlistId).then(() => {
                    syncManager.syncUserPlaylist({ id: playlistId }, 'delete');
                    navigate('/library');
                });
            }
        }

        if (e.target.closest('.remove-from-playlist-btn')) {
            e.stopPropagation();
            const btn = e.target.closest('.remove-from-playlist-btn');
            const playlistId = window.location.pathname.split('/')[2];

            db.getPlaylist(playlistId).then(async (playlist) => {
                let trackId = null;

                // Prefer ID if available (from sorted view)
                if (btn.dataset.trackId) {
                    trackId = btn.dataset.trackId;
                } else if (btn.dataset.trackIndex) {
                    // Fallback to index (legacy/unsorted)
                    const index = parseInt(btn.dataset.trackIndex);
                    if (playlist && playlist.tracks[index]) {
                        trackId = playlist.tracks[index].id;
                    }
                }

                if (trackId) {
                    const updatedPlaylist = await db.removeTrackFromPlaylist(playlistId, trackId);
                    syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                    const scrollTop = document.querySelector('.main-content').scrollTop;
                    await ui.renderPlaylistPage(playlistId, 'user');
                    document.querySelector('.main-content').scrollTop = scrollTop;
                }
            });
        }

        if (e.target.closest('#play-playlist-btn')) {
            const btn = e.target.closest('#play-playlist-btn');
            if (btn.disabled) return;

            const playlistId = window.location.pathname.split('/')[2];
            if (!playlistId) return;

            try {
                let tracks;
                const userPlaylist = await db.getPlaylist(playlistId);
                if (userPlaylist) {
                    tracks = userPlaylist.tracks;
                } else {
                    // Try API, if fail, try Public Pocketbase
                    try {
                        const { tracks: apiTracks } = await api.getPlaylist(playlistId);
                        tracks = apiTracks;
                    } catch (e) {
                        const publicPlaylist = await syncManager.getPublicPlaylist(playlistId);
                        if (publicPlaylist) {
                            tracks = publicPlaylist.tracks;
                        } else {
                            throw e;
                        }
                    }
                }
                if (tracks.length > 0) {
                    player.setQueue(tracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    player.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to play playlist:', error);
                alert('Failed to play playlist: ' + error.message);
            }
        }

        if (e.target.closest('#download-album-btn')) {
            const btn = e.target.closest('#download-album-btn');
            if (btn.disabled) return;

            const albumId = window.location.pathname.split('/')[2];
            if (!albumId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                const { album, tracks } = await api.getAlbum(albumId);
                const { downloadAlbumAsZip } = await loadDownloadsModule();
                await downloadAlbumAsZip(album, tracks, api, downloadQualitySettings.getQuality(), lyricsManager);
            } catch (error) {
                console.error('Album download failed:', error);
                alert('Failed to download album: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#add-album-to-playlist-btn')) {
            const btn = e.target.closest('#add-album-to-playlist-btn');
            if (btn.disabled) return;

            const albumId = window.location.pathname.split('/')[2];
            if (!albumId) return;

            try {
                const { tracks } = await api.getAlbum(albumId);

                if (!tracks || tracks.length === 0) {
                    const { showNotification } = await loadDownloadsModule();
                    showNotification('No tracks found in this album.');
                    return;
                }

                const modal = document.getElementById('playlist-select-modal');
                const list = document.getElementById('playlist-select-list');
                const cancelBtn = document.getElementById('playlist-select-cancel');
                const overlay = modal.querySelector('.modal-overlay');

                const playlists = await db.getPlaylists(false);

                list.innerHTML =
                    `
                    <div class="modal-option create-new-option" style="border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;">
                        <span style="font-weight: 600; color: var(--primary);">+ Create New Playlist</span>
                    </div>
                ` +
                    playlists
                        .map(
                            (p) => `
                    <div class="modal-option" data-id="${p.id}">
                        <span>${p.name}</span>
                    </div>
                `
                        )
                        .join('');

                const closeModal = () => {
                    modal.classList.remove('active');
                    cleanup();
                };

                const handleOptionClick = async (e) => {
                    const option = e.target.closest('.modal-option');
                    if (!option) return;

                    if (option.classList.contains('create-new-option')) {
                        closeModal();
                        const createModal = document.getElementById('playlist-modal');
                        document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
                        document.getElementById('playlist-name-input').value = '';
                        document.getElementById('playlist-cover-input').value = '';
                        createModal.dataset.editingId = '';
                        document.getElementById('import-section').style.display = 'none'; // Hide import for simple add

                        // Pass tracks
                        createModal._pendingTracks = tracks;

                        createModal.classList.add('active');
                        document.getElementById('playlist-name-input').focus();
                        return;
                    }

                    const playlistId = option.dataset.id;

                    try {
                        await db.addTracksToPlaylist(playlistId, tracks);
                        const updatedPlaylist = await db.getPlaylist(playlistId);
                        await syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                        const { showNotification } = await loadDownloadsModule();
                        showNotification(`Added ${tracks.length} tracks to playlist.`);
                        closeModal();
                    } catch (err) {
                        console.error(err);
                        const { showNotification } = await loadDownloadsModule();
                        showNotification('Failed to add tracks.');
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
            } catch (error) {
                console.error('Failed to prepare album for playlist:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to load album tracks.');
            }
        }

        if (e.target.closest('#play-artist-radio-btn')) {
            const btn = e.target.closest('#play-artist-radio-btn');
            if (btn.disabled) return;

            const artistId = window.location.pathname.split('/')[2];
            if (!artistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Loading...</span>';

            try {
                const artist = await api.getArtist(artistId);

                const allReleases = [...(artist.albums || []), ...(artist.eps || [])];
                if (allReleases.length === 0) {
                    throw new Error('No albums or EPs found for this artist');
                }

                const trackSet = new Set();
                const allTracks = [];

                const chunks = [];
                const chunkSize = 3;
                const albums = allReleases;

                for (let i = 0; i < albums.length; i += chunkSize) {
                    chunks.push(albums.slice(i, i + chunkSize));
                }

                for (const chunk of chunks) {
                    await Promise.all(
                        chunk.map(async (album) => {
                            try {
                                const { tracks } = await api.getAlbum(album.id);
                                tracks.forEach((track) => {
                                    if (!trackSet.has(track.id)) {
                                        trackSet.add(track.id);
                                        allTracks.push(track);
                                    }
                                });
                            } catch (err) {
                                console.warn(`Failed to fetch tracks for album ${album.title}:`, err);
                            }
                        })
                    );
                }

                if (allTracks.length > 0) {
                    for (let i = allTracks.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
                    }

                    player.setQueue(allTracks, 0);
                    player.playTrackFromQueue();
                } else {
                    throw new Error('No tracks found across all albums');
                }
            } catch (error) {
                console.error('Artist radio failed:', error);
                alert('Failed to start artist radio: ' + error.message);
            } finally {
                if (document.body.contains(btn)) {
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                }
            }
        }

        if (e.target.closest('#shuffle-liked-tracks-btn')) {
            const btn = e.target.closest('#shuffle-liked-tracks-btn');
            if (btn.disabled) return;

            try {
                const likedTracks = await db.getFavorites('track');
                if (likedTracks.length > 0) {
                    // Shuffle array
                    for (let i = likedTracks.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [likedTracks[i], likedTracks[j]] = [likedTracks[j], likedTracks[i]];
                    }
                    player.setQueue(likedTracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    player.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to shuffle liked tracks:', error);
            }
        }

        if (e.target.closest('#download-liked-tracks-btn')) {
            const btn = e.target.closest('#download-liked-tracks-btn');
            if (btn.disabled) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';

            try {
                const likedTracks = await db.getFavorites('track');
                if (likedTracks.length === 0) {
                    alert('No liked tracks to download.');
                    return;
                }
                const { downloadLikedTracks } = await loadDownloadsModule();
                await downloadLikedTracks(likedTracks, api, downloadQualitySettings.getQuality(), lyricsManager);
            } catch (error) {
                console.error('Liked tracks download failed:', error);
                alert('Failed to download liked tracks: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#download-discography-btn')) {
            const btn = e.target.closest('#download-discography-btn');
            if (btn.disabled) return;

            const artistId = window.location.pathname.split('/')[2];
            if (!artistId) return;

            try {
                const artist = await api.getArtist(artistId);
                showDiscographyDownloadModal(artist, api, downloadQualitySettings.getQuality(), lyricsManager, btn);
            } catch (error) {
                console.error('Failed to load artist for discography download:', error);
                alert('Failed to load artist: ' + error.message);
            }
        }

        // Local Files Logic lollll
        if (e.target.closest('#select-local-folder-btn') || e.target.closest('#change-local-folder-btn')) {
            const isChange = e.target.closest('#change-local-folder-btn') !== null;
            try {
                const isNeutralino =
                    window.Neutralino && (window.NL_MODE || window.location.search.includes('mode=neutralino'));
                let handle;
                let path;

                if (isNeutralino) {
                    path = await window.Neutralino.os.showFolderDialog('Select Music Folder');
                    if (!path) return;
                    // Mock a handle object for UI compatibility
                    handle = { name: path.split(/[/\\]/).pop() || path, isNeutralino: true, path };
                } else {
                    handle = await window.showDirectoryPicker({
                        id: 'music-folder',
                        mode: 'read',
                    });
                }

                await db.saveSetting('local_folder_handle', handle);

                const btn = document.getElementById('select-local-folder-btn');
                const btnText = document.getElementById('select-local-folder-text');
                if (btn) {
                    if (btnText) btnText.textContent = 'Scanning...';
                    else btn.textContent = 'Scanning...';
                    btn.disabled = true;
                }

                const tracks = [];
                let idCounter = 0;
                const { readTrackMetadata } = await loadMetadataModule();

                if (isNeutralino) {
                    async function scanDirectoryNeu(dirPath) {
                        const entries = await window.Neutralino.filesystem.readDirectory(dirPath);
                        for (const entry of entries) {
                            if (entry.entry === '.' || entry.entry === '..') continue;
                            const fullPath = `${dirPath}/${entry.entry}`;
                            if (entry.type === 'FILE') {
                                const name = entry.entry.toLowerCase();
                                if (
                                    name.endsWith('.flac') ||
                                    name.endsWith('.mp3') ||
                                    name.endsWith('.m4a') ||
                                    name.endsWith('.wav') ||
                                    name.endsWith('.ogg')
                                ) {
                                    try {
                                        const buffer = await window.Neutralino.filesystem.readBinaryFile(fullPath);
                                        const stats = await window.Neutralino.filesystem.getStats(fullPath);
                                        const file = new File([buffer], entry.entry, {
                                            lastModified: stats.mtime,
                                        });
                                        const metadata = await readTrackMetadata(file);
                                        metadata.id = `local-${idCounter++}-${entry.entry}`;
                                        tracks.push(metadata);
                                    } catch (e) {
                                        console.error('Failed to read file:', fullPath, e);
                                    }
                                }
                            } else if (entry.type === 'DIRECTORY') {
                                await scanDirectoryNeu(fullPath);
                            }
                        }
                    }
                    await scanDirectoryNeu(path);
                } else {
                    async function scanDirectory(dirHandle) {
                        for await (const entry of dirHandle.values()) {
                            if (entry.kind === 'file') {
                                const name = entry.name.toLowerCase();
                                if (
                                    name.endsWith('.flac') ||
                                    name.endsWith('.mp3') ||
                                    name.endsWith('.m4a') ||
                                    name.endsWith('.wav') ||
                                    name.endsWith('.ogg')
                                ) {
                                    const file = await entry.getFile();
                                    const metadata = await readTrackMetadata(file);
                                    metadata.id = `local-${idCounter++}-${file.name}`;
                                    tracks.push(metadata);
                                }
                            } else if (entry.kind === 'directory') {
                                await scanDirectory(entry);
                            }
                        }
                    }
                    await scanDirectory(handle);
                }

                tracks.sort((a, b) => {
                    const artistA = a.artist.name || '';
                    const artistB = b.artist.name || '';
                    return artistA.localeCompare(artistB);
                });

                window.localFilesCache = tracks;
                ui.renderLibraryPage();
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error selecting folder:', err);
                    alert('Failed to access folder. Please try again.');
                }
                const btn = document.getElementById('select-local-folder-btn');
                const btnText = document.getElementById('select-local-folder-text');
                if (btn) {
                    if (btnText) btnText.textContent = 'Select Music Folder';
                    else btn.textContent = 'Select Music Folder';
                    btn.disabled = false;
                }
            }
        }
    });

    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');

    // Instantiate Intelligent Search Engine
    const searchEngine = new SearchEngine(api);
    window.searchEngine = searchEngine;

    // Pre-build local fuse index from liked tracks + recently played
    import('./db.js').then(async ({ db }) => {
        try {
            const liked = (await db.getFavorites('track')) || [];
            searchEngine.buildLocalIndex(liked);
        } catch {
            /* silently skip if db is unavailable */
        }
    });

    // Setup clear button for search bar
    ui.setupSearchClearButton(searchInput);

    // Suggestions/history dropdown
    let suggestionsEl = document.getElementById('search-suggestions');
    if (!suggestionsEl) {
        suggestionsEl = document.createElement('ul');
        suggestionsEl.id = 'search-suggestions';
        suggestionsEl.className = 'search-suggestions-list';
        searchInput.closest('.search-bar')?.appendChild(suggestionsEl);
    }

    const hideSuggestions = () => {
        suggestionsEl.style.display = 'none';
    };
    const showSuggestions = (items, isHistory = false) => {
        if (!items || items.length === 0) {
            hideSuggestions();
            return;
        }
        suggestionsEl.innerHTML = items
            .map((item) => {
                const label = typeof item === 'string' ? item : item.title || '';
                const sub = isHistory
                    ? '<span class="suggestion-icon">🕐</span>'
                    : `<span class="suggestion-sub">${item.artist?.name || ''}</span>`;
                return `<li class="suggestion-item" data-query="${label}">${sub} <span>${label}</span></li>`;
            })
            .join('');
        suggestionsEl.style.display = 'block';
    };

    suggestionsEl.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;
        const q = item.dataset.query;
        searchInput.value = q;
        searchEngine.addToHistory(q);
        navigate(`/search/${encodeURIComponent(q)}`);
        hideSuggestions();
    });

    // Two-phase search: instant local → async remote
    const performSearch = debounce(async (query) => {
        if (!query) return;
        navigate(`/search/${encodeURIComponent(query)}`);
    }, 300);

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length < 2) {
            hideSuggestions();
            return;
        }
        // Show instant local results as suggestions
        const local = searchEngine.searchLocal(query);
        showSuggestions(local.slice(0, 6));
        performSearch(query);
    });

    searchInput.addEventListener('focus', () => {
        // Search history removed - suggestions only show for typed queries
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-bar')) {
            hideSuggestions();
        }
    });

    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            navigate(`/search/${encodeURIComponent(query)}`);
            hideSuggestions();
            const historyEl = document.getElementById('search-history');
            if (historyEl) historyEl.style.display = 'none';
        }
    });

    // Voice Search
    const voiceBtn = document.getElementById('voice-search-btn');
    if (voiceBtn && searchEngine.isVoiceSupported) {
        voiceBtn.style.display = 'flex';
        voiceBtn.addEventListener('click', async () => {
            try {
                voiceBtn.classList.add('listening');
                voiceBtn.title = 'Listening…';
                const transcript = await searchEngine.startVoiceSearch();
                searchInput.value = transcript;
                searchEngine.addToHistory(transcript);
                navigate(`/search/${encodeURIComponent(transcript)}`);
            } catch (err) {
                console.warn('[Voice Search] Failed:', err.message);
            } finally {
                voiceBtn.classList.remove('listening');
                voiceBtn.title = 'Voice Search';
            }
        });
    }

    window.addEventListener('online', () => {
        hideOfflineNotification();
        console.log('Back online');
    });

    window.addEventListener('offline', () => {
        showOfflineNotification();
        console.log('Gone offline');
    });

    document.querySelector('.now-playing-bar .play-pause-btn').innerHTML = SVG_PLAY;

    const router = createRouter(ui);

    const handleRouteChange = async (event) => {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const isFullscreenOpen = overlay && getComputedStyle(overlay).display === 'flex';

        if (isFullscreenOpen && window.location.hash !== '#fullscreen') {
            ui.closeFullscreenCover();
        }

        if (event && event.state && event.state.exitTrap) {
            const { showNotification } = await loadDownloadsModule();
            showNotification('Press back again to exit');
            setTimeout(() => {
                if (history.state && history.state.exitTrap) {
                    history.pushState({ app: true }, '', window.location.pathname);
                }
            }, 2000);
            return;
        }

        // Intercept back navigation to close modals first if setting is enabled
        if (event && modalSettings.shouldInterceptBackToClose() && modalSettings.hasOpenModalsOrPanels()) {
            sidePanelManager.close();
            modalSettings.closeAllModals();
            history.pushState(history.state || { app: true }, '', window.location.pathname);
            return;
        }

        // Close side panel (queue/lyrics) and modals on navigation if setting is enabled
        if (modalSettings.shouldCloseOnNavigation()) {
            sidePanelManager.close();
            modalSettings.closeAllModals();
        }

        console.log('[Router] Handling route change to:', window.location.pathname);
        await router();
        updateTabTitle(player);

        // Update Open Graph and canonical meta tags dynamically
        const canonical = getShareUrl(window.location.pathname);
        const setMeta = (sel, attr, val) => {
            let el = document.querySelector(sel);
            if (!el) {
                el = document.createElement('meta');
                const parts = sel.match(/\[([^=]+)=["']([^"']+)["']\]/);
                if (parts) el.setAttribute(parts[1], parts[2]);
                document.head.appendChild(el);
            }
            el.setAttribute(attr, val);
        };
        setMeta('meta[property="og:url"]', 'content', canonical);
        setMeta('link[rel="canonical"]', 'href', canonical);
        // og:title and og:description are best-effort from the current document title
        setMeta('meta[property="og:title"]', 'content', document.title || 'Monochrome+');
        setMeta('meta[property="og:description"]', 'content', 'Hi-Res lossless music. Beyond Apple Music.');
    };

    console.log('[Appwrite] Performing initial route handling...');
    await handleRouteChange();

    window.addEventListener('popstate', handleRouteChange);

    document.body.addEventListener('click', (e) => {
        const link = e.target.closest('a');

        if (
            link &&
            link.origin === window.location.origin &&
            link.target !== '_blank' &&
            !link.hasAttribute('download')
        ) {
            e.preventDefault();
            navigate(link.pathname);
        }
    });

    const syncNowPlayingCoverRotation = () => {
        const coverEl = document.querySelector('.now-playing-bar .cover-shell');
        if (!coverEl) return;

        if (!rotatingCoverSettings.isEnabled()) {
            coverEl.classList.remove('rotating', 'paused');
            return;
        }

        coverEl.classList.add('rotating');
        if (audioPlayer.paused) {
            coverEl.classList.add('paused');
        } else {
            coverEl.classList.remove('paused');
        }
    };

    const syncFullscreenDiscRotation = () => {
        const vinylContainer = document.getElementById('vinyl-disc-container');
        if (!vinylContainer) return;

        if (!rotatingCoverSettings.isEnabled()) {
            vinylContainer.classList.remove('rotating-disc', 'paused', 'spin-reverse');
            return;
        }

        vinylContainer.classList.add('rotating-disc');
        vinylContainer.classList.remove('spin-reverse');
        if (audioPlayer.paused) {
            vinylContainer.classList.add('paused');
        } else {
            vinylContainer.classList.remove('paused');
        }
    };

    audioPlayer.addEventListener('play', () => {
        updateTabTitle(player);
        syncNowPlayingCoverRotation();
        syncFullscreenDiscRotation();
    });

    audioPlayer.addEventListener('pause', () => {
        syncNowPlayingCoverRotation();
        syncFullscreenDiscRotation();
    });

    // Listen for rotating cover setting changes
    window.addEventListener('rotating-cover-changed', () => {
        syncNowPlayingCoverRotation();
        syncFullscreenDiscRotation();
    });

    // PWA Update Logic
    if (window.__AUTH_GATE__) {
        disablePwaForAuthGate();
    } else {
        const updateSW = registerSW({
            onNeedRefresh() {
                if (pwaUpdateSettings.isAutoUpdateEnabled()) {
                    // Auto-update: immediately activate the new service worker
                    updateSW(true);
                } else {
                    // Show notification with Update button and dismiss option
                    showUpdateNotification(() => {
                        updateSW(true);
                    });
                }
            },
            onOfflineReady() {
                console.log('App ready to work offline');
            },
        });
    }

    document.getElementById('show-shortcuts-btn')?.addEventListener('click', () => {
        showKeyboardShortcuts();
    });

    // Font Settings
    const fontSelect = document.getElementById('font-select');
    if (fontSelect) {
        const savedFont = localStorage.getItem('monochrome-font');
        if (savedFont) {
            fontSelect.value = savedFont;
        }
        fontSelect.addEventListener('change', (e) => {
            const font = e.target.value;
            document.documentElement.style.setProperty('--font-family', font);
            localStorage.setItem('monochrome-font', font);
        });
    }

    // Listener for Pocketbase Sync updates
    window.addEventListener('library-changed', () => {
        const path = window.location.pathname;
        if (path === '/library') {
            ui.renderLibraryPage();
        } else if (path === '/' || path === '/home') {
            ui.renderHomePage();
        } else if (path.startsWith('/userplaylist/')) {
            const playlistId = path.split('/')[2];
            const content = document.querySelector('.main-content');
            const scroll = content ? content.scrollTop : 0;
            ui.renderPlaylistPage(playlistId, 'user').then(() => {
                if (content) content.scrollTop = scroll;
            });
        }
    });
    window.addEventListener('history-changed', () => {
        const path = window.location.pathname;
        if (path === '/recent') {
            ui.renderRecentPage();
        }
    });

    // Listeners for Real-time PocketBase events
    window.addEventListener('pb-user-updated', async () => {
        const path = window.location.pathname;
        if (path.startsWith('/friends')) {
            const friendParam = path.startsWith('/friends/') ? decodeURIComponent(path.slice('/friends/'.length)) : '';
            ui.renderFriendsPage(friendParam);
        }
        if (path.startsWith('/user/@')) {
            const username = decodeURIComponent(path.split('/user/@')[1]);
            const { loadProfile } = await import('./profile.js');
            loadProfile(username);
        }
    });

    window.addEventListener('pb-friend-updated', () => {
        const path = window.location.pathname;
        if (path.startsWith('/friends')) {
            const friendParam = path.startsWith('/friends/') ? decodeURIComponent(path.slice('/friends/'.length)) : '';
            ui.renderFriendsPage(friendParam);
        }
    });

    window.addEventListener('pb-public-playlist-updated', (event) => {
        const path = window.location.pathname;
        const changedPlaylistId = event?.detail?.playlistId;
        if (!changedPlaylistId) return;

        if (path.startsWith('/playlist/')) {
            const parts = path.split('/').filter(Boolean);
            const maybeProvider = parts[1];
            const currentPlaylistId = maybeProvider === 't' || maybeProvider === 'q' ? parts[2] : maybeProvider;
            if (currentPlaylistId === changedPlaylistId) {
                ui.renderPlaylistPage(changedPlaylistId, 'user');
            }
            return;
        }

        if (path.startsWith('/userplaylist/')) {
            const currentPlaylistId = path.split('/')[2];
            if (currentPlaylistId === changedPlaylistId) {
                ui.renderPlaylistPage(changedPlaylistId, 'user');
            }
        }
    });

    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (contextMenu.style.display === 'block') {
                        const track = contextMenu._contextTrack;
                        const albumItem = contextMenu.querySelector('[data-action="go-to-album"]');
                        const artistItem = contextMenu.querySelector('[data-action="go-to-artist"]');

                        if (track) {
                            if (albumItem) {
                                let label = 'album';
                                const albumType = track.album?.type?.toUpperCase();
                                const trackCount = track.album?.numberOfTracks;

                                if (albumType === 'SINGLE' || trackCount === 1) label = 'single';
                                else if (albumType === 'EP') label = 'EP';
                                else if (trackCount && trackCount <= 6) label = 'EP';

                                albumItem.textContent = `Go to ${label}`;
                                albumItem.style.display = track.album ? 'block' : 'none';
                            }
                        }
                    }
                }
            });
        });

        observer.observe(contextMenu, { attributes: true });
    }

    const headerAccountBtn = document.getElementById('header-account-btn');
    const headerAccountDropdown = document.getElementById('header-account-dropdown');
    const headerAccountImg = document.getElementById('header-account-img');
    const headerAccountIcon = document.getElementById('header-account-icon');
    const sidebarAccountName = document.getElementById('sidebar-account-name');
    const sidebarAccountSubtitle = document.getElementById('sidebar-account-subtitle');
    const sidebarProfileNav = document.getElementById('sidebar-nav-profile');
    const sidebarEl = document.querySelector('.sidebar');

    if (headerAccountBtn && headerAccountDropdown) {
        const closeAccountDropdown = () => {
            headerAccountDropdown.classList.remove('active');
            headerAccountBtn.classList.remove('is-open');
            headerAccountBtn.setAttribute('aria-expanded', 'false');
            if (sidebarEl) sidebarEl.classList.remove('sidebar-account-open');
        };

        headerAccountBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = !headerAccountDropdown.classList.contains('active');
            headerAccountDropdown.classList.toggle('active', willOpen);
            headerAccountBtn.classList.toggle('is-open', willOpen);
            headerAccountBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            if (sidebarEl) sidebarEl.classList.toggle('sidebar-account-open', willOpen);
            if (willOpen) {
                updateAccountDropdown();
            }
        });

        document.addEventListener('click', (e) => {
            if (!headerAccountBtn.contains(e.target) && !headerAccountDropdown.contains(e.target)) {
                closeAccountDropdown();
            }
        });

        async function updateAccountDropdown() {
            const user = authManager?.user;
            headerAccountDropdown.innerHTML = '';

            if (!user) {
                headerAccountDropdown.innerHTML = `
                    <div class="account-dropdown-section">
                        <button class="btn-primary" id="header-email-auth">Sign in with Email</button>
                        <button class="btn-secondary" id="header-discord-auth">Continue with Discord</button>
                    </div>
                    <div class="account-dropdown-section">
                        <button class="btn-secondary" id="header-open-account">Open Account Page</button>
                    </div>
                `;

                document.getElementById('header-email-auth').onclick = () => {
                    const authModal = document.getElementById('email-auth-modal');
                    if (authModal) authModal.classList.add('active');
                    document.getElementById('auth-email')?.focus();
                    closeAccountDropdown();
                };
                document.getElementById('header-discord-auth').onclick = () => {
                    closeAccountDropdown();
                    authManager.signInWithDiscord();
                };
                document.getElementById('header-open-account').onclick = () => {
                    navigate('/account');
                    closeAccountDropdown();
                };
            } else {
                let data = null;
                try {
                    data = await syncManager.getUserData();
                } catch {
                    data = null;
                }
                const hasProfile = data && data.profile && data.profile.username;

                if (hasProfile) {
                    headerAccountDropdown.innerHTML = `
                        <div class="account-dropdown-section">
                            <button class="btn-secondary" id="header-view-profile">My Profile</button>
                            <button class="btn-secondary" id="header-open-account">Account Settings</button>
                        </div>
                        <div class="account-dropdown-section">
                            <button class="btn-secondary danger" id="header-sign-out">Sign Out</button>
                        </div>
                    `;
                    document.getElementById('header-view-profile').onclick = () => {
                        navigate(`/user/@${data.profile.username}`);
                        closeAccountDropdown();
                    };
                } else {
                    headerAccountDropdown.innerHTML = `
                        <div class="account-dropdown-section">
                            <button class="btn-primary" id="header-create-profile">Create Profile</button>
                            <button class="btn-secondary" id="header-open-account">Account Settings</button>
                        </div>
                        <div class="account-dropdown-section">
                            <button class="btn-secondary danger" id="header-sign-out">Sign Out</button>
                        </div>
                    `;
                    document.getElementById('header-create-profile').onclick = () => {
                        openEditProfile();
                        closeAccountDropdown();
                    };
                }

                const accountSettingsBtn = document.getElementById('header-open-account');
                if (accountSettingsBtn) {
                    accountSettingsBtn.onclick = () => {
                        navigate('/account');
                        closeAccountDropdown();
                    };
                }

                document.getElementById('header-sign-out').onclick = () => {
                    closeAccountDropdown();
                    authManager.signOut();
                };
            }
        }

        authManager.onAuthStateChanged(async (user) => {
            const friendsNav = document.getElementById('sidebar-nav-friends');
            if (user) {
                if (friendsNav) friendsNav.style.display = '';
                if (sidebarProfileNav) sidebarProfileNav.style.display = '';
                headerAccountBtn.classList.add('is-authenticated');
                let data = null;
                try {
                    data = await syncManager.getUserData();
                } catch {
                    data = null;
                }
                if (sidebarAccountName) {
                    sidebarAccountName.textContent =
                        data?.profile?.display_name || data?.profile?.username || user.name || user.email || 'Account';
                }
                if (sidebarAccountSubtitle) {
                    sidebarAccountSubtitle.textContent = data?.profile?.username
                        ? `@${data.profile.username}`
                        : user.email || 'Signed in';
                }
                if (data && data.profile && data.profile.avatar_url) {
                    headerAccountImg.src = data.profile.avatar_url;
                    headerAccountImg.style.display = 'block';
                    headerAccountIcon.style.display = 'none';
                } else {
                    headerAccountImg.style.display = 'none';
                    headerAccountIcon.style.display = 'block';
                }

                // Re-render profile if we are on it
                if (window.location.pathname === '/profile' || window.location.pathname.startsWith('/user/')) {
                    ui.renderProfilePage();
                }
            } else {
                if (friendsNav) friendsNav.style.display = 'none';
                if (sidebarProfileNav) sidebarProfileNav.style.display = 'none';
                headerAccountBtn.classList.remove('is-authenticated');
                if (sidebarAccountName) sidebarAccountName.textContent = 'Sign in';
                if (sidebarAccountSubtitle) sidebarAccountSubtitle.textContent = 'Email or Discord';
                headerAccountImg.style.display = 'none';
                headerAccountIcon.style.display = 'block';

                // Re-render profile to show "Not Signed In"
                if (window.location.pathname === '/profile') {
                    ui.renderProfilePage();
                }
            }
            updateAccountDropdown();
        });
    }
});

function showUpdateNotification(updateCallback) {
    // Remove any existing update notification
    const existingNotification = document.querySelector('.update-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
        <div>
            <strong>Update Available</strong>
            <p>A new version of Monochrome+ is available.</p>
        </div>
        <div class="update-notification-actions">
            <button class="btn-primary" id="update-now-btn">Update Now</button>
            <button class="btn-icon" id="dismiss-update-btn" title="Dismiss">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `;
    document.body.appendChild(notification);

    document.getElementById('update-now-btn').addEventListener('click', () => {
        if (typeof updateCallback === 'function') {
            updateCallback();
        } else if (updateCallback && updateCallback.postMessage) {
            updateCallback.postMessage({ action: 'skipWaiting' });
        } else {
            window.location.reload();
        }
    });

    document.getElementById('dismiss-update-btn').addEventListener('click', () => {
        notification.remove();
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showMissingTracksNotification(missingTracks) {
    const modal = document.getElementById('missing-tracks-modal');
    const listUl = document.getElementById('missing-tracks-list-ul');

    listUl.innerHTML = missingTracks
        .map((track) => {
            const text =
                typeof track === 'string' ? track : `${track.artist ? track.artist + ' - ' : ''}${track.title}`;
            return `<li>${escapeHtml(text)}</li>`;
        })
        .join('');

    const closeModal = () => modal.classList.remove('active');

    // Remove old listeners if any (though usually these functions are called once per instance,
    // but since we reuse the same modal element we should be careful or use a one-time listener)
    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.closest('.close-missing-tracks') ||
            e.target.id === 'close-missing-tracks-btn' ||
            e.target.classList.contains('modal-overlay')
        ) {
            closeModal();
            modal.removeEventListener('click', handleClose);
        }
    };

    modal.addEventListener('click', handleClose);
    modal.classList.add('active');
}

function showDiscographyDownloadModal(artist, api, quality, lyricsManager, triggerBtn) {
    const modal = document.getElementById('discography-download-modal');

    document.getElementById('discography-artist-name').textContent = artist.name;
    document.getElementById('albums-count').textContent = artist.albums?.length || 0;
    document.getElementById('eps-count').textContent = (artist.eps || []).filter((a) => a.type === 'EP').length;
    document.getElementById('singles-count').textContent = (artist.eps || []).filter((a) => a.type === 'SINGLE').length;

    // Reset checkboxes
    document.getElementById('download-albums').checked = true;
    document.getElementById('download-eps').checked = true;
    document.getElementById('download-singles').checked = true;

    const closeModal = () => {
        modal.classList.remove('active');
    };

    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.classList.contains('modal-overlay') ||
            e.target.closest('.close-modal-btn') ||
            e.target.id === 'cancel-discography-download'
        ) {
            closeModal();
        }
    };

    modal.addEventListener('click', handleClose);

    document.getElementById('start-discography-download').onclick = async () => {
        const includeAlbums = document.getElementById('download-albums').checked;
        const includeEPs = document.getElementById('download-eps').checked;
        const includeSingles = document.getElementById('download-singles').checked;

        if (!includeAlbums && !includeEPs && !includeSingles) {
            alert('Please select at least one type of release to download.');
            return;
        }

        closeModal();

        // Filter releases based on selection
        let selectedReleases = [];
        if (includeAlbums) {
            selectedReleases = selectedReleases.concat(artist.albums || []);
        }
        if (includeEPs) {
            selectedReleases = selectedReleases.concat((artist.eps || []).filter((a) => a.type === 'EP'));
        }
        if (includeSingles) {
            selectedReleases = selectedReleases.concat((artist.eps || []).filter((a) => a.type === 'SINGLE'));
        }

        triggerBtn.disabled = true;
        const originalHTML = triggerBtn.innerHTML;
        triggerBtn.innerHTML =
            '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

        try {
            const { downloadDiscography } = await loadDownloadsModule();
            await downloadDiscography(artist, selectedReleases, api, quality, lyricsManager);
        } catch (error) {
            console.error('Discography download failed:', error);
            alert('Failed to download discography: ' + error.message);
        } finally {
            triggerBtn.disabled = false;
            triggerBtn.innerHTML = originalHTML;
        }
    };

    modal.classList.add('active');
}

function showKeyboardShortcuts() {
    const modal = document.getElementById('shortcuts-modal');

    const closeModal = () => {
        modal.classList.remove('active');

        modal.removeEventListener('click', handleClose);
    };

    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.classList.contains('close-shortcuts') ||
            e.target.classList.contains('modal-overlay')
        ) {
            closeModal();
        }
    };

    modal.addEventListener('click', handleClose);
    modal.classList.add('active');
}
