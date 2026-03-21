export class MusicDatabase {
    constructor() {
        this.dbName = 'MonochromeDB';
        this.version = 9;
        this.db = null;
    }

    async open() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = (event) => {
                console.error('Database error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Favorites stores
                if (!db.objectStoreNames.contains('favorites_tracks')) {
                    const store = db.createObjectStore('favorites_tracks', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_albums')) {
                    const store = db.createObjectStore('favorites_albums', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_artists')) {
                    const store = db.createObjectStore('favorites_artists', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_playlists')) {
                    const store = db.createObjectStore('favorites_playlists', { keyPath: 'uuid' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_mixes')) {
                    const store = db.createObjectStore('favorites_mixes', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('history_tracks')) {
                    const store = db.createObjectStore('history_tracks', { keyPath: 'timestamp' });
                    store.createIndex('timestamp', 'timestamp', { unique: true });
                }
                if (!db.objectStoreNames.contains('user_playlists')) {
                    const store = db.createObjectStore('user_playlists', { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('user_folders')) {
                    const store = db.createObjectStore('user_folders', { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings');
                }
                if (!db.objectStoreNames.contains('pinned_items')) {
                    const store = db.createObjectStore('pinned_items', { keyPath: 'id' });
                    store.createIndex('pinnedAt', 'pinnedAt', { unique: false });
                }
                // Friends system stores
                if (!db.objectStoreNames.contains('friends')) {
                    const store = db.createObjectStore('friends', { keyPath: 'uid' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('friend_requests')) {
                    const store = db.createObjectStore('friend_requests', { keyPath: 'uid' });
                    store.createIndex('requestedAt', 'requestedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('shared_tracks')) {
                    const store = db.createObjectStore('shared_tracks', { keyPath: 'id' });
                    store.createIndex('sharedAt', 'sharedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('collaborative_playlists')) {
                    const store = db.createObjectStore('collaborative_playlists', { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('collab_playlist_members')) {
                    const store = db.createObjectStore('collab_playlist_members', { keyPath: 'id' });
                    store.createIndex('playlistId', 'playlistId', { unique: false });
                }
            };
        });
    }

    // Generic Helper
    async performTransaction(storeName, mode, callback) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = callback(store);

            transaction.oncomplete = () => {
                resolve(request?.result);
            };
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    // History API
    _getHistoryKey(track) {
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
    }

    async addToHistory(track) {
        const storeName = 'history_tracks';
        const minified = this._minifyItem('track', track);
        // Use sub-millisecond entropy to avoid timestamp key collisions in IndexedDB.
        const timestamp = Number(`${Date.now()}.${Math.floor(Math.random() * 1000000)}`);
        const historyKey = this._getHistoryKey(track);
        const entry = { ...minified, timestamp, historyKey };

        const db = await this.open();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);

            store.put(entry);

            transaction.oncomplete = () => {
                // Sync to cloud immediately
                this._syncHistoryItemToCloud(entry).catch((error) => {
                    console.warn('[DB] Failed to sync history to cloud:', error);
                });

                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('history-changed'));
                }

                resolve(entry);
            };
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    async _syncHistoryItemToCloud(entry) {
        try {
            const { syncManager } = await import('./accounts/appwrite-sync.js');
            if (syncManager?.syncHistoryItem) {
                await syncManager.syncHistoryItem(entry);
            }
        } catch (error) {
            console.warn('[DB] Cloud sync failed for history item:', error);
        }
    }

    async getHistory() {
        const storeName = 'history_tracks';
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index('timestamp');
            const request = index.getAll();

            request.onsuccess = () => {
                // Return reversed (newest first)
                resolve(request.result.reverse());
            };
            request.onerror = () => reject(request.error);
        });
    }

    async clearHistory() {
        const storeName = 'history_tracks';
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async deduplicateHistory() {
        const storeName = 'history_tracks';
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const index = store.index('timestamp');
            const cursorReq = index.openCursor(null, 'prev');

            // Keep only the newest entry per track key
            const seen = new Set();
            let removed = 0;

            const getTrackKey = (entry) => {
                if (!entry || typeof entry !== 'object') return null;
                if (entry.historyKey) return entry.historyKey;
                const trackId = entry.id || entry.trackId || entry.uuid || entry.isrc;
                if (trackId) return String(trackId);

                const title = String(entry.title || entry.name || '')
                    .trim()
                    .toLowerCase();
                const artists = Array.isArray(entry.artists)
                    ? entry.artists
                          .map((artist) =>
                              String(artist?.name || artist || '')
                                  .trim()
                                  .toLowerCase()
                          )
                          .filter(Boolean)
                          .join(',')
                    : String(entry.artist?.name || entry.artist || '')
                          .trim()
                          .toLowerCase();

                if (!title && !artists) return null;
                const duration = Number(entry.duration || entry.length || 0) || 0;
                return `meta:${title}:${artists}:${duration}`;
            };

            cursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) return;
                const trackKey = getTrackKey(cursor.value);
                if (trackKey && seen.has(trackKey)) {
                    store.delete(cursor.primaryKey);
                    removed++;
                } else if (trackKey) {
                    seen.add(trackKey);
                }
                cursor.continue();
            };

            transaction.oncomplete = () => {
                if (removed > 0) console.log(`[DB] Deduplicated history: removed ${removed} duplicate entries`);
                resolve(removed);
            };
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    // Favorites API
    async toggleFavorite(type, item) {
        const plural = type === 'mix' ? 'mixes' : `${type}s`;
        const storeName = `favorites_${plural}`;
        const key = type === 'playlist' ? item.uuid : item.id;
        const exists = await this.isFavorite(type, key);

        if (exists) {
            await this.performTransaction(storeName, 'readwrite', (store) => store.delete(key));
            // Sync to cloud immediately
            this._syncLibraryItemToCloud(type, item, false).catch((error) => {
                console.warn('[DB] Failed to sync library removal to cloud:', error);
            });
            return false; // Removed
        } else {
            const minified = this._minifyItem(type, item);
            const entry = { ...minified, addedAt: Date.now() };
            await this.performTransaction(storeName, 'readwrite', (store) => store.put(entry));
            // Sync to cloud immediately
            this._syncLibraryItemToCloud(type, entry, true).catch((error) => {
                console.warn('[DB] Failed to sync library addition to cloud:', error);
            });
            return true; // Added
        }
    }

    async _syncLibraryItemToCloud(type, item, added) {
        try {
            const { syncManager } = await import('./accounts/appwrite-sync.js');
            if (syncManager?.syncLibraryItem) {
                await syncManager.syncLibraryItem(type, item, added);
            }
        } catch (error) {
            console.warn('[DB] Cloud sync failed for library item:', error);
        }
    }

    async isFavorite(type, id) {
        const plural = type === 'mix' ? 'mixes' : `${type}s`;
        const storeName = `favorites_${plural}`;
        try {
            const result = await this.performTransaction(storeName, 'readonly', (store) => store.get(id));
            return !!result;
        } catch {
            return false;
        }
    }

    async getFavorites(type) {
        const plural = type === 'mix' ? 'mixes' : `${type}s`;
        const storeName = `favorites_${plural}`;
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);

            const request = store.getAll();

            request.onsuccess = () => {
                const results = request.result;
                results.sort((a, b) => {
                    const aTime = a.addedAt || 0;
                    const bTime = b.addedAt || 0;
                    return bTime - aTime; // Newest first
                });
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    _minifyItem(type, item) {
        if (!item) return item;

        // Base properties to keep
        const base = {
            id: item.id,
            addedAt: item.addedAt || null,
        };

        if (type === 'track') {
            return {
                ...base,
                addedById: item.addedById || null,
                addedByName: item.addedByName || null,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                // Keep minimal artist info
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                // Keep minimal album info
                album: item.album
                    ? {
                          id: item.album.id,
                          title: item.album.title || null,
                          cover: item.album.cover || null,
                          releaseDate: item.album.releaseDate || null,
                          vibrantColor: item.album.vibrantColor || null,
                          artist: item.album.artist || null,
                          numberOfTracks: item.album.numberOfTracks || null,
                          mediaMetadata: item.album.mediaMetadata ? { tags: item.album.mediaMetadata.tags } : null,
                      }
                    : null,
                copyright: item.copyright || null,
                isrc: item.isrc || null,
                trackNumber: item.trackNumber || null,
                // Fallback date
                streamStartDate: item.streamStartDate || null,
                // Keep version if exists
                version: item.version || null,
                // Keep mix info
                mixes: item.mixes || null,
                isTracker: item.isTracker || (item.id && String(item.id).startsWith('tracker-')),
                trackerInfo: item.trackerInfo || null,
                audioUrl: item.remoteUrl || item.audioUrl || null,
                remoteUrl: item.remoteUrl || null,
                audioQuality: item.audioQuality || null,
                mediaMetadata: item.mediaMetadata ? { tags: item.mediaMetadata.tags } : null,
            };
        }

        if (type === 'album') {
            return {
                ...base,
                title: item.title || null,
                cover: item.cover || null,
                releaseDate: item.releaseDate || null,
                explicit: item.explicit || false,
                // UI uses singular 'artist'
                artist: item.artist
                    ? { name: item.artist.name || null, id: item.artist.id }
                    : item.artists?.[0]
                      ? { name: item.artists[0].name || null, id: item.artists[0].id }
                      : null,
                // Keep type and track count for UI labels
                type: item.type || null,
                numberOfTracks: item.numberOfTracks || null,
            };
        }

        if (type === 'artist') {
            return {
                ...base,
                name: item.name || null,
                picture: item.picture || item.image || null, // Handle both just in case
            };
        }

        if (type === 'playlist') {
            return {
                uuid: item.uuid || item.id,
                addedAt: item.addedAt || item.createdAt || null,
                title: item.title || item.name || null,
                // UI checks squareImage || image || uuid
                image: item.image || item.squareImage || item.cover || null,
                numberOfTracks: item.numberOfTracks || (item.tracks ? item.tracks.length : 0),
                user: item.user ? { name: item.user.name || null } : null,
            };
        }

        if (type === 'mix') {
            return {
                id: item.id,
                addedAt: item.addedAt,
                title: item.title,
                subTitle: item.subTitle,
                description: item.description,
                mixType: item.mixType,
                cover: item.cover,
            };
        }

        return item;
    }

    _minifyPinnedItem(item, type) {
        if (!item) return null;

        const id = item.id || item.uuid;
        let name, cover, href, images;

        switch (type) {
            case 'album':
                name = item.title;
                cover = item.cover;
                href = `/album/${id}`;
                break;
            case 'artist':
                name = item.name;
                cover = item.picture;
                href = `/artist/${id}`;
                break;
            case 'playlist':
                name = item.title || item.name;
                cover = item.image || item.cover;
                href = `/playlist/${id}`;
                break;
            case 'user-playlist':
                name = item.name;
                cover = item.cover;
                images = item.images;
                href = `/userplaylist/${id}`;
                break;
            default:
                return null;
        }

        return {
            id: id,
            type: type,
            name: name,
            cover: cover,
            images: images,
            href: href,
        };
    }

    async togglePinned(item, type) {
        const storeName = 'pinned_items';
        const minifiedItem = this._minifyPinnedItem(item, type);
        if (!minifiedItem) return;

        const key = minifiedItem.id;
        const exists = await this.isPinned(key);

        if (exists) {
            await this.performTransaction(storeName, 'readwrite', (store) => store.delete(key));
            return false;
        } else {
            const allPinned = await this.getPinned();
            if (allPinned.length >= 3) {
                const oldest = allPinned.sort((a, b) => a.pinnedAt - b.pinnedAt)[0];
                await this.performTransaction(storeName, 'readwrite', (store) => store.delete(oldest.id));
            }
            const entry = { ...minifiedItem, pinnedAt: Date.now() };
            await this.performTransaction(storeName, 'readwrite', (store) => store.put(entry));
            return true;
        }
    }

    async isPinned(id) {
        const storeName = 'pinned_items';
        try {
            const result = await this.performTransaction(storeName, 'readonly', (store) => store.get(id));
            return !!result;
        } catch {
            return false;
        }
    }

    async exportData() {
        const tracks = await this.getFavorites('track');
        const albums = await this.getFavorites('album');
        const artists = await this.getFavorites('artist');
        const playlists = await this.getFavorites('playlist');
        const mixes = await this.getFavorites('mix');
        const history = await this.getHistory();

        const userPlaylists = await this.getPlaylists(true);
        const userFolders = await this.getFolders();
        const data = {
            favorites_tracks: tracks.map((t) => this._minifyItem('track', t)),
            favorites_albums: albums.map((a) => this._minifyItem('album', a)),
            favorites_artists: artists.map((a) => this._minifyItem('artist', a)),
            favorites_playlists: playlists.map((p) => this._minifyItem('playlist', p)),
            favorites_mixes: mixes.map((m) => this._minifyItem('mix', m)),
            history_tracks: history.map((t) => this._minifyItem('track', t)),
            user_playlists: userPlaylists,
            user_folders: userFolders,
        };
        return data;
    }

    async importData(data, clear = false) {
        const db = await this.open();

        const importStore = async (storeName, items) => {
            if (items === undefined) return false;

            let itemsArray = Array.isArray(items) ? items : Object.values(items || {});

            console.log(`Importing to ${storeName}: ${itemsArray.length} items`);

            if (itemsArray.length === 0) {
                if (clear) {
                    return new Promise((resolve, reject) => {
                        const transaction = db.transaction(storeName, 'readwrite');
                        const store = transaction.objectStore(storeName);

                        const countReq = store.count();
                        countReq.onsuccess = () => {
                            if (countReq.result > 0) {
                                store.clear();
                            }
                        };

                        transaction.oncomplete = () => {
                            resolve(countReq.result > 0);
                        };
                        transaction.onerror = () => reject(transaction.error);
                    });
                }
                return false;
            }

            // For history_tracks, do a proper merge: combine local and cloud entries,
            // keep each distinct play, remove exact timestamp duplicates and
            // consecutive same-track repeats.
            if (storeName === 'history_tracks' && !clear) {
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(storeName, 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const getAllReq = store.getAll();

                    getAllReq.onsuccess = () => {
                        const localEntries = getAllReq.result || [];
                        const allEntries = [...localEntries, ...itemsArray].map((entry) => {
                            const normalized = {
                                ...entry,
                                historyKey: entry.historyKey || this._getHistoryKey(entry),
                                timestamp: entry.timestamp || Date.now() + Math.random(),
                            };
                            return normalized;
                        });

                        allEntries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

                        const deDuped = [];
                        for (const entry of allEntries) {
                            const last = deDuped[deDuped.length - 1];
                            if (!last) {
                                deDuped.push(entry);
                                continue;
                            }

                            // drop exact timestamp duplicate of same track key
                            if (
                                entry.historyKey &&
                                entry.historyKey === last.historyKey &&
                                entry.timestamp === last.timestamp
                            ) {
                                continue;
                            }

                            deDuped.push(entry);
                        }

                        // Keep full history (no forced max-limit) while preserving non-duplicates.
                        const trimmed = deDuped.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

                        // Clear and rewrite
                        store.clear();
                        for (const entry of trimmed) {
                            store.put(entry);
                        }
                    };

                    transaction.oncomplete = () => {
                        console.log(`${storeName}: Merged import complete`);
                        resolve(true);
                    };
                    transaction.onerror = (event) => {
                        console.error(`${storeName}: Merge error:`, event.target.error);
                        reject(transaction.error);
                    };
                });
            }

            // Deduplicate history_tracks for exact duplicates only (same key + same timestamp), not by track ID.
            if (storeName === 'history_tracks') {
                const seen = new Set();
                const reduced = [];
                for (const item of itemsArray) {
                    const key = this._getHistoryKey(item) || String(item.id || item.trackId || item.isrc || '');
                    const timestamp = item.timestamp || 0;
                    const unique = `${key}::${timestamp}`;
                    if (!seen.has(unique)) {
                        seen.add(unique);
                        reduced.push(item);
                    }
                }
                itemsArray = reduced;
            }

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);

                if (clear) {
                    console.log(`Clearing ${storeName} before import`);
                    store.clear();
                }

                itemsArray.forEach((item) => {
                    if (item.id && typeof item.id === 'string' && !isNaN(item.id)) {
                        item.id = parseInt(item.id, 10);
                    }
                    if (item.album?.id && typeof item.album.id === 'string' && !isNaN(item.album.id)) {
                        item.album.id = parseInt(item.album.id, 10);
                    }
                    if (item.artists) {
                        item.artists.forEach((artist) => {
                            if (artist.id && typeof artist.id === 'string' && !isNaN(artist.id)) {
                                artist.id = parseInt(artist.id, 10);
                            }
                        });
                    }

                    // Critical: Ensure key exists for IndexedDB store.put()
                    const keyPath = store.keyPath;
                    if (keyPath && !item[keyPath]) {
                        console.warn(`Item missing keyPath "${keyPath}" in ${storeName}, generating fallback.`);
                        if (keyPath === 'uuid') item.uuid = crypto.randomUUID();
                        else if (keyPath === 'id')
                            item.id = item.trackId || item.albumId || item.artistId || Date.now() + Math.random();
                        else if (keyPath === 'timestamp') item.timestamp = Date.now() + Math.random();
                    }

                    store.put(item);
                });

                transaction.oncomplete = () => {
                    console.log(`${storeName}: Imported ${itemsArray.length} items`);
                    resolve(true);
                };

                transaction.onerror = (event) => {
                    console.error(`${storeName}: Transaction error:`, event.target.error);
                    reject(transaction.error);
                };
            });
        };

        console.log('Starting import with data:', {
            tracks: data.favorites_tracks?.length || 0,
            albums: data.favorites_albums?.length || 0,
            artists: data.favorites_artists?.length || 0,
            playlists: data.favorites_playlists?.length || 0,
            mixes: data.favorites_mixes?.length || 0,
            history: data.history_tracks?.length || 0,
            userPlaylists: data.user_playlists?.length || 0,
            user_folders: data.user_folders?.length || 0,
        });

        const results = await Promise.all([
            importStore('favorites_tracks', data.favorites_tracks),
            importStore('favorites_albums', data.favorites_albums),
            importStore('favorites_artists', data.favorites_artists),
            importStore('favorites_playlists', data.favorites_playlists),
            importStore('favorites_mixes', data.favorites_mixes),
            importStore('history_tracks', data.history_tracks),
            data.user_playlists ? importStore('user_playlists', data.user_playlists) : Promise.resolve(false),
            data.user_folders ? importStore('user_folders', data.user_folders) : Promise.resolve(false),
        ]);

        console.log('Import results:', results);
        return results.some((r) => r);
    }

    _updatePlaylistMetadata(playlist) {
        playlist.numberOfTracks = playlist.tracks ? playlist.tracks.length : 0;

        if (!playlist.cover) {
            const uniqueCovers = [];
            const seenCovers = new Set();
            const tracks = playlist.tracks || [];
            for (const track of tracks) {
                const cover = track.album?.cover;
                if (cover && !seenCovers.has(cover)) {
                    seenCovers.add(cover);
                    uniqueCovers.push(cover);
                    if (uniqueCovers.length >= 4) break;
                }
            }
            playlist.images = uniqueCovers;
        }
        return playlist;
    }

    _dispatchPlaylistSync(action, playlist) {
        window.dispatchEvent(
            new CustomEvent('sync-playlist-change', {
                detail: { action, playlist },
            })
        );

        // Immediately sync to cloud
        this._syncPlaylistToCloud(action, playlist).catch((error) => {
            console.warn('[DB] Failed to sync playlist to cloud:', error);
        });
    }

    async _syncPlaylistToCloud(action, playlist) {
        try {
            const { syncManager } = await import('./accounts/appwrite-sync.js');
            if (syncManager?.syncUserPlaylist) {
                await syncManager.syncUserPlaylist(playlist, action);
            }
        } catch (error) {
            console.warn('[DB] Cloud sync failed for playlist:', error);
        }
    }

    async _syncCollaborativePlaylist(action, playlist) {
        window.dispatchEvent(
            new CustomEvent('sync-collab-playlist-change', {
                detail: { action, playlist },
            })
        );

        try {
            const { syncManager } = await import('./accounts/appwrite-sync.js');
            if (syncManager?.syncCollaborativePlaylist) {
                await syncManager.syncCollaborativePlaylist(playlist, action);
            }
        } catch (error) {
            console.warn('[Collaborative Sync] Failed to sync collaborative playlist change:', error);
        }
    }

    // User Playlists API
    async createPlaylist(name, tracks = [], cover = '', description = '') {
        const id = crypto.randomUUID();
        const playlist = {
            id: id,
            name: name,
            tracks: tracks.map((t) => this._minifyItem('track', { ...t, addedAt: Date.now() })),
            cover: cover,
            description: description,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            numberOfTracks: tracks.length,
            images: [], // Initialize images
        };
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        // TRIGGER SYNC
        this._dispatchPlaylistSync('create', playlist);

        return playlist;
    }

    async addTrackToPlaylist(playlistId, track) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];
        const trackWithDate = { ...track, addedAt: Date.now() };
        const minifiedTrack = this._minifyItem('track', trackWithDate);
        if (playlist.tracks.some((t) => t.id === track.id)) return;
        playlist.tracks.push(minifiedTrack);
        playlist.updatedAt = Date.now();
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async addTracksToPlaylist(playlistId, tracks) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];

        let addedCount = 0;
        for (const track of tracks) {
            if (!playlist.tracks.some((t) => t.id === track.id)) {
                const trackWithDate = { ...track, addedAt: Date.now() };
                playlist.tracks.push(this._minifyItem('track', trackWithDate));
                addedCount++;
            }
        }

        if (addedCount > 0) {
            playlist.updatedAt = Date.now();
            this._updatePlaylistMetadata(playlist);
            await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
            this._dispatchPlaylistSync('update', playlist);
        }

        return playlist;
    }

    async removeTrackFromPlaylist(playlistId, trackId) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];
        playlist.tracks = playlist.tracks.filter((t) => String(t.id) !== String(trackId));
        playlist.updatedAt = Date.now();
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async deletePlaylist(playlistId) {
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.delete(playlistId));

        // TRIGGER SYNC (but for deleting)
        this._dispatchPlaylistSync('delete', { id: playlistId });
    }

    async getPlaylist(playlistId) {
        return await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
    }

    async updatePlaylist(playlist) {
        playlist.updatedAt = Date.now();
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async addPlaylistToFolder(folderId, playlistId) {
        const folder = await this.getFolder(folderId);
        if (!folder) throw new Error('Folder not found');
        folder.playlists = folder.playlists || [];
        if (!folder.playlists.includes(playlistId)) {
            folder.playlists.push(playlistId);
            folder.updatedAt = Date.now();
            await this.performTransaction('user_folders', 'readwrite', (store) => store.put(folder));
            // Sync to cloud immediately
            this._syncFolderToCloud('update', folder).catch((error) => {
                console.warn('[DB] Failed to sync folder update to cloud:', error);
            });
        }
        return folder;
    }

    // User Folders API
    async createFolder(name, cover = '') {
        const id = crypto.randomUUID();
        const folder = {
            id: id,
            name: name,
            cover: cover,
            playlists: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await this.performTransaction('user_folders', 'readwrite', (store) => store.put(folder));
        // Sync to cloud immediately
        this._syncFolderToCloud('create', folder).catch((error) => {
            console.warn('[DB] Failed to sync folder creation to cloud:', error);
        });
        return folder;
    }

    async getFolders() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_folders', 'readonly');
            const store = transaction.objectStore('user_folders');
            const index = store.index('createdAt');
            const request = index.getAll();
            request.onsuccess = () => resolve(request.result.reverse());
            request.onerror = () => reject(request.error);
        });
    }

    async getFolder(id) {
        return await this.performTransaction('user_folders', 'readonly', (store) => store.get(id));
    }

    async deleteFolder(id) {
        await this.performTransaction('user_folders', 'readwrite', (store) => store.delete(id));
        // Sync to cloud immediately
        this._syncFolderToCloud('delete', { id }).catch((error) => {
            console.warn('[DB] Failed to sync folder deletion to cloud:', error);
        });
    }

    async _syncFolderToCloud(action, folder) {
        try {
            const { syncManager } = await import('./accounts/appwrite-sync.js');
            if (syncManager?.syncUserFolder) {
                await syncManager.syncUserFolder(folder, action);
            }
        } catch (error) {
            console.warn('[DB] Cloud sync failed for folder:', error);
        }
    }

    async getPinned() {
        const storeName = 'pinned_items';
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                const results = request.result;
                results.sort((a, b) => b.pinnedAt - a.pinnedAt);
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getPlaylists(includeTracks = false) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_playlists', 'readwrite'); // Changed to readwrite for lazy migration
            const store = transaction.objectStore('user_playlists');
            const request = store.getAll();
            request.onsuccess = () => {
                const playlists = request.result;
                const processedPlaylists = playlists.map((playlist) => {
                    let needsUpdate = false;

                    if (typeof playlist.createdAt === 'undefined') {
                        playlist.createdAt = playlist.updatedAt || Date.now();
                        needsUpdate = true;
                    }

                    if (typeof playlist.updatedAt === 'undefined') {
                        playlist.updatedAt = playlist.createdAt || Date.now();
                        needsUpdate = true;
                    }

                    // Lazy migration for numberOfTracks
                    if (typeof playlist.numberOfTracks === 'undefined') {
                        playlist.numberOfTracks = playlist.tracks ? playlist.tracks.length : 0;
                        needsUpdate = true;
                    }

                    // Lazy migration for images (collage)
                    if (!playlist.cover && (!playlist.images || playlist.images.length === 0)) {
                        this._updatePlaylistMetadata(playlist);
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        // We are in a readwrite transaction, so we can put back
                        try {
                            store.put(playlist);
                        } catch (e) {
                            console.warn('Failed to update playlist metadata', e);
                        }
                    }

                    if (includeTracks) {
                        return playlist;
                    }

                    // Return lightweight copy without tracks
                    // eslint-disable-next-line no-unused-vars
                    const { tracks, ...minified } = playlist;
                    return minified;
                });
                processedPlaylists.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                resolve(processedPlaylists);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updatePlaylistName(playlistId, newName) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.name = newName;
        playlist.updatedAt = Date.now();
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
        return playlist;
    }

    async updatePlaylistDescription(playlistId, newDescription) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.description = newDescription;
        playlist.updatedAt = Date.now();
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async updatePlaylistTracks(playlistId, tracks) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_playlists', 'readwrite');
            const store = transaction.objectStore('user_playlists');

            const getRequest = store.get(playlistId);
            getRequest.onsuccess = () => {
                const playlist = getRequest.result;
                if (!playlist) {
                    reject(new Error('Playlist not found'));
                    return;
                }
                playlist.tracks = tracks;
                playlist.updatedAt = Date.now();
                this._updatePlaylistMetadata(playlist);
                const putRequest = store.put(playlist);
                putRequest.onsuccess = () => {
                    resolve(playlist);
                };
                putRequest.onerror = () => {
                    reject(putRequest.error);
                };
            };
            getRequest.onerror = () => {
                reject(getRequest.error);
            };

            transaction.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    async saveSetting(key, value) {
        await this.performTransaction('settings', 'readwrite', (store) => store.put(value, key));
    }

    async getSetting(key) {
        return await this.performTransaction('settings', 'readonly', (store) => store.get(key));
    }

    // ========== FRIENDS SYSTEM ==========

    // Add a friend
    async addFriend(friend) {
        const entry = {
            uid: friend.uid,
            username: friend.username || '',
            displayName: friend.displayName || friend.username || '',
            avatarUrl: friend.avatarUrl || '',
            addedAt: Date.now(),
        };
        await this.performTransaction('friends', 'readwrite', (store) => store.put(entry));
        return entry;
    }

    // Remove a friend
    async removeFriend(uid) {
        await this.performTransaction('friends', 'readwrite', (store) => store.delete(uid));
    }

    // Get all friends
    async getFriends() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('friends', 'readonly');
            const store = transaction.objectStore('friends');
            const index = store.index('addedAt');
            const request = index.getAll();
            request.onsuccess = () => resolve(request.result.reverse());
            request.onerror = () => reject(request.error);
        });
    }

    // Check if user is friend
    async isFriend(uid) {
        const friend = await this.performTransaction('friends', 'readonly', (store) => store.get(uid));
        return !!friend;
    }

    // ========== FRIEND REQUESTS ==========

    // Send friend request
    async sendFriendRequest(request) {
        const entry = {
            uid: request.uid,
            username: request.username || '',
            displayName: request.displayName || request.username || '',
            avatarUrl: request.avatarUrl || '',
            requestedAt: Date.now(),
            status: 'pending', // pending, accepted, rejected
            outgoing: true, // This is an outgoing request
        };
        await this.performTransaction('friend_requests', 'readwrite', (store) => store.put(entry));
        return entry;
    }

    // Receive incoming friend request
    async receiveFriendRequest(request) {
        const entry = {
            uid: request.uid,
            username: request.username || '',
            displayName: request.displayName || request.username || '',
            avatarUrl: request.avatarUrl || '',
            requestedAt: request.requestedAt || Date.now(),
            status: 'pending',
            outgoing: false, // This is an incoming request
        };
        await this.performTransaction('friend_requests', 'readwrite', (store) => store.put(entry));
        return entry;
    }

    // Get all friend requests (both incoming and outgoing)
    async getFriendRequests() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('friend_requests', 'readonly');
            const store = transaction.objectStore('friend_requests');
            const index = store.index('requestedAt');
            const request = index.getAll();
            request.onsuccess = () => resolve(request.result.reverse());
            request.onerror = () => reject(request.error);
        });
    }

    // Get incoming friend requests only
    async getIncomingFriendRequests() {
        const requests = await this.getFriendRequests();
        return requests.filter((r) => !r.outgoing && r.status === 'pending');
    }

    // Accept friend request
    async acceptFriendRequest(uid) {
        const request = await this.performTransaction('friend_requests', 'readonly', (store) => store.get(uid));
        if (request) {
            // Add as friend
            await this.addFriend(request);
            // Update request status
            request.status = 'accepted';
            await this.performTransaction('friend_requests', 'readwrite', (store) => store.put(request));
        }
    }

    // Reject friend request
    async rejectFriendRequest(uid) {
        const request = await this.performTransaction('friend_requests', 'readonly', (store) => store.get(uid));
        if (request) {
            request.status = 'rejected';
            await this.performTransaction('friend_requests', 'readwrite', (store) => store.put(request));
        }
    }

    // Cancel outgoing friend request
    async cancelFriendRequest(uid) {
        await this.performTransaction('friend_requests', 'readwrite', (store) => store.delete(uid));
    }

    // ========== SHARED TRACKS ==========

    // Share a track with a friend
    async shareTrack(track, withUid, message = '') {
        const entry = {
            id: crypto.randomUUID(),
            track: this._minifyItem('track', track),
            sharedWith: withUid,
            sharedBy: track.sharedBy || '', // User ID of sender
            sharedByName: track.sharedByName || '', // Name of sender
            message: message,
            sharedAt: Date.now(),
            played: false,
        };
        await this.performTransaction('shared_tracks', 'readwrite', (store) => store.put(entry));
        return entry;
    }

    // Get shared tracks from friends
    async getSharedTracks() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('shared_tracks', 'readonly');
            const store = transaction.objectStore('shared_tracks');
            const index = store.index('sharedAt');
            const request = index.getAll();
            request.onsuccess = () => resolve(request.result.reverse());
            request.onerror = () => reject(request.error);
        });
    }

    // Mark shared track as played
    async markSharedTrackPlayed(id) {
        const track = await this.performTransaction('shared_tracks', 'readonly', (store) => store.get(id));
        if (track) {
            track.played = true;
            await this.performTransaction('shared_tracks', 'readwrite', (store) => store.put(track));
        }
    }

    // Delete shared track
    async deleteSharedTrack(id) {
        await this.performTransaction('shared_tracks', 'readwrite', (store) => store.delete(id));
    }

    // ========== COLLABORATIVE PLAYLISTS ==========

    // Create collaborative playlist
    async createCollaborativePlaylist(name, memberIds = []) {
        const id = crypto.randomUUID();
        let ownerId = '';
        try {
            const { authManager } = await import('./accounts/auth.js');
            ownerId = authManager?.user?.$id || '';
        } catch {
            ownerId = '';
        }

        const uniqueMembers = Array.from(
            new Set((Array.isArray(memberIds) ? memberIds : []).map((memberId) => String(memberId || '').trim()))
        ).filter(Boolean);
        if (ownerId && !uniqueMembers.includes(ownerId)) {
            uniqueMembers.unshift(ownerId);
        }

        const playlist = {
            id: id,
            name: name,
            description: '',
            cover: '',
            tracks: [],
            members: uniqueMembers,
            owner: ownerId || uniqueMembers[0] || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isCollaborative: true,
        };
        await this.performTransaction('collaborative_playlists', 'readwrite', (store) => store.put(playlist));
        this._syncCollaborativePlaylist('create', playlist);
        return playlist;
    }

    // Get collaborative playlists
    async getCollaborativePlaylists() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('collaborative_playlists', 'readonly');
            const store = transaction.objectStore('collaborative_playlists');
            const index = store.index('createdAt');
            const request = index.getAll();
            request.onsuccess = () => resolve(request.result.reverse());
            request.onerror = () => reject(request.error);
        });
    }

    // Get collaborative playlist by ID
    async getCollaborativePlaylist(id) {
        return await this.performTransaction('collaborative_playlists', 'readonly', (store) => store.get(id));
    }

    // Add member to collaborative playlist
    async addCollaborativePlaylistMember(playlistId, memberId) {
        const playlist = await this.getCollaborativePlaylist(playlistId);
        if (playlist && playlist.members) {
            if (!playlist.members.includes(memberId)) {
                playlist.members.push(memberId);
                playlist.updatedAt = Date.now();
                await this.performTransaction('collaborative_playlists', 'readwrite', (store) => store.put(playlist));
                this._syncCollaborativePlaylist('update', playlist);
            }
        }
        return playlist;
    }

    // Remove member from collaborative playlist
    async removeCollaborativePlaylistMember(playlistId, memberId) {
        const playlist = await this.getCollaborativePlaylist(playlistId);
        if (playlist && playlist.members) {
            playlist.members = playlist.members.filter((m) => m !== memberId);
            playlist.updatedAt = Date.now();
            await this.performTransaction('collaborative_playlists', 'readwrite', (store) => store.put(playlist));
            this._syncCollaborativePlaylist('update', playlist);
        }
        return playlist;
    }

    // Add tracks to collaborative playlist
    async addTracksToCollaborativePlaylist(playlistId, tracks) {
        const playlist = await this.getCollaborativePlaylist(playlistId);
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];

        let addedById = '';
        let addedByName = '';
        try {
            const { authManager } = await import('./accounts/auth.js');
            const user = authManager?.user || null;
            addedById = String(user?.$id || '').trim();
            addedByName = String(user?.name || user?.email || 'Unknown User').trim();
        } catch {
            addedById = '';
            addedByName = '';
        }

        for (const track of tracks) {
            if (!playlist.tracks.some((t) => t.id === track.id)) {
                const trackWithDate = {
                    ...track,
                    addedAt: Date.now(),
                    addedById: addedById || null,
                    addedByName: addedByName || null,
                };
                playlist.tracks.push(this._minifyItem('track', trackWithDate));
            }
        }
        playlist.updatedAt = Date.now();
        await this.performTransaction('collaborative_playlists', 'readwrite', (store) => store.put(playlist));
        this._syncCollaborativePlaylist('update', playlist);
        return playlist;
    }

    // Remove track from collaborative playlist
    async removeTrackFromCollaborativePlaylist(playlistId, trackId) {
        const playlist = await this.getCollaborativePlaylist(playlistId);
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];
        playlist.tracks = playlist.tracks.filter((t) => String(t.id) !== String(trackId));
        playlist.updatedAt = Date.now();
        await this.performTransaction('collaborative_playlists', 'readwrite', (store) => store.put(playlist));
        this._syncCollaborativePlaylist('update', playlist);
        return playlist;
    }

    // Delete collaborative playlist
    async deleteCollaborativePlaylist(playlistId) {
        await this.performTransaction('collaborative_playlists', 'readwrite', (store) => store.delete(playlistId));
        this._syncCollaborativePlaylist('delete', { id: playlistId });
    }

    // Update collaborative playlist
    async updateCollaborativePlaylist(playlist) {
        if (Array.isArray(playlist.members)) {
            playlist.members = Array.from(
                new Set(playlist.members.map((memberId) => String(memberId || '').trim()))
            ).filter(Boolean);
        } else {
            playlist.members = [];
        }

        if (playlist.owner && !playlist.members.includes(playlist.owner)) {
            playlist.members.unshift(playlist.owner);
        }

        playlist.updatedAt = Date.now();
        await this.performTransaction('collaborative_playlists', 'readwrite', (store) => store.put(playlist));
        this._syncCollaborativePlaylist('update', playlist);
        return playlist;
    }
}

export const db = new MusicDatabase();
