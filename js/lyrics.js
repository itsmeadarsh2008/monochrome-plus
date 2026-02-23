//js/lyrics.js
import { getTrackTitle, getTrackArtists, buildTrackFilename, SVG_CLOSE } from './utils.js';
import { sidePanelManager } from './side-panel.js';

const SVG_GENIUS_ACTIVE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 24c6.627 0 12-5.373 12-12S18.627 0 12 0 0 5.373 0 12s5.373 12 12 12z" fill="#ffff64"/><path d="M6.3 6.3h11.4v11.4H6.3z" fill="#000"/></svg>`;

// Check if text contains Japanese, Chinese, or Korean characters
function containsAsianText(text) {
    if (!text) return false;
    // Japanese: Hiragana (3040-309F), Katakana (30A0-30FF), Kanji (4E00-9FFF, 3400-4DBF)
    // Chinese: CJK Unified Ideographs (4E00-9FFF, 3400-4DBF)
    // Korean: Hangul (AC00-D7AF, 1100-11FF, 3130-318F)
    const asianRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
    return asianRegex.test(text);
}

// Check if track has Asian text in title or artist names
function trackHasAsianText(track) {
    if (!track) return false;
    const title = track.title || '';
    const artist = getTrackArtists(track) || '';
    return containsAsianText(title) || containsAsianText(artist);
}
const SVG_GENIUS_INACTIVE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.7;"><path d="M12 24c6.627 0 12-5.373 12-12S18.627 0 12 0 0 5.373 0 12s5.373 12 12 12z" /><path d="M6.3 6.3h11.4v11.4H6.3z" fill="var(--card)"/></svg>`;

class GeniusManager {
    constructor() {
        this.cache = new Map();
        this.loading = false;
    }

    getToken() {
        return 'QmS9OvsS-7ifRBKx_ochIPQU7oejIS9Eo_z5iWHmCPyhwLVQID3pYTHJmJTa6z8z'; // idgaf anymore im js hardcoding this lmaooo
    }

    async searchTrack(title, artist) {
        const cleanTitle = title.split('(')[0].split('-')[0].trim();
        const query = encodeURIComponent(`${cleanTitle} ${artist}`);
        const token = this.getToken();

        const url = `https://api.genius.com/search?q=${query}&access_token=${token}`;
        const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);

        if (!response.ok) throw new Error('Failed to search Genius');

        const data = await response.json();
        if (data.response.hits.length === 0) return null;

        const normalize = (str) => str.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const targetArtist = normalize(artist);

        const hit = data.response.hits.find((h) => {
            const hitArtist = normalize(h.result.primary_artist.name);
            return hitArtist.includes(targetArtist) || targetArtist.includes(hitArtist);
        });

        return hit ? hit.result : data.response.hits[0].result;
    }

    async getReferents(songId) {
        const token = this.getToken();
        const url = `https://api.genius.com/referents?song_id=${songId}&text_format=plain&per_page=50&access_token=${token}`;
        const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);

        if (!response.ok) throw new Error('Failed to fetch annotations');

        const data = await response.json();
        return data.response.referents;
    }

    async getDataForTrack(track) {
        if (this.cache.has(track.id)) return this.cache.get(track.id);

        try {
            this.loading = true;
            const artist = Array.isArray(track.artists) ? track.artists[0].name : track.artist.name;
            const song = await this.searchTrack(track.title, artist);

            if (!song) {
                this.loading = false;
                return null;
            }

            const referents = await this.getReferents(song.id);
            const result = { song, referents };

            this.cache.set(track.id, result);
            this.loading = false;
            return result;
        } catch (error) {
            console.error('Genius Error:', error);
            this.loading = false;
            throw error;
        }
    }

    findAnnotations(lineText, referents) {
        if (!referents || !lineText) return [];

        const normalize = (str) =>
            str
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, '')
                .replace(/\s+/g, ' ')
                .trim();
        const normLine = normalize(lineText);

        const getWordSet = (str) => new Set(str.split(' ').filter((w) => w.length > 0));
        const lineWords = getWordSet(normLine);

        return referents.filter((ref) => {
            const normFragment = normalize(ref.fragment);

            if (normLine.includes(normFragment) || normFragment.includes(normLine)) return true;

            const fragmentWords = getWordSet(normFragment);
            if (fragmentWords.size === 0 || lineWords.size === 0) return false;

            let matchCount = 0;
            fragmentWords.forEach((w) => {
                if (lineWords.has(w)) matchCount++;
            });

            return matchCount / Math.min(fragmentWords.size, lineWords.size) > 0.6;
        });
    }
}

export class LyricsManager {
    constructor(api) {
        this.api = api;
        this.currentLyrics = null;
        this.syncedLyrics = [];
        this.lyricsCache = new Map();
        this.componentLoaded = false;
        this.amLyricsElement = null;
        this.animationFrameId = null;
        this.currentTrackId = null;
        this.mutationObserver = null;
        this.romajiObserver = null;
        this.isRomajiMode = false;
        this.originalLyricsData = null;
        this.kuroshiroLoaded = false;
        this.kuroshiroLoading = false;
        this.romajiTextCache = new Map(); // Cache: originalText -> convertedRomaji
        this.convertedTracksCache = new Set(); // Track IDs that have been fully converted
        this.geniusManager = new GeniusManager();
        this.isGeniusMode = false;
        this.currentGeniusData = null;
        this.timingOffset = 0; // Offset in milliseconds (positive = delay lyrics, negative = advance lyrics)
        this._karaokeLayoutRaf = null;
    }

    // Get timing offset for current track
    getTimingOffset(trackId) {
        try {
            const key = `lyrics-offset-${trackId}`;
            const stored = localStorage.getItem(key);
            return stored ? parseInt(stored, 10) : 0;
        } catch {
            return 0;
        }
    }

    // Set timing offset for current track
    setTimingOffset(trackId, offsetMs) {
        try {
            const key = `lyrics-offset-${trackId}`;
            localStorage.setItem(key, offsetMs.toString());
        } catch (e) {
            console.warn('Failed to save lyrics timing offset:', e);
        }
    }

