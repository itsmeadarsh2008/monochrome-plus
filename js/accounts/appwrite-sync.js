// js/accounts/appwrite-sync.js
import { client, databases } from '../lib/appwrite.js';
import { db as database } from '../db.js';
import { authManager } from './auth.js';
import { ID, Permission, Query, Role } from 'appwrite';
import { getShareUrl, getTrackArtists } from '../utils.js';

const DATABASE_ID = 'monochrome-plus';
const USERS_COLLECTION = 'DB_users';
const PUBLIC_PLAYLISTS_COLLECTION = 'DB_public_playlists';
const FRIEND_REQUESTS_COLLECTION = 'DB_friend_requests';
const CHAT_MESSAGES_COLLECTION = 'DB_chat_messages';

const DEFAULT_PRIVACY = { playlists: 'public', lastfm: 'public' };
const MAX_HISTORY_ITEMS = 300;
const MAX_TRACK_SYNC = 1500;
const MAX_ALBUM_SYNC = 1000;
const MAX_ARTIST_SYNC = 1000;
const MAX_PLAYLIST_SYNC = 600;
const MAX_MIX_SYNC = 400;
const MAX_PUBLIC_PLAYLIST_TRACKS = 500;
const MAX_PUBLIC_PLAYLIST_TRACKS_PAYLOAD_CHARS = 62000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isNetworkError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
        error?.name === 'TypeError' ||
        message.includes('networkerror') ||
        message.includes('failed to fetch') ||
        message.includes('network request')
    );
}

const syncManager = {
    _userRecordCache: null,
    _isSyncing: false,
    _realtimeUnsubscribe: null,
    _syncIntervalId: null,
    _statusBackoffUntil: 0,
    _cloudPullPromise: null,
    _publicPlaylistSyncPromise: null,
    _publicPlaylistSyncTimeoutId: null,

    _safeParseJSON(value, fallback) {
        if (value === null || value === undefined || value === '') return fallback;
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    },

    _safeObject(value, fallback = {}) {
        const parsed = this._safeParseJSON(value, fallback);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
        return parsed;
    },

    _safeArray(value, fallback = []) {
        const parsed = this._safeParseJSON(value, fallback);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return Object.values(parsed);
        return fallback;
    },

    _normalizeFavoriteAlbums(value) {
        const albums = this._safeArray(value, []);
        return albums
            .filter((album) => album && typeof album === 'object')
            .map((album) => ({
                id: album.id,
                title: album.title || '',
                artist: album.artist?.name || album.artist || 'Unknown Artist',
                cover: album.cover || album.album?.cover || null,
                description: album.description || '',
            }))
            .filter((album) => album.id);
    },

    _mapProfileRecord(record) {
        if (!record) return null;
        return {
            ...record,
            privacy: this._safeObject(record.privacy, DEFAULT_PRIVACY),
            user_playlists: this._safeObject(record.user_playlists, {}),
            favorite_albums: this._normalizeFavoriteAlbums(record.favorite_albums),
        };
    },

    _getConversationId(userA, userB) {
        return [String(userA), String(userB)].sort().join('__');
    },

    _mapChatMessage(doc) {
        return {
            id: doc.$id,
            conversationId: doc.conversation_id,
            senderId: doc.sender_id,
            senderUsername: doc.sender_username,
            senderDisplayName: doc.sender_display_name || doc.sender_username || 'User',
            senderAvatar: doc.sender_avatar || '',
            receiverId: doc.receiver_id,
            receiverUsername: doc.receiver_username,
            message: doc.message || '',
            trackPayload: this._safeParseJSON(doc.track_payload, null),
            read: !!doc.read,
            createdAt: doc.created_at || Date.now(),
        };
    },

    _didCloudSyncPayloadChange(previousRecord, nextRecord) {
        if (!nextRecord) return false;
        if (!previousRecord) return true;

        const keys = ['library', 'history', 'user_playlists', 'user_folders', 'favorite_albums'];
        return keys.some((key) => String(previousRecord[key] ?? '') !== String(nextRecord[key] ?? ''));
    },

    _getPlaylistCoverCollage(tracks = []) {
        const uniqueCovers = [];
        const seen = new Set();
        for (const track of tracks) {
            const cover = track?.album?.cover;
            if (!cover || seen.has(cover)) continue;
            seen.add(cover);
            uniqueCovers.push(cover);
            if (uniqueCovers.length >= 4) break;
        }
        return uniqueCovers;
    },

    _mapPublicPlaylistDoc(doc) {
        const tracks = this._safeArray(doc?.tracks, []).filter((track) => track && typeof track === 'object');
        const createdAt = doc?.$createdAt ? Date.parse(doc.$createdAt) : Date.now();
        const updatedAt = doc?.$updatedAt ? Date.parse(doc.$updatedAt) : Date.now();
        return {
            id: doc?.id,
            name: doc?.name || 'Untitled Playlist',
            title: doc?.name || 'Untitled Playlist',
            description: doc?.description || '',
            cover: doc?.cover || '',
            tracks,
            numberOfTracks: tracks.length,
            images: this._getPlaylistCoverCollage(tracks),
            createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
            updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
            isPublic: doc?.is_public !== false,
        };
    },

    _playlistSyncSignature(playlist) {
        if (!playlist) return '';
        return JSON.stringify({
            id: playlist.id,
            name: playlist.name || '',
            description: playlist.description || '',
            cover: playlist.cover || '',
            numberOfTracks: playlist.numberOfTracks || 0,
            tracks: playlist.tracks || [],
            isPublic: !!playlist.isPublic,
        });
    },

    _minifyPublicPlaylistTrack(track) {
        if (!track || typeof track !== 'object') return null;

        const toArtistRef = (artist) => {
            if (!artist || typeof artist !== 'object') return null;
            const id = artist.id ?? null;
            const name = artist.name || null;
            if (!id && !name) return null;
            return { id, name };
        };

        const primaryArtist = toArtistRef(track.artist) || toArtistRef(track.artists?.[0]);
        const artists = Array.isArray(track.artists)
            ? track.artists.map((artist) => toArtistRef(artist)).filter(Boolean)
            : primaryArtist
                ? [primaryArtist]
                : [];

        return {
            id: track.id ?? null,
            title: track.title || null,
            duration: Number.isFinite(track.duration) ? track.duration : null,
            explicit: !!track.explicit,
            artist: primaryArtist,
            artists,
            album: track.album
                ? {
                      id: track.album.id ?? null,
                      title: track.album.title || null,
                      cover: track.album.cover || null,
                      artist: toArtistRef(track.album.artist),
                  }
                : null,
            trackNumber: track.trackNumber || null,
        };
    },

    _serializePublicPlaylistTracks(tracks = []) {
        const normalized = (Array.isArray(tracks) ? tracks : [])
            .map((track) => this._minifyPublicPlaylistTrack(track))
            .filter((track) => track?.id);

        if (!normalized.length) {
            return { serialized: '[]', kept: 0, total: 0 };
        }

        let keepCount = Math.min(normalized.length, MAX_PUBLIC_PLAYLIST_TRACKS);
        while (keepCount > 0) {
            const serialized = JSON.stringify(normalized.slice(0, keepCount));
            if (serialized.length <= MAX_PUBLIC_PLAYLIST_TRACKS_PAYLOAD_CHARS) {
                return { serialized, kept: keepCount, total: normalized.length };
            }

            keepCount =
                keepCount > 250 ? keepCount - 50 : keepCount > 120 ? keepCount - 25 : keepCount - 10;
        }

        return { serialized: '[]', kept: 0, total: normalized.length };
    },

    async _withRetry(operation, { retries = 2, baseDelay = 450, label = 'Appwrite request' } = {}) {
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (attempt >= retries || !isNetworkError(error)) {
                    throw error;
                }
                const delayMs = baseDelay * Math.pow(2, attempt);
                console.warn(`[Appwrite Sync] ${label} failed, retrying in ${delayMs}ms...`, error);
                await wait(delayMs);
            }
        }
        throw lastError;
    },

    async _getUserRecord(forceRefresh = false) {
        const user = authManager.user;
        if (!user) return null;

        if (!forceRefresh && this._userRecordCache && this._userRecordCache.firebase_id === user.$id) {
            return this._userRecordCache;
        }

        try {
<<<<<<< HEAD
            const response = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                Query.equal('firebase_id', user.$id),
            ]);
