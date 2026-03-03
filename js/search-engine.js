// js/search-engine.js
// Intelligent Hyper-Fast Search Engine
// Features: dependency-free local semantic index, query cache, inflight dedup, voice search, history

const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 50;

export class SearchEngine {
    constructor(api) {
        this.api = api;
        /** @type {Map<string, Promise>} inflight requests keyed by query */
        this._inflight = new Map();
        /** @type {Map<string, {ts: number, results: any}>} in-memory cache */
        this._cache = new Map();
        /** @type {Array<any>} local track index */
        this._indexItems = [];
        /** @type {Array<{item: any, nTitle: string, nArtist: string, nAlbum: string}>} normalized index */
        this._normalizedIndex = [];
        /** @type {SpeechRecognition|null} voice recognition */
        this._recognition = null;
        this._voiceActive = false;
        this._rebuildDebounce = null;
        /** @type {Map<string, number>} query history */
        this._history = new Map();
    }

    _normalize(value) {
        return String(value || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[“”„‟«»]/g, '"')
            .replace(/[’‘‚‛]/g, "'")
            .replace(/[‐‑‒–—―]/g, '-')
            .replace(/\s+(feat|featuring|ft)\.?\s+/giu, ' ')
            .replace(/[()\[\]{}]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _toHiragana(text) {
        return text.replace(/[\u30A1-\u30F6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
    }

    _toKatakana(text) {
        return text.replace(/[\u3041-\u3096]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));
    }

    _expandQueryVariants(query) {
        const base = this._normalize(query);
        if (!base) return [];

        const variants = new Set([base]);

        // Kana auto-variant support (Japanese)
        variants.add(this._toHiragana(base));
        variants.add(this._toKatakana(base));

        // Width/diacritics folded variant
        variants.add(base.normalize('NFKD').replace(/\p{M}/gu, ''));

        // Keep CJK as-is but also remove spaces to improve matching over segmented queries
        variants.add(base.replace(/\s+/g, ''));

        return Array.from(variants).filter(Boolean);
    }

    _tokenSet(value) {
        return new Set(this._normalize(value).split(/\s+/).filter(Boolean));
    }

    _jaccard(a, b) {
        if (!a.size || !b.size) return 0;
        let common = 0;
        for (const token of a) {
            if (b.has(token)) common += 1;
        }
        return common / (a.size + b.size - common);
    }

    _fieldScore(queryVariants, haystack) {
        const normalizedHaystack = this._normalize(haystack);
        if (!normalizedHaystack) return 0;

        let best = 0;
        const haystackTokens = this._tokenSet(normalizedHaystack);

        for (const q of queryVariants) {
            if (!q) continue;
            if (normalizedHaystack === q) return 1;
            if (normalizedHaystack.includes(q) || q.includes(normalizedHaystack)) {
                best = Math.max(best, 0.92);
            }

            const score = this._jaccard(this._tokenSet(q), haystackTokens);
            best = Math.max(best, score);
        }

        return best;
    }

    // ─── Local Index ──────────────────────────────────────────────────────────

    /**
     * Rebuild dependency-free local index from favorites/recent items.
     * @param {Array} items
     */
    buildLocalIndex(items) {
        this._indexItems = Array.isArray(items) ? items : [];
        this._normalizedIndex = this._indexItems.map((item) => ({
            item,
            nTitle: this._normalize(item?.title),
            nArtist: this._normalize(item?.artist?.name || item?.artists?.[0]?.name),
            nAlbum: this._normalize(item?.album?.title),
        }));
    }

    /**
     * Perform instant local semantic search over normalized index.
     * Includes lightweight multilingual query variant expansion.
     * @param {string} query
     * @returns {Array} up to 8 results
     */
    searchLocal(query) {
        if (!query || this._normalizedIndex.length === 0) return [];

        const variants = this._expandQueryVariants(query);
        if (!variants.length) return [];

        const scored = [];
        for (const entry of this._normalizedIndex) {
            const titleScore = this._fieldScore(variants, entry.nTitle);
            const artistScore = this._fieldScore(variants, entry.nArtist);
            const albumScore = this._fieldScore(variants, entry.nAlbum);

            const score = titleScore * 0.62 + artistScore * 0.28 + albumScore * 0.1;
            if (score < 0.22) continue;

            scored.push({ item: entry.item, score });
        }

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
            .map((r) => ({ ...r.item, _score: 1 - r.score, _source: 'local' }));
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
        const variants = this._expandQueryVariants(query);
        const remoteQuery = variants[0] || query;

        const promise = Promise.allSettled([
            this.api.searchTracks(remoteQuery, { limit: 8 }),
            this.api.searchAlbums(remoteQuery, { limit: 6 }),
            this.api.searchArtists(remoteQuery, { limit: 6 }),
            this.api.searchPlaylists(remoteQuery, { limit: 6 }),
        ])
            .then((responses) => {
                const [tracksRes, albumsRes, artistsRes, playlistsRes] = responses;
                const results = {
                    tracks: tracksRes.status === 'fulfilled' ? tracksRes.value?.items || [] : [],
                    albums: albumsRes.status === 'fulfilled' ? albumsRes.value?.items || [] : [],
                    artists: artistsRes.status === 'fulfilled' ? artistsRes.value?.items || [] : [],
                    playlists: playlistsRes.status === 'fulfilled' ? playlistsRes.value?.items || [] : [],
                };
                this._cache.set(normalized, { ts: Date.now(), results });
                this._inflight.delete(normalized);
                // Evict oldest entries if cache is too large
                if (this._cache.size > MAX_CACHE_ENTRIES) {
                    const oldest = [...this._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0][0];
                    this._cache.delete(oldest);
                }
                return results;
            })
            .catch((err) => {
                this._inflight.delete(normalized);
                throw err;
            });

        this._inflight.set(normalized, promise);
        return promise;
    }

    addToHistory(query) {
        const key = this._normalize(query);
        if (!key) return;
        const next = (this._history.get(key) || 0) + 1;
        this._history.set(key, next);
    }

    getHistory(limit = 8) {
        return Array.from(this._history.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([q]) => q);
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