    // Reset timing offset for current track
    resetTimingOffset(trackId) {
        this.setTimingOffset(trackId, 0);
    }

    // Get formatted offset display string
    getOffsetDisplayString(offsetMs) {
        const sign = offsetMs >= 0 ? '+' : '';
        const seconds = Math.abs(offsetMs) / 1000;
        return `${sign}${seconds.toFixed(1)}s`;
    }

    // Load Kuroshiro from CDN (npm package uses Node.js path which doesn't work in browser)
    async loadKuroshiro() {
        if (this.kuroshiroLoaded) return true;
        if (this.kuroshiroLoading) {
            // Wait for existing load to complete
            return new Promise((resolve) => {
                const checkLoad = setInterval(() => {
                    if (!this.kuroshiroLoading) {
                        clearInterval(checkLoad);
                        resolve(this.kuroshiroLoaded);
                    }
                }, 100);
            });
        }

        this.kuroshiroLoading = true;
        try {
            // Bug on kuromoji@0.1.2 where it mangles absolute URLs
            // Using self-hosted dict files is failed, so we use CDN with monkey-patch
            // Monkey-patch XMLHttpRequest to redirect dictionary requests to CDN
            // Kuromoji uses XHR, not fetch, for loading dictionary files
            if (!window._originalXHROpen) {
                window._originalXHROpen = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                    const urlStr = url.toString();
                    if (urlStr.includes('/dict/') && urlStr.includes('.dat.gz')) {
                        // Extract just the filename
                        const filename = urlStr.split('/').pop();
                        // Redirect to CDN
                        const cdnUrl = `https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/${filename}`;
                        return window._originalXHROpen.call(this, method, cdnUrl, ...rest);
                    }
                    return window._originalXHROpen.call(this, method, url, ...rest);
                };
            }

            // Also patch fetch just in case
            if (!window._originalFetch) {
                window._originalFetch = window.fetch;
                window.fetch = async (url, options) => {
                    const urlStr = url.toString();
                    if (urlStr.includes('/dict/') && urlStr.includes('.dat.gz')) {
                        const filename = urlStr.split('/').pop();
                        const cdnUrl = `https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/${filename}`;
                        console.log(`Redirecting dict fetch: ${filename} -> CDN`);
                        return window._originalFetch(cdnUrl, options);
                    }
                    return window._originalFetch(url, options);
                };
            }

            // Load Kuroshiro from CDN
            if (!window.Kuroshiro) {
                await this.loadScript('https://unpkg.com/kuroshiro@1.2.0/dist/kuroshiro.min.js');
            }

            // Load Kuromoji analyzer from CDN
            if (!window.KuromojiAnalyzer) {
                await this.loadScript(
                    'https://unpkg.com/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js'
                );
            }

            // Initialize Kuroshiro (CDN version exports as .default)
            const Kuroshiro = window.Kuroshiro.default || window.Kuroshiro;
            const KuromojiAnalyzer = window.KuromojiAnalyzer.default || window.KuromojiAnalyzer;

            this.kuroshiro = new Kuroshiro();

            // Initialize with a dummy path - our fetch interceptor will redirect to CDN
            await this.kuroshiro.init(
                new KuromojiAnalyzer({
                    dictPath: '/dict/', // This gets mangled but our interceptor fixes it
                })
            );

            this.kuroshiroLoaded = true;
            this.kuroshiroLoading = false;
            console.log('✓ Kuroshiro loaded and initialized successfully');
            return true;
        } catch (error) {
            console.error('✗ Failed to load Kuroshiro:', error);
            this.kuroshiroLoaded = false;
            this.kuroshiroLoading = false;
            return false;
        }
    }

    // Helper to load external scripts
    loadScript(src) {
        return new Promise((resolve, reject) => {
            // Check if script already exists
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    // Check if text contains Japanese characters
    containsJapanese(text) {
        if (!text) return false;
        // Match any Japanese character (Hiragana, Katakana, Kanji)
        return /[\u3040-\u30FF\u31F0-\u9FFF]/.test(text);
    }

    // Convert Japanese text to Romaji (including Kanji) with caching
    async convertToRomaji(text) {
        if (!text) return text;

        // Check cache first
        if (this.romajiTextCache.has(text)) {
            return this.romajiTextCache.get(text);
        }

        // Only process if text contains Asian characters
        if (!containsAsianText(text)) {
            return text;
        }

        // Make sure Kuroshiro is loaded
        if (!this.kuroshiroLoaded) {
            const success = await this.loadKuroshiro();
            if (!success) {
                console.warn('Kuroshiro not available, skipping conversion');
                return text;
            }
        }

        if (!this.kuroshiro) {
            console.warn('Kuroshiro not available, skipping conversion');
            return text;
        }

        try {
            // Convert to Romaji using Kuroshiro (handles Kanji, Hiragana, Katakana)
            const result = await this.kuroshiro.convert(text, {
                to: 'romaji',
                mode: 'spaced',
                romajiSystem: 'hepburn',
            });
            // Cache the result
            this.romajiTextCache.set(text, result);
            return result;
        } catch (error) {
            console.warn('Romaji conversion failed for text:', text.substring(0, 30), error);
            return text;
        }
    }

    // Set Romaji mode and save preference
    setRomajiMode(enabled) {
        this.isRomajiMode = enabled;
        try {
            localStorage.setItem('lyricsRomajiMode', enabled ? 'true' : 'false');
        } catch (e) {
            console.warn('Failed to save Romaji mode preference:', e);
        }
    }

    // Get saved Romaji mode preference
    getRomajiMode() {
        try {
            return localStorage.getItem('lyricsRomajiMode') === 'true';
        } catch {
            return false;
        }
    }

    async ensureComponentLoaded() {
        if (this.componentLoaded) return;

        if (typeof customElements !== 'undefined' && customElements.get('am-lyrics')) {
            this.componentLoaded = true;
            return;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = 'https://cdn.jsdelivr.net/npm/@uimaxbai/am-lyrics/dist/src/am-lyrics.min.js';

            script.onload = () => {
                if (typeof customElements !== 'undefined') {
                    customElements
                        .whenDefined('am-lyrics')
                        .then(() => {
                            this.componentLoaded = true;
                            resolve();
                        })
                        .catch(reject);
                } else {
                    resolve();
                }
            };

            script.onerror = () => reject(new Error('Failed to load lyrics component'));
            document.head.appendChild(script);
        });
    }

    async fetchLyrics(trackId, track = null) {
        if (track) {
            if (this.lyricsCache.has(trackId)) {
                return this.lyricsCache.get(trackId);
            }

            try {
                const artist = Array.isArray(track.artists)
                    ? track.artists.map((a) => a.name || a).join(', ')
                    : track.artist?.name || '';
                const title = track.title || '';
                const album = track.album?.title || '';
                const duration = track.duration ? Math.round(track.duration) : null;

                if (!title || !artist) {
                    console.warn('Missing required fields for LRCLIB');
                    return null;
                }

                const params = new URLSearchParams({
                    track_name: title,
                    artist_name: artist,
                });

                if (album) params.append('album_name', album);
                if (duration) params.append('duration', duration.toString());

                const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);

                if (response.ok) {
                    const data = await response.json();

                    if (data.syncedLyrics) {
                        const lyricsData = {
                            subtitles: data.syncedLyrics,
                            lyricsProvider: 'LRCLIB',
                        };

                        this.lyricsCache.set(trackId, lyricsData);
                        return lyricsData;
                    }
                }
            } catch (error) {
                console.warn('LRCLIB fetch failed:', error);
            }
        }

        return null;
    }

    parseSyncedLyrics(subtitles) {
        if (!subtitles) return [];
        const lines = subtitles.split('\n').filter((line) => line.trim());
        return lines
            .map((line) => {
                const match = line.match(/\[(\d+):(\d+)\.(\d+)\]\s*(.+)/);
                if (match) {
                    const [, minutes, seconds, centiseconds, text] = match;
                    const timeInSeconds = parseInt(minutes) * 60 + parseInt(seconds) + parseInt(centiseconds) / 100;
                    return { time: timeInSeconds, text: text.trim() };
                }
                return null;
            })
            .filter(Boolean);
    }

    generateLRCContent(lyricsData, track) {
        if (!lyricsData || !lyricsData.subtitles) return null;

        const trackTitle = getTrackTitle(track);
        const trackArtist = getTrackArtists(track);

        let lrc = `[ti:${trackTitle}]\n`;
        lrc += `[ar:${trackArtist}]\n`;
        lrc += `[al:${track.album?.title || 'Unknown Album'}]\n`;
        lrc += `[by:${lyricsData.lyricsProvider || 'Unknown'}]\n`;
        lrc += '\n';
        lrc += lyricsData.subtitles;

        return lrc;
    }

    downloadLRC(lyricsData, track) {
        const lrcContent = this.generateLRCContent(lyricsData, track);
        if (!lrcContent) {
            alert('No synced lyrics available for this track');
            return;
        }

        const blob = new Blob([lrcContent], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = buildTrackFilename(track, 'LOSSLESS').replace(/\.flac$/, '.lrc');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    getCurrentLine(currentTime) {
        if (!this.syncedLyrics || this.syncedLyrics.length === 0) return -1;
        let currentIndex = -1;
        for (let i = 0; i < this.syncedLyrics.length; i++) {
            if (currentTime >= this.syncedLyrics[i].time) {
                currentIndex = i;
            } else {
                break;
            }
        }
        return currentIndex;
    }

    // Setup MutationObserver to convert lyrics in am-lyrics component
    setupLyricsObserver(amLyricsElement) {
        this.stopLyricsObserver();

        if (!amLyricsElement) return;

        // Check for shadow DOM
        const observeRoot = amLyricsElement.shadowRoot || amLyricsElement;

        this.romajiObserver = new MutationObserver((mutations) => {
            // Check if any relevant mutation occurred
            const hasRelevantChange = mutations.some((mutation) => {
                if (mutation.type === 'childList') {
                    let relevant = false;
                    if (mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('genius-indicator'))
                                continue;
                            relevant = true;
                            break;
                        }
                    }
                    if (!relevant && mutation.removedNodes.length > 0) {
                        for (const node of mutation.removedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('genius-indicator'))
                                continue;
                            relevant = true;
                            break;
                        }
                    }
                    return relevant;
                }
                if (mutation.type === 'characterData') return true;
                return false;
            });

            if (!hasRelevantChange) {
                return;
            }

            // Debounce mutations
            if (this.observerTimeout) {
                clearTimeout(this.observerTimeout);
            }
            this.observerTimeout = setTimeout(async () => {
                this.scheduleKaraokeWordLayout(amLyricsElement);
                if (this.isRomajiMode) {
                    await this.convertLyricsContent(amLyricsElement);
                    this.scheduleKaraokeWordLayout(amLyricsElement);
                }
                if (this.isGeniusMode && this.currentGeniusData) {
                    this.applyGeniusAnnotations(amLyricsElement, this.currentGeniusData.referents);
                }
            }, 100);
        });

        // Observe all child nodes for changes (in shadow DOM if it exists)
        // Watch for new nodes AND text content changes to catch when lyrics refresh
        this.romajiObserver.observe(observeRoot, {
            childList: true,
            subtree: true,
            characterData: true, // Watch text changes to catch lyric refreshes
            attributes: false, // Don't watch attribute changes (highlight, etc)
        });

        // Initial conversion if Romaji mode is enabled - single attempt, no periodic polling
        if (this.isRomajiMode) {
            this.convertLyricsContent(amLyricsElement);
        }
        if (this.isGeniusMode && this.currentGeniusData) {
            this.applyGeniusAnnotations(amLyricsElement, this.currentGeniusData.referents);
        }
        this.scheduleKaraokeWordLayout(amLyricsElement);
    }

    // Convert lyrics content to Romaji
    async convertLyricsContent(amLyricsElement) {
        if (!amLyricsElement || !this.isRomajiMode) {
            return;
        }

        // Find the root to traverse - check for shadow DOM first
        const rootToTraverse = amLyricsElement.shadowRoot || amLyricsElement;

        // Make sure Kuroshiro is ready
        if (!this.kuroshiroLoaded) {
            const success = await this.loadKuroshiro();
            if (!success) {
                console.warn('Cannot convert lyrics - Kuroshiro load failed');
                return;
            }
        }

        // Find all text nodes in the component
        const textNodes = [];
        const walker = document.createTreeWalker(rootToTraverse, NodeFilter.SHOW_TEXT, null, false);

        let node;
        while ((node = walker.nextNode())) {
            textNodes.push(node);
        }

        // Convert Japanese text to Romaji (using async/await for Kuroshiro)
        for (const textNode of textNodes) {
            if (!textNode.parentElement) {
                continue;
            }

            const parentTag = textNode.parentElement.tagName?.toLowerCase();
            const parentClass = String(textNode.parentElement.className || '');

            // Skip elements that shouldn't be converted
            const skipTags = ['script', 'style', 'code', 'input', 'textarea', 'time'];
            if (skipTags.includes(parentTag)) {
                continue;
            }

            const originalText = textNode.textContent;

            // Skip progress indicators and timestamps (but NOT progress-text which is the actual lyrics!)
            if (
                (parentClass.includes('progress') && !parentClass.includes('progress-text')) ||
                (parentClass.includes('time') && !parentClass.includes('progress-text')) ||
                parentClass.includes('timestamp')
            ) {
                continue;
            }

            if (!originalText || originalText.trim().length === 0) {
                continue;
            }

            // Check if contains Japanese - convert if we find Japanese
            if (this.containsJapanese(originalText)) {
                const romajiText = await this.convertToRomaji(originalText);

                // Only update if conversion produced different text
                if (romajiText && romajiText !== originalText) {
                    textNode.textContent = romajiText;
                }
            }
        }

        // Mark this track as converted
        if (this.currentTrackId) {
            this.convertedTracksCache.add(this.currentTrackId);
        }
    }

    // Stop the observer
    stopLyricsObserver() {
        if (this.romajiObserver) {
            this.romajiObserver.disconnect();
            this.romajiObserver = null;
        }
        if (this.observerTimeout) {
            clearTimeout(this.observerTimeout);
            this.observerTimeout = null;
        }
        if (this._karaokeLayoutRaf) {
            cancelAnimationFrame(this._karaokeLayoutRaf);
            this._karaokeLayoutRaf = null;
        }
    }

    scheduleKaraokeWordLayout(amLyricsElement) {
        if (!amLyricsElement) return;
        if (this._karaokeLayoutRaf) {
            cancelAnimationFrame(this._karaokeLayoutRaf);
        }

        this._karaokeLayoutRaf = requestAnimationFrame(() => {
            this._karaokeLayoutRaf = null;
            this.applyKaraokeWordLayout(amLyricsElement);
        });
    }

    applyKaraokeWordLayout(amLyricsElement) {
        if (!amLyricsElement) return;
        const root = amLyricsElement.shadowRoot || amLyricsElement;
        const lineNodes = Array.from(root.querySelectorAll('p, .line, .lyric-line, .lrc-line'));

        lineNodes.forEach((line, lineIndex) => {
            line.classList.add('karaoke-line-enhanced');
            line.style.setProperty('--line-stagger', String(lineIndex % 24));

            const words = Array.from(line.querySelectorAll('.word, .lyric-word'));
            words.forEach((word, wordIndex) => {
                word.classList.add('karaoke-word-enhanced');
                word.style.setProperty('--word-index', String(wordIndex));
            });
        });
    }

    // Toggle Romaji mode
    async toggleRomajiMode(amLyricsElement) {
        this.isRomajiMode = !this.isRomajiMode;
        this.setRomajiMode(this.isRomajiMode);

        if (amLyricsElement) {
            if (this.isRomajiMode) {
                // Turning ON: Setup observer and convert immediately
                this.setupLyricsObserver(amLyricsElement);
                await this.convertLyricsContent(amLyricsElement);
            } else {
                // Turning OFF: Stop observer
                // Note: To restore original Japanese, we'd need to reload the component
                this.stopLyricsObserver();
            }
        }

        return this.isRomajiMode;
    }

    async applyGeniusAnnotations(amLyricsElement, referents) {
        if (!amLyricsElement || !referents) return;

        const root = amLyricsElement.shadowRoot || amLyricsElement;

        const lineElements = Array.from(root.querySelectorAll('p, .line, .lyric-line, .lrc-line'));

        if (lineElements.length === 0) return;

        lineElements.forEach((el) => {
            el.classList.remove('genius-annotated', 'genius-multi-start', 'genius-multi-end', 'genius-multi-mid');
            delete el.__geniusAnnotations;
        });

        const normalize = (str) =>
            str
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, '')
                .replace(/\s+/g, ' ')
                .trim();

        referents.forEach((ref) => {
            const fragment = normalize(ref.fragment);
            if (!fragment) return;

            for (let i = 0; i < lineElements.length; i++) {
                let combinedText = '';
                let currentLines = [];

                for (let j = i; j < lineElements.length; j++) {
                    const line = lineElements[j];

                    const lineClone = line.cloneNode(true);
                    lineClone
                        .querySelectorAll('.time, .timestamp, [class*="time"], .genius-indicator')
                        .forEach((n) => n.remove());
                    const text = normalize(lineClone.textContent || '');

                    if (!text) continue;

                    if (currentLines.length > 0) combinedText += ' ';
                    combinedText += text;
                    currentLines.push(line);

                    if (combinedText.includes(fragment)) {
                        currentLines.forEach((el, idx) => {
                            el.classList.add('genius-annotated');
                            if (!el.__geniusAnnotations) el.__geniusAnnotations = [];

                            if (!el.__geniusAnnotations.some((a) => a.id === ref.id)) {
                                el.__geniusAnnotations.push(ref);
                            }

                            if (currentLines.length > 1) {
                                if (idx === 0) el.classList.add('genius-multi-start');
                                else if (idx === currentLines.length - 1) el.classList.add('genius-multi-end');
                                else el.classList.add('genius-multi-mid');
                            }

                            if (!el.querySelector('.genius-indicator')) {
                                const smiley = document.createElement('span');
                                smiley.className = 'genius-indicator';
                                smiley.textContent = ' ☺';
                                smiley.style.color = '#ffff64';
                                smiley.style.marginLeft = '0.5em';
                                el.appendChild(smiley);
                            }
                        });
                        break;
                    }

                    if (combinedText.length > fragment.length + 50) break;
                }
            }
        });
    }
}