=======
            const response = await this._withRetry(
                () =>
                    databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                        Query.equal('firebase_id', user.$id),
                        Query.limit(1),
                    ]),
                { label: 'get user record' }
            );
>>>>>>> 1e33a40 (major update)

            if (response.documents.length > 0) {
                this._userRecordCache = response.documents[0];
                return this._userRecordCache;
            }

            const usernameSeed = user.name || user.email?.split('@')[0] || 'user';
            const username = usernameSeed
                .toLowerCase()
                .replace(/[^a-z0-9_.-]/g, '.')
                .replace(/\.+/g, '.')
                .replace(/^\./, '')
                .replace(/\.$/, '')
                .slice(0, 40) || 'user';

            const displayName = user.name || user.email?.split('@')[0] || 'User';

<<<<<<< HEAD
            console.log('[Appwrite Sync] Creating new user record for:', user.$id, { username, displayName });

            const newRecord = await databases.createDocument(DATABASE_ID, USERS_COLLECTION, ID.unique(), {
                firebase_id: user.$id,
                library: '{}',
                history: '[]',
                user_playlists: '{}',
                user_folders: '{}',
                username: username,
                display_name: displayName,
                avatar_url: user.prefs?.avatar || '',
            });
            this._userRecordCache = newRecord;
            return newRecord;
        } catch (error) {
            if (error.code === 404) {
                console.error(
                    '[Appwrite Sync] ❌ Database or Collection NOT FOUND. Please run "node scripts/setup-appwrite.js" with your API Key to initialize the infrastructure.'
=======
            const newRecord = await this._withRetry(
                () =>
                    databases.createDocument(DATABASE_ID, USERS_COLLECTION, ID.unique(), {
                        firebase_id: user.$id,
                        library: '{}',
                        history: '[]',
                        user_playlists: '{}',
                        user_folders: '{}',
                        username,
                        display_name: displayName,
                        avatar_url: user.prefs?.avatar || '',
                        privacy: JSON.stringify(DEFAULT_PRIVACY),
                        favorite_albums: '[]',
                    }),
                { label: 'create user record' }
            );

            this._userRecordCache = newRecord;
            return newRecord;
        } catch (error) {
            if (error?.code === 404) {
                console.error(
                    '[Appwrite Sync] Database or collection missing. Run "node scripts/setup-appwrite.js" with APPWRITE_API_KEY.'
>>>>>>> 1e33a40 (major update)
                );
            } else {
                console.error('[Appwrite Sync] Failed to get/create user record:', error);
            }
            return null;
        }
    },

    async _updateUserJSON(_uidIgnored, field, data) {
        const record = await this._getUserRecord();
        if (!record) return null;

        try {
            const payload = { [field]: typeof data === 'string' ? data : JSON.stringify(data) };
            const updated = await this._withRetry(
                () => databases.updateDocument(DATABASE_ID, USERS_COLLECTION, record.$id, payload),
                { label: `update ${field}` }
            );
            this._userRecordCache = updated;
            return updated;
        } catch (error) {
            console.error(`[Appwrite Sync] Failed to update ${field}:`, error);
            throw error;
        }
    },

    safeParseInternal(str, _fieldName, fallback) {
        return this._safeParseJSON(str, fallback);
    },

    async getUserData() {
        console.log('[Appwrite Sync] Getting user data...');
        const record = await this._getUserRecord();
        if (!record) {
            console.warn('[Appwrite Sync] No user record found in getUserData');
            return null;
        }

        console.log('[Appwrite Sync] User record found:', record.$id, { username: record.username });

<<<<<<< HEAD
        const parseSet = (val, fallback) => {
            if (!val) return fallback;
            if (typeof val !== 'string') return val;
            try {
                return JSON.parse(val);
            } catch {
                return fallback;
            }
        };

        const library = parseSet(record.library, {});
        const history = parseSet(record.history, []);
        const userPlaylists = parseSet(record.user_playlists, {});
        const userFolders = parseSet(record.user_folders, {});
        const favoriteAlbums = parseSet(record.favorite_albums, []);
=======
        const library = this._safeObject(record.library, {});
        const history = this._safeArray(record.history, []);
        const userPlaylists = this._safeObject(record.user_playlists, {});
        const userFolders = this._safeObject(record.user_folders, {});
>>>>>>> 1e33a40 (major update)

        const profile = {
            username: record.username,
            display_name: record.display_name,
            avatar_url: record.avatar_url,
            banner: record.banner,
            status: record.status,
            about: record.about,
            website: record.website,
            privacy: this._safeObject(record.privacy, DEFAULT_PRIVACY),
            lastfm_username: record.lastfm_username,
            favorite_albums: this._normalizeFavoriteAlbums(record.favorite_albums),
        };

        return { library, history, userPlaylists, userFolders, profile };
    },

    async getProfile(username) {
        if (!username) return null;

        if (this._userRecordCache && this._userRecordCache.username === username) {
            console.log('[Appwrite Sync] Returning cached profile for:', username);
            return this._mapProfileRecord(this._userRecordCache);
        }

        console.log('[Appwrite Sync] Fetching profile for:', username);
        try {
<<<<<<< HEAD
            const stringified = typeof data === 'string' ? data : JSON.stringify(data);
            const updated = await databases.updateDocument(DATABASE_ID, USERS_COLLECTION, record.$id, {
                [field]: stringified,
            });
=======
            const res = await this._withRetry(
                () =>
                    databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                        Query.equal('username', username),
                        Query.limit(1),
                    ]),
                { label: 'fetch profile' }
            );

            if (res.documents.length === 0) {
                console.warn('[Appwrite Sync] No profile found for username:', username);
                return null;
            }

            const record = res.documents[0];
            console.log('[Appwrite Sync] Profile found:', record.$id);
            return this._mapProfileRecord(record);
        } catch (error) {
            console.error('[Appwrite Sync] Failed to fetch profile:', error);
            return null;
        }
    },

    async updateProfile(data) {
        const record = await this._getUserRecord();
        if (!record) return null;

        const updateData = { ...data };
        if (Object.prototype.hasOwnProperty.call(updateData, 'favorite_albums')) {
            updateData.favorite_albums = JSON.stringify(this._normalizeFavoriteAlbums(updateData.favorite_albums));
        }

        for (const key of Object.keys(updateData)) {
            const value = updateData[key];
            if (value && typeof value === 'object' && key !== 'favorite_albums') {
                updateData[key] = JSON.stringify(value);
            }
        }

        console.log('[Appwrite Sync] Updating profile with data:', Object.keys(updateData));
        try {
            const updated = await this._withRetry(
                () => databases.updateDocument(DATABASE_ID, USERS_COLLECTION, record.$id, updateData),
                { label: 'update profile' }
            );
>>>>>>> 1e33a40 (major update)
            this._userRecordCache = updated;
            console.log('[Appwrite Sync] Profile updated successfully');
            return updated;
        } catch (error) {
            console.error('[Appwrite Sync] Failed to update profile:', error);
            throw error;
        }
    },

    async clearCloudData() {
        const record = await this._getUserRecord();
        if (!record) return false;

        try {
            const updated = await databases.updateDocument(DATABASE_ID, USERS_COLLECTION, record.$id, {
                library: '{}',
                history: '[]',
                user_playlists: '{}',
                user_folders: '{}',
                favorite_albums: '[]',
                status: '',
            });
            this._userRecordCache = updated;

            const user = authManager.user;
            if (user) {
                const published = await databases.listDocuments(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, [
                    Query.equal('owner_id', user.$id),
                    Query.limit(100),
                ]);
                await Promise.allSettled(
                    published.documents.map((doc) =>
                        databases.deleteDocument(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, doc.$id)
                    )
                );
            }

            return true;
        } catch (error) {
            console.error('[Appwrite Sync] Failed to clear cloud data:', error);
            throw error;
        }
    },

    async isUsernameTaken(username) {
        if (!username) return false;
        try {
            const res = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                Query.equal('username', username.toLowerCase()),
                Query.limit(1),
            ]);
            return res.total > 0;
        } catch {
            return false;
        }
    },

    async searchUsers(query) {
        if (!query) return [];
        console.log('[Appwrite Sync] Searching users for:', query);
        try {
            const res = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                Query.or([Query.contains('username', query), Query.contains('display_name', query)]),
                Query.limit(15),
            ]);
            return res.documents;
        } catch (error) {
            console.error('[Appwrite Sync] User search failed:', error);
            return [];
        }
    },

    _minifyItem(type, item) {
        if (!item) return item;
        const base = {
            id: item.id,
            addedAt: item.addedAt || Date.now(),
        };

        if (type === 'track') {
            const artists =
                item.artists?.map((artist) => ({
                    id: artist?.id,
                    name: artist?.name || null,
                })) || (item.artist ? [{ id: item.artist.id, name: item.artist.name || null }] : []);

            return {
                ...base,
                title: item.title || null,
                duration: item.duration || null,
                explicit: !!item.explicit,
                artist: item.artist || artists[0] || null,
                artists,
                album: item.album
                    ? {
                          id: item.album.id,
                          title: item.album.title || null,
                          cover: item.album.cover || null,
                          releaseDate: item.album.releaseDate || null,
                          artist: item.album.artist || null,
                      }
                    : null,
                trackNumber: item.trackNumber || null,
                streamStartDate: item.streamStartDate || null,
                version: item.version || null,
                mixes: item.mixes || null,
                isTracker: !!item.isTracker || String(item.id || '').startsWith('tracker-'),
                trackerInfo: item.trackerInfo || null,
            };
        }

        if (type === 'album') {
            return {
                ...base,
                title: item.title || null,
                cover: item.cover || null,
                releaseDate: item.releaseDate || null,
                explicit: !!item.explicit,
                artist: item.artist || item.artists?.[0] || null,
                numberOfTracks: item.numberOfTracks || null,
                type: item.type || null,
            };
        }

        if (type === 'artist') {
            return {
                ...base,
                name: item.name || null,
                picture: item.picture || item.image || null,
            };
        }

        if (type === 'playlist') {
            return {
                uuid: item.uuid || item.id,
                addedAt: item.addedAt || item.createdAt || Date.now(),
                title: item.title || item.name || null,
                image: item.image || item.squareImage || item.cover || null,
                numberOfTracks: item.numberOfTracks || item.tracks?.length || 0,
            };
        }

        if (type === 'mix') {
            return {
                ...base,
                title: item.title || null,
                subTitle: item.subTitle || null,
                cover: item.cover || null,
                mixType: item.mixType || null,
            };
        }

        return base;
    },

    async syncLibraryItem(type, item, added) {
        const record = await this._getUserRecord();
<<<<<<< HEAD
        if (!record) return;

        const parseSet = (val, fallback) => {
            if (!val) return fallback;
            if (typeof val !== 'string') return val;
            try {
                return JSON.parse(val);
            } catch {
                return fallback;
            }
        };

        let library = parseSet(record.library, {});
=======
        if (!record || !item) return;
>>>>>>> 1e33a40 (major update)

        const library = this._safeObject(record.library, {});
        const pluralType = type === 'mix' ? 'mixes' : `${type}s`;
        const key = type === 'playlist' ? item.uuid || item.id : item.id;
<<<<<<< HEAD
=======
        if (!key) return;
>>>>>>> 1e33a40 (major update)

        if (!library[pluralType] || typeof library[pluralType] !== 'object') {
            library[pluralType] = {};
        }

        if (added) {
            library[pluralType][key] = this._minifyItem(type, item);
        } else {
            delete library[pluralType][key];
        }

<<<<<<< HEAD
        await this._updateUserJSON(null, 'library', library);
    },

    _minifyItem(type, item) {
        if (!item) return item;

        const base = {
            id: item.id,
            addedAt: item.addedAt || Date.now(),
        };

        if (type === 'track') {
            return {
                ...base,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                album: item.album
                    ? { id: item.album.id, title: item.album.title || null, cover: item.album.cover || null }
                    : null,
            };
        }

        return base;
    },

    async getProfile(username) {
        // Optimization: if requesting the current user's profile, use the cache if available
        if (this._userRecordCache && this._userRecordCache.username === username) {
            console.log('[Appwrite Sync] Returning cached profile for:', username);
            return this._userRecordCache;
        }

        console.log('[Appwrite Sync] Fetching profile for:', username);
        try {
            const res = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                Query.equal('username', username),
            ]);
            if (res.documents.length === 0) {
                console.warn('[Appwrite Sync] No profile found for username:', username);
                return null;
            }
            const record = res.documents[0];
            console.log('[Appwrite Sync] Profile found:', record.$id);
            const parseSet = (val, fallback) => {
                if (!val) return fallback;
                if (typeof val !== 'string') return val;
                try {
                    return JSON.parse(val);
                } catch {
                    return fallback;
                }
=======
        try {
            await this._updateUserJSON(null, 'library', library);
        } catch {
            // handled upstream by logger
        }
    },

    async syncHistoryItem(historyEntry) {
        if (!authManager.user || !historyEntry) return;

        try {
            const record = await this._getUserRecord();
            if (!record) return;

            const history = this._safeArray(record.history, []);
            const minified = this._minifyItem('track', historyEntry);
            minified.timestamp = historyEntry.timestamp || Date.now();

            const nextHistory = history.filter((entry) => entry.timestamp !== minified.timestamp);
            nextHistory.unshift(minified);
            nextHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            await this._updateUserJSON(null, 'history', nextHistory.slice(0, MAX_HISTORY_ITEMS));
            window.dispatchEvent(new CustomEvent('history-changed'));
        } catch (error) {
            console.warn('[Appwrite Sync] Failed to sync history item:', error);
        }
    },

    async syncUserPlaylist(playlist, action = 'update') {
        const record = await this._getUserRecord();
        if (!record) return;

        const playlists = this._safeObject(record.user_playlists, {});
        const playlistId = playlist?.id || playlist?.uuid;
        if (!playlistId) return;

        if (action === 'delete') {
            delete playlists[playlistId];
            await this.unpublishPlaylist(playlistId);
        } else if (playlist.isPublic) {
            playlists[playlistId] = {
                id: playlistId,
                name: playlist.name || playlist.title || 'Untitled Playlist',
                description: playlist.description || '',
                cover: playlist.cover || null,
                numberOfTracks: playlist.tracks?.length || playlist.numberOfTracks || 0,
                isPublic: true,
            };
            await this.publishPlaylist(playlist);
        } else {
            delete playlists[playlistId];
            await this.unpublishPlaylist(playlistId);
        }

        try {
            await this._updateUserJSON(null, 'user_playlists', playlists);
            window.dispatchEvent(new CustomEvent('library-changed'));
        } catch (error) {
            console.warn('[Appwrite Sync] Failed syncing user playlist metadata:', error);
        }
    },

    async syncUserFolder(folder, action = 'update') {
        const record = await this._getUserRecord();
        if (!record) return;

        const folders = this._safeObject(record.user_folders, {});
        const folderId = folder?.id;
        if (!folderId) return;

        if (action === 'delete') {
            delete folders[folderId];
        } else {
            folders[folderId] = {
                id: folderId,
                name: folder.name || 'Folder',
                cover: folder.cover || '',
                playlists: Array.isArray(folder.playlists) ? folder.playlists : [],
                updatedAt: folder.updatedAt || Date.now(),
            };
        }

        try {
            await this._updateUserJSON(null, 'user_folders', folders);
            window.dispatchEvent(new CustomEvent('library-changed'));
        } catch (error) {
            console.warn('[Appwrite Sync] Failed syncing user folder metadata:', error);
        }
    },

    async _findPublicPlaylistDoc(playlistId) {
        const user = authManager.user;
        if (!user) return null;

        const res = await databases.listDocuments(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, [
            Query.equal('id', playlistId),
            Query.equal('owner_id', user.$id),
            Query.limit(1),
        ]);
        return res.documents[0] || null;
    },

    async publishPlaylist(playlist) {
        await authManager.initialized.catch(() => {});
        const user = authManager.user;
        const playlistId = playlist?.id || playlist?.uuid;
        if (!user) {
            throw new Error('You must be signed in to publish playlists.');
        }
        if (!playlistId) {
            throw new Error('Playlist id is missing.');
        }

        try {
            const tracksPayload = this._serializePublicPlaylistTracks(playlist.tracks || []);
            if (tracksPayload.kept < tracksPayload.total) {
                console.warn(
                    `[Appwrite Sync] Public playlist "${playlistId}" track list truncated for cloud payload (${tracksPayload.kept}/${tracksPayload.total}).`
                );
            }

            const payload = {
                id: playlistId,
                owner_id: user.$id,
                name: playlist.name || playlist.title || 'Untitled Playlist',
                description: playlist.description || '',
                cover: playlist.cover || '',
                tracks: tracksPayload.serialized,
                is_public: true,
>>>>>>> 1e33a40 (major update)
            };

            const existing = await this._findPublicPlaylistDoc(playlistId);
            if (existing) {
                return await databases.updateDocument(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, existing.$id, payload);
            }

            return await databases.createDocument(
                DATABASE_ID,
                PUBLIC_PLAYLISTS_COLLECTION,
                ID.unique(),
                payload,
                [
                    Permission.read(Role.any()),
                    Permission.update(Role.user(user.$id)),
                    Permission.delete(Role.user(user.$id)),
                ]
            );
        } catch (error) {
            console.error('[Appwrite Sync] Failed to publish playlist:', error);
            throw error;
        }
    },

    async unpublishPlaylist(playlistId) {
        const user = authManager.user;
        if (!user || !playlistId) return;

        try {
            const res = await databases.listDocuments(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, [
                Query.equal('id', playlistId),
                Query.equal('owner_id', user.$id),
                Query.limit(25),
            ]);

            await Promise.allSettled(
                res.documents.map((doc) =>
                    databases.deleteDocument(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, doc.$id)
                )
            );
        } catch (error) {
            if (error?.code !== 404) {
                console.warn('[Appwrite Sync] Failed to unpublish playlist:', error);
            }
        }
    },

    async getPublicPlaylist(playlistId) {
        if (!playlistId) return null;
        try {
            const res = await databases.listDocuments(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, [
                Query.equal('id', playlistId),
                Query.equal('is_public', true),
                Query.limit(1),
            ]);

            if (!res.documents.length) return null;
            const doc = res.documents[0];
            const tracks = this._safeArray(doc.tracks, []);

            return {
                id: doc.id,
                name: doc.name,
                title: doc.name,
                description: doc.description || '',
                cover: doc.cover || '',
                tracks,
                numberOfTracks: tracks.length,
                owner_id: doc.owner_id,
                isPublic: true,
            };
        } catch (error) {
            console.warn('[Appwrite Sync] Failed to fetch public playlist:', error);
            return null;
        }
    },

    async sendFriendRequestToUser(username) {
        const user = authManager.user;
        if (!user) throw new Error('You must be signed in.');

        const cleanUsername = String(username || '')
            .trim()
            .replace(/^@/, '')
            .toLowerCase();

        if (!cleanUsername) throw new Error('Please provide a username.');

        const [currentData, targetProfile] = await Promise.all([this.getUserData(), this.getProfile(cleanUsername)]);
        if (!targetProfile) throw new Error('User not found.');
        if (targetProfile.firebase_id === user.$id) throw new Error('You cannot add yourself.');

        const [aToB, bToA] = await Promise.all([
            databases.listDocuments(DATABASE_ID, FRIEND_REQUESTS_COLLECTION, [
                Query.equal('sender_id', user.$id),
                Query.equal('receiver_id', targetProfile.firebase_id),
                Query.limit(5),
            ]),
            databases.listDocuments(DATABASE_ID, FRIEND_REQUESTS_COLLECTION, [
                Query.equal('sender_id', targetProfile.firebase_id),
                Query.equal('receiver_id', user.$id),
                Query.limit(5),
            ]),
        ]);

        const existing = [...aToB.documents, ...bToA.documents];
        if (existing.some((doc) => doc.status === 'pending')) {
            throw new Error('A pending friend request already exists.');
        }
        if (existing.some((doc) => doc.status === 'accepted')) {
            throw new Error('You are already friends.');
        }

<<<<<<< HEAD
        try {
            const updated = await databases.updateDocument(DATABASE_ID, USERS_COLLECTION, record.$id, updateData);
=======
        const myProfile = currentData?.profile || {};
        const now = Date.now();
>>>>>>> 1e33a40 (major update)

        await databases.createDocument(
            DATABASE_ID,
            FRIEND_REQUESTS_COLLECTION,
            ID.unique(),
            {
                sender_id: user.$id,
                sender_username: myProfile.username || user.name || user.email || 'user',
                sender_display_name: myProfile.display_name || user.name || myProfile.username || 'User',
                sender_avatar: myProfile.avatar_url || user.prefs?.avatar || '',
                receiver_id: targetProfile.firebase_id,
                receiver_username: targetProfile.username,
                receiver_display_name: targetProfile.display_name || targetProfile.username,
                receiver_avatar: targetProfile.avatar_url || '',
                status: 'pending',
                created_at: now,
                updated_at: now,
            },
            [
                Permission.read(Role.user(user.$id)),
                Permission.read(Role.user(targetProfile.firebase_id)),
                Permission.update(Role.user(user.$id)),
                Permission.update(Role.user(targetProfile.firebase_id)),
                Permission.delete(Role.user(user.$id)),
                Permission.delete(Role.user(targetProfile.firebase_id)),
            ]
        );
    },

<<<<<<< HEAD
    async isUsernameTaken(username) {
        try {
            const res = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                Query.equal('username', username),
            ]);
            return res.total > 0;
        } catch (e) {
            return false;
        }
    },
