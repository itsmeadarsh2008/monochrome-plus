// js/search-engine.js
// Intelligent Hyper-Fast Search Engine
// Features: local fuse.js index, query cache, inflight dedup, voice search, history

import Fuse from 'fuse.js';

const HISTORY_KEY = 'search-history-v2';
const CACHE_KEY_PREFIX = 'search-cache-v1:';
const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_HISTORY = 20;
const MAX_CACHE_ENTRIES = 50;

export class SearchEngine {
    constructor(api) {
        this.api = api;
        /** @type {Map<string, Promise>} inflight requests keyed by query */
        this._inflight = new Map();
        /** @type {Map<string, {ts: number, results: any}>} in-memory cache */
        this._cache = new Map();
        /** @type {Fuse|null} local fuzzy search index */
        this._fuse = null;
        /** @type {SpeechRecognition|null} voice recognition */
        this._recognition = null;
        this._voiceActive = false;
        this._rebuildDebounce = null;
    }

    // ─── Local Index ──────────────────────────────────────────────────────────

    /**
     * Rebuild the fuse.js index from the local favorites + recently played items.
     * @param {Array} items
     */
    buildLocalIndex(items) {
        this._fuse = new Fuse(items, {
            keys: [
                { name: 'title', weight: 0.5 },
                { name: 'artist.name', weight: 0.3 },
                { name: 'album.title', weight: 0.2 },
            ],
            threshold: 0.35,
            includeScore: true,
            minMatchCharLength: 2,
            ignoreLocation: true,
        });
    }

    /**
     * Perform an instant local search against the fuse.js index.
     * @param {string} query
     * @returns {Array} up to 8 results
     */
    searchLocal(query) {
        if (!this._fuse || !query) return [];
        return this._fuse.search(query, { limit: 8 }).map(r => ({ ...r.item, _score: r.score, _source: 'local' }));
    }

    // ─── Remote Search with Cache + Dedup ────────────────────────────────────

    /**
     * Search the remote API, with in-memory caching and inflight deduplication.
     * @param {string} query
     * @returns {Promise<any>}
     */
    async searchRemote(query) {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return null;

        // 1. Memory cache hit
        const cached = this._cache.get(normalized);
        if (cached && Date.now() - cached.ts < CACHE_MAX_AGE_MS) {
            return cached.results;
        }

        // 2. In-flight dedup
        if (this._inflight.has(normalized)) {
            return this._inflight.get(normalized);
        }

        // 3. Remote fetch
        const promise = this.api.search(query).then(results => {
            this._cache.set(normalized, { ts: Date.now(), results });
            this._inflight.delete(normalized);
            // Evict oldest entries if cache is too large
            if (this._cache.size > MAX_CACHE_ENTRIES) {
                const oldest = [...this._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0][0];
                this._cache.delete(oldest);
            }
            return results;
        }).catch(err => {
            this._inflight.delete(normalized);
            throw err;
        });

        this._inflight.set(normalized, promise);
        return promise;
    }

    /**
     * Full search: returns instant local results immediately, fires remote in background.
     * @param {string} query
     * @param {function} onLocal       Called immediately with local results (may be empty)
     * @param {function} onRemote      Called when remote results arrive
     */
    async search(query, onLocal, onRemote) {
        const local = this.searchLocal(query);
        onLocal(local);

        try {
            const remote = await this.searchRemote(query);
            onRemote(remote);
        } catch (err) {
            console.warn('[SearchEngine] Remote search failed:', err);
            onRemote(null);
        }
    }

    // ─── Search History ───────────────────────────────────────────────────────

    getHistory() {
        try {
            return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        } catch {
            return [];
        }
    }

    addToHistory(query) {
        if (!query || query.length < 2) return;
        let history = this.getHistory().filter(q => q !== query);
        history.unshift(query);
        if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    clearHistory() {
        localStorage.removeItem(HISTORY_KEY);
    }

    removeFromHistory(query) {
        const history = this.getHistory().filter(q => q !== query);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    // ─── Voice Search ─────────────────────────────────────────────────────────

    get isVoiceSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    /**
     * Start voice recognition. Returns a Promise that resolves with the transcript.
     * @returns {Promise<string>}
     */
    startVoiceSearch() {
        return new Promise((resolve, reject) => {
            if (!this.isVoiceSupported) {
                reject(new Error('SpeechRecognition not supported'));
                return;
            }
            if (this._voiceActive) {
                this._recognition?.stop();
            }

            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            this._recognition = new SR();
            this._recognition.lang = 'en-US';
            this._recognition.interimResults = false;
            this._recognition.maxAlternatives = 1;
            this._voiceActive = true;

            this._recognition.onresult = (e) => {
                const transcript = e.results[0][0].transcript;
                this._voiceActive = false;
                resolve(transcript);
            };

            this._recognition.onerror = (e) => {
                this._voiceActive = false;
                reject(new Error(e.error));
            };

            this._recognition.onend = () => {
                this._voiceActive = false;
            };

            this._recognition.start();
        });
    }

    stopVoiceSearch() {
        this._recognition?.stop();
        this._voiceActive = false;
    }

    get isVoiceActive() {
        return this._voiceActive;
    }
}