export function openLyricsPanel(track, audioPlayer, lyricsManager, forceOpen = false) {
    const manager = lyricsManager || new LyricsManager();

    // Load Kuroshiro in background only if track has Asian text and Romaji mode is enabled
    const isRomajiMode = manager.getRomajiMode();
    if (isRomajiMode && trackHasAsianText(track) && !manager.kuroshiroLoaded && !manager.kuroshiroLoading) {
        manager.loadKuroshiro().catch((err) => {
            console.warn('Failed to load Kuroshiro for Romaji conversion:', err);
        });
    }

    // Load saved timing offset for this track
    manager.timingOffset = manager.getTimingOffset(track.id);

    const renderControls = (container) => {
        const isRomajiMode = manager.getRomajiMode();
        manager.isRomajiMode = isRomajiMode;
        const isGeniusMode = manager.isGeniusMode;
        const offsetDisplay = manager.getOffsetDisplayString(manager.timingOffset);

        container.innerHTML = `
            <button id="close-side-panel-btn" class="btn-icon" title="Close">
                ${SVG_CLOSE}
            </button>
            <div class="lyrics-timing-controls">
                <button id="lyrics-timing-minus-btn" class="btn-icon" title="Decrease delay (lyrics earlier) -0.5s">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12h14"/>
                    </svg>
                </button>
                <span id="lyrics-timing-display" class="lyrics-timing-display" title="Current timing offset">${offsetDisplay}</span>
                <button id="lyrics-timing-plus-btn" class="btn-icon" title="Increase delay (lyrics later) +0.5s">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12h14M12 5v14"/>
                    </svg>
                </button>
                <button id="lyrics-timing-reset-btn" class="btn-icon" title="Reset timing offset">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                        <path d="M3 3v5h5"/>
                    </svg>
                </button>
            </div>
            <button id="romaji-toggle-btn" class="btn-icon" title="Toggle Romaji (Japanese to Latin)" data-enabled="${isRomajiMode}" style="color: ${isRomajiMode ? 'var(--primary)' : ''}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
            </button>
            <button id="genius-toggle-btn" class="btn-icon ${isGeniusMode ? 'active-genius' : ''}" title="Genius Mode" style="${isGeniusMode ? 'color: #ffff64;' : ''}">
                ${isGeniusMode ? SVG_GENIUS_ACTIVE : SVG_GENIUS_INACTIVE}
            </button>
        `;

        container.querySelector('#close-side-panel-btn').addEventListener('click', () => {
            sidePanelManager.close();
            clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
        });

        // Timing adjustment controls
        const updateTimingDisplay = () => {
            const display = container.querySelector('#lyrics-timing-display');
            if (display) {
                display.textContent = manager.getOffsetDisplayString(manager.timingOffset);
            }
        };

        container.querySelector('#lyrics-timing-minus-btn')?.addEventListener('click', () => {
            manager.timingOffset -= 500; // Decrease by 0.5 seconds
            manager.setTimingOffset(track.id, manager.timingOffset);
            updateTimingDisplay();
        });

        container.querySelector('#lyrics-timing-plus-btn')?.addEventListener('click', () => {
            manager.timingOffset += 500; // Increase by 0.5 seconds
            manager.setTimingOffset(track.id, manager.timingOffset);
            updateTimingDisplay();
        });

        container.querySelector('#lyrics-timing-reset-btn')?.addEventListener('click', () => {
            manager.timingOffset = 0;
            manager.resetTimingOffset(track.id);
            updateTimingDisplay();
        });

        // Romaji toggle button handler
        const romajiBtn = container.querySelector('#romaji-toggle-btn');
        if (romajiBtn) {
            const updateRomajiBtn = () => {
                const enabled = manager.isRomajiMode;
                romajiBtn.setAttribute('data-enabled', enabled);
                romajiBtn.style.color = enabled ? 'var(--primary)' : '';
            };
            updateRomajiBtn();

            romajiBtn.addEventListener('click', async () => {
                const amLyrics = sidePanelManager.panel.querySelector('am-lyrics');
                if (amLyrics) {
                    await manager.toggleRomajiMode(amLyrics);
                    updateRomajiBtn();
                }
            });
        }

        // Genius toggle
        const geniusBtn = container.querySelector('#genius-toggle-btn');
        if (geniusBtn) {
            geniusBtn.addEventListener('click', async () => {
                manager.isGeniusMode = !manager.isGeniusMode;
                const enabled = manager.isGeniusMode;

                geniusBtn.classList.toggle('active-genius', enabled);
                geniusBtn.style.color = enabled ? '#ffff64' : '';
                geniusBtn.innerHTML = enabled ? SVG_GENIUS_ACTIVE : SVG_GENIUS_INACTIVE;

                if (enabled) {
                    try {
                        geniusBtn.style.opacity = '0.5';
                        await manager.geniusManager.getDataForTrack(track);
                        manager.currentGeniusData = manager.geniusManager.cache.get(track.id);
                        const amLyrics = sidePanelManager.panel.querySelector('am-lyrics');
                        if (amLyrics)
                            manager.applyGeniusAnnotations(
                                amLyrics,
                                manager.geniusManager.cache.get(track.id)?.referents
                            );
                    } catch (e) {
                        alert(e.message);
                        manager.isGeniusMode = false;
                        geniusBtn.classList.remove('active-genius');
                        geniusBtn.style.color = '';
                    } finally {
                        geniusBtn.style.opacity = '1';
                    }
                } else {
                    const amLyrics = sidePanelManager.panel.querySelector('am-lyrics');
                    if (amLyrics) {
                        const root = amLyrics.shadowRoot || amLyrics;
                        const lineElements = Array.from(root.querySelectorAll('.genius-annotated'));
                        lineElements.forEach((el) => {
                            el.classList.remove(
                                'genius-annotated',
                                'genius-multi-start',
                                'genius-multi-end',
                                'genius-multi-mid'
                            );
                            delete el.__geniusAnnotations;
                        });
                    }
                    const modal = document.querySelector('.genius-annotation-modal');
                    if (modal) modal.remove();
                }
            });
        }
    };

    const renderContent = async (container) => {
        clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
        await renderLyricsComponent(container, track, audioPlayer, manager);
        if (container.lyricsCleanup) {
            sidePanelManager.panel.lyricsCleanup = container.lyricsCleanup;
            sidePanelManager.panel.lyricsManager = container.lyricsManager;
        }
    };

    sidePanelManager.open('lyrics', 'Lyrics', renderControls, renderContent, forceOpen);
}