=======
    async listIncomingFriendRequests() {
        const user = authManager.user;
        if (!user) return [];
>>>>>>> 1e33a40 (major update)

        try {
<<<<<<< HEAD
            const res = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                Query.or([Query.contains('username', query), Query.contains('display_name', query)]),
                Query.limit(10),
=======
            const res = await databases.listDocuments(DATABASE_ID, FRIEND_REQUESTS_COLLECTION, [
                Query.equal('receiver_id', user.$id),
                Query.equal('status', 'pending'),
                Query.orderDesc('created_at'),
                Query.limit(100),
>>>>>>> 1e33a40 (major update)
            ]);

            return res.documents.map((doc) => ({
                requestId: doc.$id,
                uid: doc.sender_id,
                username: doc.sender_username,
                displayName: doc.sender_display_name || doc.sender_username,
                avatarUrl: doc.sender_avatar || '',
                requestedAt: doc.created_at || Date.now(),
                outgoing: false,
                status: doc.status,
            }));
        } catch (error) {
            console.warn('[Appwrite Sync] Failed to list incoming requests:', error);
            return [];
        }
    },

    async listOutgoingFriendRequests() {
        const user = authManager.user;
        if (!user) return [];

        try {
            const res = await databases.listDocuments(DATABASE_ID, FRIEND_REQUESTS_COLLECTION, [
                Query.equal('sender_id', user.$id),
                Query.equal('status', 'pending'),
                Query.orderDesc('created_at'),
                Query.limit(100),
            ]);

            return res.documents.map((doc) => ({
                requestId: doc.$id,
                uid: doc.receiver_id,
                username: doc.receiver_username,
                displayName: doc.receiver_display_name || doc.receiver_username,
                avatarUrl: doc.receiver_avatar || '',
                requestedAt: doc.created_at || Date.now(),
                outgoing: true,
                status: doc.status,
            }));
        } catch (error) {
            console.warn('[Appwrite Sync] Failed to list outgoing requests:', error);
            return [];
        }
    },

    async listFriends() {
        const user = authManager.user;
        if (!user) return [];

        try {
            const [sent, received] = await Promise.all([
                databases.listDocuments(DATABASE_ID, FRIEND_REQUESTS_COLLECTION, [
                    Query.equal('sender_id', user.$id),
                    Query.equal('status', 'accepted'),
                    Query.limit(500),
                ]),
                databases.listDocuments(DATABASE_ID, FRIEND_REQUESTS_COLLECTION, [
                    Query.equal('receiver_id', user.$id),
                    Query.equal('status', 'accepted'),
                    Query.limit(500),
                ]),
            ]);

            const byUid = new Map();
            sent.documents.forEach((doc) => {
                byUid.set(doc.receiver_id, {
                    uid: doc.receiver_id,
                    username: doc.receiver_username,
                    displayName: doc.receiver_display_name || doc.receiver_username || 'User',
                    avatarUrl: doc.receiver_avatar || '',
                    addedAt: doc.updated_at || doc.created_at || Date.now(),
                });
            });
            received.documents.forEach((doc) => {
                byUid.set(doc.sender_id, {
                    uid: doc.sender_id,
                    username: doc.sender_username,
                    displayName: doc.sender_display_name || doc.sender_username || 'User',
                    avatarUrl: doc.sender_avatar || '',
                    addedAt: doc.updated_at || doc.created_at || Date.now(),
                });
            });

            return Array.from(byUid.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        } catch (error) {
            console.warn('[Appwrite Sync] Failed to list friends:', error);
            return [];
        }
    },

    async acceptFriendRequest(requestId) {
        const user = authManager.user;
        if (!user || !requestId) return;

        await databases.updateDocument(DATABASE_ID, FRIEND_REQUESTS_COLLECTION, requestId, {
            status: 'accepted',
            updated_at: Date.now(),
        });
    },

    async rejectFriendRequest(requestId) {
        const user = authManager.user;
        if (!user || !requestId) return;

        await databases.updateDocument(DATABASE_ID, FRIEND_REQUESTS_COLLECTION, requestId, {
            status: 'rejected',
            updated_at: Date.now(),
        });
    },

    async cancelFriendRequest(requestId) {
        const user = authManager.user;
        if (!user || !requestId) return;
        await databases.deleteDocument(DATABASE_ID, FRIEND_REQUESTS_COLLECTION, requestId);
    },

    async _getUserByFirebaseId(firebaseId) {
        if (!firebaseId) return null;
        const res = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
            Query.equal('firebase_id', firebaseId),
            Query.limit(1),
        ]);
        return res.documents[0] || null;
    },

    async sendChatMessage({
        toUserId,
        toUsername = '',
        toDisplayName = '',
        toAvatarUrl = '',
        message = '',
        trackPayload = null,
    } = {}) {
        const user = authManager.user;
        if (!user) throw new Error('You must be signed in.');
        if (!toUserId) throw new Error('Recipient is required.');

        const text = String(message || '').trim();
        if (!text && !trackPayload) {
            throw new Error('Cannot send an empty message.');
        }

        const currentData = await this.getUserData();
        const senderProfile = currentData?.profile || {};

        let receiverInfo = {
            username: toUsername,
            display_name: toDisplayName,
            avatar_url: toAvatarUrl,
        };
        if (!receiverInfo.username) {
            const receiverDoc = await this._getUserByFirebaseId(toUserId);
            receiverInfo = receiverDoc || receiverInfo;
        }

        const payload = {
            conversation_id: this._getConversationId(user.$id, toUserId),
            sender_id: user.$id,
            sender_username: senderProfile.username || user.name || user.email || 'user',
            sender_display_name: senderProfile.display_name || user.name || senderProfile.username || 'User',
            sender_avatar: senderProfile.avatar_url || user.prefs?.avatar || '',
            receiver_id: toUserId,
            receiver_username: receiverInfo.username || 'user',
            receiver_display_name: receiverInfo.display_name || receiverInfo.username || 'User',
            receiver_avatar: receiverInfo.avatar_url || '',
            message: text.slice(0, 3000),
            track_payload: trackPayload ? JSON.stringify(trackPayload) : '',
            read: false,
            created_at: Date.now(),
        };

        const created = await databases.createDocument(DATABASE_ID, CHAT_MESSAGES_COLLECTION, ID.unique(), payload, [
            Permission.read(Role.user(user.$id)),
            Permission.read(Role.user(toUserId)),
            Permission.update(Role.user(user.$id)),
            Permission.update(Role.user(toUserId)),
            Permission.delete(Role.user(user.$id)),
            Permission.delete(Role.user(toUserId)),
        ]);
        return this._mapChatMessage(created);
    },

    async listChatMessages(withUserId, { limit = 200, markRead = true } = {}) {
        const user = authManager.user;
        if (!user || !withUserId) return [];

        const cappedLimit = Math.max(1, Math.min(limit, 500));
        const conversationId = this._getConversationId(user.$id, withUserId);
        try {
            const res = await databases.listDocuments(DATABASE_ID, CHAT_MESSAGES_COLLECTION, [
                Query.equal('conversation_id', conversationId),
                Query.orderAsc('created_at'),
                Query.limit(cappedLimit),
            ]);

            const messages = res.documents.map((doc) => this._mapChatMessage(doc));
            if (markRead) {
                await this.markConversationRead(withUserId, messages);
            }
            return messages;
        } catch (error) {
            console.warn('[Appwrite Sync] Failed to list chat messages:', error);
            return [];
        }
    },

    async listChatSummaries() {
        const user = authManager.user;
        if (!user) return [];

        try {
            const [sent, received] = await Promise.all([
                databases.listDocuments(DATABASE_ID, CHAT_MESSAGES_COLLECTION, [
                    Query.equal('sender_id', user.$id),
                    Query.orderDesc('created_at'),
                    Query.limit(300),
                ]),
                databases.listDocuments(DATABASE_ID, CHAT_MESSAGES_COLLECTION, [
                    Query.equal('receiver_id', user.$id),
                    Query.orderDesc('created_at'),
                    Query.limit(300),
                ]),
            ]);

            const byPeer = new Map();
            [...sent.documents, ...received.documents]
                .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
                .forEach((doc) => {
                    const senderIsMe = doc.sender_id === user.$id;
                    const peerId = senderIsMe ? doc.receiver_id : doc.sender_id;
                    const peerUsername = senderIsMe ? doc.receiver_username : doc.sender_username;
                    const peerDisplayName = senderIsMe
                        ? doc.receiver_display_name || doc.receiver_username
                        : doc.sender_display_name || doc.sender_username;
                    const peerAvatar = senderIsMe ? doc.receiver_avatar : doc.sender_avatar;

                    if (!byPeer.has(peerId)) {
                        byPeer.set(peerId, {
                            peerId,
                            username: peerUsername,
                            displayName: peerDisplayName || peerUsername || 'User',
                            avatarUrl: peerAvatar || '',
                            lastMessage: doc.message || (doc.track_payload ? 'Shared a track' : ''),
                            lastMessageAt: doc.created_at || 0,
                            unreadCount: 0,
                        });
                    }

                    const summary = byPeer.get(peerId);
                    if (!senderIsMe && !doc.read) {
                        summary.unreadCount += 1;
                    }
                });

            return Array.from(byPeer.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
        } catch (error) {
            console.warn('[Appwrite Sync] Failed to list chat summaries:', error);
            return [];
        }
    },

    async markConversationRead(withUserId, existingMessages = null) {
        const user = authManager.user;
        if (!user || !withUserId) return;

        const messages =
            existingMessages && Array.isArray(existingMessages) ? existingMessages : await this.listChatMessages(withUserId, { markRead: false });

        const unread = messages.filter((msg) => msg.receiverId === user.$id && !msg.read);
        if (!unread.length) return;

        await Promise.allSettled(
            unread.map((msg) =>
                databases.updateDocument(DATABASE_ID, CHAT_MESSAGES_COLLECTION, msg.id, { read: true })
            )
        );
    },

    async syncCloudPublicPlaylistsToLocal() {
        const user = authManager.user;
        if (!user) return false;

        if (this._publicPlaylistSyncPromise) {
            return this._publicPlaylistSyncPromise;
        }

        this._publicPlaylistSyncPromise = (async () => {
            try {
                const response = await this._withRetry(
                    () =>
                        databases.listDocuments(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, [
                            Query.equal('owner_id', user.$id),
                            Query.equal('is_public', true),
                            Query.limit(200),
                        ]),
                    { label: 'sync cloud public playlists' }
                );

                const cloudPlaylists = response.documents
                    .map((doc) => this._mapPublicPlaylistDoc(doc))
                    .filter((playlist) => playlist.id);

                const dbHandle = await database.open();
                const didChange = await new Promise((resolve, reject) => {
                    const tx = dbHandle.transaction('user_playlists', 'readwrite');
                    const store = tx.objectStore('user_playlists');
                    let changed = false;

                    const allReq = store.getAll();
                    allReq.onsuccess = () => {
                        const existing = allReq.result || [];
                        const existingPublicById = new Map(
                            existing.filter((playlist) => playlist?.isPublic && playlist?.id).map((playlist) => [playlist.id, playlist])
                        );
                        const incomingById = new Map(cloudPlaylists.map((playlist) => [playlist.id, playlist]));

                        existingPublicById.forEach((_playlist, playlistId) => {
                            if (!incomingById.has(playlistId)) {
                                store.delete(playlistId);
                                changed = true;
                            }
                        });

                        cloudPlaylists.forEach((playlist) => {
                            const existingPlaylist = existingPublicById.get(playlist.id);
                            const mergedPlaylist = {
                                ...(existingPlaylist || {}),
                                ...playlist,
                                isPublic: true,
                            };

                            if (
                                !existingPlaylist ||
                                this._playlistSyncSignature(existingPlaylist) !== this._playlistSyncSignature(mergedPlaylist)
                            ) {
                                store.put(mergedPlaylist);
                                changed = true;
                            }
                        });
                    };
                    allReq.onerror = () => reject(allReq.error || tx.error);

                    tx.oncomplete = () => resolve(changed);
                    tx.onerror = (event) => reject(event.target.error || tx.error);
                    tx.onabort = (event) => reject(event.target.error || tx.error);
                });

                if (didChange) {
                    window.dispatchEvent(new CustomEvent('library-changed'));
                }

                return didChange;
            } catch (error) {
                console.warn('[Appwrite Sync] Failed to sync cloud public playlists:', error);
                return false;
            } finally {
                this._publicPlaylistSyncPromise = null;
            }
        })();

        return this._publicPlaylistSyncPromise;
    },

    _scheduleCloudPublicPlaylistSync(delayMs = 700) {
        if (this._publicPlaylistSyncTimeoutId) {
            clearTimeout(this._publicPlaylistSyncTimeoutId);
        }

        this._publicPlaylistSyncTimeoutId = setTimeout(() => {
            this._publicPlaylistSyncTimeoutId = null;
            this.syncCloudPublicPlaylistsToLocal().catch((error) => {
                console.warn('[Appwrite Sync] Delayed public playlist sync failed:', error);
            });
        }, delayMs);
    },

    async pullCloudData({ syncPublicPlaylists = true } = {}) {
        if (!authManager.user) return false;

        if (this._cloudPullPromise) {
            return this._cloudPullPromise;
        }

        this._cloudPullPromise = (async () => {
            try {
                const cloudData = await this.getUserData();
                if (!cloudData) return false;

                const cloudLibrary = cloudData.library || {};
                const didImport = await database.importData(
                    {
                        favorites_tracks: Object.values(cloudLibrary.tracks || {}),
                        favorites_albums: Object.values(cloudLibrary.albums || {}),
                        favorites_artists: Object.values(cloudLibrary.artists || {}),
                        favorites_playlists: Object.values(cloudLibrary.playlists || {}),
                        favorites_mixes: Object.values(cloudLibrary.mixes || {}),
                        history_tracks: cloudData.history || [],
                    },
                    false
                );

                let playlistChanged = false;
                if (syncPublicPlaylists) {
                    playlistChanged = await this.syncCloudPublicPlaylistsToLocal();
                }

                if (didImport) {
                    window.dispatchEvent(new CustomEvent('library-changed'));
                    window.dispatchEvent(new CustomEvent('history-changed'));
                } else if (playlistChanged) {
                    window.dispatchEvent(new CustomEvent('library-changed'));
                }

                return didImport || playlistChanged;
            } catch (error) {
                console.warn('[Appwrite Sync] Failed to pull cloud data:', error);
                return false;
            } finally {
                this._cloudPullPromise = null;
            }
        })();

        return this._cloudPullPromise;
    },

    setupRealtimeSubscriptions() {
        const user = authManager.user;
        if (!user || this._realtimeUnsubscribe) return;

        try {
            this._realtimeUnsubscribe = client.subscribe(
                [
                    `databases.${DATABASE_ID}.collections.${USERS_COLLECTION}.documents`,
                    `databases.${DATABASE_ID}.collections.${PUBLIC_PLAYLISTS_COLLECTION}.documents`,
                    `databases.${DATABASE_ID}.collections.${FRIEND_REQUESTS_COLLECTION}.documents`,
                    `databases.${DATABASE_ID}.collections.${CHAT_MESSAGES_COLLECTION}.documents`,
                ],
                (response) => {
                    const doc = response.payload;
                    if (!doc || typeof doc !== 'object') return;

                    if (Object.prototype.hasOwnProperty.call(doc, 'firebase_id')) {
                        const previousRecord = this._userRecordCache;
                        if (doc.firebase_id === user.$id) {
                            this._userRecordCache = doc;
                            const cloudPayloadChanged = this._didCloudSyncPayloadChange(previousRecord, doc);
                            window.dispatchEvent(
                                new CustomEvent('pb-user-updated', {
                                    detail: {
                                        ...doc,
                                        _cloudPayloadChanged: cloudPayloadChanged,
                                    },
                                })
                            );
                            if (cloudPayloadChanged) {
                                this.pullCloudData({ syncPublicPlaylists: true }).catch((error) => {
                                    console.warn('[Appwrite Sync] Realtime cloud pull failed:', error);
                                });
                            }
                        } else {
                            window.dispatchEvent(new CustomEvent('pb-friend-updated', { detail: doc }));
                        }
                        return;
                    }

                    if (
                        Object.prototype.hasOwnProperty.call(doc, 'owner_id') &&
                        Object.prototype.hasOwnProperty.call(doc, 'id') &&
                        Object.prototype.hasOwnProperty.call(doc, 'is_public')
                    ) {
                        const playlist = this._mapPublicPlaylistDoc(doc);
                        window.dispatchEvent(
                            new CustomEvent('pb-public-playlist-updated', {
                                detail: {
                                    playlistId: playlist.id,
                                    ownerId: doc.owner_id,
                                    playlist,
                                    events: response.events || [],
                                },
                            })
                        );

                        if (doc.owner_id === user.$id) {
                            this._scheduleCloudPublicPlaylistSync();
                        }
                        return;
                    }

                    if (
                        Object.prototype.hasOwnProperty.call(doc, 'sender_id') &&
                        Object.prototype.hasOwnProperty.call(doc, 'receiver_id') &&
                        Object.prototype.hasOwnProperty.call(doc, 'status')
                    ) {
                        if (doc.sender_id === user.$id || doc.receiver_id === user.$id) {
                            window.dispatchEvent(new CustomEvent('pb-friend-request-updated', { detail: doc }));
                        }
                        return;
                    }

                    if (
                        Object.prototype.hasOwnProperty.call(doc, 'conversation_id') &&
                        Object.prototype.hasOwnProperty.call(doc, 'message')
                    ) {
                        if (doc.sender_id === user.$id || doc.receiver_id === user.$id) {
                            window.dispatchEvent(
                                new CustomEvent('pb-chat-message', {
                                    detail: this._mapChatMessage(doc),
                                })
                            );
                        }
                    }
                }
            );
            console.log('[Appwrite Sync] Real-time subscriptions active');
        } catch (error) {
            console.error('[Appwrite Sync] Failed to initialize real-time subscriptions:', error);
        }
    },

    async updatePlaybackStatus(track) {
        if (!authManager.user || !track) return;
        if (Date.now() < this._statusBackoffUntil) return;

        const statusData = {
            text: `${track.title} - ${getTrackArtists(track)}`,
            image: track.album?.cover || 'assets/appicon.png',
            link: getShareUrl(`/track/${track.id}`),
        };

        try {
            await this.updateProfile({ status: JSON.stringify(statusData) });
        } catch (error) {
            if (isNetworkError(error)) {
                this._statusBackoffUntil = Date.now() + 10_000;
            }
            console.error('[Appwrite Sync] Failed to update playback status:', error);
        }
    },

    async clearPlaybackStatus() {
        if (!authManager.user) return;
        if (Date.now() < this._statusBackoffUntil) return;

        try {
            await this.updateProfile({ status: '' });
        } catch (error) {
            if (isNetworkError(error)) {
                this._statusBackoffUntil = Date.now() + 10_000;
            }
            console.error('[Appwrite Sync] Failed to clear playback status:', error);
        }
    },

    async onAuthStateChanged(user) {
        if (!user) {
            this._userRecordCache = null;
            this._isSyncing = false;
            this._cloudPullPromise = null;
            this._publicPlaylistSyncPromise = null;
            if (this._publicPlaylistSyncTimeoutId) {
                clearTimeout(this._publicPlaylistSyncTimeoutId);
                this._publicPlaylistSyncTimeoutId = null;
            }
            if (this._realtimeUnsubscribe) {
                this._realtimeUnsubscribe();
                this._realtimeUnsubscribe = null;
            }
            this.stopPeriodicSync();
            return;
        }

        if (this._isSyncing) return;
        this._isSyncing = true;

        try {
            await this._getUserRecord();
            this.setupRealtimeSubscriptions();
            this.startPeriodicSync();

            const cloudData = await this.getUserData();
            if (!cloudData) return;

            const localData = await database.exportData();
            const hasLocalData =
                (localData?.favorites_tracks?.length || 0) +
                    (localData?.favorites_albums?.length || 0) +
                    (localData?.favorites_artists?.length || 0) +
                    (localData?.history_tracks?.length || 0) >
                0;

            const cloudLibrary = cloudData.library || {};
            const hasCloudData =
                Object.values(cloudLibrary).some((value) => value && Object.keys(value).length > 0) ||
                (cloudData.history?.length || 0) > 0;

            if (!hasLocalData && hasCloudData) {
                await this.pullCloudData({ syncPublicPlaylists: true });
            } else {
                await this.syncCloudPublicPlaylistsToLocal();
            }
        } catch (error) {
            console.error('[Appwrite Sync] Sync error:', error);
        } finally {
            this._isSyncing = false;
        }
    },

    startPeriodicSync() {
        if (this._syncIntervalId) return;

        const doSync = async () => {
            if (!authManager.user) return;
            try {
                const localData = await database.exportData();
                if (!localData) return;

                const record = await this._getUserRecord();
                if (!record) return;

                const asMap = (arr, key = 'id') => {
                    const map = {};
                    arr.forEach((item) => {
                        const itemKey = item?.[key] ?? item?.uuid;
                        if (!itemKey) return;
                        map[itemKey] = item;
                    });
                    return map;
                };

                const library = {
                    tracks: asMap((localData.favorites_tracks || []).slice(0, MAX_TRACK_SYNC)),
                    albums: asMap((localData.favorites_albums || []).slice(0, MAX_ALBUM_SYNC)),
                    artists: asMap((localData.favorites_artists || []).slice(0, MAX_ARTIST_SYNC)),
                    playlists: asMap((localData.favorites_playlists || []).slice(0, MAX_PLAYLIST_SYNC), 'uuid'),
                    mixes: asMap((localData.favorites_mixes || []).slice(0, MAX_MIX_SYNC)),
                };

                const history = (localData.history_tracks || []).slice(0, MAX_HISTORY_ITEMS);
                const playlists = localData.user_playlists || [];

                const publicPlaylists = {};
                const publicPlaylistIds = new Set();
                const publicPlaylistDocuments = [];
                for (const playlist of playlists) {
                    if (!playlist?.isPublic) continue;
                    publicPlaylistIds.add(playlist.id);
                    publicPlaylistDocuments.push(playlist);
                    publicPlaylists[playlist.id] = {
                        id: playlist.id,
                        name: playlist.name || 'Untitled Playlist',
                        cover: playlist.cover || null,
                        description: playlist.description || '',
                        numberOfTracks: playlist.tracks?.length || 0,
                        isPublic: true,
                    };
                }

                const favoriteAlbums = this._normalizeFavoriteAlbums(localData.favorites_albums || []).slice(0, 20);

                const updated = await this._withRetry(
                    () =>
                        databases.updateDocument(DATABASE_ID, USERS_COLLECTION, record.$id, {
                            library: JSON.stringify(library),
                            history: JSON.stringify(history),
                            user_playlists: JSON.stringify(publicPlaylists),
                            favorite_albums: JSON.stringify(favoriteAlbums),
                        }),
                    { label: 'periodic sync' }
                );

                try {
                    const existingCloudPlaylists = await databases.listDocuments(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, [
                        Query.equal('owner_id', authManager.user.$id),
                        Query.limit(300),
                    ]);

                    await Promise.allSettled(
                        existingCloudPlaylists.documents
                            .filter((doc) => !publicPlaylistIds.has(doc.id))
                            .map((doc) => databases.deleteDocument(DATABASE_ID, PUBLIC_PLAYLISTS_COLLECTION, doc.$id))
                    );

                    await Promise.allSettled(publicPlaylistDocuments.map((playlist) => this.publishPlaylist(playlist)));
                } catch (playlistError) {
                    console.warn('[Appwrite Sync] Periodic public playlist sync failed:', playlistError);
                }

                this._userRecordCache = updated;
                window.dispatchEvent(new CustomEvent('library-changed'));
                console.log('[Appwrite Sync] Periodic sync complete');
            } catch (error) {
                console.warn('[Appwrite Sync] Periodic sync failed:', error);
            }
        };

        setTimeout(doSync, 5000);
        this._syncIntervalId = setInterval(doSync, 2 * 60 * 1000);
    },

    stopPeriodicSync() {
        if (this._syncIntervalId) {
            clearInterval(this._syncIntervalId);
            this._syncIntervalId = null;
        }
    },
};

authManager.onAuthStateChanged(syncManager.onAuthStateChanged.bind(syncManager));
window.syncManager = syncManager;

export { syncManager };
