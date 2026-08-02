//js/ui.js
/* global YT */
import { showNotification } from './downloads.js';
import {
    SVG_PLAY,
    SVG_PAUSE,
    SVG_DOWNLOAD,
    SVG_MENU,
    SVG_HEART,
    SVG_VOLUME,
    SVG_MUTE,
    formatTime,
    createPlaceholder,
    trackDataStore,
    hasExplicitContent,
    getTrackArtists,
    getTrackArtistsHTML,
    getTrackTitle,
    getTrackYearDisplay,
    createQualityBadgeHTML,
    createFullscreenQualityHTML,
    deriveTrackQuality,
    calculateTotalDuration,
    formatDuration,
    escapeHtml,
    getShareUrl,
    createTimeoutSignal,
    copyTextToClipboard,
} from './utils.js';
import { openLyricsPanel } from './lyrics.js';
import {
    recentActivityManager,
    backgroundSettings,
    dynamicColorSettings,
    hifiVisualSettings,
    cardSettings,
    visualizerSettings,
    homePageSettings,
    fontSettings,
    contentBlockingSettings,
    rotatingCoverSettings,
} from './storage.js';
import { eclipseAddonStorage } from './eclipse.js';
import { db } from './db.js';
import { applyPaletteFromImage, resetPalette } from './palette.js';
import { syncManager } from './accounts/appwrite-sync.js';
import { authManager } from './accounts/auth.js';
import { Visualizer } from './visualizer.js';
import { navigate } from './router.js';
import {
    renderUnreleasedPage as renderUnreleasedTrackerPage,
    renderTrackerArtistPage as renderTrackerArtistContent,
    renderTrackerProjectPage as renderTrackerProjectContent,
    renderTrackerTrackPage as renderTrackerTrackContent,
} from './tracker.js';
import { scrollToTop } from './smooth-scrolling.js';
import { getHomeSections } from './api/home.js';

const BILLBOARD_JSON_BASE_URL = 'https://raw.githubusercontent.com/KoreanThinker/billboard-json/main';
const BILLBOARD_CHARTS = Object.freeze({
    hot100: { slug: 'billboard-hot-100', label: 'Hot 100' },
    global200: { slug: 'billboard-global-200', label: 'Global 200' },
    billboard200: { slug: 'billboard-200', label: 'Billboard 200' },
    artist100: { slug: 'billboard-artist-100', label: 'Artist 100' },
});

const BILLBOARD_REGIONAL_BY_COUNTRY = Object.freeze({
    US: { slug: 'billboard-global-excl-us', label: 'Global Excl. US' },
    GB: { slug: 'official-uk-songs', label: 'Official UK Songs' },
    CA: { slug: 'canadian-hot-100', label: 'Canadian Hot 100' },
    AU: { slug: 'australia-songs-hotw', label: 'Australia Songs HOTW' },
    IN: { slug: 'india-songs-hotw', label: 'India Songs HOTW' },
    KR: { slug: 'billboard-korea-hot-100', label: 'Korea Hot 100' },
    JP: { slug: 'japan-hot-100', label: 'Japan Hot 100' },
    DE: { slug: 'germany-songs-hotw', label: 'Germany Songs HOTW' },
    FR: { slug: 'france-songs-hotw', label: 'France Songs HOTW' },
    BR: { slug: 'billboard-brasil-hot-100', label: 'Brasil Hot 100' },
    MX: { slug: 'mexico-songs-hotw', label: 'Mexico Songs HOTW' },
});

fontSettings.applyFont();
fontSettings.applyFontSize();

function sortTracks(tracks, sortType) {
    if (sortType === 'custom') return [...tracks];
    const sorted = [...tracks];
    switch (sortType) {
        case 'added-newest':
            return sorted.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        case 'added-oldest':
            return sorted.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        case 'title':
            return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        case 'artist':
            return sorted.sort((a, b) => {
                const artistA = a.artist?.name || a.artists?.[0]?.name || '';
                const artistB = b.artist?.name || b.artists?.[0]?.name || '';
                return artistA.localeCompare(artistB);
            });
        case 'album':
            return sorted.sort((a, b) => {
                const albumA = a.album?.title || '';
                const albumB = b.album?.title || '';
                const albumCompare = albumA.localeCompare(albumB);
                if (albumCompare !== 0) return albumCompare;
                const trackNumA = a.trackNumber || a.position || 0;
                const trackNumB = b.trackNumber || b.position || 0;
                return trackNumA - trackNumB;
            });
        default:
            return sorted;
    }
}

function getPlaylistTrackCount(playlist = null, tracks = null) {
    const metadataCount = Number(playlist?.numberOfTracks);
    const tracksCount = Array.isArray(tracks)
        ? tracks.length
        : Array.isArray(playlist?.tracks)
          ? playlist.tracks.length
          : 0;

    if (Number.isFinite(metadataCount) && metadataCount > 0) {
        return Math.max(metadataCount, tracksCount);
    }

    return tracksCount;
}

function getDisplayStatusText(status) {
    if (!status) return '';
    if (typeof status !== 'string') return String(status);

    try {
        const parsed = JSON.parse(status);
        if (parsed && typeof parsed === 'object' && parsed.text) {
            return String(parsed.text);
        }
    } catch (_error) {
        // Not JSON, fall back to raw text.
    }

    return status;
}

const FALLBACK_RECOMMENDED_ARTISTS = Object.freeze([
    { id: 1003, name: 'Nas' },
    { id: 3654061, name: 'Waka Flocka Flame' },
    { id: 3972883, name: 'Pusha T' },
    { id: 4839917, name: 'Boldy James' },
    { id: 27836827, name: 'OsamaSon' },
    { id: 5755811, name: 'ZelooperZ' },
    { id: 46882510, name: 'PRODYSGROUP' },
    { id: 50418386, name: 'Che' },
    { id: 439890147, name: 'JPEGMAFIA' },
    { id: 51427239, name: 'Westside Cowboy' },
]);
const FALLBACK_COLLAB_PLAYLIST_COVER =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 640'><rect width='640' height='640' fill='%2303050f'/><rect x='110' y='110' width='280' height='280' fill='%23f2f2f2' rx='8'/><rect x='250' y='250' width='280' height='280' fill='%23f2f2f2' rx='8'/><rect x='250' y='250' width='140' height='140' fill='%2303050f' rx='6'/></svg>";

export class UIRenderer {
    constructor(api, player) {
        UIRenderer.instance = this;
        this.api = api;
        this.player = player;
        this.currentTrack = null;
        this.searchAbortController = null;
        this._lastPaletteUrl = null;
        this.visualizer = null;
        this._homeArtistsRetryTimer = null;
        this._homeArtistsRetryCount = 0;
        this._homeArtistsMaxRetries = 4;
        this._recentTrackProfileCache = null;
        this._recentTrackProfileCacheAt = 0;
        this._recentTrackProfileCacheTtlMs = 0;
        this._recentTrackProfilePromise = null;
        this._recommendationExclusionCache = null;
        this._recommendationExclusionCacheAt = 0;
        this._recommendationExclusionCacheTtlMs = 2 * 60 * 1000;
        this._recommendationExclusionPromise = null;
        this._friendsSuggestionQuery = '';
        this._friendsSuggestionTimer = null;
        this._friendsSuggestionRequestToken = 0;
        this._homeDiscoveryLastHash = '';
        this._homeDiscoveryCache = null;
        this.fullscreenDiscScrubCleanup = null;
        this._fullscreenAudioPlayer = null;
        this._fullscreenDiscResizeHandler = null;
        this._fullscreenDiscRotationRaf = null;
        this._fullscreenDiscMotionState = null;

        // Listen for dynamic color reset events
        window.addEventListener('reset-dynamic-color', () => {
            this.resetVibrantColor();
        });

        window.addEventListener('history-changed', () => {
            this._clearRecentTrackProfileCache();
            this._clearRecommendationExclusionCache();
        });

        window.addEventListener('library-changed', () => {
            this._clearRecommendationExclusionCache();
        });

        window.addEventListener('disc-scratch-changed', () => {
            this.refreshFullscreenDiscScrubbing();
        });

        window.addEventListener('rotating-cover-changed', () => {
            this.refreshFullscreenDiscScrubbing();
        });

        window.addEventListener('disc-size-changed', () => {
            this.refreshFullscreenDiscScrubbing();
        });

        window.addEventListener('hifi-visual-settings-changed', () => {
            this.updateGlobalTheme();
            this.reapplyCurrentPageBackground();
        });
    }

    reapplyCurrentPageBackground() {
        const bgElement = document.getElementById('page-background');
        if (!bgElement) return;

        const visualUrl = bgElement.dataset.visualUrl || null;
        const fallbackUrl = bgElement.dataset.fallbackUrl || null;
        if (!visualUrl && !fallbackUrl) return;

        this.setPageBackground(visualUrl, fallbackUrl);
    }

    // Helper for Heart Icon
    createHeartIcon(filled = false) {
        if (filled) {
            return SVG_HEART.replace('class="heart-icon"', 'class="heart-icon filled"');
        }
        return SVG_HEART;
    }

    async extractAndApplyColor(url) {
        if (!url) {
            this.resetVibrantColor();
            return;
        }

        if (!dynamicColorSettings.isEnabled()) {
            this.resetVibrantColor();
            return;
        }

        // Avoid re-processing the same URL
        if (this._lastPaletteUrl === url) return;
        this._lastPaletteUrl = url;

        try {
            await applyPaletteFromImage(url);
        } catch {
            this.resetVibrantColor();
        }
    }

    async updateLikeState(element, type, id) {
        const isLiked = await db.isFavorite(type, id);
        const btn = element.querySelector('.like-btn');
        if (btn) {
            btn.innerHTML = this.createHeartIcon(isLiked);
            btn.classList.toggle('active', isLiked);
            btn.title = isLiked ? 'Remove from Liked' : 'Add to Liked';
        }
    }

    async renderPinnedItems() {
        const nav = document.getElementById('pinned-items-nav');
        const list = document.getElementById('pinned-items-list');
        if (!nav || !list) return;

        const pinnedItems = await db.getPinned();

        if (pinnedItems.length === 0) {
            nav.style.display = 'none';
            return;
        }

        nav.style.display = '';
        list.innerHTML = pinnedItems
            .map((item) => {
                let iconHTML;
                if (item.type === 'user-playlist' && !item.cover && item.images && item.images.length > 0) {
                    const images = item.images.slice(0, 4);
                    const imgsHTML = images
                        .map((src) => `<img src="${this.api.getCoverUrl(src)}" loading="lazy">`)
                        .join('');
                    iconHTML = `<div class="pinned-item-collage">${imgsHTML}</div>`;
                } else {
                    const coverUrl =
                        item.type === 'artist'
                            ? this.api.getArtistPictureUrl(item.cover)
                            : this.api.getCoverUrl(item.cover);
                    const coverClass = item.type === 'artist' ? 'artist' : '';
                    iconHTML = `<img src="${coverUrl}" class="pinned-item-cover ${coverClass}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.src='assets/logo.svg'">`;
                }

                return `
                <li class="nav-item">
                    <a href="${item.href}">
                        ${iconHTML}
                        <span class="pinned-item-name">${escapeHtml(item.name)}</span>
                    </a>
                </li>
            `;
            })
            .join('');
    }

    setCurrentTrack(track) {
        this.currentTrack = track;
        this.updateGlobalTheme();

        const likeBtn = document.getElementById('now-playing-like-btn');
        const addPlaylistBtn = document.getElementById('now-playing-add-playlist-btn');
        const mobileAddPlaylistBtn = document.getElementById('mobile-add-playlist-btn');
        const lyricsBtn = document.getElementById('toggle-lyrics-btn');
        const fsLikeBtn = document.getElementById('fs-like-btn');
        const fsAddPlaylistBtn = document.getElementById('fs-add-playlist-btn');

        if (track) {
            const isLocal = track.isLocal;
            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
            const shouldHideLikes = isLocal || isTracker;

            if (likeBtn) {
                if (shouldHideLikes) {
                    likeBtn.style.display = 'none';
                } else {
                    likeBtn.style.display = 'flex';
                    this.updateLikeState(likeBtn.parentElement, 'track', track.id);
                }
            }

            if (addPlaylistBtn) {
                if (isLocal) {
                    addPlaylistBtn.style.setProperty('display', 'none', 'important');
                } else {
                    addPlaylistBtn.style.removeProperty('display');
                    addPlaylistBtn.style.display = 'flex';
                }
            }
            if (mobileAddPlaylistBtn) {
                if (isLocal) {
                    mobileAddPlaylistBtn.style.setProperty('display', 'none', 'important');
                } else {
                    mobileAddPlaylistBtn.style.removeProperty('display');
                    mobileAddPlaylistBtn.style.display = 'flex';
                }
            }
            if (lyricsBtn) {
                if (isLocal || isTracker) lyricsBtn.style.display = 'none';
                else lyricsBtn.style.removeProperty('display');
            }

            if (fsLikeBtn) {
                if (shouldHideLikes) {
                    fsLikeBtn.style.display = 'none';
                } else {
                    fsLikeBtn.style.display = 'flex';
                    this.updateLikeState(fsLikeBtn.parentElement, 'track', track.id);
                }
            }
            if (fsAddPlaylistBtn) {
                if (shouldHideLikes) fsAddPlaylistBtn.style.display = 'none';
                else fsAddPlaylistBtn.style.display = 'flex';
            }
        } else {
            if (likeBtn) likeBtn.style.display = 'none';
            if (addPlaylistBtn) addPlaylistBtn.style.setProperty('display', 'none', 'important');
            if (mobileAddPlaylistBtn) mobileAddPlaylistBtn.style.setProperty('display', 'none', 'important');
            if (lyricsBtn) lyricsBtn.style.display = 'none';
            if (fsLikeBtn) fsLikeBtn.style.display = 'none';
            if (fsAddPlaylistBtn) fsAddPlaylistBtn.style.display = 'none';
        }
    }

    updateGlobalTheme() {
        // Check if we are currently viewing an album page
        const isAlbumPage = document.getElementById('page-album').classList.contains('active');

        if (isAlbumPage) {
            // The album page render logic handles its own coloring.
            // We shouldn't override it here.
            return;
        }

        const album = this.currentTrack?.album;
        if (backgroundSettings.isEnabled() && album?.cover) {
            if (hifiVisualSettings.usesApiVibrantColor() && this.applyApiVibrantColor(album.vibrantColor)) {
                return;
            }
            this.extractAndApplyColor(this.api.getCoverUrl(album.cover, '80'));
        } else {
            this.resetVibrantColor();
        }
    }

    getTrackVisualUrl(track, size = '1280') {
        if (!track?.album) return null;

        if (hifiVisualSettings.prefersVideoCover()) {
            return (
                this.api.getVideoCoverUrl(track.album.videoCover, size) || this.api.getCoverUrl(track.album.cover, size)
            );
        }

        return this.api.getCoverUrl(track.album.cover, size);
    }

    getEntityVisualUrl(entity, fallbackCover = null, size = '1280') {
        const fallbackUrl = fallbackCover
            ? this.api.getCoverUrl(fallbackCover, size)
            : entity?.cover
              ? this.api.getCoverUrl(entity.cover, size)
              : null;

        if (!entity || !hifiVisualSettings.prefersVideoCover()) {
            return fallbackUrl;
        }

        if (typeof this.api?.getPreferredVisualUrl === 'function') {
            return this.api.getPreferredVisualUrl(entity, size) || fallbackUrl;
        }

        if (typeof this.api?.getVideoCoverUrl === 'function' && entity?.videoCover) {
            return this.api.getVideoCoverUrl(entity.videoCover, size) || fallbackUrl;
        }

        return fallbackUrl;
    }

    applyApiVibrantColor(vibrantColor) {
        if (!hifiVisualSettings.usesApiVibrantColor()) return false;
        if (!vibrantColor || typeof vibrantColor !== 'string') return false;

        const normalized = vibrantColor.trim();
        const hex = /^#([\da-f]{6}|[\da-f]{3})$/i.test(normalized) ? normalized : null;
        if (!hex) return false;

        const expandHex = (value) =>
            value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value;

        const color = expandHex(hex);
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

        const root = document.documentElement;
        root.style.setProperty('--primary', color);
        root.style.setProperty('--primary-foreground', brightness > 128 ? '#000000' : '#ffffff');
        root.style.setProperty('--highlight', color);
        root.style.setProperty('--highlight-rgb', `${r}, ${g}, ${b}`);
        root.style.setProperty('--active-highlight', color);
        root.style.setProperty('--ring', color);
        root.style.setProperty('--accent-color', color);
        root.style.setProperty('--accent-glow', `${color}44`);
        root.style.setProperty('--accent-dim', `${color}88`);
        root.style.setProperty('--track-hover-bg', `rgba(${r},${g},${b}, ${brightness > 200 ? 0.25 : 0.15})`);
        return true;
    }

    createExplicitBadge() {
        return '<span class="explicit-badge" title="Explicit">E</span>';
    }

    adjustTitleFontSize(element, text) {
        element.classList.remove('long-title', 'very-long-title');
        if (!text) return;

        // Get viewport width for responsive calculations
        const vw = window.innerWidth;
        const containerWidth = element.parentElement?.offsetWidth || vw;

        // Calculate available width (accounting for padding and other elements)
        const availableWidth = Math.min(containerWidth, vw * 0.9);

        // Estimate character width (average ~0.6em for most fonts)
        const fontSize = parseFloat(getComputedStyle(element).fontSize) || 16;
        const charWidth = fontSize * 0.6;
        const maxChars = Math.floor(availableWidth / charWidth);

        // Dynamic thresholds based on viewport
        const veryLongThreshold = Math.max(30, Math.floor(maxChars * 1.2));
        const longThreshold = Math.max(20, Math.floor(maxChars * 0.8));

        if (text.length > veryLongThreshold) {
            element.classList.add('very-long-title');
        } else if (text.length > longThreshold) {
            element.classList.add('long-title');
        }
    }

    /**
     * Renders playlist description with Read More functionality
     * @param {HTMLElement} descEl - The description element
     * @param {string} description - The full description text
     * @param {number} maxLength - Maximum characters before truncation (default: 150)
     */
    renderPlaylistDescription(descEl, description, maxLength = 150) {
        if (!description) {
            descEl.textContent = '';
            descEl.classList.remove('truncated', 'expanded');
            return;
        }

        // Clear previous content
        descEl.innerHTML = '';
        descEl.classList.remove('truncated', 'expanded');

        const isLong = description.length > maxLength;

        if (isLong) {
            // Create truncated version
            const truncatedText = description.substring(0, maxLength).trim();
            descEl.textContent = truncatedText + '...';
            descEl.classList.add('truncated');

            // Create Read More button
            const readMore = document.createElement('span');
            readMore.className = 'description-read-more';
            readMore.textContent = 'Read More';
            readMore.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (descEl.classList.contains('expanded')) {
                    // Collapse
                    descEl.textContent = truncatedText + '...';
                    descEl.classList.remove('expanded');
                    descEl.classList.add('truncated');
                    readMore.textContent = 'Read More';
                    descEl.appendChild(readMore);
                } else {
                    // Expand
                    descEl.textContent = description;
                    descEl.classList.remove('truncated');
                    descEl.classList.add('expanded');
                    readMore.textContent = 'Show Less';
                    descEl.appendChild(readMore);
                }
            };
            descEl.appendChild(readMore);
        } else {
            descEl.textContent = description;
        }
    }

    /**
     * Setup mobile menu for playlist page
     * @param {Object} playlistData - The playlist data
     * @param {Array} tracks - The tracks array
     */
    setupPlaylistMobileMenu(playlistData, tracks) {
        const mobileMenuBtn = document.getElementById('playlist-mobile-menu-btn');
        const mobileMenuDropdown = document.getElementById('playlist-mobile-menu-dropdown');

        if (!mobileMenuBtn || !mobileMenuDropdown) return;

        // Toggle dropdown on button click
        mobileMenuBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            mobileMenuDropdown.classList.toggle('active');
        };

        // Close dropdown when clicking outside
        const closeDropdown = (e) => {
            if (!mobileMenuBtn.contains(e.target) && !mobileMenuDropdown.contains(e.target)) {
                mobileMenuDropdown.classList.remove('active');
            }
        };
        document.addEventListener('click', closeDropdown);

        // Mobile play button
        const mobilePlayBtn = document.getElementById('mobile-play-playlist-btn');
        if (mobilePlayBtn) {
            mobilePlayBtn.onclick = () => {
                mobileMenuDropdown.classList.remove('active');
                const playBtn = document.getElementById('play-playlist-btn');
                if (playBtn) playBtn.click();
            };
        }

        // Mobile shuffle button
        const mobileShuffleBtn = document.getElementById('mobile-shuffle-playlist-btn');
        if (mobileShuffleBtn) {
            mobileShuffleBtn.onclick = () => {
                mobileMenuDropdown.classList.remove('active');
                const shuffleBtn = document.getElementById('shuffle-playlist-btn');
                if (shuffleBtn) shuffleBtn.click();
            };
        }

        // Mobile download button
        const mobileDownloadBtn = document.getElementById('mobile-download-playlist-btn');
        if (mobileDownloadBtn) {
            mobileDownloadBtn.onclick = () => {
                mobileMenuDropdown.classList.remove('active');
                const downloadBtn = document.getElementById('download-playlist-btn');
                if (downloadBtn) downloadBtn.click();
            };
        }

        // Mobile like button
        const mobileLikeBtn = document.getElementById('mobile-like-playlist-btn');
        if (mobileLikeBtn) {
            mobileLikeBtn.onclick = () => {
                mobileMenuDropdown.classList.remove('active');
                const likeBtn = document.getElementById('like-playlist-btn');
                if (likeBtn) likeBtn.click();
            };
        }

        // Mobile add to playlist button (for API playlists)
        const mobileAddBtn = document.getElementById('mobile-add-playlist-to-playlist-btn');
        if (mobileAddBtn) {
            const addPlaylistBtn = document.getElementById('add-playlist-to-playlist-btn');
            if (addPlaylistBtn && addPlaylistBtn.style.display !== 'none') {
                mobileAddBtn.style.display = 'flex';
                mobileAddBtn.onclick = () => {
                    mobileMenuDropdown.classList.remove('active');
                    addPlaylistBtn.click();
                };
            } else {
                mobileAddBtn.style.display = 'none';
            }
        }
    }

    createTrackItemHTML(track, index, showCover = false, hasMultipleDiscs = false, useTrackNumber = false) {
        const isUnavailable = track.isUnavailable;
        const isBlocked = contentBlockingSettings?.shouldHideTrack(track);
        if (track.isLocal) {
            showCover = false;
        }
        const trackImageHTML = showCover
            ? `<img src="${this.api.getCoverUrl(track.album?.cover)}" alt="Track Cover" class="track-item-cover img-loading" loading="lazy" onerror="this.onerror=null;this.src='/assets/appicon.png';">`
            : '';

        let displayIndex;
        if (hasMultipleDiscs && !showCover) {
            const discNum = track.volumeNumber ?? track.discNumber ?? 1;
            displayIndex = `${discNum}-${track.trackNumber}`;
        } else if (useTrackNumber) {
            displayIndex = index + 1;
        } else {
            displayIndex = index + 1;
        }

        const showSeparateCoverColumn = showCover && useTrackNumber;
        const trackNumberHTML = `<div class="track-number">${showCover && !useTrackNumber ? trackImageHTML : displayIndex}</div>`;
        const trackInfoCoverHTML = showSeparateCoverColumn ? trackImageHTML : '';
        const explicitBadge = hasExplicitContent(track) ? this.createExplicitBadge() : '';
        const qualityBadge = createQualityBadgeHTML(track);
        const trackTitle = getTrackTitle(track);
        const isCurrentTrack = this.player?.currentTrack?.id === track.id;

        const yearDisplay = getTrackYearDisplay(track);

        const actionsHTML = isUnavailable
            ? ''
            : `
            <button class="track-menu-btn" type="button" title="More options" ${track.isLocal ? 'style="display:none"' : ''}>
                ${SVG_MENU}
            </button>
        `;

        const blockedTitle = isBlocked
            ? `title="Blocked: ${contentBlockingSettings.isTrackBlocked(track.id) ? 'Track blocked' : contentBlockingSettings.isArtistBlocked(track.artist?.id) ? 'Artist blocked' : 'Album blocked'}"`
            : '';

        const classList = [
            'track-item',
            isCurrentTrack ? 'playing' : '',
            isUnavailable ? 'unavailable' : '',
            isBlocked ? 'blocked' : '',
        ]
            .filter(Boolean)
            .join(' ');

        return `
            <div class="${classList}" 
                 data-track-id="${track.id}" 
                 ${track.isLocal ? 'data-is-local="true"' : ''}
                 ${isUnavailable ? 'title="This track is currently unavailable"' : ''}
                 ${blockedTitle}>
                ${trackNumberHTML}
                <div class="track-item-info">
                    ${trackInfoCoverHTML}
                    <div class="track-item-details">
                        <div class="title">
                            ${escapeHtml(trackTitle)}
                            ${explicitBadge}
                            ${qualityBadge}
                        </div>
                        <div class="artist">${getTrackArtistsHTML(track)}${yearDisplay}</div>
                    </div>
                </div>
                <div class="track-item-duration">${isUnavailable || isBlocked ? '--:--' : track.duration ? formatTime(track.duration) : '--:--'}</div>
                <div class="track-item-actions">
                    ${actionsHTML}
                </div>
            </div>
        `;
    }

    createCoverImageHtml(src, alt = '') {
        const escapedAlt = escapeHtml(String(alt || ''));
        const safeSrc = escapeHtml(String(src || 'assets/appicon.png'));

        return `<img src="${safeSrc}" alt="${escapedAlt}" class="card-image" loading="lazy" onerror="window.handleCoverImageFallback(this)">`;
    }

    createBaseCardHTML({
        type,
        id,
        href,
        title,
        subtitle,
        imageHTML,
        actionButtonsHTML,
        isCompact,
        extraAttributes = '',
        extraClasses = '',
    }) {
        return `
            <div class="card ${extraClasses} ${isCompact ? 'compact' : ''}" data-${type}-id="${id}" data-href="${href}" ${extraAttributes}>
                <div class="card-image-wrapper img-loading">
                    ${imageHTML}
                    ${actionButtonsHTML}
                </div>
                <div class="card-content">
                    <h4 class="card-title">${title}</h4>
                    ${subtitle ? `<p class="card-subtitle">${subtitle}</p>` : ''}
                </div>
            </div>
        `;
    }

    createPlaylistCardHTML(playlist) {
        const imageId =
            playlist.squareImage ||
            playlist.image ||
            playlist.picture ||
            playlist.cover ||
            playlist.imageUrl ||
            playlist.images?.LARGE?.url ||
            playlist.images?.MEDIUM?.url ||
            playlist.images?.SMALL?.url ||
            null;
        const isCompact = cardSettings.isCompactAlbum();
        const trackCount = getPlaylistTrackCount(playlist);
        const playlistId = playlist.uuid || playlist.id;

        return this.createBaseCardHTML({
            type: 'playlist',
            id: playlistId,
            href: `/playlist/${playlistId}`,
            title: playlist.title,
            subtitle: `${trackCount} tracks`,
            imageHTML: this.createCoverImageHtml(this.api.getCoverUrl(imageId), playlist.title),
            actionButtonsHTML: '',
            isCompact,
        });
    }

    createFolderCardHTML(folder) {
        const imageSrc = folder.cover || 'assets/folder.png';
        const isCompact = cardSettings.isCompactAlbum();

        return this.createBaseCardHTML({
            type: 'folder',
            id: folder.id,
            href: `/folder/${folder.id}`,
            title: escapeHtml(folder.name),
            subtitle: `${folder.playlists ? folder.playlists.length : 0} playlists`,
            imageHTML: `<img src="${imageSrc}" alt="${escapeHtml(folder.name)}" class="card-image" loading="lazy" onerror="this.src='/assets/folder.png'">`,
            actionButtonsHTML: '',
            isCompact,
        });
    }

    createMixCardHTML(mix) {
        const imageSrc = mix.cover || '/assets/appicon.png';
        const description = mix.subTitle || mix.description || '';
        const isCompact = cardSettings.isCompactAlbum();

        return this.createBaseCardHTML({
            type: 'mix',
            id: mix.id,
            href: `/mix/${mix.id}`,
            title: mix.title,
            subtitle: description,
            imageHTML: this.createCoverImageHtml(imageSrc, mix.title),
            actionButtonsHTML: '',
            isCompact,
        });
    }

    createUserPlaylistCardHTML(playlist) {
        let imageHTML = '';
        if (playlist.cover) {
            imageHTML = `<img src="${playlist.cover}" alt="${playlist.name}" class="card-image" loading="lazy">`;
        } else {
            const tracks = playlist.tracks || [];
            let uniqueCovers = playlist.images || [];
            const seenCovers = new Set(uniqueCovers);

            if (uniqueCovers.length === 0) {
                for (const track of tracks) {
                    const cover = track.album?.cover;
                    if (cover && !seenCovers.has(cover)) {
                        seenCovers.add(cover);
                        uniqueCovers.push(cover);
                        if (uniqueCovers.length >= 4) break;
                    }
                }
            }

            if (uniqueCovers.length >= 2) {
                const count = Math.min(uniqueCovers.length, 4);
                const itemsClass = count < 4 ? `items-${count}` : '';
                const covers = uniqueCovers.slice(0, 4);
                imageHTML = `
                    <div class="card-image card-collage ${itemsClass}">
                        ${covers
                            .map((cover) =>
                                this.createCoverImageHtml(this.api.getCoverUrl(cover), playlist.name)
                                    .replace('class="card-image"', 'class="card-image collage-item"')
                                    .replace('loading="lazy"', 'loading="lazy"')
                            )
                            .join('')}
                    </div>
                `;
            } else if (uniqueCovers.length > 0) {
                imageHTML = this.createCoverImageHtml(this.api.getCoverUrl(uniqueCovers[0]), playlist.name);
            } else {
                imageHTML = `<img src="/assets/appicon.png" alt="${escapeHtml(playlist.name)}" class="card-image" loading="lazy">`;
            }
        }

        const isCompact = cardSettings.isCompactAlbum();
        const trackCount = getPlaylistTrackCount(playlist);

        return this.createBaseCardHTML({
            type: 'user-playlist', // Note: data-type logic in base might need adjustment if it uses this for buttons.
            // Actually Base uses type for data attributes. play-card uses data-type="user-playlist" which is correct.
            id: playlist.id,
            href: `/userplaylist/${playlist.id}`,
            title: escapeHtml(playlist.name),
            subtitle: `${trackCount} tracks`,
            imageHTML: imageHTML,
            actionButtonsHTML: `
                <button class="edit-playlist-btn" data-action="edit-playlist" title="Edit Playlist">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="delete-playlist-btn" data-action="delete-playlist" title="Delete Playlist">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18"/>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                        <line x1="10" y1="11" x2="10" y2="17"/>
                        <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                </button>
            `,
            isCompact,
            extraAttributes: 'draggable="true"',
            extraClasses: 'user-playlist',
        });
    }

    createCollaborativePlaylistImageHTML(playlist) {
        if (playlist?.cover) {
            return `<img src="${playlist.cover}" alt="${escapeHtml(playlist.name || 'Collaborative Playlist')}" class="card-image" loading="lazy">`;
        }

        const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
        let uniqueCovers = Array.isArray(playlist?.images) ? [...playlist.images] : [];
        const seenCovers = new Set(uniqueCovers);

        if (uniqueCovers.length === 0) {
            for (const track of tracks) {
                const cover = track?.album?.cover || track?.cover || '';
                if (cover && !seenCovers.has(cover)) {
                    seenCovers.add(cover);
                    uniqueCovers.push(cover);
                    if (uniqueCovers.length >= 4) break;
                }
            }
        }

        if (uniqueCovers.length >= 2) {
            const count = Math.min(uniqueCovers.length, 4);
            const itemsClass = count < 4 ? `items-${count}` : '';
            const covers = uniqueCovers.slice(0, 4);
            return `
                <div class="card-image card-collage ${itemsClass}">
                    ${covers.map((cover) => `<img src="${this.api.getCoverUrl(cover)}" alt="" loading="lazy">`).join('')}
                </div>
            `;
        }

        if (uniqueCovers.length === 1) {
            return `<img src="${this.api.getCoverUrl(uniqueCovers[0])}" alt="${escapeHtml(playlist?.name || 'Collaborative Playlist')}" class="card-image" loading="lazy">`;
        }

        return `<img src="${FALLBACK_COLLAB_PLAYLIST_COVER}" alt="${escapeHtml(playlist?.name || 'Collaborative Playlist')}" class="card-image" loading="lazy">`;
    }

    createAlbumCardHTML(album) {
        const explicitBadge = hasExplicitContent(album) ? this.createExplicitBadge() : '';
        const qualityBadge = createQualityBadgeHTML(album);
        const isBlocked = contentBlockingSettings?.shouldHideAlbum(album);
        let yearDisplay = '';
        if (album.releaseDate) {
            const date = new Date(album.releaseDate);
            if (!isNaN(date.getTime())) yearDisplay = `${date.getFullYear()}`;
        }

        let typeLabel = '';
        if (album.type === 'EP') typeLabel = ' • EP';
        else if (album.type === 'SINGLE') typeLabel = ' • Single';

        const isCompact = cardSettings.isCompactAlbum();
        let artistName = '';
        if (album.artist) {
            artistName = typeof album.artist === 'string' ? album.artist : album.artist.name;
        } else if (album.artists?.length) {
            artistName = album.artists.map((a) => a.name).join(', ');
        }

        return this.createBaseCardHTML({
            type: 'album',
            id: album.id,
            href: `/album/${album.id}`,
            title: `${escapeHtml(album.title)} ${explicitBadge} ${qualityBadge}`,
            subtitle: `${escapeHtml(artistName)} • ${yearDisplay}${typeLabel}`,
            imageHTML: this.createCoverImageHtml(this.api.getCoverUrl(album.cover), album.title),
            actionButtonsHTML: '',
            isCompact,
            extraClasses: isBlocked ? 'blocked' : '',
            extraAttributes: isBlocked
                ? `title="Blocked: ${contentBlockingSettings.isAlbumBlocked(album.id) ? 'Album blocked' : 'Artist blocked'}"`
                : '',
        });
    }

    createArtistCardHTML(artist) {
        const isCompact = cardSettings.isCompactArtist();
        const isBlocked = contentBlockingSettings?.shouldHideArtist(artist);
        const picture = artist?.picture || 'assets/appicon.png';

        return this.createBaseCardHTML({
            type: 'artist',
            id: artist.id,
            href: `/artist/${artist.id}`,
            title: escapeHtml(artist.name),
            subtitle: 'Artist',
            imageHTML: `<img src="${this.api.getArtistPictureUrl(picture)}" alt="${escapeHtml(artist.name)}" class="card-image" loading="lazy" onerror="this.onerror=null;this.src='assets/appicon.png'">`,
            actionButtonsHTML: '',
            isCompact,
            extraClasses: isBlocked ? ' blocked' : '',
            extraAttributes: isBlocked ? 'title="Blocked: Artist blocked"' : '',
        });
    }

    createSearchArtistCardHTML(artist) {
        const isBlocked = contentBlockingSettings?.shouldHideArtist(artist);
        const picture = artist?.picture || 'assets/appicon.png';

        return this.createBaseCardHTML({
            type: 'artist',
            id: artist.id,
            href: `/artist/${artist.id}`,
            title: escapeHtml(artist.name),
            subtitle: '',
            imageHTML: `<img src="${this.api.getArtistPictureUrl(picture)}" alt="${escapeHtml(artist.name)}" class="card-image" loading="lazy" onerror="this.onerror=null;this.src='assets/appicon.png'">`,
            actionButtonsHTML: '',
            isCompact: false,
            extraClasses: `artist search-artist-card${isBlocked ? ' blocked' : ''}`,
            extraAttributes: isBlocked ? 'title="Blocked: Artist blocked"' : '',
        });
    }

    createArtistCircularCardHTML(artist) {
        const isBlocked = contentBlockingSettings?.shouldHideArtist(artist);
        const picture = artist?.picture || 'assets/appicon.png';
        return this.createBaseCardHTML({
            type: 'artist',
            id: artist.id,
            href: `/artist/${artist.id}`,
            title: escapeHtml(artist.name),
            subtitle: '',
            imageHTML: `<img src="${this.api.getArtistPictureUrl(picture)}" alt="${escapeHtml(artist.name)}" class="card-image" loading="lazy" onerror="this.onerror=null;this.src='assets/appicon.png'">`,
            actionButtonsHTML: '',
            isCompact: false,
            extraClasses: `artist-circular${isBlocked ? ' blocked' : ''}`,
            extraAttributes: isBlocked ? 'title="Blocked: Artist blocked"' : '',
        });
    }

    createUserCardHTML(user) {
        return this.createBaseCardHTML({
            type: 'user',
            id: user.username,
            href: `/user/@${user.username}`,
            title: escapeHtml(user.display_name || user.username),
            subtitle: `@${escapeHtml(user.username)}`,
            imageHTML: `<img src="${user.avatar_url || 'assets/appicon.png'}" alt="${escapeHtml(user.username)}" class="card-image" loading="lazy" style="border-radius: 50%;">`,
            actionButtonsHTML: '',
            isCompact: false,
            extraClasses: 'user-profile-card',
            extraAttributes: '',
        });
    }

    createSkeletonTrack(showCover = false) {
        return `
            <div class="skeleton-track">
                ${showCover ? '<div class="skeleton skeleton-track-cover"></div>' : '<div class="skeleton skeleton-track-number"></div>'}
                <div class="skeleton-track-info">
                    <div class="skeleton-track-details">
                        <div class="skeleton skeleton-track-title"></div>
                        <div class="skeleton skeleton-track-artist"></div>
                    </div>
                </div>
                <div class="skeleton skeleton-track-duration"></div>
                <div class="skeleton skeleton-track-actions"></div>
            </div>
        `;
    }

    createSkeletonCard(isArtist = false) {
        return `
            <div class="skeleton-card ${isArtist ? 'artist' : ''}">
                <div class="skeleton skeleton-card-image"></div>
                <div class="skeleton skeleton-card-title"></div>
                ${!isArtist ? '<div class="skeleton skeleton-card-subtitle"></div>' : ''}
            </div>
        `;
    }

    createSkeletonTracks(count = 5, showCover = false) {
        return Array(count)
            .fill(0)
            .map(() => this.createSkeletonTrack(showCover))
            .join('');
    }

    createSkeletonCards(count = 6, isArtist = false) {
        return Array(count)
            .fill(0)
            .map(() => this.createSkeletonCard(isArtist))
            .join('');
    }

    setupSearchClearButton(inputElement, clearBtnSelector = '.search-clear-btn') {
        if (!inputElement) return;

        const clearBtn = inputElement.parentElement?.querySelector(clearBtnSelector);
        if (clearBtn) {
            clearBtn.remove();
        }
    }

    setupTracklistSearch(
        searchInputId = 'track-list-search-input',
        tracklistContainerId = 'playlist-detail-tracklist'
    ) {
        const searchInput = document.getElementById(searchInputId);
        const tracklistContainer = document.getElementById(tracklistContainerId);

        if (!searchInput || !tracklistContainer) return;

        // Setup clear button
        this.setupSearchClearButton(searchInput);

        // Remove previous listener if exists
        const oldListener = searchInput._searchListener;
        if (oldListener) {
            searchInput.removeEventListener('input', oldListener);
        }

        // Create new listener
        const listener = () => {
            const query = searchInput.value.toLowerCase().trim();
            const trackItems = tracklistContainer.querySelectorAll('.track-item');

            trackItems.forEach((item) => {
                const trackData = trackDataStore.get(item);
                if (!trackData) {
                    item.style.display = '';
                    return;
                }

                const title = (trackData.title || '').toLowerCase();
                const artist = (trackData.artist?.name || trackData.artists?.[0]?.name || '').toLowerCase();
                const album = (trackData.album?.title || '').toLowerCase();

                const matches = title.includes(query) || artist.includes(query) || album.includes(query);
                item.style.display = matches ? '' : 'none';
            });
        };

        searchInput._searchListener = listener;
        searchInput.addEventListener('input', listener);
    }

    renderListWithTracks(container, tracks, showCover, append = false, useTrackNumber = false) {
        const fragment = document.createDocumentFragment();
        const tempDiv = document.createElement('div');

        // Check if there are multiple discs in the tracks array
        const hasMultipleDiscs = tracks.some((t) => (t.volumeNumber || t.discNumber || 1) > 1);

        tempDiv.innerHTML = tracks
            .map((track, i) => this.createTrackItemHTML(track, i, showCover, hasMultipleDiscs, useTrackNumber))
            .join('');

        // Bind data to elements immediately using index, avoiding selector ambiguity
        Array.from(tempDiv.children).forEach((element, index) => {
            const track = tracks[index];
            if (element && track) {
                trackDataStore.set(element, track);
                // Async update for like button
                this.updateLikeState(element, 'track', track.id);
            }
        });

        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }

        if (!append) container.innerHTML = '';
        container.appendChild(fragment);
    }

    setPageBackground(imageUrl, fallbackImageUrl = null) {
        const bgElement = document.getElementById('page-background');

        const removeExistingVideo = () => {
            const existingVideo = bgElement.querySelector('.page-background-video');
            if (existingVideo) {
                try {
                    existingVideo.pause();
                } catch (_error) {
                    void _error;
                    // ignore if media element is already detached
                }
                existingVideo.remove();
            }
            bgElement.classList.remove('has-video');
        };

        const isVideoSource =
            typeof imageUrl === 'string' && (imageUrl.includes('.mp4') || imageUrl.startsWith('blob:video'));

        const effectiveImageUrl = imageUrl;

        bgElement.dataset.visualUrl = imageUrl || '';
        bgElement.dataset.fallbackUrl = fallbackImageUrl || '';

        if (backgroundSettings.isEnabled() && effectiveImageUrl) {
            if (isVideoSource) {
                removeExistingVideo();
                bgElement.style.backgroundImage = '';

                const video = document.createElement('video');
                video.className = 'page-background-video';
                video.src = imageUrl;
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.playsInline = true;
                video.preload = 'metadata';

                video.addEventListener('error', () => {
                    removeExistingVideo();
                });

                bgElement.appendChild(video);
                bgElement.classList.add('has-video');
            } else {
                removeExistingVideo();
                bgElement.style.backgroundImage = `url('${effectiveImageUrl}')`;
            }

            bgElement.classList.add('active');
            document.body.classList.add('has-page-background');
        } else {
            removeExistingVideo();
            bgElement.classList.remove('active');
            document.body.classList.remove('has-page-background');
            // Delay clearing the image to allow transition
            setTimeout(() => {
                if (!bgElement.classList.contains('active')) {
                    bgElement.style.backgroundImage = '';
                }
            }, 500);
        }
    }

    resetVibrantColor() {
        this._lastPaletteUrl = null;
        resetPalette();
    }

    _hashStringToUint32(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    _createSeededRng(seed) {
        let state = seed >>> 0;
        return () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
    }

    _applyFullscreenBackgroundMotionVars(overlay, track, coverUrl) {
        if (!overlay) return;

        const seed = this._hashStringToUint32(`${track?.id ?? ''}|${coverUrl || ''}|${track?.duration || ''}`);
        const random = this._createSeededRng(seed || 1);

        const driftA = `${(42 + random() * 16).toFixed(1)}% ${(44 + random() * 16).toFixed(1)}%`;
        const driftB = `${(44 + random() * 16).toFixed(1)}% ${(44 + random() * 16).toFixed(1)}%`;
        const driftC = `${(42 + random() * 16).toFixed(1)}% ${(44 + random() * 16).toFixed(1)}%`;

        const originX = `${(26 + random() * 48).toFixed(1)}%`;
        const originY = `${(24 + random() * 52).toFixed(1)}%`;
        const rotationMid = `${(random() * 7.2 - 3.6).toFixed(2)}deg`;
        const rotationEnd = `${(random() * 6.4 - 3.2).toFixed(2)}deg`;
        const panDuration = `${(18 + random() * 14).toFixed(2)}s`;
        const rotateDuration = `${(54 + random() * 34).toFixed(2)}s`;
        const rotateDirection = random() > 0.5 ? '1' : '-1';

        overlay.style.setProperty('--fs-bg-pos-1', driftA);
        overlay.style.setProperty('--fs-bg-pos-2', driftB);
        overlay.style.setProperty('--fs-bg-pos-3', driftC);
        overlay.style.setProperty('--fs-bg-origin-x', originX);
        overlay.style.setProperty('--fs-bg-origin-y', originY);
        overlay.style.setProperty('--fs-bg-rot-start', '0deg');
        overlay.style.setProperty('--fs-bg-rot-mid', rotationMid);
        overlay.style.setProperty('--fs-bg-rot-end', rotationEnd);
        overlay.style.setProperty('--fs-bg-pan-duration', panDuration);
        overlay.style.setProperty('--fs-bg-rotate-duration', rotateDuration);
        overlay.style.setProperty('--fs-bg-rotate-direction', rotateDirection);
    }

    _formatFullscreenTitleWithBracketLines(rawTitle, qualityBadge = '') {
        const safeTitle = escapeHtml(rawTitle || '');
        if (!safeTitle) return qualityBadge || '';

        const bracketMatches = safeTitle.match(/\[[^\]]+\]/g) || [];
        if (bracketMatches.length === 0) {
            return `${safeTitle}${qualityBadge ? ` ${qualityBadge}` : ''}`;
        }

        const mainTitle = safeTitle
            .replace(/\s*\[[^\]]+\]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        const bracketHtml = bracketMatches
            .map((segment) => `<span class="fullscreen-title-bracket">${segment}</span>`)
            .join('');

        return `
            <span class="fullscreen-title-main">${mainTitle || safeTitle}</span>${qualityBadge ? ` ${qualityBadge}` : ''}
            <span class="fullscreen-title-brackets">${bracketHtml}</span>
        `;
    }

    updateFullscreenMetadata(track, nextTrack) {
        if (!track) return;
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const image = document.getElementById('fullscreen-cover-image');
        const title = document.getElementById('fullscreen-track-title');
        const artist = document.getElementById('fullscreen-track-artist');
        const nextTrackEl = document.getElementById('fullscreen-next-track');

        const coverUrl = this.api.getCoverUrl(track.album?.cover, '1280');

        const fsLikeBtn = document.getElementById('fs-like-btn');
        if (fsLikeBtn) {
            this.updateLikeState(fsLikeBtn.parentElement, 'track', track.id);
        }

        if (image.src !== coverUrl) {
            image.src = coverUrl;
            overlay?.style.setProperty('--bg-image', `url('${coverUrl}')`);
            this._applyFullscreenBackgroundMotionVars(overlay, track, coverUrl);
            this.extractAndApplyColor(coverUrl);
        }

        this.currentTrack = track;
        if (this.visualizer?.setTrack) {
            this.visualizer.setTrack(track);
        }

        const qualityBadge = createQualityBadgeHTML(track);
        title.innerHTML = this._formatFullscreenTitleWithBracketLines(track.title, qualityBadge);
        artist.textContent = getTrackArtists(track);

        const fullscreenQuality = document.getElementById('fullscreen-track-quality');
        if (fullscreenQuality) {
            fullscreenQuality.innerHTML = createFullscreenQualityHTML(track);
        }

        if (nextTrack) {
            nextTrackEl.style.display = 'flex';
            nextTrackEl.querySelector('.value').textContent = `${nextTrack.title} • ${getTrackArtists(nextTrack)}`;
        } else {
            nextTrackEl.style.display = 'none';
        }
    }

    async showFullscreenCover(track, nextTrack, lyricsManager, audioPlayer) {
        if (!track) return;
        if (window.location.hash !== '#fullscreen') {
            window.history.pushState({ fullscreen: true }, '', '#fullscreen');
        }
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const nextTrackEl = document.getElementById('fullscreen-next-track');
        const lyricsToggleBtn = document.getElementById('toggle-fullscreen-lyrics-btn');
        const fullscreenCover = document.getElementById('fullscreen-cover-image');

        this.updateFullscreenMetadata(track, nextTrack);

        // Apply fullscreen rotating disc effect based on rotating cover setting.
        const vinylContainer = document.getElementById('vinyl-disc-container');
        const shouldRotateDisc = rotatingCoverSettings.isEnabled();
        if (fullscreenCover && vinylContainer) {
            vinylContainer.classList.remove('spin-reverse');
            if (shouldRotateDisc) {
                vinylContainer.classList.add('rotating-disc');
                if (audioPlayer && !audioPlayer.paused) {
                    vinylContainer.classList.remove('paused');
                } else {
                    vinylContainer.classList.add('paused');
                }
            } else {
                vinylContainer.classList.remove('rotating-disc', 'paused');
            }
        }

        this._fullscreenAudioPlayer = audioPlayer;
        this.startFullscreenDiscRotationSync(audioPlayer);

        if (nextTrack) {
            nextTrackEl.classList.remove('animate-in');
            void nextTrackEl.offsetWidth;
            nextTrackEl.classList.add('animate-in');
        } else {
            nextTrackEl.classList.remove('animate-in');
        }

        if (lyricsManager && audioPlayer) {
            lyricsToggleBtn.style.display = 'flex';
            lyricsToggleBtn.classList.remove('active');

            const toggleLyrics = () => {
                openLyricsPanel(track, audioPlayer, lyricsManager);
                lyricsToggleBtn.classList.toggle('active');
            };

            const newToggleBtn = lyricsToggleBtn.cloneNode(true);
            lyricsToggleBtn.parentNode.replaceChild(newToggleBtn, lyricsToggleBtn);
            newToggleBtn.addEventListener('click', toggleLyrics);
        } else {
            lyricsToggleBtn.style.display = 'none';
        }

        const playerBar = document.querySelector('.now-playing-bar');
        if (playerBar) playerBar.style.display = 'none';

        overlay.style.display = 'flex';
        this.startAdaptiveFullscreenDiscSizing();
        this.refreshFullscreenDiscScrubbing();

        try {
            this.setupFullscreenControls(audioPlayer);
        } catch (error) {
            console.warn('Failed to initialize fullscreen controls:', error);
        }

        const startVisualizer = () => {
            if (!visualizerSettings.isEnabled()) {
                if (this.visualizer) this.visualizer.stop();
                return;
            }

            if (!this.visualizer && audioPlayer) {
                const canvas = document.getElementById('visualizer-canvas');
                if (canvas) {
                    this.visualizer = new Visualizer(canvas, audioPlayer, {
                        api: this.api,
                        track,
                    });
                }
            }
            if (this.visualizer) {
                this.visualizer.setTrack(track);
                this.visualizer.start();
            }
        };

        if (localStorage.getItem('epilepsy-warning-dismissed') === 'true') {
            startVisualizer();
        } else {
            const modal = document.getElementById('epilepsy-warning-modal');
            if (modal) {
                modal.classList.add('active');

                const acceptBtn = document.getElementById('epilepsy-accept-btn');
                const cancelBtn = document.getElementById('epilepsy-cancel-btn');

                acceptBtn.onclick = () => {
                    modal.classList.remove('active');
                    localStorage.setItem('epilepsy-warning-dismissed', 'true');
                    startVisualizer();
                };
                cancelBtn.onclick = () => {
                    modal.classList.remove('active');
                    this.closeFullscreenCover();
                };
            } else {
                startVisualizer();
            }
        }
    }

    closeFullscreenCover() {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        overlay.style.display = 'none';

        if (this.fullscreenDiscScrubCleanup) {
            this.fullscreenDiscScrubCleanup();
            this.fullscreenDiscScrubCleanup = null;
        }
        this.stopAdaptiveFullscreenDiscSizing();
        this.stopFullscreenDiscRotationSync();
        this._fullscreenAudioPlayer = null;

        // Remove rotating disc classes
        const vinylContainer = document.getElementById('vinyl-disc-container');
        if (vinylContainer) {
            vinylContainer.classList.remove('rotating-disc', 'paused', 'spin-reverse');
        }

        const playerBar = document.querySelector('.now-playing-bar');
        if (playerBar) playerBar.style.removeProperty('display');

        if (this.fullscreenUpdateInterval) {
            cancelAnimationFrame(this.fullscreenUpdateInterval);
            this.fullscreenUpdateInterval = null;
        }

        if (this.visualizer) {
            this.visualizer.stop();
        }

        if (this.fsVideoController) {
            this.fsVideoController.disable();
        }
    }

    isFullscreenCoverOpen() {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        return Boolean(overlay && overlay.style.display !== 'none');
    }

    applyAdaptiveFullscreenDiscSize() {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const mainView = overlay?.querySelector('.fullscreen-main-view');
        const vinylContainer = document.getElementById('vinyl-disc-container');
        const trackInfo = overlay?.querySelector('.fullscreen-track-info');
        const controls = overlay?.querySelector('.fullscreen-controls');

        if (!overlay || !mainView || !vinylContainer || overlay.style.display === 'none') return;

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const isLandscape = viewportWidth > viewportHeight;
        const mainRect = mainView.getBoundingClientRect();

        const infoHeight = trackInfo?.offsetHeight || 0;
        const controlsHeight = controls?.offsetHeight || 0;
        const verticalPaddingReserve = isLandscape ? 48 : 32;

        const verticalBudget = Math.max(220, mainRect.height - infoHeight - controlsHeight - verticalPaddingReserve);
        const horizontalBudget = Math.max(220, mainRect.width - (isLandscape ? 72 : 32));

        const sizeByWidth = horizontalBudget * (isLandscape ? 0.5 : 0.72);
        const sizeByHeight = verticalBudget * (isLandscape ? 0.72 : 0.78);
        const targetSize = Math.min(sizeByWidth, sizeByHeight);

        // Keep fullscreen vinyl at a smaller fixed range with a strict max limit.
        const minSize = isLandscape ? 220 : 210;
        const maxSize = isLandscape ? 340 : 320;

        const finalSize = Math.max(minSize, Math.min(maxSize, targetSize));
        vinylContainer.style.setProperty('--vinyl-disc-size', `${Math.round(finalSize)}px`);
    }

    startAdaptiveFullscreenDiscSizing() {
        this.stopAdaptiveFullscreenDiscSizing();

        this._fullscreenDiscResizeHandler = () => {
            requestAnimationFrame(() => this.applyAdaptiveFullscreenDiscSize());
        };

        window.addEventListener('resize', this._fullscreenDiscResizeHandler);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this._fullscreenDiscResizeHandler);
        }

        requestAnimationFrame(() => this.applyAdaptiveFullscreenDiscSize());
    }

    stopAdaptiveFullscreenDiscSizing() {
        if (!this._fullscreenDiscResizeHandler) return;

        window.removeEventListener('resize', this._fullscreenDiscResizeHandler);
        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', this._fullscreenDiscResizeHandler);
        }
        this._fullscreenDiscResizeHandler = null;

        const vinylContainer = document.getElementById('vinyl-disc-container');
        vinylContainer?.style.removeProperty('--vinyl-disc-size');
    }

    refreshFullscreenDiscScrubbing() {
        if (this.fullscreenDiscScrubCleanup) {
            this.fullscreenDiscScrubCleanup();
            this.fullscreenDiscScrubCleanup = null;
        }

        if (!this.isFullscreenCoverOpen() || !this._fullscreenAudioPlayer) return;
        this.fullscreenDiscScrubCleanup = this.setupFullscreenDiscScrubbing(this._fullscreenAudioPlayer);
    }

    /*
     * Fullscreen DJ disc motion uses a playback-synced RAF loop.
     * Scrub/inertia temporarily take control and hand back with preserved phase.
     */

    startFullscreenDiscRotationSync(_audioPlayer) {
        const audioPlayer = _audioPlayer || this._fullscreenAudioPlayer;
        const vinylContainer = document.getElementById('vinyl-disc-container');
        if (!audioPlayer || !vinylContainer) return;

        this.stopFullscreenDiscRotationSync();

        const parseSecondsPerDegree = () => {
            const durationVar = getComputedStyle(vinylContainer).getPropertyValue('--vinyl-rotation-duration').trim();
            if (durationVar.endsWith('s')) {
                const secondsPerRevolution = parseFloat(durationVar.slice(0, -1));
                if (Number.isFinite(secondsPerRevolution) && secondsPerRevolution > 0) {
                    return secondsPerRevolution / 360;
                }
            }

            return 2.45 / 360;
        };

        const getCurrentRotationDegrees = () => {
            const computedTransform = getComputedStyle(vinylContainer).transform;
            if (!computedTransform || computedTransform === 'none') return 0;

            const matrixValues = computedTransform.match(/matrix\(([^)]+)\)/);
            if (matrixValues?.[1]) {
                const [a, b] = matrixValues[1].split(',').map((value) => parseFloat(value.trim()));
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    return (Math.atan2(b, a) * 180) / Math.PI;
                }
            }

            const matrix3dValues = computedTransform.match(/matrix3d\(([^)]+)\)/);
            if (matrix3dValues?.[1]) {
                const values = matrix3dValues[1].split(',').map((value) => parseFloat(value.trim()));
                const a = values[0];
                const b = values[1];
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    return (Math.atan2(b, a) * 180) / Math.PI;
                }
            }

            return 0;
        };

        let motionState = this._fullscreenDiscMotionState;
        if (!motionState) {
            motionState = {
                phaseOffsetDeg: 0,
                hasPhase: false,
                rotationDeg: 0,
                isUserControlling: false,
                isInertiaActive: false,
                hasSpinReverse: false,
                secondsPerDegree: parseSecondsPerDegree(),
            };
            this._fullscreenDiscMotionState = motionState;
        }

        motionState.secondsPerDegree = parseSecondsPerDegree();
        const coarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        const isFirefox = /firefox/i.test(navigator.userAgent || '');
        const maxFps = coarsePointer || isFirefox ? 40 : 60;
        const minFrameDeltaMs = 1000 / maxFps;
        const minAngleDelta = coarsePointer || isFirefox ? 0.2 : 0.1;
        let lastFrameTs = 0;
        let lastAppliedRotation = Number.NaN;

        const tick = (timestamp = 0) => {
            if (!this.isFullscreenCoverOpen()) {
                this._fullscreenDiscRotationRaf = null;
                return;
            }

            if (timestamp - lastFrameTs < minFrameDeltaMs) {
                this._fullscreenDiscRotationRaf = requestAnimationFrame(tick);
                return;
            }
            lastFrameTs = timestamp;

            // Skip visual updates when page is hidden to reduce CPU/GPU load
            if (document.visibilityState === 'hidden') {
                this._fullscreenDiscRotationRaf = requestAnimationFrame(tick);
                return;
            }

            if (!rotatingCoverSettings.isEnabled()) {
                vinylContainer.style.transform = '';
                vinylContainer.classList.remove('spin-reverse');
                motionState.hasPhase = false;
                this._fullscreenDiscRotationRaf = requestAnimationFrame(tick);
                return;
            }

            if (!motionState.isUserControlling && !motionState.isInertiaActive) {
                const safeCurrentTime = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;

                if (!motionState.hasPhase) {
                    const currentRotation = getCurrentRotationDegrees();
                    motionState.rotationDeg = currentRotation;
                    motionState.phaseOffsetDeg = currentRotation - safeCurrentTime / motionState.secondsPerDegree;
                    motionState.hasPhase = true;
                }

                const nextRotation = motionState.phaseOffsetDeg + safeCurrentTime / motionState.secondsPerDegree;
                motionState.rotationDeg = nextRotation;
                if (
                    !Number.isFinite(lastAppliedRotation) ||
                    Math.abs(nextRotation - lastAppliedRotation) >= minAngleDelta
                ) {
                    vinylContainer.style.transform = `rotate3d(0, 0, 1, ${nextRotation.toFixed(3)}deg)`;
                    lastAppliedRotation = nextRotation;
                }
                if (motionState.hasSpinReverse) {
                    vinylContainer.classList.remove('spin-reverse');
                    motionState.hasSpinReverse = false;
                }
            }

            this._fullscreenDiscRotationRaf = requestAnimationFrame(tick);
        };

        this._fullscreenDiscRotationRaf = requestAnimationFrame(tick);
    }

    stopFullscreenDiscRotationSync() {
        if (this._fullscreenDiscRotationRaf) {
            cancelAnimationFrame(this._fullscreenDiscRotationRaf);
            this._fullscreenDiscRotationRaf = null;
        }

        if (this._fullscreenDiscMotionState) {
            this._fullscreenDiscMotionState.isUserControlling = false;
            this._fullscreenDiscMotionState.isInertiaActive = false;
        }
    }

    setupFullscreenDiscScrubbing(audioPlayer) {
        const vinylContainer = document.getElementById('vinyl-disc-container');
        const fullscreenCover = document.getElementById('fullscreen-cover-image');
        if (!vinylContainer || !fullscreenCover || !audioPlayer) return null;

        const isEnabled = rotatingCoverSettings.isEnabled() && rotatingCoverSettings.isDiscScratchEnabled();

        const resetDiscScrubState = () => {
            vinylContainer.classList.remove('disc-scrub-enabled', 'disc-scrubbing', 'spin-reverse');
            fullscreenCover.style.removeProperty('pointer-events');
        };

        if (!isEnabled) {
            resetDiscScrubState();
            return null;
        }

        vinylContainer.classList.add('disc-scrub-enabled');
        // Prevent fullscreen close-on-cover-click while scrubbing is enabled.
        fullscreenCover.style.pointerEvents = 'none';

        let motionState = this._fullscreenDiscMotionState;
        if (!motionState) {
            motionState = {
                phaseOffsetDeg: 0,
                hasPhase: false,
                rotationDeg: 0,
                isUserControlling: false,
                isInertiaActive: false,
                secondsPerDegree: 2.45 / 360,
            };
            this._fullscreenDiscMotionState = motionState;
        }

        if (!(Number.isFinite(motionState.secondsPerDegree) && motionState.secondsPerDegree > 0)) {
            motionState.secondsPerDegree = 2.45 / 360;
        }

        const SECONDS_PER_DEGREE = motionState.secondsPerDegree;
        const SCRUB_LERP = 0.34;
        const INERTIA_DECAY = 0.9;
        const INERTIA_STOP_THRESHOLD = 0.08;
        let dragging = false;
        let activePointerId = null;
        let lastAngle = 0;
        let targetRotation = 0;
        let renderedRotation = 0;
        let angularVelocity = 0;
        let lastPointerTime = 0;
        let pendingSeekSeconds = 0;
        let seekRafId = null;
        let scrubVisualRafId = null;
        let inertiaRafId = null;

        const getCurrentRotationDegrees = () => {
            const computedTransform = getComputedStyle(vinylContainer).transform;
            if (!computedTransform || computedTransform === 'none') return 0;

            const matrixValues = computedTransform.match(/matrix\(([^)]+)\)/);
            if (matrixValues?.[1]) {
                const [a, b] = matrixValues[1].split(',').map((value) => parseFloat(value.trim()));
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    return (Math.atan2(b, a) * 180) / Math.PI;
                }
            }

            const matrix3dValues = computedTransform.match(/matrix3d\(([^)]+)\)/);
            if (matrix3dValues?.[1]) {
                const values = matrix3dValues[1].split(',').map((value) => parseFloat(value.trim()));
                const a = values[0];
                const b = values[1];
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    return (Math.atan2(b, a) * 180) / Math.PI;
                }
            }

            return 0;
        };

        const getCenterAngle = (event) => {
            const rect = vinylContainer.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const dx = event.clientX - centerX;
            const dy = event.clientY - centerY;
            const radius = Math.hypot(dx, dy);
            if (radius < rect.width * 0.12) {
                return null;
            }
            return (Math.atan2(dy, dx) * 180) / Math.PI;
        };

        const normalizeDeltaAngle = (delta) => {
            if (delta > 180) return delta - 360;
            if (delta < -180) return delta + 360;
            return delta;
        };

        const applySeekDelta = (secondsDelta) => {
            if (!Number.isFinite(secondsDelta) || Math.abs(secondsDelta) < 0.0001) return;
            const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : Infinity;
            const nextTime = Math.max(0, Math.min(duration, audioPlayer.currentTime + secondsDelta));
            audioPlayer.currentTime = nextTime;
        };

        const flushPendingSeek = () => {
            seekRafId = null;
            if (pendingSeekSeconds !== 0) {
                applySeekDelta(pendingSeekSeconds);
                pendingSeekSeconds = 0;
            }
        };

        const scheduleSeekFlush = () => {
            if (seekRafId) return;
            seekRafId = requestAnimationFrame(flushPendingSeek);
        };

        const startScrubVisualLoop = () => {
            if (scrubVisualRafId) return;

            const tick = () => {
                const delta = targetRotation - renderedRotation;
                if (Math.abs(delta) > 0.01) {
                    renderedRotation += delta * SCRUB_LERP;
                } else {
                    renderedRotation = targetRotation;
                }

                vinylContainer.style.transform = `rotate(${renderedRotation.toFixed(2)}deg)`;

                if (dragging || inertiaRafId || Math.abs(targetRotation - renderedRotation) > 0.02) {
                    scrubVisualRafId = requestAnimationFrame(tick);
                } else {
                    scrubVisualRafId = null;
                }
            };

            scrubVisualRafId = requestAnimationFrame(tick);
        };

        const releaseScrubControl = () => {
            if (seekRafId) {
                cancelAnimationFrame(seekRafId);
                seekRafId = null;
            }
            flushPendingSeek();

            motionState.rotationDeg = renderedRotation;
            const safeCurrentTime = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
            motionState.phaseOffsetDeg = renderedRotation - safeCurrentTime / SECONDS_PER_DEGREE;
            motionState.hasPhase = true;
            motionState.isUserControlling = false;
            motionState.isInertiaActive = false;

            vinylContainer.classList.remove('spin-reverse');

            if (!audioPlayer.paused) {
                vinylContainer.classList.remove('paused');
            } else {
                vinylContainer.classList.add('paused');
            }
        };

        const startInertiaSpin = () => {
            if (inertiaRafId) {
                cancelAnimationFrame(inertiaRafId);
                inertiaRafId = null;
            }

            if (Math.abs(angularVelocity) < INERTIA_STOP_THRESHOLD) {
                releaseScrubControl();
                return;
            }

            motionState.isInertiaActive = true;

            const inertiaTick = () => {
                angularVelocity *= INERTIA_DECAY;

                if (Math.abs(angularVelocity) < INERTIA_STOP_THRESHOLD) {
                    inertiaRafId = null;
                    releaseScrubControl();
                    return;
                }

                targetRotation += angularVelocity;

                if (angularVelocity < 0) {
                    vinylContainer.classList.add('spin-reverse');
                    motionState.hasSpinReverse = true;
                } else {
                    vinylContainer.classList.remove('spin-reverse');
                    motionState.hasSpinReverse = false;
                }

                pendingSeekSeconds += angularVelocity * SECONDS_PER_DEGREE;
                scheduleSeekFlush();
                startScrubVisualLoop();
                inertiaRafId = requestAnimationFrame(inertiaTick);
            };

            inertiaRafId = requestAnimationFrame(inertiaTick);
        };

        const stopDragging = (skipInertia = false) => {
            if (!dragging) return;
            dragging = false;
            motionState.isUserControlling = false;

            vinylContainer.classList.remove('disc-scrubbing');
            if (skipInertia) {
                releaseScrubControl();
                return;
            }

            startInertiaSpin();
        };

        const onPointerDown = (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;

            const startAngle = getCenterAngle(event);
            if (startAngle === null) return;

            dragging = true;
            motionState.isUserControlling = true;
            motionState.isInertiaActive = false;
            activePointerId = event.pointerId;
            lastAngle = startAngle;
            const currentRotation = getCurrentRotationDegrees();
            targetRotation = currentRotation;
            renderedRotation = currentRotation;
            motionState.rotationDeg = currentRotation;
            angularVelocity = 0;
            lastPointerTime = performance.now();
            pendingSeekSeconds = 0;

            if (inertiaRafId) {
                cancelAnimationFrame(inertiaRafId);
                inertiaRafId = null;
            }

            if (event.pointerId !== undefined && vinylContainer.setPointerCapture) {
                vinylContainer.setPointerCapture(event.pointerId);
            }

            vinylContainer.classList.add('disc-scrubbing');
            startScrubVisualLoop();
            event.preventDefault();
        };

        const onPointerMove = (event) => {
            if (!dragging) return;
            if (activePointerId !== null && event.pointerId !== activePointerId) return;

            const angle = getCenterAngle(event);
            if (angle === null) return;
            const deltaAngle = normalizeDeltaAngle(angle - lastAngle);
            if (Math.abs(deltaAngle) < 0.05) return;

            if (deltaAngle < 0) {
                vinylContainer.classList.add('spin-reverse');
                motionState.hasSpinReverse = true;
            } else {
                vinylContainer.classList.remove('spin-reverse');
                motionState.hasSpinReverse = false;
            }

            const now = performance.now();
            const frameUnit = Math.max(0.5, (now - lastPointerTime) / (1000 / 60));
            angularVelocity = deltaAngle / frameUnit;
            lastPointerTime = now;

            lastAngle = angle;
            targetRotation += deltaAngle;
            startScrubVisualLoop();

            pendingSeekSeconds += deltaAngle * SECONDS_PER_DEGREE;
            scheduleSeekFlush();
            event.preventDefault();
        };

        const onPointerUp = (event) => {
            if (activePointerId !== null && event.pointerId !== activePointerId) return;
            if (event.pointerId !== undefined && vinylContainer.releasePointerCapture) {
                try {
                    vinylContainer.releasePointerCapture(event.pointerId);
                } catch {
                    // Ignore if pointer capture was already released.
                }
            }
            activePointerId = null;
            stopDragging();
        };

        const onPointerCancel = (event) => {
            if (activePointerId !== null && event.pointerId !== activePointerId) return;
            activePointerId = null;
            stopDragging();
        };

        vinylContainer.addEventListener('pointerdown', onPointerDown);
        vinylContainer.addEventListener('pointermove', onPointerMove, { passive: false });
        vinylContainer.addEventListener('pointerup', onPointerUp);
        vinylContainer.addEventListener('pointercancel', onPointerCancel);

        return () => {
            if (inertiaRafId) {
                cancelAnimationFrame(inertiaRafId);
                inertiaRafId = null;
            }
            if (scrubVisualRafId) {
                cancelAnimationFrame(scrubVisualRafId);
                scrubVisualRafId = null;
            }
            if (seekRafId) {
                cancelAnimationFrame(seekRafId);
                seekRafId = null;
            }
            flushPendingSeek();
            stopDragging(true);
            vinylContainer.removeEventListener('pointerdown', onPointerDown);
            vinylContainer.removeEventListener('pointermove', onPointerMove);
            vinylContainer.removeEventListener('pointerup', onPointerUp);
            vinylContainer.removeEventListener('pointercancel', onPointerCancel);
            resetDiscScrubState();
        };
    }

    setupFullscreenControls(audioPlayer) {
        const playBtn = document.getElementById('fs-play-pause-btn');
        const prevBtn = document.getElementById('fs-prev-btn');
        const nextBtn = document.getElementById('fs-next-btn');
        const shuffleBtn = document.getElementById('fs-shuffle-btn');
        const repeatBtn = document.getElementById('fs-repeat-btn');
        const progressBar = document.getElementById('fs-progress-bar');
        const progressFill = document.getElementById('fs-progress-fill');
        const currentTimeEl = document.getElementById('fs-current-time');
        const totalDurationEl = document.getElementById('fs-total-duration');
        const fsLikeBtn = document.getElementById('fs-like-btn');
        const fsAddPlaylistBtn = document.getElementById('fs-add-playlist-btn');
        const fsDownloadBtn = document.getElementById('fs-download-btn');
        const fsCastBtn = document.getElementById('fs-cast-btn');
        const fsQueueBtn = document.getElementById('fs-queue-btn');
        const artistEl = document.getElementById('fullscreen-track-artist');

        if (
            !audioPlayer ||
            !playBtn ||
            !prevBtn ||
            !nextBtn ||
            !shuffleBtn ||
            !repeatBtn ||
            !progressBar ||
            !progressFill ||
            !currentTimeEl ||
            !totalDurationEl
        ) {
            return;
        }

        if (artistEl) {
            artistEl.style.cursor = 'pointer';
            artistEl.onclick = () => {
                const track = this.player.currentTrack;
                if (!track) return;
                this.closeFullscreenCover();
                if (track.artist?.id) {
                    navigate(`/artist/${track.artist.id}`);
                } else if (track.artist?.name) {
                    this.api
                        .resolveArtistIdByName(track.artist.name)
                        .then((resolvedId) => {
                            if (resolvedId) navigate(`/artist/${resolvedId}`);
                        })
                        .catch((err) => console.warn('Failed to resolve artist by name:', track.artist.name, err));
                }
            };
        }

        let lastPausedState = null;
        let fsPlaybackBuffering = false;
        const updatePlayBtn = () => {
            playBtn.classList.toggle('buffering', fsPlaybackBuffering);
            if (fsPlaybackBuffering) return;

            const isPaused = audioPlayer.paused;
            if (isPaused === lastPausedState) return;
            lastPausedState = isPaused;

            if (isPaused) {
                playBtn.innerHTML = SVG_PLAY;
            } else {
                playBtn.innerHTML = SVG_PAUSE;
            }
        };

        updatePlayBtn();

        audioPlayer.addEventListener('loadstart', () => {
            fsPlaybackBuffering = true;
            updatePlayBtn();
        });
        audioPlayer.addEventListener('waiting', () => {
            fsPlaybackBuffering = true;
            updatePlayBtn();
        });
        ['playing', 'pause', 'ended', 'error', 'abort', 'emptied'].forEach((eventName) => {
            audioPlayer.addEventListener(eventName, () => {
                fsPlaybackBuffering = false;
                updatePlayBtn();
            });
        });
        audioPlayer.addEventListener('play', updatePlayBtn);
        audioPlayer.addEventListener('playing', updatePlayBtn);
        audioPlayer.addEventListener('pause', updatePlayBtn);
        audioPlayer.addEventListener('ended', updatePlayBtn);

        playBtn.onclick = () => {
            this.player.handlePlayPause();
            requestAnimationFrame(updatePlayBtn);
            setTimeout(updatePlayBtn, 100);
        };

        prevBtn.onclick = () => this.player.playPrev();
        nextBtn.onclick = () => this.player.playNext();

        shuffleBtn.onclick = () => {
            this.player.toggleShuffle();
            shuffleBtn.classList.toggle('active', this.player.shuffleActive);
        };

        repeatBtn.onclick = () => {
            const mode = this.player.toggleRepeat();
            repeatBtn.classList.toggle('active', mode !== 0);
            if (mode === 2) {
                repeatBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>';
            } else {
                repeatBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';
            }
        };

        // Progress bar with drag support
        let isFsSeeking = false;
        let wasFsPlaying = false;
        let lastFsSeekPosition = 0;

        const updateFsSeekUI = (position) => {
            if (!isNaN(audioPlayer.duration)) {
                progressFill.style.width = `${position * 100}%`;
                if (currentTimeEl) {
                    currentTimeEl.textContent = formatTime(position * audioPlayer.duration);
                }
            }
        };

        progressBar.addEventListener('mousedown', (e) => {
            isFsSeeking = true;
            wasFsPlaying = !audioPlayer.paused;
            if (wasFsPlaying) audioPlayer.pause();

            const rect = progressBar.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            lastFsSeekPosition = pos;
            updateFsSeekUI(pos);
        });

        progressBar.addEventListener(
            'touchstart',
            (e) => {
                e.preventDefault();
                isFsSeeking = true;
                wasFsPlaying = !audioPlayer.paused;
                if (wasFsPlaying) audioPlayer.pause();

                const touch = e.touches[0];
                const rect = progressBar.getBoundingClientRect();
                const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
                lastFsSeekPosition = pos;
                updateFsSeekUI(pos);
            },
            { passive: false }
        );

        document.addEventListener('mousemove', (e) => {
            if (isFsSeeking) {
                const rect = progressBar.getBoundingClientRect();
                const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                lastFsSeekPosition = pos;
                updateFsSeekUI(pos);
            }
        });

        document.addEventListener(
            'touchmove',
            (e) => {
                if (isFsSeeking) {
                    const touch = e.touches[0];
                    const rect = progressBar.getBoundingClientRect();
                    const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
                    lastFsSeekPosition = pos;
                    updateFsSeekUI(pos);
                }
            },
            { passive: false }
        );

        document.addEventListener('mouseup', () => {
            if (isFsSeeking) {
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = lastFsSeekPosition * audioPlayer.duration;
                    if (wasFsPlaying) audioPlayer.play();
                }
                isFsSeeking = false;
            }
        });

        document.addEventListener('touchend', () => {
            if (isFsSeeking) {
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = lastFsSeekPosition * audioPlayer.duration;
                    if (wasFsPlaying) audioPlayer.play();
                }
                isFsSeeking = false;
            }
        });

        if (fsLikeBtn) {
            fsLikeBtn.onclick = () => document.getElementById('now-playing-like-btn')?.click();
        }
        if (fsAddPlaylistBtn) {
            fsAddPlaylistBtn.onclick = () => document.getElementById('now-playing-add-playlist-btn')?.click();
        }
        if (fsDownloadBtn) {
            fsDownloadBtn.onclick = () => document.getElementById('download-current-btn')?.click();
        }
        if (fsCastBtn) {
            fsCastBtn.onclick = () => document.getElementById('cast-btn')?.click();
        }
        if (fsQueueBtn) {
            fsQueueBtn.onclick = () => {
                document.getElementById('queue-btn')?.click();
            };
        }

        shuffleBtn.classList.toggle('active', this.player.shuffleActive);
        const mode = this.player.repeatMode;
        repeatBtn.classList.toggle('active', mode !== 0);
        if (mode === 2) {
            repeatBtn.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>';
        }

        // Fullscreen circular volume controls
        const fsVolumeBtn = document.getElementById('fs-volume-btn');
        const fsCircularVolume = document.getElementById('fs-circular-volume');
        const fsCircularVolumeProgress = document.getElementById('fs-circular-volume-progress');
        const FS_CIRCUMFERENCE = 97.39;

        if (fsVolumeBtn && fsCircularVolume && fsCircularVolumeProgress) {
            const updateFsVolumeUI = () => {
                const { muted } = audioPlayer;
                const volume = this.player.userVolume;
                fsVolumeBtn.innerHTML = muted || volume === 0 ? SVG_MUTE : SVG_VOLUME;
                const effectiveVolume = muted ? 0 : volume * 100;
                const offset = FS_CIRCUMFERENCE - (FS_CIRCUMFERENCE * effectiveVolume) / 100;
                fsCircularVolumeProgress.style.strokeDashoffset = offset;
            };

            fsVolumeBtn.onclick = () => {
                audioPlayer.muted = !audioPlayer.muted;
                localStorage.setItem('muted', audioPlayer.muted);
                updateFsVolumeUI();
            };

            const getFsVolumeFromAngle = (e) => {
                const rect = fsCircularVolume.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                let angle = Math.atan2(e.clientX - cx, -(e.clientY - cy));
                if (angle < 0) angle += 2 * Math.PI;
                return Math.max(0, Math.min(1, angle / (2 * Math.PI)));
            };

            const applyFsCircularVolume = (position) => {
                if (audioPlayer.muted && position > 0) {
                    audioPlayer.muted = false;
                    localStorage.setItem('muted', false);
                }
                this.player.setVolume(position);
                updateFsVolumeUI();
            };

            let isAdjustingFsVolume = false;

            fsCircularVolume.addEventListener('mousedown', (e) => {
                if (e.target.closest('.circular-volume-icon')) return;
                isAdjustingFsVolume = true;
                applyFsCircularVolume(getFsVolumeFromAngle(e));
            });

            document.addEventListener('mousemove', (e) => {
                if (isAdjustingFsVolume) {
                    applyFsCircularVolume(getFsVolumeFromAngle(e));
                }
            });

            document.addEventListener('mouseup', () => {
                isAdjustingFsVolume = false;
            });

            fsCircularVolume.addEventListener(
                'wheel',
                (e) => {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -0.05 : 0.05;
                    const newVolume = Math.max(0, Math.min(1, this.player.userVolume + delta));
                    if (delta > 0 && audioPlayer.muted) {
                        audioPlayer.muted = false;
                        localStorage.setItem('muted', false);
                    }
                    this.player.setVolume(newVolume);
                    updateFsVolumeUI();
                },
                { passive: false }
            );

            audioPlayer.addEventListener('volumechange', updateFsVolumeUI);
            updateFsVolumeUI();
        }

        const update = () => {
            if (document.getElementById('fullscreen-cover-overlay').style.display === 'none') return;

            const duration = audioPlayer.duration || 0;
            const current = audioPlayer.currentTime || 0;

            if (duration > 0) {
                // Only update progress if not currently seeking (user is dragging)
                if (!isFsSeeking) {
                    const percent = (current / duration) * 100;
                    progressFill.style.width = `${percent}%`;
                    currentTimeEl.textContent = formatTime(current);
                }
                totalDurationEl.textContent = formatTime(duration);
            }

            updatePlayBtn();
            this.fullscreenUpdateInterval = requestAnimationFrame(update);
        };

        if (this.fullscreenUpdateInterval) cancelAnimationFrame(this.fullscreenUpdateInterval);
        this.fullscreenUpdateInterval = requestAnimationFrame(update);
        this.setupFullscreenVideoToggle();
    }

    setupFullscreenVideoToggle() {
        const btn = document.getElementById('fs-video-btn');
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const wrap = document.getElementById('fs-video-player-wrap');
        if (!btn || !overlay || !wrap || this.fsVideoController) return;

        const state = {
            enabled: false,
            player: null,
            apiReady: false,
            syncTimer: null,
            trackKey: null,
            searchCache: new Map(),
        };

        const getTrackKey = () => {
            const track = this.player?.currentTrack;
            if (!track?.title) return null;
            const artist = track.artist?.name || '';
            return `${artist} ${track.title}`.trim();
        };

        const loadYoutubeApi = () =>
            new Promise((resolve) => {
                if (window.YT?.Player) {
                    state.apiReady = true;
                    resolve();
                    return;
                }
                const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
                window.onYouTubeIframeAPIReady = () => {
                    state.apiReady = true;
                    resolve();
                };
                if (!existing) {
                    const script = document.createElement('script');
                    script.src = 'https://www.youtube.com/iframe_api';
                    script.async = true;
                    document.head.appendChild(script);
                }
            });

        const searchVideoId = async (key) => {
            if (state.searchCache.has(key)) return state.searchCache.get(key);
            const mod = await import('youtube-search-api');
            const api = mod.default ?? mod;
            const result = await api.GetListByKeyword(`${key} official music video`, false, 3, [{ type: 'video' }]);
            const video = (result?.items || []).find((item) => item.type === 'video' && item.id && !item.isLive);
            if (!video?.id) throw new Error('No video found on YouTube');
            state.searchCache.set(key, video.id);
            return video.id;
        };

        const syncVideoPlayback = () => {
            const player = state.player;
            const audio = document.getElementById('audio-player');
            if (!player?.playVideo) return;
            try {
                if (audio?.paused) {
                    player.pauseVideo();
                } else {
                    if (Number.isFinite(audio?.currentTime)) {
                        player.seekTo(audio.currentTime, true);
                    }
                    player.playVideo();
                }
            } catch {
                /* ignore player state errors */
            }
        };

        const disableCaptions = () => {
            try {
                state.player?.unloadModule?.('captions');
                state.player?.setOption?.('captions', 'track', {});
            } catch {
                /* captions module unavailable */
            }
        };

        const createPlayer = (videoId, start) =>
            new Promise((resolve, reject) => {
                if (state.player) {
                    state.player.loadVideoById({ videoId, startSeconds: start });
                    syncVideoPlayback();
                    resolve(state.player);
                    return;
                }
                wrap.innerHTML = '';
                const holder = document.createElement('div');
                holder.id = 'fs-video-player';
                wrap.appendChild(holder);
                try {
                    state.player = new YT.Player(holder.id, {
                        width: '100%',
                        height: '100%',
                        videoId,
                        playerVars: {
                            autoplay: 1,
                            mute: 1,
                            controls: 0,
                            modestbranding: 1,
                            cc_load_policy: 0,
                            disablekb: 1,
                            rel: 0,
                            playsinline: 1,
                            start,
                        },
                        events: {
                            onReady: (event) => {
                                event.target.mute();
                                disableCaptions();
                                syncVideoPlayback();
                                resolve(event.target);
                            },
                            onApiChange: () => disableCaptions(),
                            onError: (event) => reject(new Error(`YouTube player error: ${event.data}`)),
                            onStateChange: (event) => {
                                if (event.data === YT.PlayerState.ENDED) event.target.seekTo(0);
                                if (event.data === YT.PlayerState.BUFFERING) {
                                    setTimeout(disableCaptions, 150);
                                }
                            },
                        },
                    });
                } catch (error) {
                    reject(error);
                }
            });

        const startSync = () => {
            if (state.syncTimer) return;
            state.syncTimer = setInterval(() => {
                const player = state.player;
                const audio = document.getElementById('audio-player');
                if (!player?.getCurrentTime || !audio || audio.paused) return;
                const videoTime = player.getCurrentTime();
                if (!Number.isFinite(videoTime)) return;
                const audioTime = audio.currentTime || 0;
                if (Math.abs(videoTime - audioTime) > 3) {
                    try {
                        player.seekTo(audioTime, true);
                    } catch {
                        /* ignore seek errors */
                    }
                }
            }, 1000);
        };

        const disable = () => {
            state.enabled = false;
            btn.classList.remove('active');
            btn.title = 'Music Video Background';
            overlay.classList.remove('video-bg-active');
            if (state.syncTimer) {
                clearInterval(state.syncTimer);
                state.syncTimer = null;
            }
            if (state.player) {
                try {
                    state.player.destroy();
                } catch {
                    /* already destroyed */
                }
                state.player = null;
            }
            wrap.innerHTML = '';
        };

        const enable = async () => {
            btn.classList.add('active');
            btn.title = 'Finding video…';
            try {
                const key = getTrackKey();
                if (!key) throw new Error('No current track');
                const videoId = await searchVideoId(key);
                await loadYoutubeApi();
                if (!this.isFullscreenCoverOpen()) throw new Error('Fullscreen closed while loading');
                const audio = document.getElementById('audio-player');
                await createPlayer(videoId, Math.floor(audio?.currentTime || 0));
                state.enabled = true;
                state.trackKey = key;
                overlay.classList.add('video-bg-active');
                btn.title = 'Music Video Background';
                startSync();
            } catch (error) {
                console.warn('[fs-video] Failed to start music video background:', error);
                btn.classList.remove('active');
                btn.title = 'Music Video Background';
            }
        };

        btn.addEventListener('click', () => {
            if (state.enabled) disable();
            else enable();
        });

        const audio = document.getElementById('audio-player');
        if (audio) {
            audio.addEventListener('pause', () => {
                if (!state.enabled) return;
                try {
                    state.player?.pauseVideo();
                } catch {
                    /* ignore */
                }
            });
            audio.addEventListener('play', () => {
                if (!state.enabled) return;
                syncVideoPlayback();
            });
            audio.addEventListener('loadeddata', () => {
                if (!state.enabled) return;
                const key = getTrackKey();
                if (!key || key === state.trackKey) return;
                state.trackKey = key;
                (async () => {
                    try {
                        const videoId = await searchVideoId(key);
                        if (!state.player) return;
                        state.player.loadVideoById({
                            videoId,
                            startSeconds: Math.floor(audio.currentTime || 0),
                        });
                    } catch (error) {
                        console.warn('[fs-video] Failed to switch music video:', error);
                    }
                })();
            });
        }

        this.fsVideoController = { disable, isEnabled: () => state.enabled };
    }

    showPage(pageId) {
        const didPageChange = this._activePageId !== pageId;
        this._activePageId = pageId;
        document.body.classList.toggle('artist-page-active', pageId === 'artist');
        document.body.classList.toggle('search-page-active', pageId === 'search');

        document.querySelectorAll('.page').forEach((page) => {
            page.classList.toggle('active', page.id === `page-${pageId}`);
        });

        const currentPath = window.location.pathname;
        document.querySelectorAll('.sidebar-nav a').forEach((link) => {
            const targetPath = link.pathname;
            const isHome = targetPath === '/' && (currentPath === '/' || currentPath === '/home');
            const isProfile =
                targetPath === '/profile' && (currentPath === '/profile' || currentPath.startsWith('/user/@'));
            const isMatch =
                targetPath !== '/' && (currentPath === targetPath || currentPath.startsWith(`${targetPath}/`));
            link.classList.toggle('active', isHome || isProfile || isMatch);
        });

        if (didPageChange) {
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.scrollTop = 0;
            }
            scrollToTop();
        }

        // Clear background and color if not on album, artist, playlist, or mix page
        if (!['album', 'artist', 'playlist', 'mix'].includes(pageId)) {
            this.setPageBackground(null);
            this.updateGlobalTheme();
        }

        if (pageId === 'settings') {
            this.renderAddonSettings();
            this.renderCacheStats();
            this.applySettingsTabFromPath();
        }
    }

    activateSearchTab(tabName = 'all') {
        const validTabs = new Set(['all', 'tracks', 'albums', 'artists', 'playlists', 'profiles']);
        const selectedTab = validTabs.has(tabName) ? tabName : 'all';

        const searchPage = document.getElementById('page-search');
        if (!searchPage) return selectedTab;

        searchPage.querySelectorAll('.search-tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.tab === selectedTab);
        });

        searchPage.querySelectorAll('.search-tab-content').forEach((content) => {
            content.classList.toggle('active', content.id === `search-tab-${selectedTab}`);
        });

        return selectedTab;
    }

    activateLibraryTab(tabName = 'tracks') {
        const validTabs = new Set(['tracks', 'albums', 'artists', 'playlists', 'local']);
        const selectedTab = validTabs.has(tabName) ? tabName : 'tracks';

        const libraryPage = document.getElementById('page-library');
        if (!libraryPage) return selectedTab;

        libraryPage.querySelectorAll('.search-tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.tab === selectedTab);
        });

        libraryPage.querySelectorAll('.search-tab-content').forEach((content) => {
            content.classList.toggle('active', content.id === `library-tab-${selectedTab}`);
        });

        return selectedTab;
    }

    applySettingsTabFromPath() {
        const settingsPage = document.getElementById('page-settings');
        if (!settingsPage) return;

        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        const routeTab = pathSegments[0] === 'settings' ? decodeURIComponent(pathSegments[1] || '') : '';
        if (!routeTab) return;

        const targetTab = settingsPage.querySelector(`.settings-tab[data-tab="${routeTab}"]`);
        const targetContent = document.getElementById(`settings-tab-${routeTab}`);
        if (!targetTab || !targetContent) return;

        settingsPage.querySelectorAll('.settings-tab').forEach((tab) => tab.classList.remove('active'));
        settingsPage.querySelectorAll('.settings-tab-content').forEach((content) => content.classList.remove('active'));

        targetTab.classList.add('active');
        targetContent.classList.add('active');
    }

    async renderLibraryPage(activeTab = 'tracks') {
        this.showPage('library');
        this.activateLibraryTab(activeTab);

        const tracksContainer = document.getElementById('library-tracks-container');
        const albumsContainer = document.getElementById('library-albums-container');
        const artistsContainer = document.getElementById('library-artists-container');
        const playlistsContainer = document.getElementById('library-playlists-container');
        const localContainer = document.getElementById('library-local-container');
        const foldersContainer = document.getElementById('my-folders-container');

        const likedTracks = await db.getFavorites('track');
        const shuffleBtn = document.getElementById('shuffle-liked-tracks-btn');
        const downloadBtn = document.getElementById('download-liked-tracks-btn');

        if (likedTracks.length) {
            if (shuffleBtn) shuffleBtn.style.display = 'flex';
            if (downloadBtn) downloadBtn.style.display = 'flex';
            this.renderListWithTracks(tracksContainer, likedTracks, true);
        } else {
            if (shuffleBtn) shuffleBtn.style.display = 'none';
            if (downloadBtn) downloadBtn.style.display = 'none';
            tracksContainer.innerHTML = createPlaceholder('No liked tracks yet.');
        }

        const likedAlbums = await db.getFavorites('album');
        if (likedAlbums.length) {
            albumsContainer.innerHTML = likedAlbums.map((a) => this.createAlbumCardHTML(a)).join('');
            likedAlbums.forEach((album) => {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    this.updateLikeState(el, 'album', album.id);
                }
            });
        } else {
            albumsContainer.innerHTML = createPlaceholder('No liked albums yet.');
        }

        const likedArtists = await db.getFavorites('artist');
        if (likedArtists.length) {
            artistsContainer.innerHTML = likedArtists.map((a) => this.createArtistCardHTML(a)).join('');
            likedArtists.forEach((artist) => {
                const el = artistsContainer.querySelector(`[data-artist-id="${artist.id}"]`);
                if (el) {
                    trackDataStore.set(el, artist);
                    this.updateLikeState(el, 'artist', artist.id);
                }
            });
        } else {
            artistsContainer.innerHTML = createPlaceholder('No liked artists yet.');
        }

        const likedPlaylists = await db.getFavorites('playlist');
        const likedMixes = await db.getFavorites('mix');

        let mixedContent = [];
        if (likedPlaylists.length) mixedContent.push(...likedPlaylists.map((p) => ({ ...p, _type: 'playlist' })));
        if (likedMixes.length) mixedContent.push(...likedMixes.map((m) => ({ ...m, _type: 'mix' })));

        // Sort by addedAt descending
        mixedContent.sort((a, b) => b.addedAt - a.addedAt);

        if (mixedContent.length) {
            playlistsContainer.innerHTML = mixedContent
                .map((item) => {
                    return item._type === 'playlist' ? this.createPlaylistCardHTML(item) : this.createMixCardHTML(item);
                })
                .join('');

            likedPlaylists.forEach((playlist) => {
                const el = playlistsContainer.querySelector(`[data-playlist-id="${playlist.uuid}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                    this.updateLikeState(el, 'playlist', playlist.uuid);
                }
            });

            likedMixes.forEach((mix) => {
                const el = playlistsContainer.querySelector(`[data-mix-id="${mix.id}"]`);
                if (el) {
                    trackDataStore.set(el, mix);
                    this.updateLikeState(el, 'mix', mix.id);
                }
            });
        } else {
            playlistsContainer.innerHTML = createPlaceholder('No liked playlists or mixes yet.');
        }

        const folders = await db.getFolders();
        if (foldersContainer) {
            foldersContainer.innerHTML = folders.map((f) => this.createFolderCardHTML(f)).join('');
            foldersContainer.style.display = folders.length ? 'grid' : 'none';
        }

        const myPlaylistsContainer = document.getElementById('my-playlists-container');
        const myPlaylists = await db.getPlaylists();

        const playlistsInFolders = new Set();
        folders.forEach((folder) => {
            if (folder.playlists) {
                folder.playlists.forEach((id) => playlistsInFolders.add(id));
            }
        });

        const visiblePlaylists = myPlaylists.filter((p) => !playlistsInFolders.has(p.id));

        if (visiblePlaylists.length) {
            myPlaylistsContainer.innerHTML = visiblePlaylists.map((p) => this.createUserPlaylistCardHTML(p)).join('');
            visiblePlaylists.forEach((playlist) => {
                const el = myPlaylistsContainer.querySelector(`[data-user-playlist-id="${playlist.id}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                }
            });
        } else {
            if (folders.length === 0) {
                myPlaylistsContainer.innerHTML = createPlaceholder('No playlists yet. Create your first playlist!');
            } else {
                myPlaylistsContainer.innerHTML = '';
            }
        }

        // Render Local Files
        this.renderLocalFiles(localContainer);
    }

    async renderLocalFiles(container) {
        if (!container) return;

        const introDiv = document.getElementById('local-files-intro');
        const headerDiv = document.getElementById('local-files-header');
        const listContainer = document.getElementById('local-files-list');
        const selectBtnText = document.getElementById('select-local-folder-text');

        const handle = await db.getSetting('local_folder_handle');
        if (handle) {
            if (selectBtnText) selectBtnText.textContent = `Load "${handle.name}"`;

            if (window.localFilesCache && window.localFilesCache.length > 0) {
                if (introDiv) introDiv.style.display = 'none';
                if (headerDiv) {
                    headerDiv.style.display = 'flex';
                    headerDiv.querySelector('h3').textContent = `Local Files (${window.localFilesCache.length})`;
                }
                if (listContainer) {
                    this.renderListWithTracks(listContainer, window.localFilesCache, false);
                }
            } else {
                if (introDiv) introDiv.style.display = 'block';
                if (headerDiv) headerDiv.style.display = 'none';
                if (listContainer) listContainer.innerHTML = '';
            }
        } else {
            if (selectBtnText) selectBtnText.textContent = 'Select Music Folder';
            if (introDiv) introDiv.style.display = 'block';
            if (headerDiv) headerDiv.style.display = 'none';
            if (listContainer) listContainer.innerHTML = '';
        }
    }

    async renderHomePage() {
        this.showPage('home');

        const welcomeEl = document.getElementById('home-welcome');
        const contentEl = document.getElementById('home-content');
        const editorsPicksSectionEmpty = document.getElementById('home-editors-picks-section-empty');
        const editorsPicksSection = document.getElementById('home-editors-picks-section');

        // Set time-based greeting (24 unique hourly variants)
        const hour = new Date().getHours();
        const greetingByHour = [
            { greeting: 'Midnight vibes!', message: 'Quiet hours, deep cuts, and headphone magic.' },
            { greeting: 'Still up?', message: 'Perfect time for slow burners and nocturnal tracks.' },
            { greeting: 'Night owl mode!', message: 'Keep it low-key with moody late-night sound.' },
            { greeting: '3 AM session!', message: 'Try ambient picks and dreamy instrumentals.' },
            { greeting: 'Early glow!', message: 'Ease in with mellow tunes before sunrise.' },
            { greeting: 'Good dawn!', message: 'Fresh morning energy starts with fresh songs.' },
            { greeting: 'Sunrise sounds!', message: 'Warm up your morning with bright rhythms.' },
            { greeting: 'Good morning!', message: "Let's kickstart your day with freshly curated music." },
            { greeting: 'Morning momentum!', message: 'Build focus with clean beats and crisp hooks.' },
            { greeting: 'Coffee and choruses!', message: 'Pair your first break with uplifting tracks.' },
            { greeting: 'Late morning boost!', message: 'Keep your tempo up with new recommendations.' },
            { greeting: 'Midday warmup!', message: 'Switch gears with something fresh and vibrant.' },
            { greeting: 'Good afternoon!', message: 'Time for some fresh tunes to keep you going.' },
            { greeting: 'Afternoon drive!', message: 'Stay sharp with energetic picks and bouncy grooves.' },
            { greeting: 'Power hour!', message: 'Push through with high-tempo favorites.' },
            { greeting: 'Golden afternoon!', message: 'Blend smooth melodies with steady rhythm.' },
            { greeting: 'Pre-evening pulse!', message: 'Set the tone for the rest of your day.' },
            { greeting: 'Good evening!', message: 'Wind down with some great music.' },
            { greeting: 'Evening unwind!', message: 'Relax with rich vocals and chilled production.' },
            { greeting: 'Prime-time listening!', message: 'Queue up your best discoveries for tonight.' },
            { greeting: 'Nightfall groove!', message: 'Slow the pace with atmospheric favorites.' },
            { greeting: 'Good night!', message: 'Perfect time for some late-night listening.' },
            { greeting: 'Nightcap tracks!', message: 'Close the day with soft, immersive sound.' },
            { greeting: 'Moonlight mix!', message: 'Fade out with calm tracks and gentle textures.' },
        ];
        const { greeting, message } = greetingByHour[hour] || greetingByHour[12];

        // Update greeting element if it exists, otherwise create it
        let greetingEl = document.getElementById('home-greeting');
        if (!greetingEl) {
            greetingEl = document.createElement('div');
            greetingEl.id = 'home-greeting';
            greetingEl.style.cssText = 'padding: 2rem 0 1rem; font-size: 2.5rem; font-weight: 700; line-height: 1.2;';
            if (contentEl && contentEl.firstChild) {
                contentEl.insertBefore(greetingEl, contentEl.firstChild);
            }
        }
        if (greetingEl) {
            greetingEl.innerHTML = `<div>${greeting}</div><div style="font-size: 1rem; color: var(--muted-foreground); font-weight: 400; margin-top: 0.5rem;">${message}</div>`;
        }

        const history = await db.getHistory();
        const favorites = await db.getFavorites('track');
        const playlists = await db.getPlaylists(true);

        const hasActivity = history.length > 0 || favorites.length > 0 || playlists.length > 0;

        // Handle Billboard charts visibility based on settings
        if (!homePageSettings.shouldShowEditorsPicks()) {
            if (editorsPicksSectionEmpty) editorsPicksSectionEmpty.style.display = 'none';
            if (editorsPicksSection) editorsPicksSection.style.display = 'none';
        } else {
            // Show empty-state section at top when no activity, hide the bottom one
            if (editorsPicksSectionEmpty) editorsPicksSectionEmpty.style.display = hasActivity ? 'none' : '';
            // Show bottom section when has activity
            if (editorsPicksSection) editorsPicksSection.style.display = hasActivity ? '' : 'none';
        }

        // Clear discovery cache so all home rails refresh each time home is entered.
        this._homeDiscoveryCache = null;

        // Render Billboard charts in the visible container.
        this.renderHomeBillboard(false, hasActivity ? 'default' : 'empty');

        if (!hasActivity) {
            if (welcomeEl) welcomeEl.style.display = 'block';
            if (contentEl) contentEl.style.display = 'none';
            return;
        }

        if (welcomeEl) welcomeEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';

        const refreshSongsBtn = document.getElementById('refresh-songs-btn');
        const refreshAlbumsBtn = document.getElementById('refresh-albums-btn');
        const refreshArtistsBtn = document.getElementById('refresh-artists-btn');
        const openFriendsBtn = document.getElementById('home-friends-open-btn');
        const clearRecentBtn = document.getElementById('clear-recent-btn');

        if (refreshSongsBtn) refreshSongsBtn.onclick = () => this.renderHomeSongs(true);
        if (refreshAlbumsBtn) refreshAlbumsBtn.onclick = () => this.renderHomeAlbums(true);
        if (refreshArtistsBtn) refreshArtistsBtn.onclick = () => this.renderHomeArtists(true);
        if (openFriendsBtn) openFriendsBtn.onclick = () => navigate('/friends');
        if (clearRecentBtn)
            clearRecentBtn.onclick = () => {
                if (confirm('Clear recent activity?')) {
                    recentActivityManager.clear();
                    this.renderHomeRecent();
                }
            };

        const recommendationProfilePromise = this.getRecentTrackProfile(true);
        Promise.allSettled([
            this.renderHomeSongs(false, recommendationProfilePromise),
            this.renderHomeAlbums(false, recommendationProfilePromise),
            this.renderHomeArtists(false, recommendationProfilePromise),
        ]).catch((error) => {
            console.warn('[Home] Recommendation sections failed to load in parallel:', error);
        });

        this.renderHomeCollaborativePlaylists();
        this.renderHomeFriendsActivity();
        this.renderHomeRecent();
        this.renderHomeDiscoverySections().catch((error) => {
            console.warn('[Home] Failed to render discovery sections:', error);
            const section = document.getElementById('home-discovery-hub-section');
            if (section) {
                section.style.display = 'none';
            }
        });
    }

    _extractEntity(item) {
        if (!item || typeof item !== 'object') return null;
        if (item.item && typeof item.item === 'object') return item.item;
        if (item.track && typeof item.track === 'object') return item.track;
        if (item.album && typeof item.album === 'object' && item.id === undefined) return item.album;
        if (item.playlist && typeof item.playlist === 'object') return item.playlist;
        return item;
    }

    _normalizeDiscoveryList(items = []) {
        const normalized = [];
        const seen = new Set();
        items.forEach((entry) => {
            const entity = this._extractEntity(entry);
            if (!entity || typeof entity !== 'object') return;
            const key = String(entity.uuid || entity.id || entity.title || '');
            if (!key || seen.has(key)) return;
            seen.add(key);
            normalized.push(entity);
        });
        return normalized;
    }

    _setDiscoveryModuleVisibility(moduleId, visible) {
        const module = document.getElementById(moduleId);
        if (!module) return;
        module.style.display = visible ? '' : 'none';
    }

    _renderDiscoveryCardGrid(containerId, items, type) {
        const container = document.getElementById(containerId);
        if (!container) return false;

        const normalized = this._normalizeDiscoveryList(items);
        if (!normalized.length) {
            container.innerHTML = '';
            return false;
        }

        if (type === 'album') {
            container.innerHTML = normalized
                .slice(0, 12)
                .map((album) => this.createAlbumCardHTML(album))
                .join('');
            normalized.slice(0, 12).forEach((album) => {
                const el = container.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    this.updateLikeState(el, 'album', album.id);
                }
            });
            return true;
        }

        if (type === 'playlist') {
            container.innerHTML = normalized
                .slice(0, 12)
                .map((playlist) => this.createPlaylistCardHTML(playlist))
                .join('');
            normalized.slice(0, 12).forEach((playlist) => {
                const id = playlist.uuid || playlist.id;
                const selector = playlist.uuid
                    ? `[data-playlist-id="${playlist.uuid}"]`
                    : `[data-playlist-id="${playlist.id}"]`;
                const el = container.querySelector(selector);
                if (el) {
                    trackDataStore.set(el, playlist);
                    if (id) this.updateLikeState(el, 'playlist', id);
                }
            });
            return true;
        }

        return false;
    }

    _renderDiscoveryTrackList(containerId, items) {
        const container = document.getElementById(containerId);
        if (!container) return false;
        const normalized = this._normalizeDiscoveryList(items);
        if (!normalized.length) {
            container.innerHTML = '';
            return false;
        }
        this.renderListWithTracks(container, normalized.slice(0, 18), true);
        return true;
    }

    _renderSpotlightHero(items) {
        const container = document.getElementById('home-spotlight-hero');
        if (!container) return false;

        const normalized = this._normalizeDiscoveryList(items).slice(0, 5);
        if (!normalized.length) {
            container.innerHTML = '';
            return false;
        }

        const [lead, ...rest] = normalized;
        const leadImage = this.api.getCoverUrl(
            lead.album?.cover || lead.cover || lead.image || lead.squareImage,
            '640'
        );
        const leadTitle = escapeHtml(getTrackTitle(lead) || lead.title || 'Spotlight');
        const leadArtist = escapeHtml(getTrackArtists(lead) || lead.artist?.name || lead.artists?.[0]?.name || '');

        container.innerHTML = `
            <article class="spotlight-lead card" data-spotlight-id="${lead.id || lead.uuid || ''}">
                <div class="spotlight-lead-media">
                    <img src="${leadImage}" alt="${leadTitle}" loading="lazy" />
                </div>
                <div class="spotlight-lead-content">
                    <p class="spotlight-kicker">Hot right now</p>
                    <h3>${leadTitle}</h3>
                    <p>${leadArtist}</p>
                </div>
            </article>
            <div class="spotlight-subgrid">
                ${rest
                    .map((item) => {
                        const itemTitle = escapeHtml(getTrackTitle(item) || item.title || 'Untitled');
                        const itemArtist = escapeHtml(
                            getTrackArtists(item) || item.artist?.name || item.artists?.[0]?.name || ''
                        );
                        const itemImage = this.api.getCoverUrl(
                            item.album?.cover || item.cover || item.image || item.squareImage,
                            '320'
                        );
                        return `
                            <article class="spotlight-chip card" data-spotlight-id="${item.id || item.uuid || ''}">
                                <img src="${itemImage}" alt="${itemTitle}" loading="lazy" />
                                <div>
                                    <h4>${itemTitle}</h4>
                                    <p>${itemArtist}</p>
                                </div>
                            </article>
                        `;
                    })
                    .join('')}
            </div>
        `;

        const playItem = (item) => {
            const list = this._normalizeDiscoveryList(normalized);
            const startIndex = list.findIndex((entry) => String(entry.id) === String(item.id));
            this.player.setQueue(list, Math.max(0, startIndex));
            this.player.playTrackFromQueue();
        };

        const leadEl = container.querySelector('.spotlight-lead');
        if (leadEl) {
            trackDataStore.set(leadEl, lead);
            leadEl.addEventListener('click', () => playItem(lead));
        }

        container.querySelectorAll('.spotlight-chip').forEach((chip) => {
            const chipId = chip.getAttribute('data-spotlight-id');
            const item = rest.find((entry) => String(entry.id) === String(chipId));
            if (!item) return;
            trackDataStore.set(chip, item);
            chip.addEventListener('click', () => playItem(item));
        });

        return true;
    }

    async renderHomeDiscoverySections(forceRefresh = false) {
        const section = document.getElementById('home-discovery-hub-section');
        if (!section) return;

        const content = document.getElementById('home-content');
        if (!content || content.style.display === 'none') {
            section.style.display = 'none';
            return;
        }

        // Always refetch when navigating back to home so the deck stays fresh
        let data = this._homeDiscoveryCache;
        if (!data || forceRefresh) {
            data = await getHomeSections();
            this._homeDiscoveryCache = data;
        }

        // Shuffle helper — Fisher-Yates
        const shuffle = (arr) => {
            const a = [...arr];
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        };

        // Build the spotlight pool: prefer HOT/trending tracks, then spotlighted uploads,
        // then new tracks — and shuffle so each visit looks different
        let spotlightPool =
            data.trendingTracks?.length > 0
                ? data.trendingTracks
                : data.spotlightedUploads?.length > 0
                  ? data.spotlightedUploads
                  : data.newTracks || [];
        const spotlightItems = shuffle(spotlightPool);

        const hasSpotlight = this._renderSpotlightHero(spotlightItems);
        const hasHotTracks = this._renderDiscoveryTrackList('home-hot-tracks', data.trendingTracks || []);
        const hasNewTracks = this._renderDiscoveryTrackList('home-new-tracks', data.newTracks || []);
        const hasHotAlbums = this._renderDiscoveryCardGrid('home-hot-albums', data.trendingAlbums || [], 'album');
        const hasNewAlbums = this._renderDiscoveryCardGrid('home-new-albums', data.newAlbums || [], 'album');
        const hasFeatured = this._renderDiscoveryCardGrid(
            'home-featured-playlists',
            data.featuredPlaylists || [],
            'playlist'
        );
        const hasEditors = this._renderDiscoveryCardGrid('home-from-editors', data.fromEditors || [], 'playlist');

        this._setDiscoveryModuleVisibility('home-spotlight-module', hasSpotlight);
        this._setDiscoveryModuleVisibility('home-hot-tracks-module', hasHotTracks);
        this._setDiscoveryModuleVisibility('home-new-tracks-module', hasNewTracks);
        this._setDiscoveryModuleVisibility('home-hot-albums-module', hasHotAlbums);
        this._setDiscoveryModuleVisibility('home-new-albums-module', hasNewAlbums);
        this._setDiscoveryModuleVisibility('home-featured-playlists-module', hasFeatured);
        this._setDiscoveryModuleVisibility('home-from-editors-module', hasEditors);

        const hasAny =
            hasSpotlight || hasHotTracks || hasNewTracks || hasHotAlbums || hasNewAlbums || hasFeatured || hasEditors;
        section.style.display = hasAny ? '' : 'none';
    }

    async renderProfilePage() {
        if (!authManager.user) {
            this.showPage('profile');
            const container = document.getElementById('page-profile');
            if (!container) return;

            // Hide the placeholder header for Guests
            const headerContainer = container.querySelector('.profile-header-container');
            if (headerContainer) headerContainer.style.display = 'none';

            const profileContent = container.querySelector('.profile-content');
            if (!profileContent) return;

            profileContent.innerHTML = `
                <div class="profile-card" style="margin: 4rem auto; max-width: 500px; text-align: center; border: 1px dashed color-mix(in srgb, var(--border) 40%, transparent);">
                    <div class="profile-card-content" style="padding: 2rem;">
                        <div style="font-size: 4rem; margin-bottom: 2rem; filter: saturate(0.5); opacity: 0.8;">👤</div>
                        <h2 style="margin-bottom: 1rem; font-weight: 800; letter-spacing: -0.02em;">Not Signed In</h2>
                        <p style="color: var(--muted-foreground); margin-bottom: 2.5rem; line-height: 1.6;">Join the Monochrome+ community to sync your library, follow friends, and personalize your experience.</p>
                        <button class="btn-primary" style="width: 100%; padding: 1rem;" onclick="window.navigate('/account')">Create or Link Account</button>
                        <p style="margin-top: 2rem; font-size: 0.85rem; color: var(--muted-foreground); opacity: 0.7;">
                            If you've just signed in, we're currently synchronizing your session.
                        </p>
                    </div>
                </div>
            `;
            return;
        }

        // Redirect to their own profile if logged in
        const userData = await syncManager.getUserData();
        if (userData && userData.profile && userData.profile.username) {
            navigate(`/user/@${userData.profile.username}`);
        } else {
            // Fallback: show simple loading profile if record not ready
            this.showPage('profile');
            const container = document.getElementById('page-profile');

            const headerContainer = container.querySelector('.profile-header-container');
            if (headerContainer) headerContainer.style.display = 'block';

            const profileContent = container.querySelector('.profile-content');
            const user = authManager.user;

            profileContent.innerHTML = `
                <div class="profile-card" style="margin: 4rem auto; max-width: 500px; text-align: center;">
                    <div class="profile-card-content" style="padding: 2rem;">
                        <div class="animate-spin" style="font-size: 3rem; margin-bottom: 2rem; display: inline-block;">⏳</div>
                        <h2 style="font-weight: 800; letter-spacing: -0.02em; margin-bottom: 1rem;">Finalizing Setup</h2>
                        <p style="color: var(--muted-foreground); line-height: 1.6; margin-bottom: 2rem;">We're preparing your profile dashboard. This usually takes just a few moments.</p>
                        <div style="padding: 0.75rem; background: var(--secondary); border-radius: var(--radius-lg); font-size: 0.9rem; font-weight: 500; margin-bottom: 1.5rem;">
                            ${user.email || user.name || 'User'}
                        </div>
                        <button class="btn-glass" style="width: 100%;" onclick="window.location.reload()">Refresh Connection</button>
                    </div>
                </div>
            `;
        }
    }

    _clearRecentTrackProfileCache() {
        this._recentTrackProfileCache = null;
        this._recentTrackProfileCacheAt = 0;
        this._recentTrackProfilePromise = null;
    }

    _clearRecommendationExclusionCache() {
        this._recommendationExclusionCache = null;
        this._recommendationExclusionCacheAt = 0;
        this._recommendationExclusionPromise = null;
    }

    _toLowerText(value) {
        return String(value || '')
            .trim()
            .toLowerCase();
    }

    _albumNameKey(album) {
        if (!album || typeof album !== 'object') return '';
        const title = this._toLowerText(album.title || album.name);
        const artistName = this._toLowerText(album.artist?.name || album.artists?.[0]?.name || album.artist);
        if (!title) return '';
        return `${title}::${artistName}`;
    }

    async _getRecommendationExclusions(forceRefresh = false, profilePromise = null) {
        const now = Date.now();
        if (
            !forceRefresh &&
            this._recommendationExclusionCache &&
            now - this._recommendationExclusionCacheAt < this._recommendationExclusionCacheTtlMs
        ) {
            return this._recommendationExclusionCache;
        }

        if (!forceRefresh && this._recommendationExclusionPromise) {
            return this._recommendationExclusionPromise;
        }

        this._recommendationExclusionPromise = (async () => {
            const profile = profilePromise
                ? await Promise.resolve(profilePromise)
                : await this.getRecentTrackProfile(forceRefresh);

            const [history, favoriteTracks, favoriteArtists, favoriteAlbums] = await Promise.all([
                db.getHistory().catch(() => []),
                db.getFavorites('track').catch(() => []),
                db.getFavorites('artist').catch(() => []),
                db.getFavorites('album').catch(() => []),
            ]);

            const knownArtistIds = new Set();
            const knownArtistNames = new Set();
            const knownAlbumIds = new Set();
            const knownAlbumKeys = new Set();

            const rememberArtist = (artist) => {
                if (!artist || typeof artist !== 'object') return;
                if (artist.id !== null && typeof artist.id !== 'undefined' && artist.id !== '') {
                    knownArtistIds.add(String(artist.id));
                }
                const name = this._toLowerText(artist.name || artist.title || artist.artist);
                if (name) knownArtistNames.add(name);
            };

            const rememberAlbum = (album) => {
                if (!album || typeof album !== 'object') return;
                if (album.id !== null && typeof album.id !== 'undefined' && album.id !== '') {
                    knownAlbumIds.add(String(album.id));
                }
                const key = this._albumNameKey(album);
                if (key) knownAlbumKeys.add(key);
            };

            (profile.artistSeeds || []).forEach((artist) => rememberArtist(artist));
            (profile.albumSeeds || []).forEach((album) => rememberAlbum(album));

            const historyTracks = Array.isArray(history) ? history.slice(0, 300) : [];
            historyTracks.forEach((track) => {
                rememberArtist(track?.artist);
                if (Array.isArray(track?.artists)) {
                    track.artists.forEach((artist) => rememberArtist(artist));
                }
                rememberAlbum(track?.album);
            });

            (Array.isArray(favoriteArtists) ? favoriteArtists : []).forEach((artist) => rememberArtist(artist));
            (Array.isArray(favoriteAlbums) ? favoriteAlbums : []).forEach((album) => {
                rememberAlbum(album);
                rememberArtist(album?.artist);
                if (Array.isArray(album?.artists)) {
                    album.artists.forEach((artist) => rememberArtist(artist));
                }
            });
            (Array.isArray(favoriteTracks) ? favoriteTracks : []).forEach((track) => {
                rememberArtist(track?.artist);
                if (Array.isArray(track?.artists)) {
                    track.artists.forEach((artist) => rememberArtist(artist));
                }
                rememberAlbum(track?.album);
            });

            const exclusionSets = {
                knownArtistIds,
                knownArtistNames,
                knownAlbumIds,
                knownAlbumKeys,
            };

            this._recommendationExclusionCache = exclusionSets;
            this._recommendationExclusionCacheAt = Date.now();
            return exclusionSets;
        })();

        try {
            return await this._recommendationExclusionPromise;
        } finally {
            this._recommendationExclusionPromise = null;
        }
    }

    _buildRecentTrackProfile(historyTracks = []) {
        const recentTracks = historyTracks
            .filter((track) => track && typeof track === 'object' && (track.id || track.title))
            .slice(0, 80);

        const playCountByTrackId = new Map();
        recentTracks.forEach((track) => {
            if (!track.id) return;
            playCountByTrackId.set(track.id, (playCountByTrackId.get(track.id) || 0) + 1);
        });

        const dedupedRecentTracks = [];
        const seenTrackIds = new Set();
        const artistWeights = new Map();
        const albumWeights = new Map();

        recentTracks.forEach((track, index) => {
            const recencyWeight = Math.max(0.12, 1 - index / Math.max(recentTracks.length, 16));
            const repeatCount = track.id ? playCountByTrackId.get(track.id) || 1 : 1;
            const repeatBoost = 1 + Math.min(1, (repeatCount - 1) * 0.25);
            const weight = recencyWeight * repeatBoost;

            if (track.id && !seenTrackIds.has(track.id)) {
                seenTrackIds.add(track.id);
                dedupedRecentTracks.push(track);
            }

            const primaryArtist = track.artist || track.artists?.[0];
            if (primaryArtist?.id || primaryArtist?.name) {
                const artistId = primaryArtist.id ?? null;
                const artistName = String(primaryArtist.name || '').trim();
                const key = artistId ? `id:${artistId}` : `name:${artistName.toLowerCase()}`;
                if (artistName || artistId) {
                    const existing = artistWeights.get(key) || {
                        id: artistId,
                        name: artistName || 'Unknown Artist',
                        picture: primaryArtist.picture || primaryArtist.image || null,
                        score: 0,
                    };
                    existing.score += weight;
                    if (!existing.picture && (primaryArtist.picture || primaryArtist.image)) {
                        existing.picture = primaryArtist.picture || primaryArtist.image;
                    }
                    artistWeights.set(key, existing);
                }
            }

            if (track.album?.id) {
                const albumKey = `id:${track.album.id}`;
                const existing = albumWeights.get(albumKey) || {
                    id: track.album.id,
                    title: track.album.title || 'Unknown Album',
                    cover: track.album.cover || null,
                    artist: track.album.artist || primaryArtist || null,
                    score: 0,
                };
                existing.score += weight;
                if (!existing.cover && track.album.cover) existing.cover = track.album.cover;
                albumWeights.set(albumKey, existing);
            }
        });

        return {
            recentTracks: dedupedRecentTracks,
            artistSeeds: Array.from(artistWeights.values()).sort((a, b) => b.score - a.score),
            albumSeeds: Array.from(albumWeights.values()).sort((a, b) => b.score - a.score),
        };
    }

    async getRecentTrackProfile(forceRefresh = false) {
        if (!forceRefresh && this._recentTrackProfilePromise) {
            return this._recentTrackProfilePromise;
        }

        this._recentTrackProfilePromise = (async () => {
            let history = [];
            try {
                history = await db.getHistory().catch(() => []);
            } catch (error) {
                console.error('[UI] Failed to load recent track history:', error);
            }

            const profile = this._buildRecentTrackProfile(history);
            this._recentTrackProfileCache = profile;
            this._recentTrackProfileCacheAt = Date.now();
            return profile;
        })();

        try {
            return await this._recentTrackProfilePromise;
        } finally {
            this._recentTrackProfilePromise = null;
        }
    }

    async getSeeds(forceRefresh = false) {
        const profile = await this.getRecentTrackProfile(forceRefresh);
        return profile.recentTracks;
    }

    _extractSeedArtists(seeds = []) {
        const byKey = new Map();
        const addArtist = (artist) => {
            if (!artist || typeof artist !== 'object') return;
            const id = artist.id ?? null;
            const name = String(artist.name || '').trim();
            if (!id && !name) return;

            const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
            if (byKey.has(key)) return;
            byKey.set(key, {
                id,
                name: name || 'Unknown Artist',
                picture: artist.picture || artist.image || null,
            });
        };

        seeds.forEach((seed) => {
            if (!seed || typeof seed !== 'object') return;
            addArtist(seed.artist);
            if (Array.isArray(seed.artists)) {
                seed.artists.forEach((artist) => addArtist(artist));
            }
        });

        return Array.from(byKey.values());
    }

    _normalizeArtistList(payload) {
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.items)) return payload.items;
        if (Array.isArray(payload?.artists)) return payload.artists;
        return [];
    }

    _normalizeAlbumList(payload) {
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.items)) return payload.items;
        if (Array.isArray(payload?.albums)) return payload.albums;
        return [];
    }

    _normalizeTrackList(payload) {
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.items)) return payload.items;
        if (Array.isArray(payload?.tracks)) return payload.tracks;
        return [];
    }

    _dedupeArtists(artists = []) {
        const byKey = new Map();
        artists.forEach((artist) => {
            if (!artist || typeof artist !== 'object') return;
            const id = artist.id ?? null;
            const name = String(artist.name || '').trim();
            if (!id && !name) return;
            const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
            if (byKey.has(key)) return;
            byKey.set(key, {
                ...artist,
                id,
                name: name || 'Unknown Artist',
                picture: artist.picture || artist.image || null,
            });
        });
        return Array.from(byKey.values());
    }

    _dedupeAlbums(albums = []) {
        const byKey = new Map();
        albums.forEach((album) => {
            if (!album || typeof album !== 'object') return;
            const id = album.id ?? null;
            const title = String(album.title || '').trim();
            const artistName = String(album.artist?.name || album.artists?.[0]?.name || '').trim();
            if (!id && !title) return;

            const key = id ? `id:${id}` : `title:${title.toLowerCase()}::artist:${artistName.toLowerCase()}`;
            if (byKey.has(key)) return;
            byKey.set(key, {
                ...album,
                id,
                title: title || 'Unknown Album',
            });
        });
        return Array.from(byKey.values());
    }

    _dedupeTracks(tracks = []) {
        const byKey = new Map();
        tracks.forEach((track) => {
            if (!track || typeof track !== 'object') return;
            const id = track.id ?? null;
            const title = String(track.title || '').trim();
            const artistName = String(track.artist?.name || track.artists?.[0]?.name || '').trim();
            const key = id ? `id:${id}` : `title:${title.toLowerCase()}::artist:${artistName.toLowerCase()}`;
            if (!title && !id) return;
            if (byKey.has(key)) return;
            byKey.set(key, track);
        });
        return Array.from(byKey.values());
    }

    _isArtistIdCompatibleWithProvider(artistId, provider = null) {
        if (artistId === null || typeof artistId === 'undefined' || artistId === '') return false;
        if (!provider) return true;
        const id = String(artistId);
        if (provider === 'qobuz') return id.startsWith('q:');
        return true;
    }

    async _hydrateArtistsForProvider(artists = [], provider = null, limit = 24) {
        const deduped = this._dedupeArtists(artists);
        const hydrated = [];
        const seenIds = new Set();
        const unresolvedByName = new Map();

        deduped.forEach((artist) => {
            if (!artist || !artist.name) return;

            const currentId = artist.id;
            if (this._isArtistIdCompatibleWithProvider(currentId, provider)) {
                const key = String(currentId);
                if (currentId && !seenIds.has(key)) {
                    seenIds.add(key);
                    hydrated.push(artist);
                }
                return;
            }

            const lookupName = String(artist.name).trim();
            if (!lookupName) return;
            if (!unresolvedByName.has(lookupName)) {
                unresolvedByName.set(lookupName, artist);
            }
        });

        if (hydrated.length >= limit || unresolvedByName.size === 0) {
            return hydrated.slice(0, limit);
        }

        const unresolvedEntries = Array.from(unresolvedByName.entries());
        const unresolvedResults = await Promise.allSettled(
            unresolvedEntries.map(([lookupName]) => this.api.searchArtists(lookupName, { limit: 8, provider }))
        );

        unresolvedResults.forEach((result, index) => {
            if (hydrated.length >= limit) return;

            const [lookupName, sourceArtist] = unresolvedEntries[index] || [];
            if (!lookupName || !sourceArtist || result.status !== 'fulfilled') return;

            const candidates = this._dedupeArtists(this._normalizeArtistList(result.value));
            const resolved =
                candidates.find((candidate) => this._isArtistIdCompatibleWithProvider(candidate?.id, provider)) ||
                candidates.find((candidate) => candidate?.id);

            if (!resolved?.id) return;

            const resolvedKey = String(resolved.id);
            if (seenIds.has(resolvedKey)) return;

            seenIds.add(resolvedKey);
            hydrated.push({
                ...resolved,
                // Prefer the incoming name casing when available.
                name: sourceArtist.name || resolved.name,
                picture: sourceArtist.picture || resolved.picture || resolved.image || null,
            });
        });

        return hydrated.slice(0, limit);
    }

    _isHomeRouteActive() {
        return window.location.pathname === '/' || window.location.pathname === '/home';
    }

    _clearHomeArtistsRetryTimer() {
        if (this._homeArtistsRetryTimer) {
            clearTimeout(this._homeArtistsRetryTimer);
            this._homeArtistsRetryTimer = null;
        }
    }

    _resetHomeArtistsRetryState() {
        this._homeArtistsRetryCount = 0;
        this._clearHomeArtistsRetryTimer();
    }

    _scheduleHomeArtistsAutoload(delayMs = 2500) {
        if (this._homeArtistsRetryCount >= this._homeArtistsMaxRetries) return;

        this._clearHomeArtistsRetryTimer();
        this._homeArtistsRetryTimer = setTimeout(() => {
            this._homeArtistsRetryTimer = null;
            if (!this._isHomeRouteActive()) return;
            this._homeArtistsRetryCount += 1;
            this.renderHomeArtists(true);
        }, delayMs);
    }

    async _loadFallbackRecommendedArtists() {
        let fallbackArtists = [];

        try {
            const fallbackResponse = await fetch('/recommended-artists.json', { cache: 'no-store' });
            if (fallbackResponse.ok) {
                const payload = await fallbackResponse.json();
                fallbackArtists = this._normalizeArtistList(payload);
            }
        } catch (error) {
            console.warn('[Home] recommended-artists.json fallback unavailable', error);
        }

        if (fallbackArtists.length === 0) {
            try {
                const picksResponse = await fetch('/editors-picks.json', { cache: 'no-store' });
                if (picksResponse.ok) {
                    const payload = await picksResponse.json();
                    const picksArtists = Array.isArray(payload)
                        ? payload
                              .filter((item) => item?.artist?.id && item?.artist?.name)
                              .map((item) => ({
                                  id: item.artist.id,
                                  name: item.artist.name,
                                  picture: item.artist.picture || null,
                              }))
                        : [];
                    fallbackArtists = picksArtists;
                }
            } catch (error) {
                console.warn('[Home] Could not derive artist fallback from curated feed', error);
            }
        }

        if (fallbackArtists.length === 0) {
            fallbackArtists = FALLBACK_RECOMMENDED_ARTISTS;
        }

        return this._dedupeArtists(this._normalizeArtistList(fallbackArtists));
    }

    async renderHomeSongs(forceRefresh = false, profilePromise = null) {
        const songsContainer = document.getElementById('home-recommended-songs');
        const section = songsContainer?.closest('.content-section');

        if (!homePageSettings.shouldShowRecommendedSongs()) {
            if (section) section.style.display = 'none';
            return;
        }

        if (section) section.style.display = '';

        if (songsContainer) {
            if (forceRefresh || songsContainer.children.length === 0) {
                songsContainer.innerHTML = this.createSkeletonTracks(10, true);
            } else if (!songsContainer.querySelector('.skeleton')) {
                return; // Already loaded
            }

            try {
                const profile = profilePromise
                    ? await Promise.resolve(profilePromise)
                    : await this.getRecentTrackProfile(forceRefresh);
                const trackSeeds = profile.recentTracks.slice(0, 8);

                if (trackSeeds.length === 0) {
                    songsContainer.innerHTML = createPlaceholder(
                        'Play more tracks to unlock recommendations based on your recent listens.'
                    );
                    return;
                }

                const listenedPool = this._dedupeTracks(profile.recentTracks)
                    .filter((track) => track?.id)
                    .slice(0, 32);

                // Render an immediate familiar baseline while fresh recommendation requests run.
                if (listenedPool.length > 0) {
                    const instantMix = [...listenedPool].sort(() => Math.random() - 0.5).slice(0, 10);
                    this.renderListWithTracks(songsContainer, instantMix, true);
                }

                let candidateTracks = [];
                const recommendationTasks = [
                    this.api
                        .getRecommendedTracksForPlaylist(trackSeeds, 40, {
                            skipCache: true,
                            cacheControl: 'no-store',
                            background: true,
                        })
                        .then((result) => this._normalizeTrackList(result)),
                    ...trackSeeds
                        .filter((track) => track?.id)
                        .slice(0, 4)
                        .map((seedTrack) =>
                            this.api
                                .getRecommendations(seedTrack.id, {
                                    skipCache: true,
                                    cacheControl: 'no-store',
                                    signal: createTimeoutSignal(5500),
                                    background: true,
                                    seedTrack,
                                })
                                .then((result) => this._normalizeTrackList(result))
                        ),
                ];

                const recommendationResults = await Promise.allSettled(recommendationTasks);
                recommendationResults.forEach((result) => {
                    if (result.status !== 'fulfilled') return;
                    candidateTracks.push(...this._normalizeTrackList(result.value));
                });

                if (candidateTracks.length === 0) {
                    console.warn('[Home] Recent-track recommendation API failed, using search fallback.');
                }

                if (candidateTracks.length === 0) {
                    const provider =
                        typeof this.api.getCurrentProvider === 'function' ? this.api.getCurrentProvider() : undefined;
                    const fallbackSeeds = profile.artistSeeds.filter((artistSeed) => artistSeed.name).slice(0, 5);
                    const fallbackResults = await Promise.allSettled(
                        fallbackSeeds.map((artistSeed) =>
                            this.api.searchTracks(artistSeed.name, {
                                limit: 10,
                                provider,
                                background: true,
                            })
                        )
                    );

                    fallbackResults.forEach((result, index) => {
                        if (result.status === 'fulfilled') {
                            candidateTracks.push(...this._normalizeTrackList(result.value));
                            return;
                        }
                        const artistName = fallbackSeeds[index]?.name || 'unknown artist';
                        console.warn('[Home] searchTracks fallback failed for', artistName, result.reason);
                    });
                }

                const recentTrackIds = new Set(profile.recentTracks.map((track) => track.id).filter(Boolean));
                const dedupedCandidates = this._dedupeTracks(candidateTracks);
                const seenSongKeys = new Set();
                const uniqueCandidates = dedupedCandidates.filter((track) => {
                    const key =
                        `${String(track?.title || '')
                            .trim()
                            .toLowerCase()}::` +
                        `${String(track?.artist?.name || track?.artists?.[0]?.name || '')
                            .trim()
                            .toLowerCase()}`;
                    if (seenSongKeys.has(key)) return false;
                    seenSongKeys.add(key);
                    return true;
                });
                const unheardCandidates = uniqueCandidates.filter(
                    (track) => !track?.id || !recentTrackIds.has(track.id)
                );

                const listenedCandidates = [...listenedPool]
                    .filter((track) => !track?.id || !dedupedCandidates.some((candidate) => candidate?.id === track.id))
                    .sort(() => Math.random() - 0.5);

                const totalTarget = 20;
                const unheardTarget = 12;
                const listenedTarget = totalTarget - unheardTarget;

                const mixedTracks = [
                    ...unheardCandidates.slice(0, unheardTarget),
                    ...listenedCandidates.slice(0, listenedTarget),
                ];

                const backfillPool = this._dedupeTracks([...unheardCandidates, ...listenedCandidates]);
                let backfillIndex = 0;
                while (mixedTracks.length < totalTarget && backfillIndex < backfillPool.length) {
                    const nextTrack = backfillPool[backfillIndex++];
                    if (!nextTrack?.id || mixedTracks.some((track) => track?.id === nextTrack.id)) continue;
                    mixedTracks.push(nextTrack);
                }

                const shuffledMixedTracks = [...mixedTracks].sort(() => Math.random() - 0.5);
                const filteredTracks = await this.filterUserContent(shuffledMixedTracks, 'track');

                if (filteredTracks.length > 0) {
                    this.renderListWithTracks(songsContainer, filteredTracks.slice(0, totalTarget), true);
                } else {
                    songsContainer.innerHTML = createPlaceholder(
                        'No mixed recommendations found right now. Try refreshing for a new blend.'
                    );
                }
            } catch (e) {
                console.error(e);
                songsContainer.innerHTML = createPlaceholder('Failed to load song recommendations.');
            }
        }
    }

    async renderHomeAlbums(forceRefresh = false, profilePromise = null) {
        const albumsContainer = document.getElementById('home-recommended-albums');
        const section = albumsContainer?.closest('.content-section');

        if (!homePageSettings.shouldShowRecommendedAlbums()) {
            if (section) section.style.display = 'none';
            return;
        }

        if (section) section.style.display = '';

        if (albumsContainer) {
            if (forceRefresh || albumsContainer.children.length === 0) {
                albumsContainer.innerHTML = `<div class="skeleton-container">${this.createSkeletonCards(5)}</div>`;
            } else if (!albumsContainer.querySelector('.skeleton')) {
                return;
            }

            try {
                const profile = profilePromise
                    ? await Promise.resolve(profilePromise)
                    : await this.getRecentTrackProfile(forceRefresh);
                const albumCandidates = new Map();

                const pushAlbums = (albums, seedScore = 1) => {
                    const normalized = this._dedupeAlbums(this._normalizeAlbumList(albums));
                    normalized.forEach((album, index) => {
                        if (!album?.id) return;
                        const key = `id:${album.id}`;
                        const rankWeight = Math.max(0.25, 1 - index / Math.max(normalized.length, 12));
                        const score = seedScore * rankWeight;
                        const existing = albumCandidates.get(key);
                        if (existing) {
                            existing.score += score;
                            if (!existing.album.cover && album.cover) existing.album.cover = album.cover;
                        } else {
                            albumCandidates.set(key, { album, score });
                        }
                    });
                };

                const albumSeeds = profile.albumSeeds.filter((albumSeed) => albumSeed.id).slice(0, 6);

                // Render an immediate baseline from the user's own recent albums
                // while recommendation requests run — never leave bare skeletons.
                const renderAlbums = (albums) => {
                    const displayedAlbums = albums.slice(0, 12);
                    albumsContainer.innerHTML = displayedAlbums
                        .map((album) => this.createAlbumCardHTML(album))
                        .join('');
                    albumsContainer.classList.add('home-panel-carousel');
                    displayedAlbums.forEach((album) => {
                        const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                        if (el) {
                            trackDataStore.set(el, album);
                            this.updateLikeState(el, 'album', album.id);

                            // Keep home recommended albums visually aligned with collaborative cards.
                            el.classList.add('collab-playlist-card', 'home-album-like-collab');
                            const content = el.querySelector('.card-content');
                            if (content) {
                                content.classList.add('card-info');
                                content.querySelector('.card-subtitle')?.classList.add('card-meta');
                            }
                        }
                    });
                    this.applyHomePanelSlideFx(albumsContainer);
                };
                if (albumSeeds.length > 0) renderAlbums(albumSeeds);

                const similarAlbumResults = await Promise.allSettled(
                    albumSeeds.map((albumSeed) =>
                        this.api.getSimilarAlbums(albumSeed.id, {
                            skipCache: true,
                            cacheControl: 'no-store',
                            background: true,
                            seedArtistName: albumSeed.artist?.name || '',
                        })
                    )
                );

                similarAlbumResults.forEach((result, index) => {
                    const albumSeed = albumSeeds[index];
                    if (!albumSeed) return;
                    if (result.status === 'fulfilled') {
                        pushAlbums(result.value, albumSeed.score || 1);
                        return;
                    }
                    console.warn('[Home] getSimilarAlbums failed for', albumSeed.id, result.reason);
                });

                if (albumCandidates.size === 0) {
                    const provider =
                        typeof this.api.getCurrentProvider === 'function' ? this.api.getCurrentProvider() : undefined;
                    const fallbackSeeds = profile.artistSeeds.filter((artistSeed) => artistSeed.name).slice(0, 5);
                    const fallbackResults = await Promise.allSettled(
                        fallbackSeeds.map((artistSeed) =>
                            this.api.searchAlbums(artistSeed.name, {
                                limit: 10,
                                provider,
                                background: true,
                            })
                        )
                    );

                    fallbackResults.forEach((result, index) => {
                        const artistSeed = fallbackSeeds[index];
                        if (!artistSeed) return;
                        if (result.status === 'fulfilled') {
                            pushAlbums(result.value, artistSeed.score || 1);
                            return;
                        }
                        console.warn('[Home] searchAlbums fallback failed for', artistSeed.name, result.reason);
                    });
                }

                const exclusions = await this._getRecommendationExclusions(forceRefresh, profilePromise);
                const isKnownAlbum = (album) => {
                    if (!album || typeof album !== 'object') return false;
                    const id = album.id !== null && typeof album.id !== 'undefined' ? String(album.id) : '';
                    if (id && exclusions.knownAlbumIds.has(id)) return true;
                    const key = this._albumNameKey(album);
                    return key ? exclusions.knownAlbumKeys.has(key) : false;
                };

                const isKnownArtistForAlbum = (album) => {
                    const artistId = album?.artist?.id ?? album?.artists?.[0]?.id;
                    const artistName = this._toLowerText(album?.artist?.name || album?.artists?.[0]?.name);
                    if (artistId !== null && typeof artistId !== 'undefined' && artistId !== '') {
                        if (exclusions.knownArtistIds.has(String(artistId))) return true;
                    }
                    return artistName ? exclusions.knownArtistNames.has(artistName) : false;
                };

                const rankedAlbums = Array.from(albumCandidates.values())
                    .sort((a, b) => b.score - a.score)
                    .map((entry) => entry.album)
                    .filter((album) => !isKnownAlbum(album));

                const strictDiscoveryAlbums = rankedAlbums.filter((album) => !isKnownArtistForAlbum(album));
                const candidateAlbums =
                    strictDiscoveryAlbums.length >= 8
                        ? strictDiscoveryAlbums
                        : [
                              ...strictDiscoveryAlbums,
                              ...rankedAlbums.filter((album) => !strictDiscoveryAlbums.includes(album)),
                          ];

                const filteredAlbums = await this.filterUserContent(candidateAlbums, 'album');

                if (filteredAlbums.length > 0) {
                    renderAlbums(filteredAlbums.slice(0, 12));
                } else {
                    albumsContainer.innerHTML = `<div style="grid-column: 1/-1; padding: 2rem 0;">${createPlaceholder('No album recommendations found from your recent tracks yet.')}</div>`;
                    this.resetHomePanelSlideFx(albumsContainer);
                }
            } catch (e) {
                console.error(e);
                if (!albumsContainer.querySelector('[data-album-id]')) {
                    albumsContainer.innerHTML = createPlaceholder('Failed to load album recommendations.');
                    this.resetHomePanelSlideFx(albumsContainer);
                }
            }
        }
    }

    async renderHomeCollaborativePlaylists(forceRefresh = false) {
        const section = document.getElementById('home-collab-playlists-section');
        const grid = document.getElementById('home-collab-playlists-grid');
        const empty = document.getElementById('home-collab-playlists-empty');
        if (!section || !grid || !empty) return;

        if (forceRefresh || grid.children.length === 0) {
            grid.innerHTML = `<div class="skeleton-container">${this.createSkeletonCards(2)}</div>`;
        }

        try {
            const playlists = await db.getCollaborativePlaylists();
            const list = Array.isArray(playlists) ? playlists : [];

            if (!list.length) {
                section.style.display = '';
                grid.innerHTML = '';
                empty.style.display = '';
                this.resetHomePanelSlideFx(grid);
                return;
            }

            const top = list.slice(0, 8);
            grid.innerHTML = top
                .map((playlist) => {
                    const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0;
                    const memberCount = Array.isArray(playlist.members) ? playlist.members.length : 0;
                    const totalDuration = calculateTotalDuration(playlist.tracks || []);
                    const meta = `${trackCount} tracks • ${memberCount} members${totalDuration ? ` • ${formatDuration(totalDuration)}` : ''}`;
                    const coverHtml = this.createCollaborativePlaylistImageHTML(playlist);
                    return `
                        <div class="card collab-playlist-card" data-id="${playlist.id}">
                            <div class="card-image-wrapper">
                                ${coverHtml}
                                <button class="card-play-btn" title="Play">
                                    ${SVG_PLAY}
                                </button>
                            </div>
                            <div class="card-info">
                                <div class="card-title">${escapeHtml(playlist.name || 'Collaborative Playlist')}</div>
                                <div class="card-meta">${escapeHtml(meta)}</div>
                            </div>
                        </div>
                    `;
                })
                .join('');
            grid.classList.add('home-panel-carousel');

            grid.querySelectorAll('.collab-playlist-card').forEach((card, index) => {
                const playlist = top[index];
                if (!playlist) return;

                trackDataStore.set(card, playlist);

                card.addEventListener('click', () => {
                    navigate(`/collabplaylist/${playlist.id}`);
                });

                const playBtn = card.querySelector('.card-play-btn');
                if (playBtn) {
                    playBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
                        if (tracks.length > 0) {
                            this.player.setQueue(tracks, 0);
                            this.player.playTrackFromQueue();
                        } else {
                            navigate(`/collabplaylist/${playlist.id}`);
                        }
                    });
                }
            });

            empty.style.display = 'none';
            section.style.display = '';
            this.applyHomePanelSlideFx(grid);
        } catch (error) {
            console.error('[Home] Failed to load collaborative playlists:', error);
            section.style.display = '';
            grid.innerHTML = '';
            empty.innerHTML = '<p>Failed to load collaborative playlists.</p>';
            empty.style.display = '';
            this.resetHomePanelSlideFx(grid);
        }
    }

    async renderHomeFriendsActivity() {
        const section = document.getElementById('home-friends-activity-section');
        const grid = document.getElementById('home-friends-activity-grid');
        const empty = document.getElementById('home-friends-activity-empty');
        if (!section || !grid || !empty) return;

        const getStatusPayload = (status) => {
            if (!status || typeof status !== 'string') return null;
            try {
                const parsed = JSON.parse(status);
                if (!parsed || typeof parsed !== 'object') return null;

                const parseNumber = (value) => {
                    const n = Number(value);
                    return Number.isFinite(n) ? n : 0;
                };

                return {
                    text: parsed.text ? String(parsed.text) : '',
                    image: parsed.image ? String(parsed.image) : '',
                    link: parsed.link ? String(parsed.link) : '',
                    updatedAt: parseNumber(parsed.updatedAt),
                    startedAt: parseNumber(parsed.startedAt),
                    expiresAt: parseNumber(parsed.expiresAt),
                    durationSec: parseNumber(parsed.durationSec),
                };
            } catch (_error) {
                return null;
            }
        };

        const toTimestamp = (value) => {
            if (value === null || value === undefined || value === '') return 0;
            if (typeof value === 'number' && Number.isFinite(value)) return value;

            const parsed = Date.parse(String(value));
            return Number.isFinite(parsed) ? parsed : 0;
        };

        const isNowPlayingFresh = (statusPayload, profileUpdatedAtMs) => {
            if (!statusPayload?.text) return false;

            const now = Date.now();
            const updatedAt = statusPayload.updatedAt || 0;
            const startedAt = statusPayload.startedAt || 0;
            const expiresAt = statusPayload.expiresAt || 0;
            const durationSec = statusPayload.durationSec || 0;

            if (expiresAt > 0 && now > expiresAt) return false;

            // Treat statuses without explicit expiry as stale after 12 minutes.
            const staleWindowMs = 12 * 60 * 1000;
            if (updatedAt > 0 && now - updatedAt > staleWindowMs) return false;

            // If we know duration and start time, cap how long a single song can remain "Now Playing".
            if (startedAt > 0 && durationSec > 0) {
                const maxSongSpanMs = Math.max(3 * 60 * 1000, Math.min(durationSec * 1000 * 1.8, 20 * 60 * 1000));
                if (now - startedAt > maxSongSpanMs) return false;
            }

            // If the profile itself has not been updated for a long time, treat it as inactive.
            if (profileUpdatedAtMs > 0 && now - profileUpdatedAtMs > 15 * 60 * 1000) return false;

            return true;
        };

        const formatLastActiveText = (timestampMs) => {
            if (!timestampMs || !Number.isFinite(timestampMs) || timestampMs <= 0) {
                return 'Inactive right now.';
            }

            const deltaMs = Math.max(0, Date.now() - timestampMs);
            const minuteMs = 60 * 1000;
            const hourMs = 60 * minuteMs;
            const dayMs = 24 * hourMs;

            if (deltaMs < minuteMs) return 'Active just now.';
            if (deltaMs < hourMs) {
                const mins = Math.max(1, Math.floor(deltaMs / minuteMs));
                return `Active ${mins} min ago.`;
            }
            if (deltaMs < dayMs) {
                const hrs = Math.max(1, Math.floor(deltaMs / hourMs));
                return `Active ${hrs} hr ago.`;
            }

            const days = Math.max(1, Math.floor(deltaMs / dayMs));
            return `Active ${days} day${days === 1 ? '' : 's'} ago.`;
        };

        const resolveStatusImage = (image) => {
            if (!image) return '/assets/appicon.png';
            if (
                image.startsWith('http://') ||
                image.startsWith('https://') ||
                image.startsWith('/') ||
                image.startsWith('assets/')
            ) {
                return image;
            }
            return this.api.getCoverUrl(image, '320');
        };

        const toInternalPath = (url) => {
            if (!url) return '';
            try {
                const parsed = new URL(url, window.location.origin);
                if (parsed.origin !== window.location.origin) return '';
                return `${parsed.pathname}${parsed.search || ''}${parsed.hash || ''}`;
            } catch (_error) {
                return '';
            }
        };

        try {
            const useCloudSocial = !!authManager.user;
            const friends = useCloudSocial ? await syncManager.listFriends() : await db.getFriends();
            const friendList = Array.isArray(friends) ? friends.slice(0, 8) : [];

            if (!friendList.length) {
                grid.innerHTML = '';
                empty.innerHTML = '<p>Add friends to start seeing live listening activity.</p>';
                empty.style.display = '';
                section.style.display = '';
                return;
            }

            if (useCloudSocial) {
                await Promise.allSettled(
                    friendList.map(async (friend) => {
                        if (!friend?.username) return;
                        try {
                            const profile = await syncManager.getProfile(friend.username);
                            if (profile?.status) friend.status = profile.status;
                            if (profile?.avatar_url) friend.avatarUrl = profile.avatar_url;
                            friend.profileUpdatedAt = toTimestamp(profile?.$updatedAt || profile?.updated_at || 0);
                        } catch (_error) {
                            // Keep rendering even if one profile lookup fails.
                        }
                    })
                );
            }

            grid.innerHTML = friendList
                .map((friend) => {
                    const username = String(friend.username || '').trim();
                    const displayName = escapeHtml(friend.displayName || username || 'Friend');
                    const safeUsername = escapeHtml(username);
                    const statusPayload = getStatusPayload(friend.status);
                    const statusText = statusPayload?.text || getDisplayStatusText(friend.status);
                    const profileUpdatedAtMs = toTimestamp(friend.profileUpdatedAt || 0);
                    const hasNowPlaying = isNowPlayingFresh(statusPayload, profileUpdatedAtMs);
                    const statusLabel = hasNowPlaying ? 'Now Playing' : 'Inactive';
                    const statusClass = hasNowPlaying ? 'active' : 'inactive';
                    const statusImage = resolveStatusImage(statusPayload?.image || '');
                    const internalTrackPath = toInternalPath(statusPayload?.link || '');
                    const hasLastTrack = Boolean(statusText);
                    const lastActiveAtMs = Math.max(
                        profileUpdatedAtMs,
                        toTimestamp(statusPayload?.updatedAt || 0),
                        toTimestamp(friend.updatedAt || 0)
                    );
                    const trackLine = hasNowPlaying
                        ? escapeHtml(statusText)
                        : hasLastTrack
                          ? `Last played: ${escapeHtml(statusText)}`
                          : formatLastActiveText(lastActiveAtMs);
                    const lastSeenLine =
                        !hasNowPlaying && hasLastTrack ? escapeHtml(formatLastActiveText(lastActiveAtMs)) : '';

                    return `
                        <article class="home-friend-activity-card ${statusClass}" data-username="${safeUsername}">
                            <div class="home-friend-activity-head">
                                <div class="home-friend-activity-avatar">
                                    <img src="${friend.avatarUrl || '/assets/appicon.png'}" alt="${displayName}" loading="lazy" onerror="this.onerror=null;this.src='/assets/appicon.png';" />
                                </div>
                                <div class="home-friend-activity-identity">
                                    <h3>${displayName}</h3>
                                    <p>@${safeUsername}</p>
                                </div>
                                <span class="home-friend-activity-badge ${statusClass}">${statusLabel}</span>
                            </div>
                            <div class="home-friend-activity-body">
                                <div class="home-friend-activity-cover">
                                    <img src="${statusImage}" alt="${hasNowPlaying ? 'Now playing cover' : hasLastTrack ? 'Last played cover' : 'Inactive cover'}" loading="lazy" />
                                </div>
                                <div class="home-friend-activity-meta">
                                    <p class="home-friend-activity-track">${trackLine}</p>
                                    ${lastSeenLine ? `<p class="home-friend-activity-last-seen">${lastSeenLine}</p>` : ''}
                                    <div class="home-friend-activity-actions">
                                        <button class="btn-secondary home-friend-profile-btn" data-username="${safeUsername}">View Profile</button>
                                        ${
                                            internalTrackPath && (hasNowPlaying || hasLastTrack)
                                                ? `<button class="btn-primary home-friend-track-btn" data-track-path="${escapeHtml(internalTrackPath)}">${hasNowPlaying ? 'Open Track' : 'Open Last Track'}</button>`
                                                : ''
                                        }
                                    </div>
                                </div>
                            </div>
                        </article>
                    `;
                })
                .join('');

            empty.style.display = 'none';
            section.style.display = '';

            grid.querySelectorAll('.home-friend-profile-btn').forEach((button) => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const username = button.dataset.username;
                    if (username) {
                        navigate(`/user/@${encodeURIComponent(username)}`);
                    }
                });
            });

            grid.querySelectorAll('.home-friend-track-btn').forEach((button) => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const trackPath = button.dataset.trackPath;
                    if (trackPath) {
                        navigate(trackPath);
                    }
                });
            });

            grid.querySelectorAll('.home-friend-activity-card').forEach((card) => {
                card.addEventListener('click', () => {
                    const username = card.dataset.username;
                    if (username) {
                        navigate(`/user/@${encodeURIComponent(username)}`);
                    }
                });
            });
        } catch (error) {
            console.error('[Home] Failed to render friends activity:', error);
            grid.innerHTML = '';
            empty.innerHTML = '<p>Unable to load friend activity right now.</p>';
            empty.style.display = '';
            section.style.display = '';
        }
    }

    resetHomePanelSlideFx(container) {
        if (!container) return;
        container.classList.remove('home-panel-carousel');
        container.querySelectorAll(':scope > .card').forEach((card) => {
            card.style.removeProperty('--slide-card-opacity');
            card.style.removeProperty('--slide-card-scale');
            card.style.removeProperty('--slide-card-raise');
        });
    }

    applyHomePanelSlideFx(container) {
        if (!container) return;
        if (!this._homePanelFxHandlers) this._homePanelFxHandlers = new WeakMap();

        const update = () => {
            const cards = container.querySelectorAll(':scope > .card');
            if (!cards.length) return;

            const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
            if (!isDesktop) {
                cards.forEach((card) => {
                    card.style.setProperty('--slide-card-opacity', '1');
                    card.style.setProperty('--slide-card-scale', '1');
                    card.style.setProperty('--slide-card-raise', '0px');
                });
                return;
            }

            const viewport = container.getBoundingClientRect();
            const center = viewport.left + viewport.width / 2;
            const span = viewport.width / 2;

            cards.forEach((card) => {
                const rect = card.getBoundingClientRect();
                const visible = Math.max(0, Math.min(rect.right, viewport.right) - Math.max(rect.left, viewport.left));
                const visibleRatio = Math.max(0, Math.min(1, visible / Math.max(rect.width, 1)));
                const cardCenter = rect.left + rect.width / 2;
                const distanceRatio = Math.min(1, Math.abs(cardCenter - center) / Math.max(span, 1));
                const focus = 1 - distanceRatio;
                const emphasis = Math.max(visibleRatio, focus * 0.94);
                const opacity = 0.42 + emphasis * 0.58;
                const scale = 0.972 + emphasis * 0.028;
                const rise = (1 - emphasis) * 6;

                card.style.setProperty('--slide-card-opacity', opacity.toFixed(3));
                card.style.setProperty('--slide-card-scale', scale.toFixed(3));
                card.style.setProperty('--slide-card-raise', `${rise.toFixed(2)}px`);
            });
        };

        const rafUpdate = () => requestAnimationFrame(update);
        if (!this._homePanelFxHandlers.get(container)) {
            container.addEventListener('scroll', rafUpdate, { passive: true });
            window.addEventListener('resize', rafUpdate);
            this._homePanelFxHandlers.set(container, rafUpdate);
        }

        rafUpdate();
    }

    createTrackCardHTML(track) {
        const explicitBadge = hasExplicitContent(track) ? this.createExplicitBadge() : '';
        const qualityBadge = createQualityBadgeHTML(track);
        const isCompact = cardSettings.isCompactAlbum();
        const coverSrc = this.api.getCoverUrl(track.album?.cover);

        return this.createBaseCardHTML({
            type: 'track',
            id: track.id,
            href: `/track/${track.id}`,
            title: `${escapeHtml(getTrackTitle(track))} ${explicitBadge} ${qualityBadge}`,
            subtitle: escapeHtml(getTrackArtists(track)),
            imageHTML: this.createCoverImageHtml(coverSrc, track.title),
            actionButtonsHTML: '',
            isCompact,
        });
    }

    _getBillboardRegionalChart() {
        const country = String(localStorage.getItem('userCountryCode') || 'US')
            .trim()
            .toUpperCase();
        return BILLBOARD_REGIONAL_BY_COUNTRY[country] || { slug: 'billboard-global-excl-us', label: 'Global Excl. US' };
    }

    _getBillboardChartUrl(slug) {
        return `${BILLBOARD_JSON_BASE_URL}/${slug}/recent.json`;
    }

    async _fetchBillboardChart(slug, limit = 20) {
        const response = await fetch(this._getBillboardChartUrl(slug), { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Billboard chart fetch failed (${slug}): ${response.status}`);
        }

        const payload = await response.json();
        const items = Array.isArray(payload?.data) ? payload.data : [];

        return items.slice(0, limit).map((entry, index) => ({
            ...entry,
            rank: Number(entry?.rank) || index + 1,
            name: String(entry?.name || '').trim(),
            artist: String(entry?.artist || '').trim(),
            image: String(entry?.image || '').trim(),
            peak_rank: Number(entry?.peak_rank) || null,
            weeks_on_chart: Number(entry?.weeks_on_chart) || null,
            last_week_rank: Number(entry?.last_week_rank) || null,
        }));
    }

    _normalizeBillboardText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/\(.*?\)/g, ' ')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _stripBracketedTitle(value) {
        return String(value || '')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\[[^\]]*\]/g, ' ')
            .replace(/\{[^}]*\}/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _containsVariantKeyword(value) {
        const text = this._normalizeBillboardText(value);
        if (!text) return false;
        return /\b(karaoke|instrumental|cover|tribute|nightcore|slowed|speed up|sped up|reverb|remix|8d|acoustic)\b/.test(
            text
        );
    }

    _tokenizeBillboardText(value) {
        const stopWords = new Set(['with', 'feat', 'featuring', 'ft', 'and', 'x', 'the']);
        return this._normalizeBillboardText(value)
            .split(' ')
            .map((token) => token.trim())
            .filter((token) => token && !stopWords.has(token));
    }

    _tokenOverlapRatio(aTokens = [], bTokens = []) {
        if (!aTokens.length || !bTokens.length) return 0;
        const bSet = new Set(bTokens);
        let overlap = 0;
        aTokens.forEach((token) => {
            if (bSet.has(token)) overlap += 1;
        });
        return overlap / Math.max(aTokens.length, bTokens.length);
    }

    _selectBestBillboardTrackCandidate(entry, candidates = []) {
        if (!Array.isArray(candidates) || !candidates.length) {
            return { track: null, score: -1, confidence: 0 };
        }

        const scored = candidates
            .map((candidate) => ({
                candidate,
                score: this._scoreBillboardTrackMatch(entry, candidate),
            }))
            .sort((a, b) => b.score - a.score);

        const best = scored[0] || null;
        const second = scored[1] || null;
        const confidence = best ? best.score - (second?.score ?? -1) : 0;

        return {
            track: best?.candidate || null,
            score: best?.score ?? -1,
            confidence,
        };
    }

    _scoreBillboardTrackMatch(entry, track) {
        if (!track) return -1;

        const entryTitle = this._normalizeBillboardText(entry?.name);
        const entryArtist = this._normalizeBillboardText(entry?.artist);
        const trackTitle = this._normalizeBillboardText(getTrackTitle(track));
        const trackArtist = this._normalizeBillboardText(getTrackArtists(track));
        const trackArtistRaw = getTrackArtists(track);

        if (!entryTitle || !trackTitle) return -1;

        const entryTitleTokens = this._tokenizeBillboardText(entryTitle);
        const trackTitleTokens = this._tokenizeBillboardText(trackTitle);
        const entryArtistTokens = this._tokenizeBillboardText(entryArtist);
        const trackArtistTokens = this._tokenizeBillboardText(trackArtist);
        const titleOverlap = this._tokenOverlapRatio(entryTitleTokens, trackTitleTokens);
        const artistOverlap = this._tokenOverlapRatio(entryArtistTokens, trackArtistTokens);

        let score = 0;
        if (entryTitle === trackTitle) score += 9;
        if (trackTitle.includes(entryTitle) || entryTitle.includes(trackTitle)) score += 4;
        score += titleOverlap * 8;

        if (entryArtist && trackArtist && (trackArtist.includes(entryArtist) || entryArtist.includes(trackArtist))) {
            score += 4;
        }
        score += artistOverlap * 10;

        // If title looks close but artist does not overlap at all, treat as likely wrong release/cover.
        if (entryArtistTokens.length && artistOverlap === 0) {
            score -= 6;
        }

        // Penalize common wrong variants unless the chart entry itself contains that keyword.
        const entryHasVariant = this._containsVariantKeyword(entry?.name);
        const trackHasVariant = this._containsVariantKeyword(getTrackTitle(track));
        if (!entryHasVariant && trackHasVariant) {
            score -= 10;
        }

        // Extra penalty for karaoke/tribute style artist identities.
        if (!entryHasVariant && this._containsVariantKeyword(trackArtistRaw)) {
            score -= 10;
        }

        return score;
    }

    _scoreBillboardAlbumMatch(entry, album) {
        if (!album) return -1;

        const entryTitle = this._normalizeBillboardText(entry?.name);
        const entryArtist = this._normalizeBillboardText(entry?.artist);
        const albumTitle = this._normalizeBillboardText(album?.title);
        const albumArtist = this._normalizeBillboardText(album?.artist?.name || album?.artists?.[0]?.name || '');

        if (!entryTitle || !albumTitle) return -1;

        let score = 0;
        if (entryTitle === albumTitle) score += 8;
        if (albumTitle.includes(entryTitle) || entryTitle.includes(albumTitle)) score += 4;
        if (entryArtist && albumArtist && (albumArtist.includes(entryArtist) || entryArtist.includes(albumArtist))) {
            score += 3;
        }

        return score;
    }

    _scoreBillboardArtistMatch(entry, artist) {
        if (!artist) return -1;

        const entryName = this._normalizeBillboardText(entry?.name);
        const artistName = this._normalizeBillboardText(artist?.name);
        if (!entryName || !artistName) return -1;

        if (entryName === artistName) return 10;
        if (artistName.includes(entryName) || entryName.includes(artistName)) return 6;
        return 0;
    }

    async _resolveBillboardAlbums(entries = [], provider = null, options = {}) {
        const cache = this._billboardResolveAlbumCache || new Map();
        this._billboardResolveAlbumCache = cache;

        const resolveOne = async (entry) => {
            const query = `${entry.name} ${entry.artist}`.trim();
            const key = `${provider || 'default'}::album::${this._normalizeBillboardText(query)}`;
            if (cache.has(key)) return { ...entry, resolvedAlbum: cache.get(key) };

            const search = await this.api.searchAlbums(query, { limit: 8, provider, ...options });
            const candidates = this._normalizeAlbumList(search);
            let best = null;
            let bestScore = -1;
            candidates.forEach((candidate) => {
                const score = this._scoreBillboardAlbumMatch(entry, candidate);
                if (score > bestScore) {
                    bestScore = score;
                    best = candidate;
                }
            });

            const resolved = bestScore >= 4 ? best : candidates[0] || null;
            cache.set(key, resolved || null);
            return { ...entry, resolvedAlbum: resolved || null };
        };

        const resolved = await Promise.allSettled(entries.map((entry) => resolveOne(entry)));
        return resolved.map((item, index) =>
            item.status === 'fulfilled' ? item.value : { ...entries[index], resolvedAlbum: null }
        );
    }

    async _resolveBillboardArtists(entries = [], provider = null, options = {}) {
        const cache = this._billboardResolveArtistCache || new Map();
        this._billboardResolveArtistCache = cache;

        const resolveOne = async (entry) => {
            const query = String(entry.name || '').trim();
            const key = `${provider || 'default'}::artist::${this._normalizeBillboardText(query)}`;
            if (cache.has(key)) return { ...entry, resolvedArtist: cache.get(key) };

            const search = await this.api.searchArtists(query, { limit: 8, provider, ...options });
            const candidates = this._normalizeArtistList(search);
            let best = null;
            let bestScore = -1;
            candidates.forEach((candidate) => {
                const score = this._scoreBillboardArtistMatch(entry, candidate);
                if (score > bestScore) {
                    bestScore = score;
                    best = candidate;
                }
            });

            const resolved = bestScore >= 4 ? best : candidates[0] || null;
            cache.set(key, resolved || null);
            return { ...entry, resolvedArtist: resolved || null };
        };

        const resolved = await Promise.allSettled(entries.map((entry) => resolveOne(entry)));
        return resolved.map((item, index) =>
            item.status === 'fulfilled' ? item.value : { ...entries[index], resolvedArtist: null }
        );
    }

    _syncBillboardModuleOrder(section, suffix = '') {
        const content = section.querySelector('.home-discovery-content');
        if (!content) return;

        const ids = [
            `home-billboard-hot100-module${suffix}`,
            `home-billboard-global200-module${suffix}`,
            `home-billboard-200-module${suffix}`,
            `home-billboard-artist100-module${suffix}`,
            `home-billboard-regional-module${suffix}`,
            `home-billboard-india-module${suffix}`,
            `home-billboard-japan-module${suffix}`,
            `home-billboard-uk-module${suffix}`,
        ];

        const modules = ids.map((id) => document.getElementById(id)).filter(Boolean);
        if (!modules.length) return;

        modules.forEach((module) => content.appendChild(module));
    }

    _renderBillboardTrackList(containerId, entries = []) {
        const container = document.getElementById(containerId);
        if (!container) return false;
        if (!entries.length) {
            container.innerHTML = '';
            return false;
        }
        container.classList.add('billboard-chart-list');

        // Billboard chart entries are rendered like any other track list
        // (same .track-item markup and CSS). Nothing is preloaded/resolved in
        // the background — clicking a row resolves it through the addon at
        // click time (with persistent retry) and plays it like a normal track.
        const pseudoTracks = entries.slice(0, 15).map((entry) => {
            const artistName = String(entry.artist || 'Unknown Artist');
            return {
                id: '',
                title: String(entry.name || 'Untitled'),
                artist: { name: artistName },
                artists: [{ name: artistName }],
                album: { title: '', cover: entry.image || null },
                duration: 0,
            };
        });

        this.renderListWithTracks(container, pseudoTracks, true, false, true);

        const rows = container.querySelectorAll('.track-item');
        rows.forEach((row, i) => {
            const entry = entries[i];
            const rank = Number(entry?.rank) || i + 1;
            const numberEl = row.querySelector('.track-number');
            if (numberEl) {
                numberEl.textContent = rank;
                if (rank === 1) numberEl.classList.add('rank-gold');
                else if (rank === 2) numberEl.classList.add('rank-silver');
                else if (rank === 3) numberEl.classList.add('rank-bronze');
            }
            const durationEl = row.querySelector('.track-item-duration');
            if (durationEl) {
                const peak = Number.isFinite(entry?.peak_rank) ? `Peak ${entry.peak_rank}` : 'Peak -';
                const weeks = Number.isFinite(entry?.weeks_on_chart) ? `${entry.weeks_on_chart} wks` : 'New';
                durationEl.textContent = `${peak} • ${weeks}`;
            }
            row.dataset.billboardName = String(entry?.name || '');
            row.dataset.billboardArtist = String(entry?.artist || '');
        });

        // Bind the click handler once — the container persists across
        // re-renders, and re-binding would make every click fire multiple
        // concurrent searches/plays and overlap the same song.
        if (container.dataset.billboardClickBound === '1') return true;
        container.dataset.billboardClickBound = '1';

        container.addEventListener('click', async (e) => {
            const row = e.target.closest('.track-item');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();

            const storedTrack = trackDataStore.get(row);
            if (storedTrack?.id) {
                this.player.setQueue([storedTrack], 0);
                this.player.playTrackFromQueue();
                return;
            }

            row.classList.add('billboard-resolving');
            try {
                const provider =
                    typeof this.api.getCurrentProvider === 'function' ? this.api.getCurrentProvider() : undefined;
                const name = String(row.dataset.billboardName || '');
                const artist = String(row.dataset.billboardArtist || '');
                const entry = { name, artist };
                const strippedName = this._stripBracketedTitle(name);
                const primaryQuery = `${name} ${artist}`.trim();
                const fallbackQuery = `${strippedName} ${artist}`.trim();

                const results = await this.api.searchTracks(primaryQuery, { provider, retry: true });
                let candidates = this._normalizeTrackList(results);
                let bestMatch = this._selectBestBillboardTrackCandidate(entry, candidates);

                const shouldRetryWithoutBrackets =
                    fallbackQuery && fallbackQuery !== primaryQuery && (!candidates.length || bestMatch.score < 6);
                if (shouldRetryWithoutBrackets) {
                    try {
                        const fallbackResults = await this.api.searchTracks(fallbackQuery, { provider, retry: true });
                        const fallbackCandidates = this._normalizeTrackList(fallbackResults);
                        if (fallbackCandidates.length) {
                            candidates = fallbackCandidates;
                            bestMatch = this._selectBestBillboardTrackCandidate(entry, candidates);
                        }
                    } catch (error) {
                        console.warn('[Billboard] Track fallback search failed:', error);
                    }
                }

                const track = bestMatch.score >= 3 ? bestMatch.track : candidates[0] || null;
                if (!track) {
                    showNotification('No playable match found for this chart track.', 'warning');
                    return;
                }

                trackDataStore.set(row, track);
                this.player.setQueue([track], 0);
                this.player.playTrackFromQueue();
            } catch (error) {
                console.warn('[Billboard] Track resolution failed:', error);
                showNotification('Search unavailable right now — try again in a moment.', 'warning');
            } finally {
                row.classList.remove('billboard-resolving');
            }
        });

        return true;
    }

    _renderBillboardAlbumCards(containerId, entries = []) {
        const container = document.getElementById(containerId);
        if (!container) return false;
        if (!entries.length) {
            container.innerHTML = '';
            return false;
        }

        container.innerHTML = entries
            .slice(0, 12)
            .map((entry) => {
                const name = escapeHtml(entry.name || 'Untitled Album');
                const artist = escapeHtml(entry.artist || 'Unknown Artist');
                const rank = Number(entry.rank) || 0;
                const rankClass =
                    rank === 1 ? ' rank-gold' : rank === 2 ? ' rank-silver' : rank === 3 ? ' rank-bronze' : '';
                const cover = entry.resolvedAlbum?.cover || entry.image;
                const image = cover ? this.api.getCoverUrl(cover, '320') : '/assets/appicon.png';
                const weeks = Number.isFinite(entry.weeks_on_chart) ? `${entry.weeks_on_chart} wks` : 'New';
                return `
                    <article class="billboard-track-row billboard-album-row" data-album-name="${escapeHtml(entry.name || '')}" data-album-artist="${escapeHtml(entry.artist || '')}" data-album-id="${entry.resolvedAlbum?.id || ''}">
                        <span class="billboard-rank${rankClass}">${rank}</span>
                        <img src="${image}" alt="${name}" loading="lazy" onerror="this.onerror=null;this.src='/assets/appicon.png';" />
                        <div class="billboard-track-meta">
                            <h4>${name}</h4>
                            <p>${artist}</p>
                        </div>
                        <small>${weeks}</small>
                    </article>
                `;
            })
            .join('');

        container.querySelectorAll('.billboard-album-row').forEach((row) => {
            row.addEventListener('click', async () => {
                const resolvedId = row.dataset.albumId;
                if (resolvedId) {
                    navigate(`/album/${resolvedId}`);
                    return;
                }
                const name = row.dataset.albumName || '';
                const artist = row.dataset.albumArtist || '';
                const provider =
                    typeof this.api.getCurrentProvider === 'function' ? this.api.getCurrentProvider() : undefined;
                let response;
                try {
                    response = await this.api.searchAlbums(`${name} ${artist}`, { limit: 5, provider });
                } catch (error) {
                    console.warn('[Billboard] Album search failed:', error);
                    showNotification('Search unavailable right now — try again in a moment.', 'warning');
                    return;
                }
                const albums = this._normalizeAlbumList(response);
                const first = albums.find((album) => album?.id);
                if (!first?.id) {
                    showNotification('No album match found for this chart entry.', 'warning');
                    return;
                }
                navigate(`/album/${first.id}`);
            });
        });

        return true;
    }

    _renderBillboardArtistStrip(containerId, entries = []) {
        const container = document.getElementById(containerId);
        if (!container) return false;
        if (!entries.length) {
            container.innerHTML = '';
            return false;
        }

        container.innerHTML = entries
            .slice(0, 16)
            .map((entry) => {
                const name = escapeHtml(entry.name || 'Unknown Artist');
                const rank = Number(entry.rank) || 0;
                const rankClass =
                    rank === 1 ? ' rank-gold' : rank === 2 ? ' rank-silver' : rank === 3 ? ' rank-bronze' : '';
                const cover = entry.resolvedArtist?.picture || entry.resolvedArtist?.image || entry.image;
                const image = cover ? this.api.getCoverUrl(cover, '320') : '/assets/appicon.png';
                const weeks = Number.isFinite(entry.weeks_on_chart) ? `${entry.weeks_on_chart} wks` : 'New';
                return `
                    <article class="billboard-track-row billboard-artist-row" data-artist-name="${escapeHtml(entry.name || '')}" data-artist-id="${entry.resolvedArtist?.id || ''}">
                        <span class="billboard-rank${rankClass}">${rank}</span>
                        <img src="${image}" alt="${name}" loading="lazy" onerror="this.onerror=null;this.src='/assets/appicon.png';" />
                        <div class="billboard-track-meta">
                            <h4>${name}</h4>
                        </div>
                        <small>${weeks}</small>
                    </article>
                `;
            })
            .join('');

        container.querySelectorAll('.billboard-artist-row').forEach((row) => {
            row.addEventListener('click', async () => {
                const resolvedId = row.dataset.artistId;
                if (resolvedId) {
                    navigate(`/artist/${resolvedId}`);
                    return;
                }
                const name = row.dataset.artistName || '';
                const provider =
                    typeof this.api.getCurrentProvider === 'function' ? this.api.getCurrentProvider() : undefined;
                let response;
                try {
                    response = await this.api.searchArtists(name, { limit: 8, provider });
                } catch (error) {
                    console.warn('[Billboard] Artist search failed:', error);
                    showNotification('Search unavailable right now — try again in a moment.', 'warning');
                    return;
                }
                const artists = this._normalizeArtistList(response);
                const first = artists.find((artist) => artist?.id);
                if (!first?.id) {
                    showNotification('No artist match found for this chart entry.', 'warning');
                    return;
                }
                navigate(`/artist/${first.id}`);
            });
        });

        return true;
    }

    _upgradeBillboardModule(containerId, resolver, type = 'track') {
        const container = document.getElementById(containerId);
        if (!container || !container.children.length) return;
        resolver()
            .then((entries) => {
                if (!entries || !entries.length) return;
                if (type === 'album') {
                    this._renderBillboardAlbumCards(containerId, entries);
                } else if (type === 'artist') {
                    this._renderBillboardArtistStrip(containerId, entries);
                } else {
                    this._renderBillboardTrackList(containerId, entries);
                }
            })
            .catch(() => {
                // Keep the phase-1 (unresolved) content — resolution is best-effort.
            });
    }

    async renderHomeBillboard(forceRefresh = false, variant = 'default') {
        const isEmptyVariant = variant === 'empty';
        const suffix = isEmptyVariant ? '-empty' : '';
        const sectionId = isEmptyVariant ? 'home-editors-picks-section-empty' : 'home-editors-picks-section';
        const section = document.getElementById(sectionId);
        if (!section) return;

        try {
            const regional = this._getBillboardRegionalChart();
            const provider =
                typeof this.api.getCurrentProvider === 'function' ? this.api.getCurrentProvider() : undefined;
            const regionalTitle = document.getElementById(`home-billboard-regional-title${suffix}`);
            if (regionalTitle) {
                regionalTitle.textContent = regional.label;
            }

            const [
                hot100Result,
                globalResult,
                albumResult,
                artistResult,
                regionalResult,
                ukResult,
                japanResult,
                indiaResult,
            ] = await Promise.allSettled([
                this._fetchBillboardChart(BILLBOARD_CHARTS.hot100.slug, 25),
                this._fetchBillboardChart(BILLBOARD_CHARTS.global200.slug, 25),
                this._fetchBillboardChart(BILLBOARD_CHARTS.billboard200.slug, 20),
                this._fetchBillboardChart(BILLBOARD_CHARTS.artist100.slug, 30),
                this._fetchBillboardChart(regional.slug, 25),
                this._fetchBillboardChart(BILLBOARD_REGIONAL_BY_COUNTRY.GB.slug, 25),
                this._fetchBillboardChart(BILLBOARD_REGIONAL_BY_COUNTRY.JP.slug, 25),
                this._fetchBillboardChart(BILLBOARD_REGIONAL_BY_COUNTRY.IN.slug, 25),
            ]);

            const hot100 = hot100Result.status === 'fulfilled' ? hot100Result.value : [];
            const global200 = globalResult.status === 'fulfilled' ? globalResult.value : [];
            const albums200 = albumResult.status === 'fulfilled' ? albumResult.value : [];
            const artists100 = artistResult.status === 'fulfilled' ? artistResult.value : [];
            const regionalEntries = regionalResult.status === 'fulfilled' ? regionalResult.value : [];
            const ukEntries = ukResult.status === 'fulfilled' ? ukResult.value : [];
            const japanEntries = japanResult.status === 'fulfilled' ? japanResult.value : [];
            const indiaEntries = indiaResult.status === 'fulfilled' ? indiaResult.value : [];

            // Phase 1 — render immediately from raw chart data. Track/album/
            // artist resolution is done in the background so the section never
            // waits on the addon's serialized, rate-limited search queue.
            const hasHot100 = this._renderBillboardTrackList(`home-billboard-hot100${suffix}`, hot100.slice(0, 15));
            const hasGlobal200 = this._renderBillboardTrackList(
                `home-billboard-global200${suffix}`,
                global200.slice(0, 15)
            );
            const hasAlbums200 = this._renderBillboardAlbumCards(`home-billboard-200${suffix}`, albums200.slice(0, 12));
            const hasArtists100 = this._renderBillboardArtistStrip(
                `home-billboard-artist100${suffix}`,
                artists100.slice(0, 16)
            );
            const hasRegional = this._renderBillboardTrackList(
                `home-billboard-regional${suffix}`,
                regionalEntries.slice(0, 15)
            );
            const hasUk = this._renderBillboardTrackList(`home-billboard-uk${suffix}`, ukEntries.slice(0, 15));
            const hasJapan = this._renderBillboardTrackList(`home-billboard-japan${suffix}`, japanEntries.slice(0, 15));
            const hasIndia = this._renderBillboardTrackList(`home-billboard-india${suffix}`, indiaEntries.slice(0, 15));

            this._setDiscoveryModuleVisibility(`home-billboard-hot100-module${suffix}`, hasHot100);
            this._setDiscoveryModuleVisibility(`home-billboard-global200-module${suffix}`, hasGlobal200);
            this._setDiscoveryModuleVisibility(`home-billboard-200-module${suffix}`, hasAlbums200);
            this._setDiscoveryModuleVisibility(`home-billboard-artist100-module${suffix}`, hasArtists100);
            this._setDiscoveryModuleVisibility(`home-billboard-regional-module${suffix}`, hasRegional);
            this._setDiscoveryModuleVisibility(`home-billboard-uk-module${suffix}`, hasUk);
            this._setDiscoveryModuleVisibility(`home-billboard-japan-module${suffix}`, hasJapan);
            this._setDiscoveryModuleVisibility(`home-billboard-india-module${suffix}`, hasIndia);

            this._syncBillboardModuleOrder(section, suffix);

            const hasAny =
                hasHot100 ||
                hasGlobal200 ||
                hasAlbums200 ||
                hasArtists100 ||
                hasRegional ||
                hasUk ||
                hasJapan ||
                hasIndia;
            section.style.display = hasAny ? '' : 'none';
            if (!hasAny) return;

            // Track charts are rendered as normal track lists and resolve on
            // click — nothing is preloaded in the background. Albums and artists
            // still upgrade in place through the addon's background lane.
            const bg = { background: true };
            this._upgradeBillboardModule(
                `home-billboard-200${suffix}`,
                () => this._resolveBillboardAlbums(albums200.slice(0, 12), provider, bg),
                'album'
            );
            this._upgradeBillboardModule(
                `home-billboard-artist100${suffix}`,
                () => this._resolveBillboardArtists(artists100.slice(0, 16), provider, bg),
                'artist'
            );
        } catch (error) {
            console.warn('[Home] Failed to render Billboard charts:', error);
            section.style.display = 'none';
        }
    }

    async renderHomeArtists(forceRefresh = false, profilePromise = null) {
        const artistsContainer = document.getElementById('home-recommended-artists');
        const section = artistsContainer?.closest('.content-section');

        if (!homePageSettings.shouldShowRecommendedArtists()) {
            if (section) section.style.display = 'none';
            this._resetHomeArtistsRetryState();
            return;
        }

        if (section) section.style.display = '';

        if (artistsContainer) {
            if (forceRefresh || artistsContainer.children.length === 0) {
                artistsContainer.innerHTML = this.createSkeletonCards(12, true);
            } else if (!artistsContainer.querySelector('.skeleton')) {
                return;
            }

            try {
                const provider =
                    typeof this.api.getCurrentProvider === 'function' ? this.api.getCurrentProvider() : undefined;
                const profile = profilePromise
                    ? await Promise.resolve(profilePromise)
                    : await this.getRecentTrackProfile(forceRefresh);
                const seedArtists = profile.artistSeeds.map((artist) => ({
                    id: artist.id,
                    name: artist.name,
                    picture: artist.picture || null,
                    score: artist.score || 1,
                }));

                if (seedArtists.length === 0) {
                    const fallbackArtists = await this._loadFallbackRecommendedArtists();
                    if (fallbackArtists.length > 0) {
                        fallbackArtists.forEach((artist) => seedArtists.push({ ...artist, score: 1 }));
                    } else {
                        artistsContainer.innerHTML = createPlaceholder(
                            'Play more tracks to get artist recommendations from your recent history.'
                        );
                        this._scheduleHomeArtistsAutoload(3200);
                        return;
                    }
                }

                const artistCandidates = new Map();
                const pushArtists = (artists, seedScore = 1) => {
                    const normalized = this._dedupeArtists(this._normalizeArtistList(artists));
                    normalized.forEach((artist, index) => {
                        if (!artist?.name) return;
                        const key = artist.id ? `id:${artist.id}` : `name:${artist.name.toLowerCase()}`;
                        const rankWeight = Math.max(0.25, 1 - index / Math.max(normalized.length, 12));
                        const score = seedScore * rankWeight;
                        const existing = artistCandidates.get(key);
                        if (existing) {
                            existing.score += score;
                            if (!existing.artist.picture && artist.picture) existing.artist.picture = artist.picture;
                        } else {
                            artistCandidates.set(key, { artist, score });
                        }
                    });
                };

                const seedArtistsWithId = seedArtists.filter((seedArtist) => seedArtist.id).slice(0, 6);
                const similarArtistResults = await Promise.allSettled(
                    seedArtistsWithId.map((seedArtist) =>
                        this.api.getSimilarArtists(seedArtist.id, {
                            skipCache: true,
                            cacheControl: 'no-store',
                            background: true,
                        })
                    )
                );

                similarArtistResults.forEach((result, index) => {
                    const seedArtist = seedArtistsWithId[index];
                    if (!seedArtist) return;
                    if (result.status === 'fulfilled') {
                        pushArtists(result.value, seedArtist.score || 1);
                        return;
                    }
                    console.warn('[Home] getSimilarArtists failed for', seedArtist.id, result.reason);
                });

                if (artistCandidates.size === 0) {
                    const fallbackSeeds = seedArtists.filter((seedArtist) => seedArtist.name).slice(0, 8);
                    const fallbackResults = await Promise.allSettled(
                        fallbackSeeds.map((seedArtist) =>
                            this.api.searchArtists(seedArtist.name, {
                                limit: 8,
                                provider,
                                background: true,
                            })
                        )
                    );

                    fallbackResults.forEach((result, index) => {
                        const seedArtist = fallbackSeeds[index];
                        if (!seedArtist) return;
                        if (result.status === 'fulfilled') {
                            pushArtists(result.value, seedArtist.score || 1);
                            return;
                        }
                        console.warn('[Home] Artist search fallback failed for', seedArtist.name, result.reason);
                    });
                }

                if (artistCandidates.size === 0) {
                    const fallbackArtists = await this._loadFallbackRecommendedArtists();
                    pushArtists(fallbackArtists, 1);
                }

                const exclusions = await this._getRecommendationExclusions(forceRefresh, profilePromise);
                const isKnownArtist = (artist) => {
                    if (!artist || typeof artist !== 'object') return false;
                    const id = artist.id !== null && typeof artist.id !== 'undefined' ? String(artist.id) : '';
                    if (id && exclusions.knownArtistIds.has(id)) return true;
                    const name = this._toLowerText(artist.name);
                    return name ? exclusions.knownArtistNames.has(name) : false;
                };

                let rankedArtists = Array.from(artistCandidates.values())
                    .sort((a, b) => b.score - a.score)
                    .map((entry) => entry.artist);

                if (forceRefresh && rankedArtists.length > 1) {
                    rankedArtists = [...rankedArtists].sort(() => Math.random() - 0.5);
                }

                const strictDiscoveryArtists = rankedArtists.filter((artist) => !isKnownArtist(artist));
                rankedArtists =
                    strictDiscoveryArtists.length >= 8
                        ? strictDiscoveryArtists
                        : [
                              ...strictDiscoveryArtists,
                              ...rankedArtists.filter((artist) => !strictDiscoveryArtists.includes(artist)),
                          ];

                const hydratedArtists = await this._hydrateArtistsForProvider(rankedArtists, provider, 30);
                const filteredArtists = await this.filterUserContent(hydratedArtists, 'artist');
                const renderableArtists = (filteredArtists.length > 0 ? filteredArtists : hydratedArtists)
                    .filter((artist) => artist && artist.id)
                    .filter((artist) => {
                        const id = String(artist.id || '');
                        const name = this._toLowerText(artist.name);
                        const isKnownById = id ? exclusions.knownArtistIds.has(id) : false;
                        const isKnownByName = name ? exclusions.knownArtistNames.has(name) : false;
                        return !(isKnownById || isKnownByName);
                    });

                const finalArtists =
                    renderableArtists.length >= 6
                        ? renderableArtists
                        : (filteredArtists.length > 0 ? filteredArtists : hydratedArtists).filter(
                              (artist) => artist && artist.id
                          );

                if (finalArtists.length > 0) {
                    const displayArtists = finalArtists.slice(0, 12);
                    artistsContainer.innerHTML = displayArtists
                        .map((artist) => this.createArtistCircularCardHTML(artist))
                        .join('');
                    displayArtists.forEach((artist) => {
                        const el = artistsContainer.querySelector(`[data-artist-id="${artist.id}"]`);
                        if (el) {
                            trackDataStore.set(el, artist);
                            this.updateLikeState(el, 'artist', artist.id);
                        }
                    });
                    this._resetHomeArtistsRetryState();
                } else {
                    artistsContainer.innerHTML = createPlaceholder(
                        'No artist recommendations found from your recent tracks yet.'
                    );
                    this._scheduleHomeArtistsAutoload(3200);
                }
            } catch (e) {
                console.error(e);
                try {
                    const provider =
                        typeof this.api.getCurrentProvider === 'function' ? this.api.getCurrentProvider() : undefined;
                    const fallbackArtists = await this._loadFallbackRecommendedArtists();
                    const hydratedFallback = await this._hydrateArtistsForProvider(fallbackArtists, provider, 18);
                    const filteredFallback = await this.filterUserContent(hydratedFallback, 'artist').catch(() => {
                        return hydratedFallback;
                    });
                    const renderableFallback = (filteredFallback.length > 0 ? filteredFallback : hydratedFallback)
                        .filter((artist) => artist && artist.id)
                        .slice(0, 12);

                    if (renderableFallback.length > 0) {
                        artistsContainer.innerHTML = renderableFallback
                            .map((artist) => this.createArtistCircularCardHTML(artist))
                            .join('');
                        renderableFallback.forEach((artist) => {
                            const el = artistsContainer.querySelector(`[data-artist-id="${artist.id}"]`);
                            if (el) {
                                trackDataStore.set(el, artist);
                                this.updateLikeState(el, 'artist', artist.id);
                            }
                        });
                        this._scheduleHomeArtistsAutoload(forceRefresh ? 5000 : 3200);
                        return;
                    }
                } catch (fallbackError) {
                    console.warn('[Home] Fallback artist recommendations failed:', fallbackError);
                }

                artistsContainer.innerHTML = createPlaceholder(
                    'No artist recommendations available right now. Try refresh.'
                );
                this._scheduleHomeArtistsAutoload(forceRefresh ? 5000 : 3200);
            }
        }
    }

    async renderHomeRecent() {
        const recentContainer = document.getElementById('home-recent-mixed');
        const recentMeta = document.getElementById('home-recent-smart-meta');
        const section = recentContainer?.closest('.content-section');

        if (!homePageSettings.shouldShowJumpBackIn()) {
            if (section) section.style.display = 'none';
            return;
        }

        if (section) section.style.display = '';

        if (recentContainer) {
            const recents = await recentActivityManager.getRecents();
            const dedupeConsecutive = (items, getKey) => {
                const filtered = [];
                let previousKey = null;
                items.forEach((item) => {
                    const key = getKey(item);
                    if (key && key === previousKey) return;
                    filtered.push(item);
                    previousKey = key || null;
                });
                return filtered;
            };

            const albums = dedupeConsecutive(
                (recents.albums || []).map((i) => ({ ...i, _kind: 'album' })),
                (item) => String(item.id || item.uuid || item.title || '')
            );
            const playlists = dedupeConsecutive(
                (recents.playlists || []).map((i) => ({ ...i, _kind: 'playlist' })),
                (item) => String(item.id || item.uuid || item.title || item.name || '')
            );
            const mixes = dedupeConsecutive(
                (recents.mixes || []).map((i) => ({ ...i, _kind: 'mix' })),
                (item) => String(item.id || item.uuid || item.title || item.name || '')
            );
            const artists = dedupeConsecutive(
                (recents.artists || []).map((i) => ({ ...i, _kind: 'artist' })),
                (item) => String(item.id || item.uuid || item.name || item.title || '')
            );
            const tracks = dedupeConsecutive(
                (recents.tracks || []).map((i) => ({ ...i, _kind: 'track' })),
                (item) => String(item.id || item.trackId || item.isrc || item.title || '')
            );

            const albumCount = albums.length;
            const playlistCount = playlists.length;
            const artistCount = artists.length;

            // Smart blend: prioritize variety between types.
            const buckets = [albums, playlists, mixes, artists, tracks].filter((b) => b.length > 0);
            const displayItems = [];
            let cursor = 0;
            while (displayItems.length < 12 && buckets.length > 0) {
                const bucketIdx = cursor % buckets.length;
                const bucket = buckets[bucketIdx];
                if (bucket.length > 0) {
                    displayItems.push(bucket.shift());
                }
                if (bucket.length === 0) {
                    buckets.splice(bucketIdx, 1);
                } else {
                    cursor += 1;
                }
            }

            if (recentMeta) {
                const segments = [];
                if (albumCount > 0) segments.push(`${albumCount} album${albumCount === 1 ? '' : 's'}`);
                if (playlistCount > 0) segments.push(`${playlistCount} playlist${playlistCount === 1 ? '' : 's'}`);
                if (artistCount > 0) segments.push(`${artistCount} artist${artistCount === 1 ? '' : 's'}`);
                recentMeta.textContent =
                    displayItems.length > 0
                        ? `${displayItems.length} smart picks • ${segments.join(' • ')}`
                        : 'Smart picks blended from your history.';
            }

            if (displayItems.length > 0) {
                recentContainer.innerHTML = displayItems.map((item) => this.createJumpBackCardHTML(item)).join('');

                displayItems.forEach((item) => {
                    let selector = '';
                    if (item._kind === 'album') selector = `[data-album-id="${item.id}"]`;
                    else if (item._kind === 'playlist')
                        selector = item.isUserPlaylist
                            ? `[data-user-playlist-id="${item.id}"]`
                            : `[data-playlist-id="${item.uuid}"]`;
                    else if (item._kind === 'mix') selector = `[data-mix-id="${item.id}"]`;
                    else if (item._kind === 'artist') selector = `[data-artist-id="${item.id}"]`;
                    else if (item._kind === 'track') selector = `[data-track-id="${item.id}"]`;

                    const el = recentContainer.querySelector(selector);
                    if (el) {
                        trackDataStore.set(el, item);
                        el.classList.add('home-recent-card', `home-recent-${item._kind}`);
                        el.dataset.recentKind = item._kind;
                    }
                });
            } else {
                recentContainer.innerHTML = createPlaceholder('No recent items yet...');
                if (recentMeta) {
                    recentMeta.textContent = 'Play music to build a smart jump-back deck.';
                }
            }
        }
    }

    createJumpBackCardHTML(item) {
        const kind = item._kind;
        let kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
        let title = '';
        let subtitle = '';
        let meta = '';
        let imageSrc = 'assets/appicon.png';
        let href = '#';
        let type = kind;
        let id = item.id;

        if (kind === 'album') {
            title = escapeHtml(item.title);
            let artistName = '';
            if (item.artist) {
                artistName = typeof item.artist === 'string' ? item.artist : item.artist.name;
            } else if (item.artists?.length) {
                artistName = item.artists.map((a) => a.name).join(', ');
            }
            let yearDisplay = '';
            if (item.releaseDate) {
                const date = new Date(item.releaseDate);
                if (!isNaN(date.getTime())) yearDisplay = `${date.getFullYear()}`;
            }
            subtitle = escapeHtml(artistName);
            meta = yearDisplay;
            imageSrc = item.cover ? this.api.getCoverUrl(item.cover) : 'assets/appicon.png';
            href = `/album/${item.id}`;
        } else if (kind === 'playlist') {
            title = escapeHtml(item.title || item.name);
            subtitle = '';
            const trackCount = getPlaylistTrackCount(item);
            meta = `${trackCount} tracks`;
            const imageId =
                item.image ||
                item.squareImage ||
                item.cover ||
                item.imageUrl ||
                item.images?.LARGE?.url ||
                item.images?.MEDIUM?.url ||
                item.images?.SMALL?.url ||
                null;
            if (imageId) {
                let coverUrl;
                if (imageId.startsWith('http') || imageId.startsWith('/')) {
                    coverUrl = imageId;
                } else {
                    coverUrl = this.api.getCoverUrl(imageId, '1080');
                }
                imageSrc = coverUrl;
            } else {
                imageSrc = 'assets/appicon.png';
            }
            href = item.isUserPlaylist ? `/userplaylist/${item.id}` : `/playlist/${item.uuid}`;
            id = item.isUserPlaylist ? item.id : item.uuid;
        } else if (kind === 'mix') {
            title = escapeHtml(item.title);
            subtitle = escapeHtml(item.subTitle || item.description || '');
            meta = '';
            imageSrc = item.cover || 'assets/appicon.png';
            href = `/mix/${item.id}`;
        } else if (kind === 'artist') {
            title = escapeHtml(item.name);
            subtitle = '';
            meta = 'Artist';
            imageSrc = item.picture ? this.api.getArtistPictureUrl(item.picture) : 'assets/appicon.png';
            href = `/artist/${item.id}`;
        } else if (kind === 'track') {
            title = escapeHtml(item.title);
            let artistName = '';
            if (item.artist) {
                artistName = typeof item.artist === 'string' ? item.artist : item.artist.name;
            } else if (item.artists?.length) {
                artistName = item.artists.map((a) => a.name).join(', ');
            }
            subtitle = escapeHtml(artistName);
            meta = '';
            const coverId = item.album?.cover || item.cover;
            imageSrc = coverId ? this.api.getCoverUrl(coverId) : 'assets/appicon.png';
            href = `/track/${item.id}`;
        }

        return `
            <a class="card jump-back-card" href="${href}" data-type="${type}" data-id="${id}">
                <div class="card-image-wrapper">
                    <img src="${imageSrc}" alt="${escapeHtml(title)}" class="card-image" loading="lazy" onerror="window.handleCoverImageFallback(this)">
                    <span class="home-recent-kind-badge">${kindLabel}</span>
                </div>
                <div class="card-content">
                    <div class="card-title">${title}</div>
                    ${subtitle ? `<div class="card-subtitle">${subtitle}</div>` : ''}
                    ${meta ? `<div class="card-meta">${meta}</div>` : ''}
                </div>
            </a>
        `;
    }

    async filterUserContent(items, type) {
        if (!items || items.length === 0) return [];

        // Import blocking settings
        const { contentBlockingSettings } = await import('./storage.js');

        // First filter out blocked content
        if (type === 'track') {
            items = contentBlockingSettings.filterTracks(items);
        } else if (type === 'album') {
            items = contentBlockingSettings.filterAlbums(items);
        } else if (type === 'artist') {
            items = contentBlockingSettings.filterArtists(items);
        }

        const favorites = await db.getFavorites(type).catch(() => []);
        const favoriteIds = new Set(favorites.map((i) => i.id));

        const likedTracks = await db.getFavorites('track').catch(() => []);
        const playlists = await db.getPlaylists(true).catch(() => []);

        const userTracksMap = new Map();
        likedTracks.forEach((t) => userTracksMap.set(t.id, t));
        playlists.forEach((p) => {
            if (p.tracks) p.tracks.forEach((t) => userTracksMap.set(t.id, t));
        });

        if (type === 'track') {
            return items.filter((item) => !userTracksMap.has(item.id));
        }

        if (type === 'album') {
            const albumTrackCounts = new Map();
            for (const track of userTracksMap.values()) {
                if (track.album && track.album.id) {
                    const aid = track.album.id;
                    albumTrackCounts.set(aid, (albumTrackCounts.get(aid) || 0) + 1);
                }
            }

            return items.filter((item) => {
                if (favoriteIds.has(item.id)) return false;

                const userCount = albumTrackCounts.get(item.id) || 0;
                const total = item.numberOfTracks;

                if (total && total > 0) {
                    if (userCount / total > 0.5) return false;
                }

                return true;
            });
        }

        return items.filter((item) => !favoriteIds.has(item.id));
    }

    async renderSearchPage(query, activeTab = 'all') {
        this.showPage('search');
        const selectedTab = this.activateSearchTab(activeTab);
        const normalizedQuery = String(query || '').trim();

        const titleEl = document.getElementById('search-results-title');
        if (titleEl) {
            titleEl.textContent = normalizedQuery ? `Results for "${normalizedQuery}"` : 'Search';
        }

        // All containers — individual tabs
        const tracksContainer = document.getElementById('search-tracks-container');
        const artistsContainer = document.getElementById('search-artists-container');
        const albumsContainer = document.getElementById('search-albums-container');
        const playlistsContainer = document.getElementById('search-playlists-container');
        const usersContainer = document.getElementById('search-users-container');

        // All containers — "all" tab
        const allTracksContainer = document.getElementById('search-all-tracks-container');
        const allArtistsContainer = document.getElementById('search-all-artists-container');
        const allAlbumsContainer = document.getElementById('search-all-albums-container');
        const allPlaylistsContainer = document.getElementById('search-all-playlists-container');
        const allUsersContainer = document.getElementById('search-all-users-container');

        // Top results layout elements
        const layoutEl = document.getElementById('search-top-results-layout');
        const fallbackEl = document.getElementById('search-all-tracks-fallback');
        const topHitContent = document.getElementById('search-top-hit-content');

        // Empty state — no query
        if (!normalizedQuery) {
            const emptyState = createPlaceholder(
                'Start typing to search tracks, artists, albums, playlists, and profiles.'
            );
            [tracksContainer, artistsContainer, albumsContainer, playlistsContainer].forEach((c) => {
                if (c) c.innerHTML = emptyState;
            });
            [
                usersContainer,
                allTracksContainer,
                allArtistsContainer,
                allAlbumsContainer,
                allPlaylistsContainer,
                allUsersContainer,
            ].forEach((c) => {
                if (c) c.innerHTML = emptyState;
            });
            if (layoutEl) layoutEl.style.display = 'none';
            if (fallbackEl) fallbackEl.style.display = 'none';
            if (topHitContent) topHitContent.innerHTML = '';
            return;
        }

        const allTabTrackLimit =
            window.innerWidth >= 1400 ? 12 : window.innerWidth >= 1024 ? 10 : window.innerWidth >= 720 ? 8 : 6;

        // Show skeletons for ALL containers (we always fetch everything)
        if (tracksContainer) tracksContainer.innerHTML = this.createSkeletonTracks(8, true);
        if (artistsContainer) artistsContainer.innerHTML = this.createSkeletonCards(6, true);
        if (albumsContainer) albumsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (playlistsContainer) playlistsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (usersContainer) usersContainer.innerHTML = this.createSkeletonCards(6, false);
        if (allTracksContainer) allTracksContainer.innerHTML = this.createSkeletonTracks(allTabTrackLimit, true);
        if (allArtistsContainer) allArtistsContainer.innerHTML = this.createSkeletonCards(6, true);
        if (allAlbumsContainer) allAlbumsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (allPlaylistsContainer) allPlaylistsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (allUsersContainer) allUsersContainer.innerHTML = this.createSkeletonCards(6, false);

        // Abort any in-flight search
        if (this.searchAbortController) {
            this.searchAbortController.abort();
        }
        this.searchAbortController = new AbortController();
        const signal = this.searchAbortController.signal;

        try {
            const provider = this.api.getCurrentProvider();

            // Always fetch ALL types so tab switching works without re-fetching.
            // retry: true — keep retrying through addon rate limits until results arrive.
            const [tracksResult, artistsResult, albumsResult, playlistsResult, usersResult] = await Promise.all([
                this.api.searchTracks(normalizedQuery, { signal, provider, retry: true }),
                this.api.searchArtists(normalizedQuery, { signal, provider, retry: true }),
                this.api.searchAlbums(normalizedQuery, { signal, provider, retry: true }),
                this.api.searchPlaylists(normalizedQuery, { signal, provider, retry: true }),
                syncManager.searchUsers(normalizedQuery),
            ]);

            // Deduplicate tracks
            const seenTrackIds = new Set();
            let finalTracks = [];
            for (const t of tracksResult.items || []) {
                if (!seenTrackIds.has(t.id)) {
                    seenTrackIds.add(t.id);
                    finalTracks.push(t);
                }
            }
            let finalArtists = artistsResult.items || [];
            let finalAlbums = albumsResult.items || [];
            let finalPlaylists = playlistsResult.items || [];
            const finalUsers = usersResult || [];

            // Derive artists from tracks if API returned none
            if (finalArtists.length === 0 && finalTracks.length > 0) {
                const artistMap = new Map();
                finalTracks.forEach((track) => {
                    if (track.artist && !artistMap.has(track.artist.id)) {
                        artistMap.set(track.artist.id, track.artist);
                    }
                    if (track.artists) {
                        track.artists.forEach((a) => {
                            if (!artistMap.has(a.id)) artistMap.set(a.id, a);
                        });
                    }
                });
                finalArtists = Array.from(artistMap.values());
            }

            // Derive albums from tracks if API returned none
            if (finalAlbums.length === 0 && finalTracks.length > 0) {
                const albumMap = new Map();
                finalTracks.forEach((track) => {
                    if (track.album && !albumMap.has(track.album.id)) {
                        albumMap.set(track.album.id, track.album);
                    }
                });
                finalAlbums = Array.from(albumMap.values());
            }

            // ── Render individual tab containers ──────────────────────
            // Tracks tab
            if (tracksContainer) {
                if (finalTracks.length) {
                    this.renderListWithTracks(tracksContainer, finalTracks, true);
                } else {
                    tracksContainer.innerHTML = createPlaceholder('No tracks found.');
                }
            }

            // Artists tab
            if (artistsContainer) {
                artistsContainer.innerHTML = finalArtists.length
                    ? finalArtists.map((a) => this.createSearchArtistCardHTML(a)).join('')
                    : createPlaceholder('No artists found.');
            }

            // Albums tab
            if (albumsContainer) {
                albumsContainer.innerHTML = finalAlbums.length
                    ? finalAlbums.map((a) => this.createAlbumCardHTML(a)).join('')
                    : createPlaceholder('No albums found.');
            }

            // Playlists tab
            if (playlistsContainer) {
                playlistsContainer.innerHTML = finalPlaylists.length
                    ? finalPlaylists.map((p) => this.createPlaylistCardHTML(p)).join('')
                    : createPlaceholder('No playlists found.');
            }

            // Users/Profiles tab
            if (usersContainer) {
                usersContainer.innerHTML = finalUsers.length
                    ? finalUsers.map((u) => this.createUserCardHTML(u)).join('')
                    : createPlaceholder('No users found.');
            }

            // ── Render "All" tab ─────────────────────────────────────
            // Top Result card
            if (layoutEl && topHitContent) {
                let topHit = null;
                let topHitType = '';

                const validArtist = finalArtists.find(
                    (artist) => typeof artist?.name === 'string' && artist.name.trim()
                );
                const validAlbum = finalAlbums.find((album) => typeof album?.title === 'string' && album.title.trim());
                const validTrack = finalTracks.find((track) => typeof track?.title === 'string' && track.title.trim());

                if (validArtist) {
                    topHit = validArtist;
                    topHitType = 'artist';
                } else if (validAlbum) {
                    topHit = validAlbum;
                    topHitType = 'album';
                } else if (validTrack) {
                    topHit = validTrack;
                    topHitType = 'track';
                }

                if (topHit && finalTracks.length > 0) {
                    layoutEl.style.display = 'grid';
                    if (fallbackEl) fallbackEl.style.display = 'none';

                    let imageSrc = '';
                    let title = '';
                    let subtitle = '';
                    let cardClass = 'search-top-hit-card';
                    let navigateUrl = '';

                    if (topHitType === 'artist') {
                        imageSrc = this.api.getArtistPictureUrl(topHit.picture, '320');
                        title = topHit.name || '';
                        subtitle = 'Artist';
                        cardClass += ' card-artist';
                        navigateUrl = `/artist/${topHit.id}`;
                    } else if (topHitType === 'album') {
                        imageSrc = this.api.getCoverUrl(topHit.cover, '320');
                        title = topHit.title || '';
                        subtitle = `Album • ${getAlbumArtists(topHit)}`;
                        cardClass += ' card-album';
                        navigateUrl = `/album/${topHit.id}`;
                    } else if (topHitType === 'track') {
                        imageSrc = this.api.getPreferredVisualUrl(topHit.album, '320');
                        title = topHit.title || '';
                        subtitle = `Song • ${getTrackArtists(topHit)}`;
                        cardClass += ' card-track';
                        navigateUrl = topHit.album ? `/album/${topHit.album.id}` : '#';
                    }

                    const safeTitle = escapeHtml(title || 'Unknown');

                    // Use innerHTML to avoid losing the element reference on re-search
                    topHitContent.className = cardClass;
                    topHitContent.setAttribute('data-type', topHitType);
                    topHitContent.removeAttribute('data-artist-id');
                    topHitContent.removeAttribute('data-album-id');
                    topHitContent.removeAttribute('data-track-id');
                    if (topHitType === 'artist') topHitContent.setAttribute('data-artist-id', topHit.id);
                    else if (topHitType === 'album') topHitContent.setAttribute('data-album-id', topHit.id);
                    else if (topHitType === 'track') topHitContent.setAttribute('data-track-id', topHit.id);

                    topHitContent.innerHTML = `
                        <div class="search-top-hit-visual">
                            <img src="${imageSrc}" alt="${safeTitle}" loading="lazy" onerror="window.handleCoverImageFallback(this)">
                        </div>
                        <div class="search-top-hit-info">
                            <span class="search-top-hit-badge">${topHitType}</span>
                            <h4 class="search-top-hit-title">${safeTitle}</h4>
                            <p class="search-top-hit-subtitle">${escapeHtml(subtitle)}</p>
                        </div>
                        <div class="search-top-hit-arrow">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                        </div>`;

                    // Click navigates to the entity page
                    topHitContent.onclick = (e) => {
                        e.preventDefault();
                        if (navigateUrl && typeof window.navigate === 'function') {
                            window.navigate(navigateUrl);
                        }
                    };

                    trackDataStore.set(topHitContent, topHit);
                    this.updateLikeState(topHitContent, topHitType, topHit.id);

                    // Songs beside the top hit
                    if (allTracksContainer) {
                        this.renderListWithTracks(allTracksContainer, finalTracks.slice(0, allTabTrackLimit), true);
                    }
                } else {
                    layoutEl.style.display = 'none';
                    if (finalTracks.length > 0 && fallbackEl) {
                        fallbackEl.style.display = 'block';
                        const fbContainer = document.getElementById('search-all-tracks-container-fallback');
                        if (fbContainer) this.renderListWithTracks(fbContainer, finalTracks, true);
                    } else if (fallbackEl) {
                        fallbackEl.style.display = 'none';
                    }
                    topHitContent.innerHTML = '';
                }
            }

            // All-tab: Artists section
            if (allArtistsContainer) {
                const section = allArtistsContainer.closest('.search-all-section');
                if (finalArtists.length) {
                    allArtistsContainer.innerHTML = finalArtists
                        .map((a) => this.createSearchArtistCardHTML(a))
                        .join('');
                    if (section) section.style.display = '';
                } else {
                    allArtistsContainer.innerHTML = '';
                    if (section) section.style.display = 'none';
                }
            }

            // All-tab: Albums section
            if (allAlbumsContainer) {
                const section = allAlbumsContainer.closest('.search-all-section');
                if (finalAlbums.length) {
                    allAlbumsContainer.innerHTML = finalAlbums.map((a) => this.createAlbumCardHTML(a)).join('');
                    if (section) section.style.display = '';
                } else {
                    allAlbumsContainer.innerHTML = '';
                    if (section) section.style.display = 'none';
                }
            }

            // All-tab: Playlists section
            if (allPlaylistsContainer) {
                const section = allPlaylistsContainer.closest('.search-all-section');
                if (finalPlaylists.length) {
                    allPlaylistsContainer.innerHTML = finalPlaylists
                        .map((p) => this.createPlaylistCardHTML(p))
                        .join('');
                    if (section) section.style.display = '';
                } else {
                    allPlaylistsContainer.innerHTML = '';
                    if (section) section.style.display = 'none';
                }
            }

            // All-tab: Users section
            if (allUsersContainer) {
                const section = allUsersContainer.closest('.search-all-section');
                if (finalUsers.length) {
                    allUsersContainer.innerHTML = finalUsers.map((u) => this.createUserCardHTML(u)).join('');
                    if (section) section.style.display = '';
                } else {
                    allUsersContainer.innerHTML = '';
                    if (section) section.style.display = 'none';
                }
            }

            // ── Wire up trackDataStore and like states ────────────────
            const wireUpCards = (container, items, type, idKey = 'id') => {
                if (!container) return;
                items.forEach((item) => {
                    const selector = `[data-${type}-id="${item[idKey]}"]`;
                    const el = container.querySelector(selector);
                    if (el) {
                        trackDataStore.set(el, item);
                        this.updateLikeState(el, type, item[idKey]);
                    }
                });
            };

            wireUpCards(artistsContainer, finalArtists, 'artist');
            wireUpCards(allArtistsContainer, finalArtists, 'artist');
            wireUpCards(albumsContainer, finalAlbums, 'album');
            wireUpCards(allAlbumsContainer, finalAlbums, 'album');
            wireUpCards(playlistsContainer, finalPlaylists, 'playlist', 'uuid');
            wireUpCards(allPlaylistsContainer, finalPlaylists, 'playlist', 'uuid');
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Search failed:', error);
            const errorMsg = createPlaceholder(`Error during search. ${error.message}`);
            [
                tracksContainer,
                artistsContainer,
                albumsContainer,
                playlistsContainer,
                usersContainer,
                allTracksContainer,
                allArtistsContainer,
                allAlbumsContainer,
                allPlaylistsContainer,
                allUsersContainer,
            ].forEach((c) => {
                if (c) c.innerHTML = errorMsg;
            });
        }
    }

    async renderAlbumPage(albumId, provider = null) {
        this.showPage('album');

        const imageEl = document.getElementById('album-detail-image');
        const titleEl = document.getElementById('album-detail-title');
        const metaEl = document.getElementById('album-detail-meta');
        const prodEl = document.getElementById('album-detail-producer');
        const descEl = document.getElementById('album-detail-description');
        const tracklistContainer = document.getElementById('album-detail-tracklist');
        const playBtn = document.getElementById('play-album-btn');
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY}<span>Play Album</span>`;
        const dlBtn = document.getElementById('download-album-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download Album</span>`;
        const mixBtn = document.getElementById('album-mix-btn');
        if (mixBtn) mixBtn.style.display = 'none';

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        if (prodEl)
            prodEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        if (descEl)
            descEl.innerHTML = '<div class="skeleton" style="height: 14px; width: 300px; max-width: 90%;"></div>';
        tracklistContainer.innerHTML = `
            <div class="track-list-header">
                <span style="width: 40px; text-align: center;">#</span>
                <span>Title</span>
                <span class="duration-header">Duration</span>
                <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
            </div>
            ${this.createSkeletonTracks(10, false)}
        `;

        try {
            const { album, tracks } = await this.api.getAlbum(albumId, provider);
            recentActivityManager.addAlbum(album);

            const coverUrl = this.api.getCoverUrl(album.cover);
            const preferredVisualUrl = this.getEntityVisualUrl(album, album.cover);
            imageEl.src = coverUrl;
            imageEl.style.backgroundColor = '';

            // Set background and vibrant color
            this.setPageBackground(preferredVisualUrl || coverUrl, coverUrl);
            if (backgroundSettings.isEnabled() && album.cover) {
                if (!this.applyApiVibrantColor(album.vibrantColor)) {
                    this.extractAndApplyColor(this.api.getCoverUrl(album.cover, '80'));
                }
            }

            const explicitBadge = hasExplicitContent(album) ? this.createExplicitBadge() : '';
            titleEl.innerHTML = `${escapeHtml(album.title)} ${explicitBadge}`;

            this.adjustTitleFontSize(titleEl, album.title);

            const totalDuration = calculateTotalDuration(tracks);
            let dateDisplay = '';
            if (album.releaseDate) {
                const releaseDate = new Date(album.releaseDate);
                if (!isNaN(releaseDate.getTime())) {
                    const year = releaseDate.getFullYear();
                    const isYearOnly =
                        typeof album.releaseDate === 'string' && /^\d{4}$/.test(album.releaseDate.trim());
                    dateDisplay =
                        !isYearOnly && window.innerWidth > 768
                            ? releaseDate.toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                              })
                            : year;
                }
            }

            const firstCopyright = tracks.find((track) => track.copyright)?.copyright;

            metaEl.innerHTML =
                (dateDisplay ? `${dateDisplay} • ` : '') + `${tracks.length} tracks • ${formatDuration(totalDuration)}`;

            // Show artist in producer line
            if (prodEl) {
                prodEl.innerHTML = `By <a href="/artist/${album.artist.id}">${album.artist.name}</a>`;
                prodEl.style.display = '';
            }

            // Show copyright in description area
            if (descEl) {
                if (firstCopyright) {
                    descEl.textContent = firstCopyright;
                    descEl.style.display = '';
                } else {
                    descEl.style.display = 'none';
                }
            }

            tracklistContainer.innerHTML = `
                <div class="track-list-header">
                    <span style="width: 40px; text-align: center;">#</span>
                    <span>Title</span>
                    <span class="duration-header">Duration</span>
                    <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                </div>
            `;

            tracks.sort((a, b) => {
                const discA = a.volumeNumber ?? a.discNumber ?? 1;
                const discB = b.volumeNumber ?? b.discNumber ?? 1;
                if (discA !== discB) return discA - discB;
                return a.trackNumber - b.trackNumber;
            });
            this.renderListWithTracks(tracklistContainer, tracks, false, true);

            // Store album data for play-time recent activity tracking
            this._currentAlbumForRecent = album;

            // Update header like button
            const albumLikeBtn = document.getElementById('like-album-btn');
            if (albumLikeBtn) {
                const isLiked = await db.isFavorite('album', album.id);
                albumLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                albumLikeBtn.classList.toggle('active', isLiked);
            }

            document.title = `${album.title} - ${album.artist.name}`;

            // "More from Artist" and Related Sections
            const moreAlbumsSection = document.getElementById('album-section-more-albums');
            const moreAlbumsContainer = document.getElementById('album-detail-more-albums');
            const moreAlbumsTitle = document.getElementById('album-title-more-albums');

            const epsSection = document.getElementById('album-section-eps');
            const epsContainer = document.getElementById('album-detail-eps');
            const epsTitle = document.getElementById('album-title-eps');

            const similarArtistsSection = document.getElementById('album-section-similar-artists');
            const similarArtistsContainer = document.getElementById('album-detail-similar-artists');

            const similarAlbumsSection = document.getElementById('album-section-similar-albums');
            const similarAlbumsContainer = document.getElementById('album-detail-similar-albums');

            // Hide all initially
            [moreAlbumsSection, epsSection, similarArtistsSection, similarAlbumsSection].forEach((el) => {
                if (el) el.style.display = 'none';
            });

            try {
                const artistData = await this.api.getArtist(album.artist.id);

                // Add Mix/Radio Button to header
                const mixBtn = document.getElementById('album-mix-btn');
                if (mixBtn && artistData.mixes && artistData.mixes.ARTIST_MIX) {
                    mixBtn.style.display = 'flex';
                    mixBtn.onclick = () => navigate(`/mix/${artistData.mixes.ARTIST_MIX}`);
                }

                const renderSection = (items, container, section, titleEl, titleText) => {
                    if (!container || !section) return;

                    const filtered = (items || [])
                        .filter((a) => a.id != album.id)
                        .filter(
                            (a, index, self) => index === self.findIndex((t) => t.title === a.title) // Dedup by title
                        )
                        .slice(0, 12);

                    if (filtered.length === 0) return;

                    container.innerHTML = filtered.map((a) => this.createAlbumCardHTML(a)).join('');
                    if (titleEl && titleText) titleEl.textContent = titleText;
                    section.style.display = 'block';

                    filtered.forEach((a) => {
                        const el = container.querySelector(`[data-album-id="${a.id}"]`);
                        if (el) {
                            trackDataStore.set(el, a);
                            this.updateLikeState(el, 'album', a.id);
                        }
                    });
                };

                renderSection(
                    artistData.albums,
                    moreAlbumsContainer,
                    moreAlbumsSection,
                    moreAlbumsTitle,
                    `More albums from ${album.artist.name}`
                );
                renderSection(
                    artistData.eps,
                    epsContainer,
                    epsSection,
                    epsTitle,
                    `EPs and Singles from ${album.artist.name}`
                );

                // Similar Artists
                this.api
                    .getSimilarArtists(album.artist.id)
                    .then(async (similar) => {
                        // Filter out blocked artists
                        const { contentBlockingSettings } = await import('./storage.js');
                        const filteredSimilar = contentBlockingSettings.filterArtists(similar || []);

                        if (filteredSimilar.length > 0 && similarArtistsContainer && similarArtistsSection) {
                            similarArtistsContainer.innerHTML = filteredSimilar
                                .map((a) => this.createArtistCircularCardHTML(a))
                                .join('');
                            similarArtistsSection.style.display = 'block';

                            filteredSimilar.forEach((a) => {
                                const el = similarArtistsContainer.querySelector(`[data-artist-id="${a.id}"]`);
                                if (el) {
                                    trackDataStore.set(el, a);
                                    this.updateLikeState(el, 'artist', a.id);
                                }
                            });
                        }
                    })
                    .catch((e) => console.warn('Failed to load similar artists:', e));

                // Similar Albums
                this.api
                    .getSimilarAlbums(albumId)
                    .then(async (similar) => {
                        // Filter out blocked albums
                        const { contentBlockingSettings } = await import('./storage.js');
                        const filteredSimilar = contentBlockingSettings.filterAlbums(similar || []);

                        if (filteredSimilar.length > 0 && similarAlbumsContainer && similarAlbumsSection) {
                            similarAlbumsContainer.innerHTML = filteredSimilar
                                .map((a) => this.createAlbumCardHTML(a))
                                .join('');
                            similarAlbumsSection.style.display = 'block';

                            filteredSimilar.forEach((a) => {
                                const el = similarAlbumsContainer.querySelector(`[data-album-id="${a.id}"]`);
                                if (el) {
                                    trackDataStore.set(el, a);
                                    this.updateLikeState(el, 'album', a.id);
                                }
                            });
                        }
                    })
                    .catch((e) => console.warn('Failed to load similar albums:', e));
            } catch (err) {
                console.warn('Failed to load "More from artist":', err);
            }
        } catch (error) {
            console.error('Failed to load album:', error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load album details. ${error.message}`);
        }
    }

    async loadRecommendedSongsForPlaylist(tracks) {
        const recommendedSection = document.getElementById('playlist-section-recommended');
        const recommendedContainer = document.getElementById('playlist-detail-recommended');
        const recommendedSearchInput = document.getElementById('playlist-recommended-search-input');

        if (!recommendedSection || !recommendedContainer) {
            console.warn('Recommended songs section not found in DOM');
            return;
        }

        const renderRecommendedTracks = (trackList) => {
            this.renderListWithTracks(recommendedContainer, trackList, true);

            const trackItems = recommendedContainer.querySelectorAll('.track-item');
            trackItems.forEach((item) => {
                const actionsDiv = item.querySelector('.track-item-actions');
                if (!actionsDiv) return;

                const addToPlaylistBtn = document.createElement('button');
                addToPlaylistBtn.className = 'track-action-btn add-to-playlist-btn';
                addToPlaylistBtn.title = 'Add to this playlist';
                addToPlaylistBtn.innerHTML =
                    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';

                addToPlaylistBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const trackData = trackDataStore.get(item);
                    if (!trackData) return;

                    try {
                        const path = window.location.pathname;
                        const playlistMatch = path.match(/\/userplaylist\/([^/]+)/);
                        if (playlistMatch) {
                            const playlistId = playlistMatch[1];
                            await db.addTrackToPlaylist(playlistId, trackData);
                            const updatedPlaylist = await db.getPlaylist(playlistId);
                            syncManager.syncUserPlaylist(updatedPlaylist, 'update');

                            const tracklistContainer = document.getElementById('playlist-detail-tracklist');
                            if (tracklistContainer && updatedPlaylist.tracks) {
                                tracklistContainer.innerHTML = `
                                                                                                                                                <div class="track-list-header">
                                                                                                                                                    <span style="width: 40px; text-align: center;">#</span>
                                                                                                                                                    <span>Title</span>
                                                                                                                                                    <span class="duration-header">Duration</span>
                                                                                                                                                    <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                                                                                                                                                </div>                                            `;
                                this.renderListWithTracks(tracklistContainer, updatedPlaylist.tracks, true, true, true);

                                if (document.querySelector('.remove-from-playlist-btn')) {
                                    this.enableTrackReordering(
                                        tracklistContainer,
                                        updatedPlaylist.tracks,
                                        playlistId,
                                        syncManager
                                    );
                                }

                                const metaEl = document.getElementById('playlist-detail-meta');
                                if (metaEl) {
                                    const totalDuration = calculateTotalDuration(updatedPlaylist.tracks);
                                    metaEl.textContent = `${updatedPlaylist.tracks.length} tracks • ${formatDuration(totalDuration)}`;
                                }
                            }

                            showNotification(`Added "${trackData.title}" to playlist`);
                        }
                    } catch (error) {
                        console.error('Failed to add track to playlist:', error);
                        showNotification('Failed to add track to playlist');
                    }
                };

                const menuBtn = actionsDiv.querySelector('.track-menu-btn');
                if (menuBtn) {
                    actionsDiv.insertBefore(addToPlaylistBtn, menuBtn);
                } else {
                    actionsDiv.appendChild(addToPlaylistBtn);
                }
            });
        };

        try {
            let recommendedTracks = await this.api.getRecommendedTracksForPlaylist(tracks, 20);

            const { contentBlockingSettings } = await import('./storage.js');
            recommendedTracks = contentBlockingSettings.filterTracks(recommendedTracks);

            if (recommendedTracks.length > 0) {
                renderRecommendedTracks(recommendedTracks);

                if (recommendedSearchInput) {
                    recommendedSearchInput.value = '';

                    if (recommendedSearchInput._recommendedSearchListener) {
                        recommendedSearchInput.removeEventListener(
                            'input',
                            recommendedSearchInput._recommendedSearchListener
                        );
                    }

                    if (recommendedSearchInput._recommendedSearchDebounce) {
                        clearTimeout(recommendedSearchInput._recommendedSearchDebounce);
                    }

                    let requestToken = 0;
                    const listener = () => {
                        if (recommendedSearchInput._recommendedSearchDebounce) {
                            clearTimeout(recommendedSearchInput._recommendedSearchDebounce);
                        }

                        recommendedSearchInput._recommendedSearchDebounce = setTimeout(async () => {
                            const query = recommendedSearchInput.value.trim();

                            if (!query) {
                                renderRecommendedTracks(recommendedTracks);
                                return;
                            }

                            const myToken = ++requestToken;
                            recommendedContainer.innerHTML = this.createSkeletonTracks(4, true);

                            try {
                                const searchResult = await this.api.searchTracks(query, {
                                    signal: createTimeoutSignal(8000),
                                });

                                if (myToken !== requestToken) return;

                                let searchedTracks = Array.isArray(searchResult?.items) ? searchResult.items : [];
                                searchedTracks = contentBlockingSettings.filterTracks(searchedTracks);

                                if (!searchedTracks.length) {
                                    recommendedContainer.innerHTML = createPlaceholder(
                                        'No songs found for this search.'
                                    );
                                    return;
                                }

                                renderRecommendedTracks(searchedTracks.slice(0, 50));
                            } catch (error) {
                                if (myToken !== requestToken) return;
                                console.warn('Recommended songs search failed:', error);
                                recommendedContainer.innerHTML = createPlaceholder('Search failed. Try again.');
                            }
                        }, 260);
                    };

                    recommendedSearchInput._recommendedSearchListener = listener;
                    recommendedSearchInput.addEventListener('input', listener);
                }

                recommendedSection.style.display = 'block';
            } else {
                if (recommendedSearchInput) {
                    recommendedSearchInput.value = '';
                }
                recommendedSection.style.display = 'none';
            }
        } catch (error) {
            console.error('Failed to load recommended songs:', error);
            if (recommendedSearchInput) {
                recommendedSearchInput.value = '';
            }
            recommendedSection.style.display = 'none';
        }
    }

    async renderPlaylistPage(playlistId, source = null, _provider = null) {
        this.showPage('playlist');

        // Reset search input for new playlist
        const searchInput = document.getElementById('track-list-search-input');
        if (searchInput) searchInput.value = '';

        const imageEl = document.getElementById('playlist-detail-image');
        const collageEl = document.getElementById('playlist-detail-collage');
        const titleEl = document.getElementById('playlist-detail-title');
        const metaEl = document.getElementById('playlist-detail-meta');
        const descEl = document.getElementById('playlist-detail-description');
        const tracklistContainer = document.getElementById('playlist-detail-tracklist');
        const playBtn = document.getElementById('play-playlist-btn');
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY}<span>Play</span>`;
        const dlBtn = document.getElementById('download-playlist-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download</span>`;
        const addPlaylistBtn = document.getElementById('add-playlist-to-playlist-btn');

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        descEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 100%;"></div>';
        tracklistContainer.innerHTML = `
            <div class="track-list-header">
                <span style="width: 40px; text-align: center;">#</span>
                <span>Title</span>
                <span class="duration-header">Duration</span>
                <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
            </div>
            ${this.createSkeletonTracks(10, true)}
        `;

        try {
            // Check if it's a user playlist (UUID format)
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playlistId);

            let playlistData = null;
            let ownedPlaylist = null;
            let currentSort = 'custom';

            // Priority:
            // 1. If source is 'user', check DB/Sync.
            // 2. If source is 'api', check API.
            // 3. If no source, check DB if UUID, then API.

            if (source === 'user' || (!source && isUUID)) {
                ownedPlaylist = await db.getPlaylist(playlistId);
                playlistData = ownedPlaylist;

                // If not in local DB, check if it's a public Pocketbase playlist
                if (!playlistData) {
                    try {
                        playlistData = await syncManager.getPublicPlaylist(playlistId);
                    } catch (e) {
                        console.warn('Failed to check public pocketbase playlists:', e);
                    }
                }
            }

            if (playlistData) {
                // ... (rest of the logic)
                if (addPlaylistBtn) addPlaylistBtn.style.display = 'none';

                if (playlistData.cover) {
                    imageEl.src = playlistData.cover;
                    imageEl.style.display = 'block';
                    if (collageEl) collageEl.style.display = 'none';
                    const preferredVisualUrl = this.getEntityVisualUrl(playlistData, playlistData.cover);
                    this.setPageBackground(preferredVisualUrl || playlistData.cover, playlistData.cover);
                    if (!this.applyApiVibrantColor(playlistData.vibrantColor)) {
                        this.extractAndApplyColor(playlistData.cover);
                    }
                } else {
                    const tracksWithCovers = (playlistData.tracks || []).filter((t) => t.album && t.album.cover);
                    const uniqueCovers = [];
                    const seen = new Set();
                    for (const t of tracksWithCovers) {
                        if (!seen.has(t.album.cover)) {
                            seen.add(t.album.cover);
                            uniqueCovers.push(t.album.cover);
                            if (uniqueCovers.length >= 4) break;
                        }
                    }

                    if (uniqueCovers.length > 0 && collageEl) {
                        imageEl.style.display = 'none';
                        collageEl.style.display = 'grid';
                        collageEl.className = 'playlist-hero-collage';
                        collageEl.innerHTML = '';
                        const imagesToRender = [];
                        for (let i = 0; i < 4; i++) {
                            imagesToRender.push(uniqueCovers[i % uniqueCovers.length]);
                        }
                        imagesToRender.forEach((cover) => {
                            const img = document.createElement('img');
                            img.src = this.api.getCoverUrl(cover);
                            collageEl.appendChild(img);
                        });
                    } else {
                        imageEl.src = '/assets/appicon.png';
                        imageEl.style.display = 'block';
                        if (collageEl) collageEl.style.display = 'none';
                    }
                    this.setPageBackground(null);
                    this.resetVibrantColor();
                }

                titleEl.textContent = playlistData.name || playlistData.title;
                titleEl.className = 'playlist-hero-title';
                this.adjustTitleFontSize(titleEl, titleEl.textContent);

                const tracks = playlistData.tracks || [];
                const totalDuration = calculateTotalDuration(tracks);
                const trackCount = getPlaylistTrackCount(playlistData, tracks);

                metaEl.textContent = `${trackCount} tracks • ${formatDuration(totalDuration)}`;

                // Use the new renderPlaylistDescription for Read More functionality
                this.renderPlaylistDescription(descEl, playlistData.description, 150);

                const originalTracks = [...tracks];
                const savedSort = localStorage.getItem(`playlist-sort-${playlistId}`);
                currentSort = savedSort || 'custom';
                let currentTracks = sortTracks(originalTracks, currentSort);

                const renderTracks = () => {
                    // Re-fetch container each time because enableTrackReordering clones it
                    const container = document.getElementById('playlist-detail-tracklist');
                    container.innerHTML = `
                        <div class="track-list-header">
                            <span style="width: 40px; text-align: center;">#</span>
                            <span>Title</span>
                            <span class="duration-header">Duration</span>
                            <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                        </div>
                    `;
                    this.renderListWithTracks(container, currentTracks, true, true, true);

                    // Add remove buttons and enable reordering ONLY IF OWNED
                    if (ownedPlaylist) {
                        const trackItems = container.querySelectorAll('.track-item');
                        trackItems.forEach((item, index) => {
                            const actionsDiv = item.querySelector('.track-item-actions');
                            const removeBtn = document.createElement('button');
                            removeBtn.className = 'track-action-btn remove-from-playlist-btn';
                            removeBtn.title = 'Remove from playlist';
                            removeBtn.innerHTML =
                                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
                            removeBtn.dataset.trackId = currentTracks[index].id;

                            const menuBtn = actionsDiv.querySelector('.track-menu-btn');
                            actionsDiv.insertBefore(removeBtn, menuBtn);
                        });

                        // Always add is-editable class for owned playlists to fix layout
                        // This expands the grid columns to accommodate the remove button
                        container.classList.add('is-editable');

                        // Only enable drag-and-drop reordering in custom sort mode
                        if (currentSort === 'custom') {
                            this.enableTrackReordering(container, currentTracks, playlistId, syncManager);
                        }
                    } else {
                        container.classList.remove('is-editable');
                    }
                };

                const applySort = (sortType) => {
                    currentSort = sortType;
                    localStorage.setItem(`playlist-sort-${playlistId}`, sortType);
                    currentTracks = sortTracks(originalTracks, sortType);
                    renderTracks();
                };

                renderTracks();

                // Update header like button - hide for user playlists
                const playlistLikeBtn = document.getElementById('like-playlist-btn');
                if (playlistLikeBtn) {
                    playlistLikeBtn.style.display = 'none';
                }

                // Load recommended songs thingy
                if (ownedPlaylist) {
                    this.loadRecommendedSongsForPlaylist(tracks);
                }

                // Render Actions (Sort, Shuffle, Edit, Delete, Share)
                this.updatePlaylistHeaderActions(
                    playlistData,
                    !!ownedPlaylist,
                    currentTracks,
                    false,
                    applySort,
                    () => currentSort
                );

                const uniqueCovers = [];
                const seenCovers = new Set();
                const trackList = playlistData.tracks || [];
                for (const track of trackList) {
                    const cover = track.album?.cover;
                    if (cover && !seenCovers.has(cover)) {
                        seenCovers.add(cover);
                        uniqueCovers.push(cover);
                        if (uniqueCovers.length >= 4) break;
                    }
                }

                const userPlaylistRecentData = {
                    id: playlistData.id || playlistData.uuid,
                    name: playlistData.name || playlistData.title,
                    title: playlistData.title || playlistData.name,
                    uuid: playlistData.uuid || playlistData.id,
                    cover: playlistData.cover,
                    images: uniqueCovers,
                    numberOfTracks: playlistData.tracks ? playlistData.tracks.length : 0,
                    isUserPlaylist: true,
                };

                playBtn.onclick = () => {
                    this.player.setQueue(currentTracks, 0);
                    this.player.playTrackFromQueue();
                    recentActivityManager.addPlaylist(userPlaylistRecentData);
                };

                document.title = `${playlistData.name || playlistData.title} - Monochrome+`;

                // Setup playlist search
                this.setupTracklistSearch();
            } else {
                if (addPlaylistBtn) addPlaylistBtn.style.display = 'flex';

                // If source was explicitly 'user' and we didn't find it, fail.
                if (source === 'user') {
                    throw new Error('Playlist not found. If this is a custom playlist, make sure it is set to Public.');
                }

                // Render API playlist
                let apiResult = await this.api.getPlaylist(playlistId);
                const { playlist, tracks } = apiResult;
                recentActivityManager.addPlaylist(playlist);

                const imageId = playlist.squareImage || playlist.image;
                if (imageId) {
                    imageEl.src = this.api.getCoverUrl(imageId, '1080');
                    const preferredVisualUrl = this.getEntityVisualUrl(
                        {
                            cover: imageId,
                            videoCover: playlist.videoCover,
                        },
                        imageId
                    );
                    this.setPageBackground(preferredVisualUrl || imageEl.src, imageEl.src);

                    if (!this.applyApiVibrantColor(playlist.vibrantColor)) {
                        this.extractAndApplyColor(this.api.getCoverUrl(imageId, '160'));
                    }
                } else {
                    imageEl.src = '/assets/appicon.png';
                    this.setPageBackground(null);
                    this.resetVibrantColor();
                }

                titleEl.textContent = playlist.title;
                titleEl.className = 'playlist-hero-title';
                this.adjustTitleFontSize(titleEl, playlist.title);

                const totalDuration = calculateTotalDuration(tracks);
                const trackCount = getPlaylistTrackCount(playlist, tracks);

                metaEl.textContent = `${trackCount} tracks • ${formatDuration(totalDuration)}`;

                // Use the new renderPlaylistDescription for Read More functionality
                this.renderPlaylistDescription(descEl, playlist.description, 150);

                const originalTracks = [...tracks];
                const savedSort = localStorage.getItem(`playlist-sort-${playlistId}`);
                let currentSort = savedSort || 'custom';
                let currentTracks = sortTracks(originalTracks, currentSort);

                const renderTracks = () => {
                    tracklistContainer.innerHTML = `
                        <div class="track-list-header">
                            <span style="width: 40px; text-align: center;">#</span>
                            <span>Title</span>
                            <span class="duration-header">Duration</span>
                            <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                        </div>
                    `;
                    this.renderListWithTracks(tracklistContainer, currentTracks, true, true, true);
                };

                const applySort = (sortType) => {
                    currentSort = sortType;
                    localStorage.setItem(`playlist-sort-${playlistId}`, sortType);
                    currentTracks = sortTracks(originalTracks, sortType);
                    renderTracks();
                };

                renderTracks();

                playBtn.onclick = () => {
                    this.player.setQueue(currentTracks, 0);
                    this.player.playTrackFromQueue();
                    recentActivityManager.addPlaylist(playlist);
                };

                // Update header like button
                const playlistLikeBtn = document.getElementById('like-playlist-btn');
                if (playlistLikeBtn) {
                    const isLiked = await db.isFavorite('playlist', playlist.uuid);
                    playlistLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                    playlistLikeBtn.classList.toggle('active', isLiked);
                    playlistLikeBtn.style.display = 'flex';
                }

                // Show/hide Delete button
                const deleteBtn = document.getElementById('delete-playlist-btn');
                if (deleteBtn) {
                    deleteBtn.style.display = 'none';
                }

                // Hide recommended songs section for tidal playlists
                const recommendedSection = document.getElementById('playlist-section-recommended');
                if (recommendedSection) {
                    recommendedSection.style.display = 'none';
                }

                // Render Actions (Shuffle + Sort + Share)
                this.updatePlaylistHeaderActions(playlist, false, currentTracks, false, applySort, () => currentSort);
                document.title = playlist.title || 'Artist Mix';
            }

            // Setup playlist search
            this.setupTracklistSearch();
        } catch (error) {
            console.error('Failed to load playlist:', error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load playlist details. ${error.message}`);
        }
    }

    async renderFolderPage(folderId) {
        this.showPage('folder');
        const imageEl = document.getElementById('folder-detail-image');
        const titleEl = document.getElementById('folder-detail-title');
        const metaEl = document.getElementById('folder-detail-meta');
        const container = document.getElementById('folder-detail-container');

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        container.innerHTML = this.createSkeletonCards(4, false);

        try {
            const folder = await db.getFolder(folderId);
            if (!folder) throw new Error('Folder not found');

            imageEl.src = folder.cover || '/assets/folder.png';
            imageEl.onerror = () => {
                imageEl.src = '/assets/folder.png';
            };
            imageEl.style.backgroundColor = '';

            titleEl.textContent = folder.name;
            metaEl.textContent = `Created ${new Date(folder.createdAt).toLocaleDateString()}`;

            this.setPageBackground(null);
            this.resetVibrantColor();

            if (folder.playlists?.length > 0) {
                const playlistPromises = folder.playlists.map((id) => db.getPlaylist(id));
                const playlists = (await Promise.all(playlistPromises)).filter(Boolean);
                if (playlists.length > 0) {
                    container.innerHTML = playlists.map((p) => this.createUserPlaylistCardHTML(p)).join('');
                    playlists.forEach((playlist) => {
                        const el = container.querySelector(`[data-user-playlist-id="${playlist.id}"]`);
                        if (el) trackDataStore.set(el, playlist);
                    });
                } else {
                    container.innerHTML = createPlaceholder(
                        'This folder is empty. Some playlists may have been deleted.'
                    );
                }
            } else {
                container.innerHTML = createPlaceholder('This folder is empty. Drag a playlist here to add it.');
            }
        } catch (error) {
            console.error('Failed to load folder:', error);
            container.innerHTML = createPlaceholder('Folder not found.');
        }
    }

    async renderMixPage(mixId, provider = null) {
        this.showPage('mix');

        const imageEl = document.getElementById('mix-detail-image');
        const titleEl = document.getElementById('mix-detail-title');
        const metaEl = document.getElementById('mix-detail-meta');
        const descEl = document.getElementById('mix-detail-description');
        const tracklistContainer = document.getElementById('mix-detail-tracklist');
        const playBtn = document.getElementById('play-mix-btn');
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY}<span>Play</span>`;
        const dlBtn = document.getElementById('download-mix-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download</span>`;

        // Skeleton loading
        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        descEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 100%;"></div>';
        tracklistContainer.innerHTML = `
            <div class="track-list-header">
                <span style="width: 40px; text-align: center;">#</span>
                <span>Title</span>
                <span class="duration-header">Duration</span>
                <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
            </div>
            ${this.createSkeletonTracks(10, true)}
        `;

        try {
            const { mix, tracks } = await this.api.getMix(mixId, provider);
            recentActivityManager.addMix(mix);

            if (mix.cover) {
                imageEl.src = mix.cover;
                this.setPageBackground(mix.cover);
                this.extractAndApplyColor(mix.cover);
            } else {
                // Try to get cover from first track album
                if (tracks.length > 0 && tracks[0].album?.cover) {
                    imageEl.src = this.api.getCoverUrl(tracks[0].album.cover);
                    this.setPageBackground(imageEl.src);
                    this.extractAndApplyColor(this.api.getCoverUrl(tracks[0].album.cover, '160'));
                } else {
                    imageEl.src = '/assets/appicon.png';
                    this.setPageBackground(null);
                    this.resetVibrantColor();
                }
            }

            imageEl.style.backgroundColor = '';

            // Use title and subtitle from API directly
            const displayTitle = mix.title || 'Mix';
            titleEl.textContent = displayTitle;
            this.adjustTitleFontSize(titleEl, displayTitle);

            const totalDuration = calculateTotalDuration(tracks);
            metaEl.textContent = `${tracks.length} tracks • ${formatDuration(totalDuration)}`;
            descEl.innerHTML = `${mix.subTitle}`;

            tracklistContainer.innerHTML = `
                <div class="track-list-header">
                    <span style="width: 40px; text-align: center;">#</span>
                    <span>Title</span>
                    <span class="duration-header">Duration</span>
                    <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                </div>
            `;

            this.renderListWithTracks(tracklistContainer, tracks, true, true);

            // Set play button action
            playBtn.onclick = () => {
                this.player.setQueue(tracks, 0);
                this.player.playTrackFromQueue();
                recentActivityManager.addMix(mix);
            };

            // Update header like button
            const mixLikeBtn = document.getElementById('like-mix-btn');
            if (mixLikeBtn) {
                mixLikeBtn.style.display = 'flex';
                const isLiked = await db.isFavorite('mix', mix.id);
                mixLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                mixLikeBtn.classList.toggle('active', isLiked);
            }

            document.title = displayTitle;
        } catch (error) {
            console.error('Failed to load mix:', error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load mix details. ${error.message}`);
        }
    }

    async renderArtistPage(artistId, provider = null) {
        this.showPage('artist');
        this._artistRenderToken = (this._artistRenderToken || 0) + 1;
        const renderToken = this._artistRenderToken;

        const imageEl = document.getElementById('artist-detail-image');
        const heroHeaderEl = document.querySelector('#page-artist .artist-hero-header');
        const heroContentEl = document.querySelector('#page-artist .artist-hero-content');
        const nameEl = document.getElementById('artist-detail-name');
        const metaEl = document.getElementById('artist-detail-meta');
        const bioEl = document.getElementById('artist-detail-bio');
        const bioSection = document.getElementById('artist-section-bio');
        let aboutTopEl = document.getElementById('artist-about-top');
        if (!aboutTopEl && bioSection && bioEl) {
            aboutTopEl = document.createElement('div');
            aboutTopEl.id = 'artist-about-top';
            aboutTopEl.className = 'artist-about-top';
            bioSection.insertBefore(aboutTopEl, bioEl);
        }
        const tracksContainer = document.getElementById('artist-detail-tracks');
        const albumsContainer = document.getElementById('artist-detail-albums');
        const epsContainer = document.getElementById('artist-detail-eps');
        const epsSection = document.getElementById('artist-section-eps');
        const similarContainer = document.getElementById('artist-detail-similar');
        const similarSection = document.getElementById('artist-section-similar');
        const dlBtn = document.getElementById('download-discography-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download Discography</span>`;

        imageEl.classList.add('img-loading');
        if (heroHeaderEl) {
            heroHeaderEl.classList.add('img-loading');
            heroHeaderEl.style.setProperty('--artist-hero-bg-image', 'none');
        }
        imageEl.removeAttribute('src');
        imageEl.style.backgroundColor = 'var(--muted)';
        nameEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '';
        metaEl.style.display = 'none';
        const heroActionsEl = document.querySelector('#page-artist .artist-hero-actions');
        if (heroActionsEl && heroContentEl && !heroContentEl.contains(heroActionsEl)) {
            heroContentEl.appendChild(heroActionsEl);
        }
        if (aboutTopEl) {
            aboutTopEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 220px;"></div>';
        }
        if (bioEl) {
            bioEl.textContent = '';
            bioEl.classList.remove('expanded');
        }
        if (bioSection) bioSection.style.display = 'none';
        tracksContainer.innerHTML = this.createSkeletonTracks(5, true);
        albumsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (epsContainer) epsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (epsSection) epsSection.style.display = 'none';
        const loadUnreleasedSection = document.getElementById('artist-section-load-unreleased');
        if (loadUnreleasedSection) loadUnreleasedSection.style.display = 'none';
        if (similarContainer) similarContainer.innerHTML = this.createSkeletonCards(6, true);
        if (similarSection) similarSection.style.display = 'block';

        try {
            const artist = await this.api.getArtist(artistId, provider);
            if (renderToken !== this._artistRenderToken) return;
            recentActivityManager.addArtist(artist);

            // Handle Biography
            if (bioEl) {
                // Pre-define regex patterns for better performance
                const linkTypes = ['artist', 'album', 'track', 'playlist'];
                const regexCache = {
                    wimp: linkTypes.reduce((acc, type) => {
                        acc[type] = new RegExp(`\\[wimpLink ${type}Id="([a-f\\d-]+)"\\](.*?)\\[\\/wimpLink\\]`, 'g');
                        return acc;
                    }, {}),
                    legacy: linkTypes.reduce((acc, type) => {
                        acc[type] = new RegExp(`\\[${type}:([a-f\\d-]+)\\](.*?)\\[\\/${type}\\]`, 'g');
                        return acc;
                    }, {}),
                    doubleBracket: /\[\[(.*?)\|(.*?)\]\]/g,
                };

                const parseBio = (text) => {
                    if (!text) return '';

                    let parsed = text;

                    linkTypes.forEach((type) => {
                        parsed = parsed.replace(
                            regexCache.wimp[type],
                            (_m, id, name) =>
                                `<span class="bio-link" data-type="${type}" data-id="${id}">${name}</span>`
                        );
                        parsed = parsed.replace(
                            regexCache.legacy[type],
                            (_m, id, name) =>
                                `<span class="bio-link" data-type="${type}" data-id="${id}">${name}</span>`
                        );
                    });

                    parsed = parsed.replace(
                        regexCache.doubleBracket,
                        (_m, name, id) => `<span class="bio-link" data-type="artist" data-id="${id}">${name}</span>`
                    );

                    return parsed.replace(/\n/g, '<br>');
                };

                // Helper to strip tags for clean preview
                const stripBioTags = (text) => {
                    if (!text) return '';
                    let clean = text;
                    linkTypes.forEach((type) => {
                        // [wimpLink artistId="..."]Name[/wimpLink] -> Name
                        clean = clean.replace(regexCache.wimp[type], (_m, _id, name) => name);
                        // [artist:...]Name[/artist] -> Name
                        clean = clean.replace(regexCache.legacy[type], (_m, _id, name) => name);
                    });
                    // [[Name|ID]] -> Name
                    clean = clean.replace(regexCache.doubleBracket, (_m, name, _id) => name);
                    return clean;
                };

                const showBioModal = (bio) => {
                    const text = typeof bio === 'string' ? bio : bio.text;
                    const source = typeof bio === 'string' ? null : bio.source;

                    const modal = document.createElement('div');
                    modal.className = 'modal active bio-modal';
                    modal.style.zIndex = '9999'; // Ensure it's on top
                    modal.innerHTML = `
                        <div class="modal-overlay"></div>
                        <div class="modal-content extra-wide" style="display: flex; flex-direction: column;">
                            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem;">
                                <h3 style="margin: 0;">Artist Biography</h3>
                                <button class="btn-close" style="background: none; border: none; font-size: 2rem; cursor: pointer; color: var(--foreground); padding: 0.2rem 0.5rem; line-height: 1;">&times;</button>
                            </div>
                            <div class="modal-body" style="max-height: 70vh; overflow-y: auto; line-height: 1.8; font-size: 1.1rem; padding-right: 1rem; color: var(--foreground); cursor: default;">
                                ${parseBio(text)}
                                ${source ? `<div class="bio-source">Source: ${source}</div>` : ''}
                            </div>
                        </div>
                    `;

                    document.body.appendChild(modal);

                    const close = (e) => {
                        if (e) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        modal.remove();
                    };

                    modal.querySelector('.modal-overlay').onclick = close;
                    modal.querySelector('.btn-close').onclick = close;

                    // Ensure links are clickable by attaching the listener to the modal body
                    const modalBody = modal.querySelector('.modal-body');
                    modalBody.addEventListener(
                        'click',
                        (e) => {
                            const link = e.target.closest('.bio-link');
                            if (link) {
                                e.preventDefault();
                                e.stopPropagation();
                                const { type, id } = link.dataset;
                                if (type && id) {
                                    modal.remove();
                                    navigate(`/${type}/t/${id}`);
                                }
                            }
                        },
                        true
                    ); // Use capture phase to ensure it's hit
                };

                const renderBioPreview = (bio) => {
                    const text = typeof bio === 'string' ? bio : bio.text;
                    if (text) {
                        // Use stripped text for preview to avoid broken tags/links
                        const cleanText = stripBioTags(text);
                        const isLong = cleanText.length > 200;
                        const previewText = isLong ? cleanText.substring(0, 200).trim() + '...' : cleanText;

                        bioEl.innerHTML = previewText.replace(/\n/g, '<br>');
                        if (bioSection) bioSection.style.display = 'block';
                        bioEl.style.webkitLineClamp = 'unset';
                        bioEl.style.cursor = 'default';
                        bioEl.onclick = null;

                        if (isLong) {
                            bioEl.appendChild(document.createElement('br'));
                            const readMore = document.createElement('span');
                            readMore.className = 'bio-read-more';
                            readMore.textContent = 'Read More';
                            readMore.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                showBioModal(bio);
                            };
                            bioEl.appendChild(readMore);
                        }
                    } else {
                        if (bioSection) bioSection.style.display = 'none';
                    }
                };

                if (artist.biography) {
                    renderBioPreview(artist.biography);
                } else {
                    // Try to fetch biography asynchronously
                    this.api
                        .getArtistBiography(artistId, provider)
                        .then((bio) => {
                            if (renderToken !== this._artistRenderToken) return;
                            if (bio) renderBioPreview(bio);
                        })
                        .catch(() => {
                            /* ignore */
                        });
                }
            }

            // Handle Artist Mix Button
            const mixBtn = document.getElementById('artist-mix-btn');
            if (mixBtn) {
                if (artist.mixes && artist.mixes.ARTIST_MIX) {
                    mixBtn.style.display = 'flex';
                    mixBtn.onclick = () => navigate(`/mix/${artist.mixes.ARTIST_MIX}`);
                } else {
                    mixBtn.style.display = 'none';
                }
            }

            // Similar Artists
            if (similarContainer && similarSection) {
                this.api
                    .getSimilarArtists(artistId)
                    .then(async (similar) => {
                        if (renderToken !== this._artistRenderToken) return;
                        // Filter out blocked artists
                        const { contentBlockingSettings } = await import('./storage.js');
                        if (renderToken !== this._artistRenderToken) return;
                        const filteredSimilar = contentBlockingSettings.filterArtists(similar || []);

                        if (filteredSimilar.length > 0) {
                            similarContainer.innerHTML = filteredSimilar
                                .map((a) => this.createArtistCircularCardHTML(a))
                                .join('');
                            similarSection.style.display = 'block';

                            filteredSimilar.forEach((a) => {
                                const el = similarContainer.querySelector(`[data-artist-id="${a.id}"]`);
                                if (el) {
                                    trackDataStore.set(el, a);
                                    this.updateLikeState(el, 'artist', a.id);
                                }
                            });
                        } else {
                            similarSection.style.display = 'none';
                        }
                    })
                    .catch(() => {
                        if (renderToken !== this._artistRenderToken) return;
                        similarSection.style.display = 'none';
                    });
            }

            const heroCandidates = [];
            const seenHeroUrls = new Set();
            const addHeroCandidate = (url) => {
                if (typeof url !== 'string') return;
                const trimmed = url.trim();
                if (!trimmed || seenHeroUrls.has(trimmed)) return;
                seenHeroUrls.add(trimmed);
                heroCandidates.push(trimmed);
            };
            const addArtistSourceCandidates = (source) => {
                if (!source) return;
                ['750', '640', '320', '160', '1280'].forEach((size) => {
                    addHeroCandidate(this.api.getArtistPictureUrl(source, size));
                });
            };

            // Always try Wikimedia/web image first before any provider fallback.
            const webImageCandidate = await this.api.getArtistWebImage(artist.name);
            if (renderToken !== this._artistRenderToken) return;
            addHeroCandidate(webImageCandidate);

            addArtistSourceCandidates(artist.picture);
            addArtistSourceCandidates(artist.selectedAlbumCoverFallback);
            addArtistSourceCandidates(artist.image);
            addArtistSourceCandidates(artist.cover);

            if (Array.isArray(artist.albums)) {
                artist.albums.slice(0, 6).forEach((album) => {
                    if (album?.cover) {
                        addHeroCandidate(this.api.getCoverUrl(album.cover, '1280'));
                        addHeroCandidate(this.api.getCoverUrl(album.cover, '640'));
                    }
                });
            }

            if (Array.isArray(artist.tracks)) {
                artist.tracks.slice(0, 8).forEach((track) => {
                    const cover = track?.album?.cover || track?.cover;
                    if (cover) {
                        addHeroCandidate(this.api.getCoverUrl(cover, '1280'));
                        addHeroCandidate(this.api.getCoverUrl(cover, '640'));
                    }
                });
            }

            addHeroCandidate('assets/appicon.png');

            let heroIndex = 0;
            const loadHeroCandidate = () => {
                if (heroIndex >= heroCandidates.length) {
                    imageEl.classList.remove('img-loading');
                    if (heroHeaderEl) {
                        heroHeaderEl.classList.remove('img-loading');
                        heroHeaderEl.style.setProperty('--artist-hero-bg-image', 'none');
                    }
                    this.setPageBackground(null);
                    return;
                }
                const nextSrc = heroCandidates[heroIndex++];
                if (heroHeaderEl) {
                    const safeSrc = nextSrc.replace(/"/g, '\\"');
                    heroHeaderEl.style.setProperty('--artist-hero-bg-image', `url("${safeSrc}")`);
                }
                imageEl.src = nextSrc;
            };
            imageEl.onerror = () => {
                if (renderToken !== this._artistRenderToken) return;
                loadHeroCandidate();
            };
            imageEl.onload = () => {
                if (renderToken !== this._artistRenderToken) return;
                imageEl.classList.remove('img-loading');
                if (heroHeaderEl) heroHeaderEl.classList.remove('img-loading');
                this.setPageBackground(imageEl.src);
            };
            loadHeroCandidate();

            imageEl.style.backgroundColor = '';
            nameEl.textContent = artist.name;

            // Extract vibrant color using robust image extraction (160x160 for speed/accuracy balance)
            const artistPic160 = heroCandidates.find((url) => !url.includes('assets/appicon.png')) || heroCandidates[0];
            this.extractAndApplyColor(artistPic160);

            this.adjustTitleFontSize(nameEl, artist.name);

            metaEl.innerHTML = '';
            metaEl.style.display = 'none';

            const rolesHtml = (artist.artistRoles || [])
                .filter((role) => role.category)
                .map((role) => `<span class="artist-tag">${role.category}</span>`)
                .join('');

            if (aboutTopEl) {
                aboutTopEl.innerHTML = `
                    <div class="artist-about-meta">
                        <span>${artist.popularity}% popularity</span>
                        <div class="artist-tags">${rolesHtml}</div>
                    </div>
                `;

                const heroActions = document.querySelector('#page-artist .artist-hero-actions');
                if (heroActions) {
                    heroActions.classList.add('artist-about-actions');
                    aboutTopEl.appendChild(heroActions);
                }
            }

            this.renderListWithTracks(tracksContainer, artist.tracks, true);

            // Update header like button
            const artistLikeBtn = document.getElementById('like-artist-btn');
            if (artistLikeBtn) {
                artistLikeBtn.style.display = 'flex';
                const isLiked = await db.isFavorite('artist', artist.id);
                artistLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                artistLikeBtn.classList.toggle('active', isLiked);
            }

            albumsContainer.innerHTML = artist.albums.map((album) => this.createAlbumCardHTML(album)).join('');
            // Render Albums
            albumsContainer.innerHTML = artist.albums.length
                ? artist.albums.map((album) => this.createAlbumCardHTML(album)).join('')
                : createPlaceholder('No albums found.');

            // Render EPs and Singles
            if (epsContainer && epsSection) {
                if (artist.eps && artist.eps.length > 0) {
                    epsContainer.innerHTML = artist.eps.map((album) => this.createAlbumCardHTML(album)).join('');
                    epsSection.style.display = 'block';

                    artist.eps.forEach((album) => {
                        const el = epsContainer.querySelector(`[data-album-id="${album.id}"]`);
                        if (el) {
                            trackDataStore.set(el, album);
                            this.updateLikeState(el, 'album', album.id);
                        }
                    });
                } else {
                    epsSection.style.display = 'none';
                }
            }

            artist.albums.forEach((album) => {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    this.updateLikeState(el, 'album', album.id);
                }
            });

            // Unreleased section removed.

            document.title = artist.name;
        } catch (error) {
            console.error('Failed to load artist:', error);
            tracksContainer.innerHTML = albumsContainer.innerHTML = createPlaceholder(
                `Could not load artist details. ${error.message}`
            );
        }
    }

    async renderRecentPage() {
        this.showPage('recent');
        const container = document.getElementById('recent-tracks-container');
        const clearBtn = document.getElementById('clear-history-btn');
        const subtitle = document.getElementById('recent-page-subtitle');
        container.innerHTML = this.createSkeletonTracks(10, true);

        try {
            const history = await db.getHistory();
            const latestHistory = Array.isArray(history) ? history : [];

            // Show/hide clear button based on whether there's history
            if (clearBtn) {
                clearBtn.style.display = latestHistory.length > 0 ? 'flex' : 'none';
            }

            if (latestHistory.length === 0) {
                container.innerHTML = createPlaceholder("You haven't played any tracks yet.");
                if (subtitle) subtitle.textContent = 'No listening history yet.';
                return;
            }

            // Group by date
            const groups = {};
            const today = new Date().setHours(0, 0, 0, 0);
            const yesterday = new Date(today - 86400000).setHours(0, 0, 0, 0);

            latestHistory.forEach((item) => {
                const date = new Date(item.timestamp);
                const dayStart = new Date(date).setHours(0, 0, 0, 0);

                let label;
                if (dayStart === today) label = 'Today';
                else if (dayStart === yesterday) label = 'Yesterday';
                else
                    label = date.toLocaleDateString(undefined, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    });

                if (!groups[label]) groups[label] = [];
                groups[label].push(item);
            });

            container.innerHTML = '';
            if (subtitle) {
                subtitle.textContent = `${latestHistory.length} plays across ${Object.keys(groups).length} day${Object.keys(groups).length === 1 ? '' : 's'}.`;
            }

            for (const [label, tracks] of Object.entries(groups)) {
                const groupEl = document.createElement('section');
                groupEl.className = 'recent-day-group';
                const header = document.createElement('div');
                header.className = 'recent-day-head';
                header.innerHTML = `<h3>${escapeHtml(label)}</h3><span>${tracks.length} track${tracks.length === 1 ? '' : 's'}</span>`;
                groupEl.appendChild(header);

                // Use a temporary container to render tracks and then move them
                const tempContainer = document.createElement('div');
                this.renderListWithTracks(tempContainer, tracks, true);

                // Append rendered track nodes and annotate played time per item
                const trackNodes = Array.from(tempContainer.querySelectorAll('.track-item'));
                trackNodes.forEach((node, trackIndex) => {
                    const ts = tracks[trackIndex]?.timestamp;
                    if (ts) {
                        const when = new Date(ts);
                        const playedText = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const artistLine = node.querySelector('.track-item-details .artist');
                        if (artistLine) {
                            const playedMeta = document.createElement('span');
                            playedMeta.className = 'recent-played-at';
                            playedMeta.textContent = ` • Played ${playedText}`;
                            artistLine.appendChild(playedMeta);
                        }
                    }

                    groupEl.appendChild(node);
                });

                container.appendChild(groupEl);
            }

            // Setup clear button handler
            if (clearBtn) {
                clearBtn.onclick = async () => {
                    if (confirm('Clear all recently played tracks? This cannot be undone.')) {
                        try {
                            await db.clearHistory();
                            container.innerHTML = createPlaceholder("You haven't played any tracks yet.");
                            if (subtitle) subtitle.textContent = 'No listening history yet.';
                            clearBtn.style.display = 'none';
                        } catch (err) {
                            console.error('Failed to clear history:', err);
                            alert('Failed to clear history');
                        }
                    }
                };
            }
        } catch (error) {
            console.error('Failed to load history:', error);
            container.innerHTML = createPlaceholder('Failed to load history.');
            if (subtitle) subtitle.textContent = 'Failed to load listening history.';
            if (clearBtn) clearBtn.style.display = 'none';
        }
    }

    _getFriendsRouteParam() {
        if (!window.location.pathname.startsWith('/friends/')) return '';
        return decodeURIComponent(window.location.pathname.slice('/friends/'.length));
    }

    _normalizeFriendUsername(username) {
        return String(username || '')
            .trim()
            .replace(/^@/, '')
            .toLowerCase();
    }

    async renderFriendSuggestionsSection({
        friends = [],
        incomingRequests = [],
        outgoingRequests = [],
        useCloudSocial = !!authManager.user,
    } = {}) {
        const section = document.getElementById('friends-discover-section');
        const searchInput = document.getElementById('friends-discover-input');
        const statusEl = document.getElementById('friends-suggestions-status');
        const suggestionsList = document.getElementById('friends-suggestions-list');

        if (!section || !searchInput || !statusEl || !suggestionsList) return;

        if (!useCloudSocial || !authManager.user) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        const myProfileData = await syncManager.getUserData().catch(() => null);
        const selfUid = String(authManager.user.$id || '');
        const selfUsername = this._normalizeFriendUsername(myProfileData?.profile?.username);
        const blockedUids = new Set(selfUid ? [selfUid] : []);
        const blockedUsernames = new Set();

        const addBlockedTarget = (uid, username) => {
            if (uid) blockedUids.add(String(uid));
            const normalized = this._normalizeFriendUsername(username);
            if (normalized) blockedUsernames.add(normalized);
        };

        friends.forEach((friend) => addBlockedTarget(friend.uid, friend.username));
        incomingRequests.forEach((request) => addBlockedTarget(request.uid, request.username));
        outgoingRequests.forEach((request) => addBlockedTarget(request.uid, request.username));

        addBlockedTarget(selfUid, myProfileData?.profile?.username);

        const runSearch = async (query, requestToken) => {
            const cleanQuery = String(query || '').trim();

            if (cleanQuery.length < 2) {
                statusEl.textContent = 'Type at least 2 characters to find people.';
                suggestionsList.innerHTML = '';
                return;
            }

            statusEl.textContent = 'Searching...';
            suggestionsList.innerHTML = '';

            try {
                const users = await syncManager.searchUsers(cleanQuery);
                if (requestToken !== this._friendsSuggestionRequestToken) return;

                let selfMatchCount = 0;
                let connectedMatchCount = 0;
                const filtered = (Array.isArray(users) ? users : [])
                    .filter((user) => user && typeof user === 'object')
                    .filter((user) => {
                        const uid = String(user.firebase_id || '');
                        const username = this._normalizeFriendUsername(user.username);
                        if (!uid || !username) return false;
                        if (uid === selfUid || (selfUsername && username === selfUsername)) {
                            selfMatchCount += 1;
                            return false;
                        }
                        if (blockedUids.has(uid) || blockedUsernames.has(username)) {
                            connectedMatchCount += 1;
                            return false;
                        }
                        return true;
                    })
                    .slice(0, 12);

                if (filtered.length === 0) {
                    if (selfMatchCount > 0 && connectedMatchCount === 0) {
                        statusEl.textContent = 'That search matches your account.';
                        const meUsername = this._normalizeFriendUsername(myProfileData?.profile?.username);
                        const meDisplayName = myProfileData?.profile?.display_name || meUsername || 'You';
                        const meAvatar = myProfileData?.profile?.avatar_url || '/assets/appicon.png';
                        suggestionsList.innerHTML = meUsername
                            ? `
                                <div class="friend-suggestion-item self">
                                    <img class="friend-suggestion-avatar" src="${meAvatar}" alt="${escapeHtml(meDisplayName)}" />
                                    <div class="friend-suggestion-meta">
                                        <div class="friend-suggestion-name">${escapeHtml(meDisplayName)} <span style="opacity: 0.75">(You)</span></div>
                                        <div class="friend-suggestion-username">@${escapeHtml(meUsername)}</div>
                                    </div>
                                    <div class="friend-suggestion-actions">
                                        <button class="btn-secondary friend-suggestion-profile-btn" data-username="${encodeURIComponent(meUsername)}">Profile</button>
                                    </div>
                                </div>
                            `
                            : '';
                    } else if (connectedMatchCount > 0) {
                        statusEl.textContent = 'Matched users are already friends or pending requests.';
                        suggestionsList.innerHTML = '';
                    } else {
                        statusEl.textContent = 'No matching people found.';
                        suggestionsList.innerHTML = '';
                    }
                    return;
                }

                statusEl.textContent = `Found ${filtered.length} ${filtered.length === 1 ? 'person' : 'people'}.`;
                suggestionsList.innerHTML = filtered
                    .map((user) => {
                        const username = this._normalizeFriendUsername(user.username);
                        const encodedUsername = encodeURIComponent(username);
                        const uid = String(user.firebase_id || '');
                        return `
                            <div class="friend-suggestion-item" data-uid="${uid}">
                                <img class="friend-suggestion-avatar" src="${user.avatar_url || '/assets/appicon.png'}" alt="${escapeHtml(user.display_name || username || 'User')}" />
                                <div class="friend-suggestion-meta">
                                    <div class="friend-suggestion-name">${escapeHtml(user.display_name || username || 'User')}</div>
                                    <div class="friend-suggestion-username">@${escapeHtml(username)}</div>
                                </div>
                                <div class="friend-suggestion-actions">
                                    <button class="btn-secondary friend-suggestion-profile-btn" data-username="${encodedUsername}">Profile</button>
                                    <button class="btn-primary friend-suggestion-add-btn" data-username="${encodedUsername}">Add Friend</button>
                                </div>
                            </div>
                        `;
                    })
                    .join('');
            } catch (error) {
                if (requestToken !== this._friendsSuggestionRequestToken) return;
                console.error('Failed to search users for friend suggestions:', error);
                statusEl.textContent = 'Search failed. Try again.';
                suggestionsList.innerHTML = '';
            }
        };

        if (searchInput.value !== this._friendsSuggestionQuery) {
            searchInput.value = this._friendsSuggestionQuery;
        }

        searchInput.oninput = () => {
            this._friendsSuggestionQuery = searchInput.value.trim();
            if (this._friendsSuggestionTimer) {
                clearTimeout(this._friendsSuggestionTimer);
            }
            const requestToken = ++this._friendsSuggestionRequestToken;
            this._friendsSuggestionTimer = setTimeout(() => {
                runSearch(this._friendsSuggestionQuery, requestToken);
            }, 250);
        };

        searchInput.onkeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (this._friendsSuggestionTimer) {
                    clearTimeout(this._friendsSuggestionTimer);
                }
                const requestToken = ++this._friendsSuggestionRequestToken;
                runSearch(searchInput.value.trim(), requestToken);
            }
        };

        suggestionsList.onclick = async (event) => {
            const profileBtn = event.target.closest('.friend-suggestion-profile-btn');
            if (profileBtn) {
                const username = decodeURIComponent(profileBtn.dataset.username || '');
                if (username) navigate(`/user/@${encodeURIComponent(username)}`);
                return;
            }

            const addBtn = event.target.closest('.friend-suggestion-add-btn');
            if (!addBtn) return;

            const username = decodeURIComponent(addBtn.dataset.username || '');
            if (!username) return;

            const row = addBtn.closest('.friend-suggestion-item');
            const rowUid = row?.dataset.uid || '';
            addBtn.disabled = true;
            const originalLabel = addBtn.textContent;
            addBtn.textContent = 'Sending...';

            try {
                await syncManager.sendFriendRequestToUser(username);
                addBlockedTarget(rowUid, username);
                addBtn.classList.remove('btn-primary');
                addBtn.classList.add('btn-secondary');
                addBtn.textContent = 'Requested';
                addBtn.disabled = true;
                statusEl.textContent = `Request sent to @${username}.`;
            } catch (error) {
                console.error('Failed to send friend suggestion request:', error);
                addBtn.textContent = originalLabel || 'Add Friend';
                addBtn.disabled = false;
                statusEl.textContent = error?.message || 'Failed to send request.';
            }
        };

        if (this._friendsSuggestionQuery.trim().length >= 2) {
            const requestToken = ++this._friendsSuggestionRequestToken;
            await runSearch(this._friendsSuggestionQuery, requestToken);
        } else {
            statusEl.textContent = 'Type at least 2 characters to find people.';
            suggestionsList.innerHTML = '';
        }
    }

    async renderFriendsPage(routeParam = '') {
        this.showPage('friends');

        const friendsPage = document.getElementById('page-friends');
        if (friendsPage) {
            friendsPage.classList.add('friends-redesign');
        }

        const toTimestamp = (value) => {
            if (value === null || value === undefined || value === '') return 0;
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            const parsed = Date.parse(String(value));
            return Number.isFinite(parsed) ? parsed : 0;
        };

        const parseStatusPayload = (status) => {
            if (!status || typeof status !== 'string') return null;
            try {
                const parsed = JSON.parse(status);
                if (!parsed || typeof parsed !== 'object') return null;

                const asNumber = (value) => {
                    const n = Number(value);
                    return Number.isFinite(n) ? n : 0;
                };

                return {
                    text: parsed.text ? String(parsed.text) : '',
                    image: parsed.image ? String(parsed.image) : '',
                    link: parsed.link ? String(parsed.link) : '',
                    updatedAt: asNumber(parsed.updatedAt),
                    startedAt: asNumber(parsed.startedAt),
                    expiresAt: asNumber(parsed.expiresAt),
                    durationSec: asNumber(parsed.durationSec),
                };
            } catch (_error) {
                return null;
            }
        };

        const isFreshNowPlaying = (statusPayload, profileUpdatedAtMs) => {
            if (!statusPayload?.text) return false;

            const now = Date.now();
            const updatedAt = statusPayload.updatedAt || 0;
            const startedAt = statusPayload.startedAt || 0;
            const expiresAt = statusPayload.expiresAt || 0;
            const durationSec = statusPayload.durationSec || 0;

            if (expiresAt > 0 && now > expiresAt) return false;
            if (updatedAt > 0 && now - updatedAt > 12 * 60 * 1000) return false;

            if (startedAt > 0 && durationSec > 0) {
                const maxSongSpanMs = Math.max(3 * 60 * 1000, Math.min(durationSec * 1000 * 1.8, 20 * 60 * 1000));
                if (now - startedAt > maxSongSpanMs) return false;
            }

            if (profileUpdatedAtMs > 0 && now - profileUpdatedAtMs > 15 * 60 * 1000) return false;
            return true;
        };

        const formatLastActive = (timestampMs) => {
            if (!timestampMs || !Number.isFinite(timestampMs) || timestampMs <= 0) return 'Inactive';

            const deltaMs = Math.max(0, Date.now() - timestampMs);
            const minuteMs = 60 * 1000;
            const hourMs = 60 * minuteMs;
            const dayMs = 24 * hourMs;

            if (deltaMs < minuteMs) return 'Active just now';
            if (deltaMs < hourMs) return `Active ${Math.max(1, Math.floor(deltaMs / minuteMs))} min ago`;
            if (deltaMs < dayMs) return `Active ${Math.max(1, Math.floor(deltaMs / hourMs))} hr ago`;
            const days = Math.max(1, Math.floor(deltaMs / dayMs));
            return `Active ${days} day${days === 1 ? '' : 's'} ago`;
        };

        const greetingText = document.getElementById('friends-greeting-text');
        const friendsGrid = document.getElementById('friends-grid');
        const noFriendsMessage = document.getElementById('no-friends-message');
        const friendRequestsSection = document.getElementById('friends-requests-section');
        const friendRequestsList = document.getElementById('friend-requests-list');
        const friendRequestsCount = document.getElementById('friend-requests-count');
        const sharedTracksSection = document.getElementById('shared-tracks-section');
        const sharedTracksList = document.getElementById('shared-tracks-list');
        const collabPlaylistsSection = document.getElementById('collab-playlists-section');
        const collabPlaylistsGrid = document.getElementById('collab-playlists-grid');
        const noCollabPlaylistsMessage = document.getElementById('no-collab-playlists-message');

        if (friendsPage) {
            const friendsListSection = document.getElementById('friends-list-section');
            const discoverSection = document.getElementById('friends-discover-section');
            const heroSection = document.getElementById('friends-greeting');

            heroSection?.classList.add('friends-layout-hero');
            friendsListSection?.classList.add('friends-layout-friends');
            friendRequestsSection?.classList.add('friends-layout-requests');
            discoverSection?.classList.add('friends-layout-discover');
            sharedTracksSection?.classList.add('friends-layout-shared');
            collabPlaylistsSection?.classList.add('friends-layout-collab');
        }

        const hour = new Date().getHours();
        let greeting = 'Welcome';
        if (hour >= 5 && hour < 12) greeting = 'Good morning';
        else if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
        else if (hour >= 17 && hour < 21) greeting = 'Good evening';
        else greeting = 'Good night';

        if (greetingText) {
            greetingText.textContent = `${greeting}!`;
        }

        const useCloudSocial = !!authManager.user;

        try {
            const [friends, incomingRequests, outgoingRequests, sharedTracks, collabPlaylists] = useCloudSocial
                ? await Promise.all([
                      syncManager.listFriends(),
                      syncManager.listIncomingFriendRequests(),
                      syncManager.listOutgoingFriendRequests(),
                      db.getSharedTracks(),
                      db.getCollaborativePlaylists(),
                  ])
                : await Promise.all([
                      db.getFriends(),
                      db.getIncomingFriendRequests(),
                      db
                          .getFriendRequests()
                          .then((requests) =>
                              requests.filter((request) => request.outgoing && request.status === 'pending')
                          ),
                      db.getSharedTracks(),
                      db.getCollaborativePlaylists(),
                  ]);

            const hero = document.getElementById('friends-greeting');
            if (hero) {
                let stats = document.getElementById('friends-hero-stats');
                if (!stats) {
                    stats = document.createElement('div');
                    stats.id = 'friends-hero-stats';
                    stats.className = 'friends-hero-stats';
                    hero.appendChild(stats);
                }
                const incomingCount = incomingRequests?.length || 0;
                const sharedCount = sharedTracks?.length || 0;
                const collabCount = collabPlaylists?.length || 0;
                stats.innerHTML = `
                    <div class="friends-hero-stat"><span class="value">${friends.length}</span><span class="label">Friends</span></div>
                    <div class="friends-hero-stat"><span class="value">${incomingCount}</span><span class="label">Incoming</span></div>
                    <div class="friends-hero-stat"><span class="value">${sharedCount}</span><span class="label">Shared</span></div>
                    <div class="friends-hero-stat"><span class="value">${collabCount}</span><span class="label">Collabs</span></div>
                `;
            }

            // Enrich friends with status from their profiles
            if (useCloudSocial && friends.length > 0) {
                await Promise.allSettled(
                    friends.map(async (friend) => {
                        try {
                            const profile = await syncManager.getProfile(friend.username);
                            if (profile?.status) friend.status = profile.status;
                            if (profile?.avatar_url) friend.avatarUrl = profile.avatar_url;
                            friend.profileUpdatedAt = toTimestamp(profile?.$updatedAt || profile?.updated_at || 0);
                        } catch (_error) {
                            // Ignore per-profile lookup failures and keep rendering available friend data.
                        }
                    })
                );
            }

            if (friends && friends.length > 0) {
                friendsGrid.innerHTML = friends
                    .map((friend) => {
                        const username = friend.username || '';
                        const safeDisplayName = escapeHtml(friend.displayName || username || 'Friend');
                        const safeUsername = escapeHtml(username);
                        const statusPayload = parseStatusPayload(friend.status);
                        const profileUpdatedAtMs = toTimestamp(friend.profileUpdatedAt || 0);
                        const hasFreshNowPlaying = isFreshNowPlaying(statusPayload, profileUpdatedAtMs);
                        const rawStatusText =
                            statusPayload?.text || (hasFreshNowPlaying ? getDisplayStatusText(friend.status) : '');
                        const safeStatus = rawStatusText ? escapeHtml(rawStatusText) : '';
                        const hasLastTrack = Boolean(statusPayload?.text);
                        const lastActiveAtMs = Math.max(
                            profileUpdatedAtMs,
                            toTimestamp(statusPayload?.updatedAt || 0),
                            toTimestamp(friend.updatedAt || 0),
                            toTimestamp(friend.addedAt || 0)
                        );
                        const lastActiveText = escapeHtml(formatLastActive(lastActiveAtMs));
                        return `
                            <div class="friend-card" data-uid="${friend.uid}" data-username="${safeUsername}">
                                <div class="friend-row-shell">
                                    <div class="friend-avatar friend-avatar-lg">
                                        <img src="${friend.avatarUrl || '/assets/appicon.png'}" alt="${safeDisplayName}" loading="lazy" onerror="this.onerror=null;this.src='/assets/appicon.png';">
                                    </div>
                                    <div class="friend-card-body">
                                        <div class="friend-card-top">
                                            <div class="friend-name">${safeDisplayName}</div>
                                            <span class="friend-presence-pill ${hasFreshNowPlaying ? 'active' : 'inactive'}">${hasFreshNowPlaying ? 'Listening' : 'Idle'}</span>
                                        </div>
                                        <div class="friend-username">@${safeUsername}</div>
                                        ${
                                            hasFreshNowPlaying
                                                ? `<div class="friend-status-track"><span class="friend-status-dot"></span><span class="friend-status-text">${safeStatus}</span></div>`
                                                : `${hasLastTrack ? `<div class="friend-status-track friend-last-track">Last played: ${safeStatus}</div>` : ''}<div class="friend-last-active">${lastActiveText}</div>`
                                        }
                                    </div>
                                    <div class="friend-card-actions">
                                        <button class="btn-secondary friend-open-profile-btn" data-username="${safeUsername}">Profile</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    })
                    .join('');
                if (noFriendsMessage) noFriendsMessage.style.display = 'none';
            } else {
                friendsGrid.innerHTML = '';
                if (noFriendsMessage) noFriendsMessage.style.display = 'block';
            }

            const hasIncoming = incomingRequests && incomingRequests.length > 0;
            const hasOutgoing = outgoingRequests && outgoingRequests.length > 0;
            if (hasIncoming || hasOutgoing) {
                friendRequestsSection.style.display = 'block';
                friendRequestsCount.style.display = hasIncoming ? 'inline' : 'none';
                friendRequestsCount.textContent = hasIncoming ? incomingRequests.length : '0';

                const incomingHTML = hasIncoming
                    ? incomingRequests
                          .map(
                              (request) => `
                            <div class="friend-request-item incoming" data-uid="${request.uid}">
                                <div class="friend-request-shell">
                                    <div class="friend-request-avatar">
                                        <img src="${request.avatarUrl || '/assets/appicon.png'}" alt="${escapeHtml(request.displayName || request.username || 'User')}" loading="lazy" onerror="this.onerror=null;this.src='/assets/appicon.png';">
                                    </div>
                                    <div class="friend-request-info">
                                        <div class="friend-request-type">Incoming Request</div>
                                        <div class="friend-request-name">${escapeHtml(request.displayName || request.username || 'User')}</div>
                                        <div class="friend-request-username">@${escapeHtml(request.username || '')}</div>
                                    </div>
                                    <div class="friend-request-actions">
                                        <button class="btn-primary accept-friend-btn" data-request-id="${request.requestId || ''}" data-uid="${request.uid}">Accept</button>
                                        <button class="btn-secondary reject-friend-btn" data-request-id="${request.requestId || ''}" data-uid="${request.uid}">Reject</button>
                                    </div>
                                </div>
                            </div>
                        `
                          )
                          .join('')
                    : '';

                const outgoingHTML = hasOutgoing
                    ? `
                        <div class="friend-requests-subtitle">Outgoing Requests</div>
                        ${outgoingRequests
                            .map(
                                (request) => `
                            <div class="friend-request-item pending outgoing" data-uid="${request.uid}">
                                <div class="friend-request-shell">
                                    <div class="friend-request-avatar">
                                        <img src="${request.avatarUrl || '/assets/appicon.png'}" alt="${escapeHtml(request.displayName || request.username || 'User')}" loading="lazy" onerror="this.onerror=null;this.src='/assets/appicon.png';">
                                    </div>
                                    <div class="friend-request-info">
                                        <div class="friend-request-type">Outgoing Request</div>
                                        <div class="friend-request-name">${escapeHtml(request.displayName || request.username || 'User')}</div>
                                        <div class="friend-request-username">@${escapeHtml(request.username || '')}</div>
                                    </div>
                                    <div class="friend-request-actions">
                                        <button class="btn-secondary cancel-friend-btn" data-request-id="${request.requestId || ''}" data-uid="${request.uid}">Cancel</button>
                                    </div>
                                </div>
                            </div>
                        `
                            )
                            .join('')}
                    `
                    : '';

                friendRequestsList.innerHTML = incomingHTML + outgoingHTML;
            } else {
                friendRequestsSection.style.display = 'none';
                friendRequestsList.innerHTML = '';
            }

            await this.renderFriendSuggestionsSection({
                friends,
                incomingRequests,
                outgoingRequests,
                useCloudSocial,
            });

            if (sharedTracks && sharedTracks.length > 0) {
                sharedTracksSection.style.display = 'block';
                const tempContainer = document.createElement('div');
                this.renderListWithTracks(
                    tempContainer,
                    sharedTracks.map((shared) => shared.track).filter((track) => track && typeof track === 'object'),
                    true
                );
                sharedTracksList.innerHTML = tempContainer.innerHTML;
            } else {
                sharedTracksSection.style.display = 'none';
            }

            if (collabPlaylists && collabPlaylists.length > 0) {
                collabPlaylistsSection.style.display = 'block';
                collabPlaylistsGrid.innerHTML = collabPlaylists
                    .map((playlist) => {
                        const trackCount = playlist.tracks?.length || 0;
                        const memberCount = playlist.members?.length || 0;
                        const totalDuration = calculateTotalDuration(playlist.tracks || []);
                        const durationLabel = totalDuration ? formatDuration(totalDuration) : 'Duration pending';
                        return `
                            <article class="collab-playlist-card" data-id="${playlist.id}">
                                <div class="collab-playlist-media">
                                    <img src="${playlist.cover || '/assets/appicon.png'}" alt="${escapeHtml(playlist.name)}" class="collab-playlist-cover" loading="lazy">
                                    <button class="card-play-btn collab-play-btn" title="Play">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                            <polygon points="7 3 21 12 7 21 7 3"></polygon>
                                        </svg>
                                    </button>
                                </div>
                                <div class="collab-playlist-content">
                                    <div class="collab-playlist-title">${escapeHtml(playlist.name)}</div>
                                    <div class="collab-playlist-meta-row">
                                        <span class="collab-playlist-chip">${trackCount} tracks</span>
                                        <span class="collab-playlist-chip">${memberCount} members</span>
                                        <span class="collab-playlist-chip">${escapeHtml(durationLabel)}</span>
                                    </div>
                                    <div class="collab-playlist-subtitle">Built for shared listening sessions</div>
                                </div>
                                <div class="collab-playlist-chevron" aria-hidden="true">Open</div>
                            </article>
                        `;
                    })
                    .join('');

                // Add play button handlers for collab playlist cards
                collabPlaylistsGrid.querySelectorAll('.collab-playlist-card').forEach((card, index) => {
                    const playBtn = card.querySelector('.card-play-btn');
                    if (playBtn) {
                        playBtn.onclick = (e) => {
                            e.stopPropagation();
                            const playlist = collabPlaylists[index];
                            const tracks = playlist.tracks || [];
                            if (tracks.length > 0 && window.monochromePlayer) {
                                window.monochromePlayer.setQueue(tracks, 0);
                                window.monochromePlayer.playTrackFromQueue();
                            }
                        };
                    }
                });

                if (noCollabPlaylistsMessage) noCollabPlaylistsMessage.style.display = 'none';
            } else {
                collabPlaylistsGrid.innerHTML = '';
                if (noCollabPlaylistsMessage) noCollabPlaylistsMessage.style.display = 'block';
            }

            this.setupFriendsPageEventListeners({ useCloudSocial });

            if (!this._friendsRealtimeBound) {
                this._friendsRealtimeBound = true;
                this._friendsRealtimeHandler = () => {
                    if (window.location.pathname.startsWith('/friends')) {
                        this.renderFriendsPage(this._getFriendsRouteParam());
                    }
                };
                window.addEventListener('pb-friend-request-updated', this._friendsRealtimeHandler);
                window.addEventListener('pb-friend-updated', this._friendsRealtimeHandler);
                window.addEventListener('pb-collab-playlist-updated', this._friendsRealtimeHandler);
                window.addEventListener('library-changed', this._friendsRealtimeHandler);
            }
        } catch (error) {
            console.error('Failed to load friends page:', error);
        }
    }

    setupFriendsPageEventListeners({ useCloudSocial = !!authManager.user } = {}) {
        const rerender = () => this.renderFriendsPage(this._getFriendsRouteParam());
        const friendsPage = document.getElementById('page-friends');

        const addFriendBtn = document.getElementById('add-friend-btn');
        const addFriendModal = document.getElementById('add-friend-modal');
        const cancelAddFriendBtn = document.getElementById('cancel-add-friend-btn');
        const confirmAddFriendBtn = document.getElementById('confirm-add-friend-btn');
        const addFriendUsername = document.getElementById('add-friend-username');

        if (addFriendBtn && addFriendModal) {
            addFriendBtn.onclick = () => addFriendModal.classList.add('active');
            if (cancelAddFriendBtn) {
                cancelAddFriendBtn.onclick = () => addFriendModal.classList.remove('active');
            }
            const modalOverlay = addFriendModal.querySelector('.modal-overlay');
            if (modalOverlay) {
                modalOverlay.onclick = () => addFriendModal.classList.remove('active');
            }

            if (confirmAddFriendBtn) {
                confirmAddFriendBtn.onclick = async () => {
                    const username = addFriendUsername?.value?.trim();
                    if (!username) {
                        alert('Please enter a username');
                        return;
                    }

                    try {
                        if (useCloudSocial) {
                            await syncManager.sendFriendRequestToUser(username);
                        } else {
                            await db.sendFriendRequest({
                                uid: crypto.randomUUID(),
                                username,
                                displayName: username,
                            });
                        }
                        addFriendModal.classList.remove('active');
                        if (addFriendUsername) addFriendUsername.value = '';
                        rerender();
                    } catch (error) {
                        console.error('Failed to send friend request:', error);
                        alert(error?.message || 'Failed to send friend request.');
                    }
                };
            }
        }

        if (!friendsPage) return;

        friendsPage.querySelectorAll('.accept-friend-btn').forEach((btn) => {
            btn.onclick = async () => {
                try {
                    if (useCloudSocial && btn.dataset.requestId) {
                        await syncManager.acceptFriendRequest(btn.dataset.requestId);
                    } else {
                        await db.acceptFriendRequest(btn.dataset.uid);
                    }
                    rerender();
                } catch (error) {
                    console.error('Failed to accept friend request:', error);
                }
            };
        });

        friendsPage.querySelectorAll('.reject-friend-btn').forEach((btn) => {
            btn.onclick = async () => {
                try {
                    if (useCloudSocial && btn.dataset.requestId) {
                        await syncManager.rejectFriendRequest(btn.dataset.requestId);
                    } else {
                        await db.rejectFriendRequest(btn.dataset.uid);
                    }
                    rerender();
                } catch (error) {
                    console.error('Failed to reject friend request:', error);
                }
            };
        });

        friendsPage.querySelectorAll('.cancel-friend-btn').forEach((btn) => {
            btn.onclick = async () => {
                try {
                    if (useCloudSocial && btn.dataset.requestId) {
                        await syncManager.cancelFriendRequest(btn.dataset.requestId);
                    } else {
                        await db.cancelFriendRequest(btn.dataset.uid);
                    }
                    rerender();
                } catch (error) {
                    console.error('Failed to cancel friend request:', error);
                }
            };
        });

        friendsPage.querySelectorAll('.friend-open-profile-btn').forEach((btn) => {
            btn.onclick = (event) => {
                event.stopPropagation();
                const username = btn.dataset.username;
                if (username) {
                    navigate(`/user/@${encodeURIComponent(username)}`);
                }
            };
        });

        friendsPage.querySelectorAll('.friend-card').forEach((card) => {
            card.onclick = () => {
                const username = card.dataset.username;
                if (username) {
                    navigate(`/user/@${encodeURIComponent(username)}`);
                }
            };
        });

        const createCollabBtn = document.getElementById('create-collab-playlist-btn');
        const createCollabModal = document.getElementById('create-collab-playlist-modal');
        const cancelCollabBtn = document.getElementById('cancel-collab-playlist-btn');
        const confirmCollabBtn = document.getElementById('confirm-collab-playlist-btn');
        const collabPlaylistName = document.getElementById('collab-playlist-name');

        if (createCollabBtn && createCollabModal) {
            createCollabBtn.onclick = async () => {
                const friendsSelect = document.getElementById('collab-friends-select');
                const friends = useCloudSocial ? await syncManager.listFriends() : await db.getFriends();

                if (friendsSelect) {
                    if (friends && friends.length > 0) {
                        friendsSelect.innerHTML = friends
                            .map(
                                (friend) => `
                                <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; cursor: pointer;">
                                    <input type="checkbox" value="${friend.uid}" name="collab-friends">
                                    <img src="${friend.avatarUrl || '/assets/appicon.png'}" style="width: 24px; height: 24px; border-radius: 50%;" onerror="this.onerror=null;this.src='/assets/appicon.png';">
                                    <span>${escapeHtml(friend.displayName || friend.username || 'Friend')}</span>
                                </label>
                            `
                            )
                            .join('');
                    } else {
                        friendsSelect.innerHTML =
                            '<p style="color: var(--muted-foreground); text-align: center; padding: 1rem">Add friends first to invite them</p>';
                    }
                }

                createCollabModal.classList.add('active');
            };

            if (cancelCollabBtn) {
                cancelCollabBtn.onclick = () => createCollabModal.classList.remove('active');
            }

            const collabOverlay = createCollabModal.querySelector('.modal-overlay');
            if (collabOverlay) {
                collabOverlay.onclick = () => createCollabModal.classList.remove('active');
            }

            if (confirmCollabBtn) {
                confirmCollabBtn.onclick = async () => {
                    const name = collabPlaylistName?.value?.trim();
                    if (!name) {
                        alert('Please enter a playlist name');
                        return;
                    }

                    const selectedFriends = Array.from(
                        document.querySelectorAll('input[name="collab-friends"]:checked')
                    ).map((checkbox) => checkbox.value);

                    try {
                        await db.createCollaborativePlaylist(name, selectedFriends);
                        createCollabModal.classList.remove('active');
                        if (collabPlaylistName) collabPlaylistName.value = '';
                        rerender();
                    } catch (error) {
                        console.error('Failed to create collaborative playlist:', error);
                    }
                };
            }
        }

        friendsPage.querySelectorAll('.collab-playlist-card').forEach((card) => {
            card.onclick = () => {
                const playlistId = card.dataset.id;
                if (playlistId) {
                    navigate(`/collabplaylist/${playlistId}`);
                }
            };
        });
    }

    async renderCollabPlaylistPage(playlistId) {
        this.showPage('collabplaylist');

        if (this._collabRealtimeHandler) {
            window.removeEventListener('pb-collab-playlist-updated', this._collabRealtimeHandler);
            window.removeEventListener('library-changed', this._collabRealtimeHandler);
        }
        this._activeCollabPlaylistId = String(playlistId || '');
        this._collabRealtimeHandler = (event) => {
            const isCollabRoute = window.location.pathname.startsWith('/collabplaylist/');
            if (!isCollabRoute || !this._activeCollabPlaylistId) return;

            const updatedId = String(event?.detail?.playlistId || this._activeCollabPlaylistId);
            if (updatedId !== this._activeCollabPlaylistId) return;

            this.renderCollabPlaylistPage(this._activeCollabPlaylistId);
        };
        window.addEventListener('pb-collab-playlist-updated', this._collabRealtimeHandler);
        window.addEventListener('library-changed', this._collabRealtimeHandler);

        const imageEl = document.getElementById('collab-playlist-image');
        const collageEl = document.getElementById('collab-playlist-collage');
        const titleEl = document.getElementById('collab-playlist-title');
        const metaEl = document.getElementById('collab-playlist-meta');
        const descEl = document.getElementById('collab-playlist-description');
        const tracksContainer = document.getElementById('collab-playlist-tracks');
        const emptyEl = document.getElementById('collab-playlist-empty');
        const playBtn = document.getElementById('collab-play-btn');
        const shuffleBtn = document.getElementById('collab-shuffle-btn');
        const editBtn = document.getElementById('collab-edit-btn');
        const deleteBtn = document.getElementById('collab-delete-btn');
        const editModal = document.getElementById('edit-collab-playlist-modal');
        const editModalOverlay = editModal?.querySelector('.modal-overlay');
        const editNameInput = document.getElementById('edit-collab-playlist-name');
        const editDescriptionInput = document.getElementById('edit-collab-playlist-description');
        const editCoverInput = document.getElementById('edit-collab-playlist-cover');
        const saveEditBtn = document.getElementById('save-edit-collab-playlist-btn');
        const cancelEditBtn = document.getElementById('cancel-edit-collab-playlist-btn');
        const deleteInPanelBtn = document.getElementById('delete-collab-playlist-in-panel-btn');

        const openEditPanel = () => {
            if (!editModal) return;
            if (editNameInput) editNameInput.value = playlist.name || '';
            if (editDescriptionInput) editDescriptionInput.value = playlist.description || '';
            if (editCoverInput) editCoverInput.value = playlist.cover || '';
            if (deleteInPanelBtn) {
                deleteInPanelBtn.dataset.armed = 'false';
                deleteInPanelBtn.textContent = 'Delete';
            }
            editModal.classList.add('active');
            editNameInput?.focus();
        };

        const closeEditPanel = () => {
            if (!editModal) return;
            editModal.classList.remove('active');
            if (deleteInPanelBtn) {
                deleteInPanelBtn.dataset.armed = 'false';
                deleteInPanelBtn.textContent = 'Delete';
            }
        };

        // Set loading state
        if (imageEl) {
            imageEl.src = '';
            imageEl.style.backgroundColor = 'var(--muted)';
        }
        if (titleEl)
            titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        if (metaEl)
            metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        if (descEl) descEl.textContent = '';
        if (tracksContainer) tracksContainer.innerHTML = '';

        const playlist = await db.getCollaborativePlaylist(playlistId);
        if (!playlist) {
            if (titleEl) titleEl.textContent = 'Playlist not found';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }

        // Set title and adjust font size like regular playlists
        if (titleEl) {
            titleEl.textContent = playlist.name;
            titleEl.className = 'playlist-hero-title';
            this.adjustTitleFontSize(titleEl, playlist.name);
        }

        // Set meta information
        const tracks = playlist.tracks || [];
        const totalDuration = calculateTotalDuration(tracks);
        if (metaEl) {
            metaEl.textContent = `${tracks.length} tracks • ${formatDuration(totalDuration)} • ${playlist.members?.length || 0} members`;
        }

        // Set description if available, otherwise show creation info
        if (descEl) {
            if (playlist.description) {
                descEl.textContent = playlist.description;
                descEl.style.display = '';
            } else {
                const createdDate = playlist.createdAt ? new Date(playlist.createdAt).toLocaleDateString() : 'Unknown';
                descEl.textContent = `Created on ${createdDate} • Collaborative playlist with ${playlist.members?.length || 0} members`;
                descEl.style.display = '';
            }
        }

        // Handle cover image or collage
        if (playlist.cover) {
            if (imageEl) {
                imageEl.src = playlist.cover;
                imageEl.style.display = 'block';
            }
            if (collageEl) collageEl.style.display = 'none';
            const preferredVisualUrl = this.getEntityVisualUrl(playlist, playlist.cover);
            this.setPageBackground(preferredVisualUrl || playlist.cover, playlist.cover);
            if (!this.applyApiVibrantColor(playlist.vibrantColor)) {
                this.extractAndApplyColor(playlist.cover);
            }
        } else {
            // Create collage from track covers
            const tracksWithCovers = tracks.filter((t) => t.album && t.album.cover);
            const uniqueCovers = [];
            const seen = new Set();
            for (const t of tracksWithCovers) {
                if (!seen.has(t.album.cover)) {
                    seen.add(t.album.cover);
                    uniqueCovers.push(t.album.cover);
                    if (uniqueCovers.length >= 4) break;
                }
            }

            if (uniqueCovers.length > 0 && collageEl) {
                if (imageEl) imageEl.style.display = 'none';
                collageEl.style.display = 'grid';
                collageEl.className = 'playlist-hero-collage';
                collageEl.innerHTML = '';
                const imagesToRender = [];
                for (let i = 0; i < 4; i++) {
                    imagesToRender.push(uniqueCovers[i % uniqueCovers.length]);
                }
                imagesToRender.forEach((cover) => {
                    const img = document.createElement('img');
                    img.src = this.api.getCoverUrl(cover);
                    collageEl.appendChild(img);
                });
            } else {
                if (imageEl) {
                    imageEl.src = '/assets/appicon.png';
                    imageEl.style.display = 'block';
                }
                if (collageEl) collageEl.style.display = 'none';
            }
            this.setPageBackground(null);
            this.resetVibrantColor();
        }

        // Render tracks
        if (tracks.length > 0) {
            if (emptyEl) emptyEl.style.display = 'none';
            tracksContainer.innerHTML = `
                <div class="track-list-header">
                    <span style="width: 40px; text-align: center;">#</span>
                    <span>Title</span>
                    <span class="duration-header">Duration</span>
                    <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                </div>
            `;
            this.renderListWithTracks(tracksContainer, tracks, true);

            // Add is-editable class to fix grid layout for remove buttons
            tracksContainer.classList.add('is-editable');

            // Add remove buttons to each track
            tracksContainer.querySelectorAll('.track-item').forEach((item, index) => {
                const track = tracks[index] || null;
                const addedAtLabel = track?.addedAt ? new Date(track.addedAt).toLocaleDateString() : null;
                const addedByLabel = String(track?.addedByName || '').trim() || 'Unknown';

                const artistLine = item.querySelector('.track-item-details .artist');
                if (artistLine && (addedAtLabel || addedByLabel)) {
                    const collabMeta = document.createElement('span');
                    collabMeta.className = 'track-collab-meta';
                    collabMeta.textContent = addedAtLabel
                        ? ` • Added ${addedAtLabel} by ${addedByLabel}`
                        : ` • Added by ${addedByLabel}`;
                    artistLine.appendChild(collabMeta);
                }

                const removeBtn = document.createElement('button');
                removeBtn.className = 'track-action-btn remove-from-playlist-btn';
                removeBtn.title = 'Remove from playlist';
                removeBtn.innerHTML =
                    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

                const trackId = item.dataset.trackId;
                removeBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (trackId) {
                        await db.removeTrackFromCollaborativePlaylist(playlistId, trackId);
                        this.renderCollabPlaylistPage(playlistId);
                    }
                };

                const actionsEl = item.querySelector('.track-item-actions');
                if (actionsEl) {
                    const menuBtn = actionsEl.querySelector('.track-menu-btn');
                    if (menuBtn) {
                        actionsEl.insertBefore(removeBtn, menuBtn);
                    } else {
                        actionsEl.appendChild(removeBtn);
                    }
                }
            });
        } else {
            if (emptyEl) emptyEl.style.display = 'block';
        }

        // Button handlers
        if (playBtn) {
            playBtn.onclick = () => {
                if (tracks.length > 0 && window.monochromePlayer) {
                    window.monochromePlayer.setQueue(tracks, 0);
                    window.monochromePlayer.playTrackFromQueue();
                }
            };
        }

        if (shuffleBtn) {
            shuffleBtn.onclick = () => {
                if (tracks.length > 0 && window.monochromePlayer) {
                    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
                    window.monochromePlayer.setQueue(shuffled, 0);
                    window.monochromePlayer.playTrackFromQueue();
                }
            };
        }

        if (editBtn) {
            editBtn.onclick = async () => {
                openEditPanel();
            };
        }

        if (cancelEditBtn) {
            cancelEditBtn.onclick = () => closeEditPanel();
        }

        if (editModalOverlay) {
            editModalOverlay.onclick = () => closeEditPanel();
        }

        if (saveEditBtn) {
            saveEditBtn.onclick = async () => {
                const trimmedName = String(editNameInput?.value || '').trim();
                if (!trimmedName) {
                    showNotification('Playlist name is required');
                    editNameInput?.focus();
                    return;
                }

                try {
                    await db.updateCollaborativePlaylist({
                        ...playlist,
                        name: trimmedName,
                        description: String(editDescriptionInput?.value || '').trim(),
                        cover: String(editCoverInput?.value || '').trim(),
                    });
                    closeEditPanel();
                    showNotification('Collaborative playlist updated');
                    this.renderCollabPlaylistPage(playlistId);
                    this.renderFriendsPage(this._getFriendsRouteParam());
                } catch (error) {
                    console.error('Failed to update collaborative playlist:', error);
                    showNotification('Failed to update playlist');
                }
            };
        }

        if (deleteInPanelBtn) {
            deleteInPanelBtn.onclick = async () => {
                const armed = deleteInPanelBtn.dataset.armed === 'true';
                if (!armed) {
                    deleteInPanelBtn.dataset.armed = 'true';
                    deleteInPanelBtn.textContent = 'Confirm Delete';
                    return;
                }

                try {
                    await db.deleteCollaborativePlaylist(playlistId);
                    closeEditPanel();
                    showNotification('Collaborative playlist deleted');
                    navigate('/friends');
                } catch (error) {
                    console.error('Failed to delete collaborative playlist:', error);
                    showNotification('Failed to delete playlist');
                }
            };
        }

        if (deleteBtn) {
            deleteBtn.onclick = () => {
                openEditPanel();
                if (deleteInPanelBtn) {
                    deleteInPanelBtn.dataset.armed = 'true';
                    deleteInPanelBtn.textContent = 'Confirm Delete';
                }
            };
        }
    }

    async renderUnreleasedPage() {
        this.showPage('unreleased');
        const container = document.getElementById('unreleased-content');
        await renderUnreleasedTrackerPage(container);
    }

    async renderTrackerArtistPage(sheetId) {
        this.showPage('tracker-artist');
        const container = document.getElementById('tracker-artist-projects-container');
        await renderTrackerArtistContent(sheetId, container);
    }

    async renderTrackerProjectPage(sheetId, projectName) {
        this.showPage('album'); // Use album page template
        const container = document.getElementById('album-detail-tracklist');
        await renderTrackerProjectContent(sheetId, projectName, container, this);
    }

    async renderTrackerTrackPage(trackId) {
        this.showPage('album'); // Use album page template
        const container = document.getElementById('album-detail-tracklist');
        await renderTrackerTrackContent(trackId, container, this);
    }

    updatePlaylistHeaderActions(playlist, isOwned, tracks, showShare = false, onSort = null, getCurrentSort = null) {
        // Get button references
        const shuffleBtn = document.getElementById('shuffle-playlist-btn');
        const sortBtn = document.getElementById('sort-playlist-btn');
        const editBtn = document.getElementById('edit-playlist-btn');
        const deleteBtn = document.getElementById('delete-playlist-btn');
        const shareBtn = document.getElementById('share-playlist-btn');

        // Shuffle button - always show and attach handler
        if (shuffleBtn) {
            shuffleBtn.style.display = '';
            shuffleBtn.onclick = () => {
                const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
                this.player.setQueue(shuffledTracks, 0);
                this.player.playTrackFromQueue();
                recentActivityManager.addPlaylist(playlist);
            };
        }

        // Sort button - show if onSort is provided
        if (sortBtn) {
            if (onSort) {
                sortBtn.style.display = '';
                sortBtn.onclick = (e) => {
                    e.stopPropagation();
                    const menu = document.getElementById('sort-menu');

                    // Show "Date Added" options only if tracks have addedAt
                    const hasAddedDate = tracks.some((t) => t.addedAt);
                    menu.querySelectorAll('.requires-added-date').forEach((opt) => {
                        opt.style.display = hasAddedDate ? '' : 'none';
                    });

                    // Highlight current sort option
                    const currentSortType = getCurrentSort ? getCurrentSort() : 'custom';
                    menu.querySelectorAll('li').forEach((opt) => {
                        opt.classList.toggle('sort-active', opt.dataset.sort === currentSortType);
                    });

                    const rect = sortBtn.getBoundingClientRect();
                    menu.style.top = `${rect.bottom + 5}px`;
                    menu.style.left = `${rect.left}px`;
                    menu.style.display = 'block';

                    const closeMenu = () => {
                        menu.style.display = 'none';
                        document.removeEventListener('click', closeMenu);
                    };

                    const handleSort = (ev) => {
                        const li = ev.target.closest('li');
                        if (li && li.dataset.sort) {
                            onSort(li.dataset.sort);
                            closeMenu();
                        }
                    };

                    menu.onclick = handleSort;

                    setTimeout(() => document.addEventListener('click', closeMenu), 0);
                };
            } else {
                sortBtn.style.display = 'none';
            }
        }

        // Edit/Delete buttons - show only if owned
        if (editBtn) {
            editBtn.style.display = isOwned ? '' : 'none';
        }
        if (deleteBtn) {
            deleteBtn.style.display = isOwned ? '' : 'none';
        }

        // Share button - show if public or showShare is true
        if (shareBtn) {
            if (showShare || (isOwned && playlist.isPublic)) {
                shareBtn.style.display = '';
                shareBtn.onclick = () => {
                    const url = getShareUrl(`/userplaylist/${playlist.id || playlist.uuid}`);
                    copyTextToClipboard(url).then((copied) => {
                        if (!copied) {
                            alert('Could not copy link on this browser.');
                            return;
                        }
                        alert('Link copied to clipboard!');
                    });
                };
            } else {
                shareBtn.style.display = 'none';
            }
        }
    }

    enableTrackReordering(container, tracks, playlistId, syncManager) {
        // Clone to remove old listeners
        const newContainer = container.cloneNode(true);
        if (container.parentNode) {
            container.parentNode.replaceChild(newContainer, container);
        }
        container = newContainer;

        let draggedElement = null;
        let draggedIndex = -1;
        let trackItems = Array.from(container.querySelectorAll('.track-item'));

        trackItems.forEach((item, index) => {
            // Re-bind data to cloned elements
            if (tracks[index]) {
                trackDataStore.set(item, tracks[index]);
            }
            item.draggable = true;
            item.dataset.index = index;
        });

        const dragStart = (e) => {
            draggedElement = e.target.closest('.track-item');
            if (!draggedElement) return;

            draggedIndex = parseInt(draggedElement.dataset.index);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedIndex);
            draggedElement.classList.add('dragging');
        };

        const dragEnd = () => {
            if (draggedElement) {
                draggedElement.classList.remove('dragging');
                draggedElement = null;
            }
        };

        const dragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (!draggedElement) return;

            const afterElement = getDragAfterElement(container, e.clientY);
            if (afterElement === draggedElement) return;

            if (afterElement) {
                container.insertBefore(draggedElement, afterElement);
            } else {
                container.appendChild(draggedElement);
            }
        };

        const drop = async (e) => {
            e.preventDefault();

            if (!draggedElement) return;

            try {
                // Get new order from DOM
                const newTrackItems = Array.from(container.querySelectorAll('.track-item'));
                const newTracks = newTrackItems.map((item) => {
                    const originalIndex = parseInt(item.dataset.index);
                    return tracks[originalIndex];
                });

                newTrackItems.forEach((item, index) => {
                    item.dataset.index = index;
                });

                tracks.splice(0, tracks.length, ...newTracks);

                // Save to DB
                const updatedPlaylist = await db.updatePlaylistTracks(playlistId, newTracks);
                syncManager.syncUserPlaylist(updatedPlaylist, 'update');

                draggedElement = null;
                draggedIndex = -1;
            } catch (error) {
                console.error('Error updating playlist tracks:', error);
                if (draggedElement) {
                    draggedElement.classList.remove('dragging');
                    draggedElement = null;
                }
                draggedIndex = -1;
            }
        };

        container.addEventListener('dragstart', dragStart);
        container.addEventListener('dragend', dragEnd);
        container.addEventListener('dragover', dragOver);
        container.addEventListener('drop', drop);

        // Cache function to avoid recreating
        function getDragAfterElement(container, y) {
            const draggableElements = [...container.querySelectorAll('.track-item:not(.dragging)')];

            return draggableElements.reduce(
                (closest, child) => {
                    const box = child.getBoundingClientRect();
                    const offset = y - box.top - box.height / 2;
                    if (offset < 0 && offset > closest.offset) {
                        return { offset: offset, element: child };
                    } else {
                        return closest;
                    }
                },
                { offset: Number.NEGATIVE_INFINITY }
            ).element;
        }
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.track-item:not(.dragging)')];

        return draggableElements.reduce(
            (closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            },
            { offset: Number.NEGATIVE_INFINITY }
        ).element;
    }

    renderAddonSettings() {
        const container = document.getElementById('addon-info');
        if (!container) return;

        const actions = document.getElementById('addon-actions');
        const status = document.getElementById('addon-status');
        if (status) {
            status.hidden = true;
            status.className = 'addon-status';
        }

        const addon = eclipseAddonStorage.getAddon();
        if (!addon) {
            container.innerHTML = `
                <div class="addon-empty-state">
                    <div class="addon-empty-icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M9 4a2 2 0 1 1 4 0v2h4a1 1 0 0 1 1 1v4h2a2 2 0 1 1 0 4h-2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 1 0-4 0v2H5a1 1 0 0 1-1-1v-4h2a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1h4V4z"/>
                        </svg>
                    </div>
                    <h4 class="addon-empty-title">No addon installed</h4>
                    <p class="addon-empty-text">Search, streaming and catalog are powered by an Eclipse addon. Paste an addon URL below to get started.</p>
                </div>
            `;
            if (actions) actions.hidden = true;
            return;
        }

        const manifest = addon.manifest || {};
        const resources = Array.isArray(manifest.resources)
            ? manifest.resources.map((resource) => `<span class="addon-badge">${escapeHtml(resource)}</span>`).join('')
            : '';
        const icon = manifest.icon
            ? `<img class="addon-card-icon" src="${escapeHtml(manifest.icon)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
            : '';

        container.innerHTML = `
            <div class="addon-card">
                ${icon}
                <div class="addon-card-body">
                    <div class="addon-card-title">
                        ${escapeHtml(manifest.name || 'Eclipse Addon')}
                        <span class="addon-card-version">v${escapeHtml(manifest.version || '?')}</span>
                    </div>
                    ${
                        manifest.description
                            ? `<div class="addon-card-desc">${escapeHtml(manifest.description)}</div>`
                            : ''
                    }
                    <div class="addon-card-url">${escapeHtml(addon.baseUrl)}</div>
                    ${resources ? `<div class="addon-card-badges">${resources}</div>` : ''}
                </div>
            </div>
        `;
        if (actions) actions.hidden = false;
    }

    renderCacheStats() {
        const cacheInfo = document.getElementById('cache-info');
        if (!cacheInfo) return;
        const stats = this.api.getCacheStats();
        cacheInfo.textContent = `Cache: ${stats.memoryEntries}/${stats.maxSize} entries • ${stats.streamUrls} stream URLs`;
    }

    async renderTrackPage(trackId, provider = null) {
        this.showPage('track');

        // Keep sidebar collapsed/expanded state from user settings instead of forcing collapse.
        // This prevents a compressed UI when navigating directly to a track.
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            // Do not override; the toggle state is managed globally by sidebarSettings.restoreState and user interactions.
        }

        const imageEl = document.getElementById('track-detail-image');
        const titleEl = document.getElementById('track-detail-title');
        const artistEl = document.getElementById('track-detail-artist');
        const albumEl = document.getElementById('track-detail-album');
        const yearEl = document.getElementById('track-detail-year');
        const albumSection = document.getElementById('track-album-section');
        const albumTracksContainer = document.getElementById('track-detail-album-tracks');
        const similarSection = document.getElementById('track-similar-section');
        const similarTracksContainer = document.getElementById('track-detail-similar-tracks');

        const playBtn = document.getElementById('play-track-btn');
        const lyricsBtn = document.getElementById('track-lyrics-btn');
        const shareBtn = document.getElementById('share-track-btn');
        const likeBtn = document.getElementById('like-track-btn');
        const downloadBtn = document.getElementById('download-track-btn');

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        artistEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 100px;"></div>';
        albumEl.innerHTML = '';
        yearEl.innerHTML = '';
        albumTracksContainer.innerHTML = this.createSkeletonTracks(5, false);
        albumSection.style.display = 'none';
        similarSection.style.display = 'none';

        if (!trackId || trackId === 'undefined' || trackId === 'null') {
            titleEl.textContent = 'Invalid Track ID';
            artistEl.innerHTML = '';
            return;
        }

        try {
            let trackData = null;
            const resolvedProvider = provider || 'tidal';

            if (provider) {
                trackData = await this.api.getTrack(trackId, undefined, provider);
            } else {
                trackData = await this.api.getTrack(trackId, undefined, 'tidal');
            }

            let track = trackData?.track;

            const hasDisplayMetadata = Boolean(
                track?.title &&
                (track?.artist || (Array.isArray(track?.artists) && track.artists.length > 0)) &&
                (track?.album?.title || track?.album?.id)
            );

            if (!hasDisplayMetadata) {
                try {
                    const metadataTrack = await this.api.getTrackMetadata(trackId, resolvedProvider);
                    if (metadataTrack) {
                        track = {
                            ...metadataTrack,
                            ...(track || {}),
                            album: {
                                ...(metadataTrack.album || {}),
                                ...(track?.album || {}),
                            },
                        };
                    }
                } catch (metadataError) {
                    console.warn('Track metadata fallback failed:', metadataError);
                }
            }

            if (!track?.title) {
                throw new Error('Track metadata missing');
            }

            const coverUrl = this.api.getCoverUrl(track.album?.cover);
            const preferredVisualUrl = this.getTrackVisualUrl(track);
            imageEl.src = coverUrl;
            imageEl.style.backgroundColor = '';

            this.setPageBackground(preferredVisualUrl || coverUrl, coverUrl);
            if (backgroundSettings.isEnabled() && track.album?.cover) {
                if (!this.applyApiVibrantColor(track.album?.vibrantColor)) {
                    this.extractAndApplyColor(this.api.getCoverUrl(track.album.cover, '80'));
                }
            }

            const explicitBadge = hasExplicitContent(track) ? this.createExplicitBadge() : '';
            const qualityBadge = createQualityBadgeHTML(track);
            titleEl.innerHTML = `${escapeHtml(track.title)} ${explicitBadge} ${qualityBadge}`;
            this.adjustTitleFontSize(titleEl, track.title);

            artistEl.innerHTML = getTrackArtistsHTML(track);

            if (track.album) {
                albumEl.innerHTML = `<a href="/album/${track.album.id}">${escapeHtml(track.album.title)}</a>`;
            }

            if (track.album?.releaseDate) {
                const date = new Date(track.album.releaseDate);
                if (!isNaN(date.getTime())) {
                    yearEl.textContent = date.getFullYear();
                }
            }

            playBtn.onclick = () => {
                this.player.setQueue([track], 0);
                this.player.playTrackFromQueue();
            };

            if (likeBtn) {
                const isLiked = await db.isFavorite('track', track.id);
                likeBtn.innerHTML = this.createHeartIcon(isLiked);
                likeBtn.classList.toggle('active', isLiked);
            }

            if (track.album?.id) {
                const { tracks } = await this.api.getAlbum(track.album.id);
                if (tracks && tracks.length > 0) {
                    albumSection.style.display = 'block';
                    this.renderListWithTracks(albumTracksContainer, tracks, false);
                }
            }

            const recommendations = await this.api.getRecommendations(track.id);
            if (recommendations?.items?.length > 0) {
                const deduped = recommendations.items.filter((entry) => entry?.id && entry.id !== track.id);
                if (deduped.length > 0) {
                    similarSection.style.display = 'block';
                    this.renderListWithTracks(similarTracksContainer, deduped.slice(0, 25), false);
                }
            }

            document.title = `${track.title} - ${getTrackArtists(track)}`;
        } catch (error) {
            console.error('Failed to load track:', error);
            titleEl.textContent = 'Track not found';
            artistEl.innerHTML = '';
        }
    }
}