function getLyricsHighlightColor() {
    // Check if the current theme is light
    const isLight = getComputedStyle(document.documentElement).colorScheme === 'light';
    return isLight ? '#000' : '#fff';
}

function updateLyricsTheme() {
    const highlightColor = getLyricsHighlightColor();
    document.querySelectorAll('am-lyrics').forEach((el) => {
        el.setAttribute('highlight-color', highlightColor);
    });
}

// watch for theme changes
const themeObserver = new MutationObserver(() => {
    updateLyricsTheme();
});

themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style'],
});

async function renderLyricsComponent(container, track, audioPlayer, lyricsManager) {
    container.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';

    try {
        await lyricsManager.ensureComponentLoaded();

        // Set initial Romaji mode
        lyricsManager.isRomajiMode = lyricsManager.getRomajiMode();
        lyricsManager.currentTrackId = track.id;

        const title = track.title;
        const artist = getTrackArtists(track);
        const album = track.album?.title;
        const durationMs = track.duration ? Math.round(track.duration * 1000) : undefined;
        const isrc = track.isrc || '';

        container.innerHTML = '';
        const amLyrics = document.createElement('am-lyrics');
        amLyrics.setAttribute('song-title', title);
        amLyrics.setAttribute('song-artist', artist);
        if (album) amLyrics.setAttribute('song-album', album);
        if (durationMs) amLyrics.setAttribute('song-duration', durationMs);
        amLyrics.setAttribute('query', `${title} ${artist}`.trim());
        if (isrc) amLyrics.setAttribute('isrc', isrc);

        amLyrics.setAttribute('highlight-color', getLyricsHighlightColor());
        amLyrics.setAttribute('hover-background-color', 'rgba(59, 130, 246, 0.14)');
        amLyrics.setAttribute('autoscroll', '');
        amLyrics.setAttribute('interpolate', '');
        amLyrics.style.height = '100%';
        amLyrics.style.width = '100%';

        container.appendChild(amLyrics);

        lyricsManager.setupLyricsObserver(amLyrics);

        // If Romaji mode is enabled and track has Asian text, ensure Kuroshiro is ready
        if (lyricsManager.isRomajiMode && trackHasAsianText(track) && !lyricsManager.kuroshiroLoaded) {
            await lyricsManager.loadKuroshiro();
        }

        lyricsManager
            .fetchLyrics(track.id, track)
            .then(async () => {
                if (lyricsManager.isGeniusMode) {
                    try {
                        const data = await lyricsManager.geniusManager.getDataForTrack(track);
                        if (data) {
                            lyricsManager.currentGeniusData = data;
                            lyricsManager.applyGeniusAnnotations(amLyrics, data.referents);
                        }
                    } catch (e) {
                        console.warn('Genius auto-load failed', e);
                    }
                }
            })
            .catch((e) => console.warn('Background lyrics fetch failed', e));

        // Wait for lyrics to appear, then do an immediate conversion
        const waitForLyrics = () => {
            return new Promise((resolve) => {
                // Check if lyrics are already loaded
                const checkForLyrics = () => {
                    const hasLyrics =
                        amLyrics.querySelector(".lyric-line, [class*='lyric']") ||
                        (amLyrics.shadowRoot && amLyrics.shadowRoot.querySelector("[class*='lyric']")) ||
                        (amLyrics.textContent && amLyrics.textContent.length > 50);
                    return hasLyrics;
                };

                if (checkForLyrics()) {
                    resolve();
                    return;
                }

                // Check more frequently (200ms) for faster response
                let attempts = 0;
                const maxAttempts = 25; // 5 seconds max
                const interval = setInterval(() => {
                    attempts++;
                    if (checkForLyrics() || attempts >= maxAttempts) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 200);
            });
        };

        await waitForLyrics();

        // Inject GPU-accelerated, high-refresh karaoke styles into am-lyrics Shadow DOM
        const root = amLyrics.shadowRoot || amLyrics;
        if (!root.querySelector('#custom-lyrics-tuning')) {
            const style = document.createElement('style');
            style.id = 'custom-lyrics-tuning';
            style.textContent = `
                :host {
                    --karaoke-wave-ms: 0;
                }

                .lyrics-container, .container, main, article {
                    transform: translateZ(0);
                    backface-visibility: hidden;
                    contain: paint;
                }

                /* Wrap by words on short screens and avoid letter-level breaking */
                p, .line, .lyric-line, .lrc-line, .karaoke-line-enhanced {
                    position: relative;
                    max-width: 100%;
                    white-space: normal !important;
                    word-break: normal !important;
                    overflow-wrap: break-word !important;
                    hyphens: none !important;
                    line-break: auto;
                    text-wrap: pretty;
                    overflow: visible !important;
                    transform: translate3d(0, 0, 0);
                    backface-visibility: hidden;
                    transition:
                        transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1),
                        opacity 180ms linear,
                        filter 260ms ease,
                        text-shadow 260ms ease;
                }

                .word, .lyric-word, .karaoke-word-enhanced {
                    display: inline-block !important;
                    white-space: nowrap !important;
                    word-break: keep-all !important;
                    margin-inline-end: 0.06em;
                    transform: translate3d(0, 0, 0);
                    backface-visibility: hidden;
                }

                .word:last-child, .lyric-word:last-child, .karaoke-word-enhanced:last-child {
                    margin-inline-end: 0;
                }

                /* Active line water-wave motion */
                p[active], p[data-active], p[data-active="true"], .is-active, p.active, .line.active, .lyric-line.active, .lrc-line.active {
                    will-change: transform, opacity, filter;
                    transform: translate3d(0, 0, 0) scale(1.022);
                    animation: karaoke-wave-line 2050ms cubic-bezier(0.36, 0.03, 0.21, 0.99) infinite;
                    filter: saturate(1.08);
                }

                p[active]::after, p[data-active]::after, p[data-active="true"]::after, .is-active::after, p.active::after, .line.active::after, .lyric-line.active::after, .lrc-line.active::after {
                    content: '';
                    position: absolute;
                    pointer-events: none;
                    inset: -0.18em -0.08em;
                    border-radius: 0.45em;
                    background:
                        radial-gradient(130% 75% at 50% 95%, rgba(255, 255, 255, 0.12), transparent 72%),
                        linear-gradient(
                            112deg,
                            transparent 0%,
                            rgba(255, 255, 255, 0.11) 26%,
                            transparent 47%,
                            rgba(255, 255, 255, 0.08) 64%,
                            transparent 100%
                        );
                    background-size: 190% 100%;
                    background-position: calc(var(--karaoke-wave-ms) * 0.032px) 50%;
                    mix-blend-mode: screen;
                    opacity: 0.55;
                    will-change: transform, opacity;
                    animation: karaoke-wave-shimmer 1400ms linear infinite;
                }

                p[active] .word, p[data-active] .word, p[data-active="true"] .word, .is-active .word, p.active .word, .line.active .word, .lyric-line.active .word, .lrc-line.active .word,
                p[active] .lyric-word, p[data-active] .lyric-word, p[data-active="true"] .lyric-word, .is-active .lyric-word, p.active .lyric-word, .line.active .lyric-word, .lyric-line.active .lyric-word, .lrc-line.active .lyric-word,
                p[active] .karaoke-word-enhanced, p[data-active] .karaoke-word-enhanced, p[data-active="true"] .karaoke-word-enhanced, .is-active .karaoke-word-enhanced, p.active .karaoke-word-enhanced, .line.active .karaoke-word-enhanced, .lyric-line.active .karaoke-word-enhanced, .lrc-line.active .karaoke-word-enhanced {
                    will-change: transform, filter;
                    animation: karaoke-word-wave 1180ms cubic-bezier(0.27, 0.1, 0.23, 1) infinite;
                    animation-delay: calc(var(--word-index, 0) * 34ms + var(--line-stagger, 0) * 14ms);
                }

                @keyframes karaoke-wave-line {
                    0% { transform: translate3d(0, 0, 0) scale(1.02); text-shadow: 0 0 0 rgba(255, 255, 255, 0); }
                    25% { transform: translate3d(0, -1px, 0) scale(1.028); text-shadow: 0 0 14px rgba(255, 255, 255, 0.18); }
                    50% { transform: translate3d(0, 0.8px, 0) scale(1.021); text-shadow: 0 0 11px rgba(255, 255, 255, 0.13); }
                    75% { transform: translate3d(0, -0.7px, 0) scale(1.026); text-shadow: 0 0 16px rgba(255, 255, 255, 0.2); }
                    100% { transform: translate3d(0, 0, 0) scale(1.02); text-shadow: 0 0 12px rgba(255, 255, 255, 0.14); }
                }

                @keyframes karaoke-wave-shimmer {
                    0% { opacity: 0.3; transform: translate3d(0, 0, 0); }
                    50% { opacity: 0.58; transform: translate3d(0, -0.6px, 0); }
                    100% { opacity: 0.3; transform: translate3d(0, 0, 0); }
                }

                @keyframes karaoke-word-wave {
                    0% { transform: translate3d(0, 0, 0); }
                    30% { transform: translate3d(0, -1.5px, 0); }
                    60% { transform: translate3d(0, 0.7px, 0); }
                    100% { transform: translate3d(0, 0, 0); }
                }

                @media (max-height: 760px) {
                    p, .line, .lyric-line, .lrc-line, .karaoke-line-enhanced {
                        line-height: 1.42 !important;
                        margin-block: 0.12em !important;
                    }
                }

                @media (prefers-reduced-motion: reduce) {
                    p[active], p[data-active], p[data-active="true"], .is-active, p.active, .line.active, .lyric-line.active, .lrc-line.active,
                    p[active] .word, p[data-active] .word, p[data-active="true"] .word, .is-active .word, p.active .word, .line.active .word, .lyric-line.active .word, .lrc-line.active .word,
                    p[active] .lyric-word, p[data-active] .lyric-word, p[data-active="true"] .lyric-word, .is-active .lyric-word, p.active .lyric-word, .line.active .lyric-word, .lyric-line.active .lyric-word, .lrc-line.active .lyric-word,
                    p[active] .karaoke-word-enhanced, p[data-active] .karaoke-word-enhanced, p[data-active="true"] .karaoke-word-enhanced, .is-active .karaoke-word-enhanced, p.active .karaoke-word-enhanced, .line.active .karaoke-word-enhanced, .lyric-line.active .karaoke-word-enhanced, .lrc-line.active .karaoke-word-enhanced {
                        animation: none !important;
                        transform: none !important;
                    }
                }
            `;
            root.appendChild(style);
        }
        lyricsManager.scheduleKaraokeWordLayout(amLyrics);

        // Convert immediately after lyrics detected
        if (lyricsManager.isRomajiMode) {
            await lyricsManager.convertLyricsContent(amLyrics);
            lyricsManager.scheduleKaraokeWordLayout(amLyrics);
            // One retry after 500ms in case more lyrics load
            setTimeout(() => {
                lyricsManager.convertLyricsContent(amLyrics);
                lyricsManager.scheduleKaraokeWordLayout(amLyrics);
            }, 500);
        }

        if (lyricsManager.isGeniusMode && lyricsManager.currentGeniusData) {
            lyricsManager.applyGeniusAnnotations(amLyrics, lyricsManager.currentGeniusData.referents);
        }

        const cleanup = setupSync(track, audioPlayer, amLyrics, lyricsManager);

        // Attach cleanup to container for easy access
        container.lyricsCleanup = cleanup;
        container.lyricsManager = lyricsManager;

        return amLyrics;
    } catch (error) {
        console.error('Failed to load lyrics:', error);
        container.innerHTML = '<div class="lyrics-error">Failed to load lyrics</div>';
        return null;
    }
}

function setupSync(track, audioPlayer, amLyrics, lyricsManager) {
    let baseTimeMs = 0;
    let lastTimestamp = performance.now();
    let animationFrameId = null;
    let lastWaveCssUpdate = 0;

    // Get timing offset from lyrics manager (in milliseconds)
    const getTimingOffset = () => {
        return lyricsManager?.timingOffset || 0;
    };

    const updateTime = () => {
        const currentMs = audioPlayer.currentTime * 1000;
        baseTimeMs = currentMs;
        lastTimestamp = performance.now();
        // Apply timing offset: positive offset delays lyrics, negative advances them
        amLyrics.currentTime = currentMs - getTimingOffset();
    };

    const tick = () => {
        if (!audioPlayer.paused) {
            const now = performance.now();
            const elapsed = now - lastTimestamp;
            const nextMs = baseTimeMs + elapsed * (audioPlayer.playbackRate || 1);
            // Apply timing offset: positive offset delays lyrics, negative advances them
            amLyrics.currentTime = nextMs - getTimingOffset();

            // High-refresh visual phase update for wave shimmer (up to ~120Hz)
            if (now - lastWaveCssUpdate >= 8) {
                amLyrics.style.setProperty('--karaoke-wave-ms', now.toFixed(2));
                lastWaveCssUpdate = now;
            }

            animationFrameId = requestAnimationFrame(tick);
        }
    };

    const onPlay = () => {
        baseTimeMs = audioPlayer.currentTime * 1000;
        lastTimestamp = performance.now();
        tick();
    };

    const onPause = () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    };

    const onLineClick = (e) => {
        if (e.detail && e.detail.timestamp !== undefined) {
            const manager = lyricsManager || sidePanelManager.panel.lyricsManager;
            if (manager && manager.isGeniusMode) {
                const timestampSeconds = e.detail.timestamp / 1000;

                const lyricsData = manager.lyricsCache.get(track.id);
                if (lyricsData && lyricsData.subtitles) {
                    const parsed = manager.parseSyncedLyrics(lyricsData.subtitles);

                    const line = parsed.find((l) => Math.abs(l.time - timestampSeconds) < 1.0);

                    if (line && line.text && manager.currentGeniusData) {
                        const annotations = manager.geniusManager.findAnnotations(
                            line.text,
                            manager.currentGeniusData.referents
                        );
                        showGeniusAnnotations(annotations, line.text);
                    }
                }
                return;
            }

            audioPlayer.currentTime = e.detail.timestamp / 1000;
            audioPlayer.play();
        }
    };

    audioPlayer.addEventListener('timeupdate', updateTime);
    audioPlayer.addEventListener('play', onPlay);
    audioPlayer.addEventListener('pause', onPause);
    audioPlayer.addEventListener('seeked', updateTime);
    amLyrics.addEventListener('line-click', onLineClick);

    if (!audioPlayer.paused) {
        tick();
    }

    return () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        audioPlayer.removeEventListener('timeupdate', updateTime);
        audioPlayer.removeEventListener('play', onPlay);
        audioPlayer.removeEventListener('pause', onPause);
        audioPlayer.removeEventListener('seeked', updateTime);
        amLyrics.removeEventListener('line-click', onLineClick);
    };
}

function showGeniusAnnotations(annotations, lineText) {
    const existing = document.querySelector('.genius-annotation-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'genius-annotation-modal';

    let contentHtml = `
        <div class="genius-modal-content">
            <div class="genius-header">
                <span class="genius-line">"${lineText}"</span>
                <button class="close-genius">×</button>
            </div>
            <div class="genius-body">
    `;

    if (annotations.length === 0) {
        contentHtml += `
            <div class="annotation-item">
                <div class="annotation-text" style="color: var(--muted-foreground); font-style: italic;">No Genius annotation found for this line.</div>
            </div>
        `;
    } else {
        annotations.forEach((ann) => {
            const body = ann.annotations[0].body.plain;
            contentHtml += `
                <div class="annotation-item">
                    <div class="annotation-text">${body.replace(/\n/g, '<br>')}</div>
                </div>
            `;
        });
    }

    contentHtml += `</div></div>`;
    modal.innerHTML = contentHtml;

    document.body.appendChild(modal);

    modal.querySelector('.close-genius').addEventListener('click', () => modal.remove());

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

export async function renderLyricsInFullscreen(track, audioPlayer, lyricsManager, container) {
    return renderLyricsComponent(container, track, audioPlayer, lyricsManager);
}

export function clearFullscreenLyricsSync(container) {
    if (container && container.lyricsCleanup) {
        container.lyricsCleanup();
        container.lyricsCleanup = null;
    }
    if (container && container.lyricsManager) {
        container.lyricsManager.stopLyricsObserver();
    }
}

export function clearLyricsPanelSync(audioPlayer, panel) {
    if (panel && panel.lyricsCleanup) {
        panel.lyricsCleanup();
        panel.lyricsCleanup = null;
    }
    if (panel && panel.lyricsManager) {
        panel.lyricsManager.stopLyricsObserver();
    }
}
