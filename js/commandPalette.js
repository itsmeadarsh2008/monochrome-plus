import { debounce } from './utils.js';
import { db } from './db.js';
import Fuse from 'fuse.js';
import { navigate } from './router.js';
import * as icons from './icons.js';
import { Player } from './player.js';
import { UIRenderer } from './ui.js';

const ICON_SIZE = 16;

const ICONS = {
    search: icons.SVG_SEARCH,
    house: icons.SVG_HOUSE,
    library: icons.SVG_LIBRARY,
    clock: icons.SVG_CLOCK,
    calendar: icons.SVG_INFO, // fallback
    settings: icons.SVG_SETTINGS,
    info: icons.SVG_INFO,
    download: icons.SVG_DOWNLOAD,
    handHeart: icons.SVG_HEART, // fallback
    play: icons.SVG_PLAY,
    skipForward: icons.SVG_SKIP_FORWARD,
    skipBack: icons.SVG_SKIP_BACK,
    shuffle: icons.SVG_SHUFFLE,
    repeat: icons.SVG_REPEAT,
    volumeX: icons.SVG_MUTE,
    volume: icons.SVG_VOLUME,
    heart: icons.SVG_HEART,
    list: icons.SVG_LIST,
    trash: icons.SVG_BIN,
    text: icons.SVG_LIST, // fallback
    maximize: icons.SVG_PLUS, // fallback
    sparkles: icons.SVG_PLUS, // fallback
    monitor: icons.SVG_INFO, // fallback
    moon: icons.SVG_INFO, // fallback
    sun: icons.SVG_INFO, // fallback
    palette: icons.SVG_INFO, // fallback
    store: icons.SVG_INFO, // fallback
    sliders: icons.SVG_SETTINGS, // fallback
    plus: icons.SVG_PLUS,
    folderPlus: icons.SVG_PLUS, // fallback
    keyboard: icons.SVG_INFO, // fallback
    upload: icons.SVG_DOWNLOAD, // fallback
    user: icons.SVG_USER,
    pencil: icons.SVG_INFO, // fallback
    logOut: icons.SVG_LOG_OUT,
    logIn: icons.SVG_LOG_IN,
    music: icons.SVG_MUSIC,
    disc: icons.SVG_DISC,
    mic: icons.SVG_MIC,
    radio: icons.SVG_INFO, // fallback
};

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

class CommandPalette {
    constructor() {
        this.overlay = document.getElementById('command-palette-overlay');
        this.input = document.getElementById('command-palette-input');
        this.resultsContainer = document.getElementById('command-palette-results');
        this.isOpen = false;
        this.selectedIndex = 0;
        this.flatItems = [];
        this.allSettings = [];
        this.musicSearchAbort = null;
        this.debouncedMusicSearch = debounce(this.searchMusic.bind(this), 300);
        this.commands = this.buildCommands();
        this.fuse = new Fuse(this.commands, {
            keys: [
                { name: 'label', weight: 0.6 },
                { name: 'keywords', weight: 0.3 },
                { name: 'group', weight: 0.1 },
            ],
            threshold: 0.4,
            ignoreLocation: true,
            includeScore: true,
        });

        this.init();
    }

    buildCommands() {
        return [
            {
                id: 'nav-home',
                group: 'Navigation',
                icon: 'house',
                label: 'Go to Home',
                keywords: ['home', 'main', 'start', 'landing'],
                action: () => {
                    navigate('/');
                },
            },
            {
                id: 'nav-library',
                group: 'Navigation',
                icon: 'library',
                label: 'Go to Library',
                keywords: ['library', 'collection', 'playlists', 'favorites'],
                action: () => {
                    navigate('/library');
                },
            },
            {
                id: 'nav-recent',
                group: 'Navigation',
                icon: 'clock',
                label: 'Go to Recent',
                keywords: ['recent', 'history', 'last played'],
                action: () => {
                    navigate('/recent');
                },
            },
            {
                id: 'nav-settings',
                group: 'Navigation',
                icon: 'settings',
                label: 'Go to Settings',
                keywords: ['settings', 'preferences', 'config', 'options'],
                shortcut: null,
                action: () => {
                    navigate('/settings');
                },
            },
            {
                id: 'nav-about',
                group: 'Navigation',
                icon: 'info',
                label: 'Go to About',
                keywords: ['about', 'version', 'credits'],
                action: () => {
                    navigate('/about');
                },
            },

            {
                id: 'play-pause',
                group: 'Playback',
                icon: 'play',
                label: 'Play / Pause',
                keywords: ['play', 'pause', 'toggle', 'resume', 'stop'],
                shortcut: 'Space',
                action: () => {
                    Player.instance.handlePlayPause();
                },
            },
            {
                id: 'play-next',
                group: 'Playback',
                icon: 'skipForward',
                label: 'Next Track',
                keywords: ['next', 'skip', 'forward'],
                shortcut: 'Shift+\u2192',
                action: () => {
                    Player.instance.playNext();
                },
            },
            {
                id: 'play-prev',
                group: 'Playback',
                icon: 'skipBack',
                label: 'Previous Track',
                keywords: ['previous', 'back', 'rewind'],
                shortcut: 'Shift+\u2190',
                action: () => {
                    Player.instance.playPrev();
                },
            },
            {
                id: 'play-shuffle',
                group: 'Playback',
                icon: 'shuffle',
                label: 'Toggle Shuffle',
                keywords: ['shuffle', 'random'],
                shortcut: 'S',
                action: () => {
                    document.getElementById('shuffle-btn')?.click();
                },
            },
            {
                id: 'play-repeat',
                group: 'Playback',
                icon: 'repeat',
                label: 'Toggle Repeat',
                keywords: ['repeat', 'loop', 'cycle'],
                shortcut: 'R',
                action: () => {
                    document.getElementById('repeat-btn')?.click();
                },
            },
            {
                id: 'play-mute',
                group: 'Playback',
                icon: 'volumeX',
                label: 'Mute / Unmute',
                keywords: ['mute', 'unmute', 'sound', 'volume', 'silent'],
                shortcut: 'M',
                action: () => {
                    const el = Player.instance.activeElement;
                    if (el) el.muted = !el.muted;
                },
            },

            {
                id: 'like-current',
                group: 'Now Playing',
                icon: 'heart',
                label: 'Like Current Track',
                keywords: ['like', 'favorite', 'love', 'heart', 'save'],
                action: () => {
                    document.querySelector('.now-playing-bar .like-btn')?.click();
                },
            },
            {
                id: 'download-current',
                group: 'Now Playing',
                icon: 'download',
                label: 'Download Current Track',
                keywords: ['download', 'save', 'current'],
                action: () => {
                    document.querySelector('.now-playing-bar .download-btn')?.click();
                },
            },

            {
                id: 'queue-open',
                group: 'Queue',
                icon: 'list',
                label: 'Open Queue',
                keywords: ['queue', 'list', 'up next'],
                shortcut: 'Q',
                action: () => {
                    document.getElementById('queue-btn')?.click();
                },
            },
            {
                id: 'queue-wipe',
                group: 'Queue',
                icon: 'trash',
                label: 'Clear Queue',
                keywords: ['wipe', 'clear', 'empty', 'queue'],
                action: () => {
                    Player.instance.wipeQueue();
                    this.notify('Queue cleared');
                },
            },

            {
                id: 'lyrics-toggle',
                group: 'View',
                icon: 'text',
                label: 'Toggle Lyrics',
                keywords: ['lyrics', 'words', 'text', 'karaoke'],
                shortcut: 'L',
                action: () => {
                    document.querySelector('.now-playing-bar .cover')?.click();
                },
            },
            {
                id: 'fullscreen-open',
                group: 'View',
                icon: 'maximize',
                label: 'Open Fullscreen View',
                keywords: ['fullscreen', 'expand', 'immersive', 'cover'],
                action: () => {
                    const cover = document.querySelector('.now-playing-bar .cover-art');
                    if (cover) cover.click();
                },
            },

            {
                id: 'lib-create-playlist',
                group: 'Library',
                icon: 'plus',
                label: 'Create Playlist',
                keywords: ['create', 'new', 'playlist', 'add'],
                action: () => this.createPlaylist(),
            },

            {
                id: 'sys-cache',
                group: 'System',
                icon: 'trash',
                label: 'Clear Cache',
                keywords: ['cache', 'clear', 'reset', 'clean'],
                action: () => this.clearCache(),
            },
            {
                id: 'sys-search-setting',
                group: 'System',
                icon: 'search',
                label: 'Search Settings...',
                keywords: ['setting', 'find', 'search', 'preference', 'option', 'configure'],
                keepOpen: true,
                action: () => this.enterSettingsMode(),
            },

            {
                id: 'acc-profile',
                group: 'Account',
                icon: 'user',
                label: 'View Profile',
                keywords: ['profile', 'account', 'user', 'me'],
                action: () => {
                    document.querySelector('.user-avatar-btn')?.click();
                },
            },
            {
                id: 'acc-sign-out',
                group: 'Account',
                icon: 'logOut',
                label: 'Sign Out',
                keywords: ['sign out', 'log out', 'logout', 'disconnect'],
                action: async () => {
                    const { authManager } = await import('./accounts/auth.js');
                    await authManager.signOut();
                },
            },
            {
                id: 'acc-sign-in',
                group: 'Account',
                icon: 'logIn',
                label: 'Sign In',
                keywords: ['sign in', 'log in', 'login', 'account', 'connect'],
                action: () => {
                    navigate('/account');
                },
            },
        ];
    }

    init() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.toggle();
            }
        });

        this.input.addEventListener('input', () => this.handleInput());
        this.input.addEventListener('keydown', (e) => this.handleKeydown(e));

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });

        this.cacheAllSettings();
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        this.isOpen = true;
        this.settingsMode = false;
        this.overlay.style.display = 'flex';
        this.input.value = '';
        this.input.placeholder = 'Search commands, music, settings...';
        this.input.focus();
        this.showDefaultCommands();
    }

    close() {
        this.isOpen = false;
        this.settingsMode = false;
        this.overlay.style.display = 'none';
        this.cancelMusicSearch();
    }

    enterSettingsMode() {
        this.settingsMode = true;
        this.input.value = '';
        this.input.placeholder = 'Search settings...';
        this.input.focus();
        this.cacheAllSettings();
        this.renderSettingsResults('');
    }

    handleInput() {
        const query = this.input.value.trim();
        this.selectedIndex = 0;

        if (this.settingsMode) {
            this.renderSettingsResults(query);
            return;
        }

        if (!query) {
            this.cancelMusicSearch();
            this.showDefaultCommands();
            return;
        }

        this.searchCommands(query);
        this.debouncedMusicSearch(query);
    }

    handleKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.flatItems.length - 1);
            this.updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.updateSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.executeSelected();
        } else if (e.key === 'Escape') {
            if (this.settingsMode) {
                this.settingsMode = false;
                this.input.value = '';
                this.input.placeholder = 'Search commands, music, settings...';
                this.showDefaultCommands();
            } else {
                this.close();
            }
        } else if (e.key === 'Backspace' && this.settingsMode && !this.input.value) {
            this.settingsMode = false;
            this.input.placeholder = 'Search commands, music, settings...';
            this.showDefaultCommands();
        }
    }

    showDefaultCommands() {
        const priority = [
            'nav-home',
            'nav-library',
            'play-pause',
            'play-next',
            'play-prev',
            'queue-open',
            'lyrics-toggle',
            'fullscreen-open',
            'sys-search-setting',
        ];

        const matched = this.commands.filter((c) => priority.includes(c.id));
        const groups = this.groupBy(matched, 'group');
        this.renderGroups(groups);
    }

    searchCommands(query) {
        const fuseResults = this.fuse.search(query).slice(0, 12);
        const matched = fuseResults.map((r) => r.item);

        if (matched.length === 0) {
            this.renderGroups({});
            return;
        }

        const groups = this.groupBy(matched, 'group');
        this.renderGroups(groups);
    }

    async searchMusic(query) {
        if (!query || query.length < 2) return;

        const api = UIRenderer.instance?.api;
        if (!api) return;

        this.cancelMusicSearch();
        const controller = new AbortController();
        this.musicSearchAbort = controller;

        this.showMusicLoading();

        try {
            // Adapted search logic for MusicAPI
            const [tracks, albums, artists] = await Promise.all([
                api.searchTracks(query, { limit: 4 }),
                api.searchAlbums(query, { limit: 4 }),
                api.searchArtists(query, { limit: 4 }),
            ]);

            if (controller.signal.aborted || !this.isOpen) return;

            const musicGroups = {};

            if (tracks?.items?.length) {
                musicGroups['Tracks'] = tracks.items.map((track) => ({
                    id: `track-${track.id}`,
                    group: 'Tracks',
                    icon: 'music',
                    image: api.getCoverUrl(track.album?.cover, 80),
                    label: track.title,
                    description: `${track.artist?.name || 'Unknown'} \u2022 ${track.album?.title || ''}`,
                    action: async () => {
                        Player.instance.setQueue([track], 0);
                        await Player.instance.playTrackFromQueue();
                    },
                }));
            }

            if (albums?.items?.length) {
                musicGroups['Albums'] = albums.items.map((album) => ({
                    id: `album-${album.id}`,
                    group: 'Albums',
                    icon: 'disc',
                    image: api.getCoverUrl(album.cover, 80),
                    label: album.title,
                    description: album.artist?.name || 'Unknown',
                    action: () => {
                        navigate(`/album/${album.id}`);
                    },
                }));
            }

            if (artists?.items?.length) {
                musicGroups['Artists'] = artists.items.map((artist) => ({
                    id: `artist-${artist.id}`,
                    group: 'Artists',
                    icon: 'mic',
                    image: api.getArtistPictureUrl(artist.picture, 80),
                    label: artist.name,
                    description: 'Artist',
                    action: () => {
                        navigate(`/artist/${artist.id}`);
                    },
                }));
            }

            if (Object.keys(musicGroups).length > 0) {
                this.appendMusicGroups(musicGroups);
            }

            this.removeMusicLoading();
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error('Music search error:', e);
                this.removeMusicLoading();
            }
        }
    }

    cancelMusicSearch() {
        if (this.musicSearchAbort) {
            this.musicSearchAbort.abort();
            this.musicSearchAbort = null;
        }
    }

    showMusicLoading() {
        this.removeMusicLoading();
        const loading = document.createElement('div');
        loading.className = 'cmdk-loading';
        loading.setAttribute('data-music-loading', '');
        loading.innerHTML = '<div class="cmdk-loading-spinner"></div>Searching music...';
        this.resultsContainer.appendChild(loading);
    }

    removeMusicLoading() {
        this.resultsContainer.querySelector('[data-music-loading]')?.remove();
    }

    appendMusicGroups(musicGroups) {
        this.removeMusicLoading();
        this.resultsContainer.querySelector('.cmdk-empty')?.remove();
        this.resultsContainer.querySelectorAll('[data-music-group]').forEach((el) => el.remove());

        let index = this.flatItems.length;

        for (const [heading, items] of Object.entries(musicGroups)) {
            const groupEl = document.createElement('div');
            groupEl.className = 'cmdk-group';
            groupEl.setAttribute('data-music-group', '');

            const headingEl = document.createElement('div');
            headingEl.className = 'cmdk-group-heading';
            headingEl.textContent = heading;
            groupEl.appendChild(headingEl);

            for (const item of items) {
                const itemEl = this.createItemElement(item, index);
                groupEl.appendChild(itemEl);
                this.flatItems.push(item);
                index++;
            }

            this.resultsContainer.appendChild(groupEl);
        }
    }

    groupBy(items, key) {
        const groups = {};
        for (const item of items) {
            const group = item[key] || 'Other';
            if (!groups[group]) groups[group] = [];
            groups[group].push(item);
        }
        return groups;
    }

    renderGroups(groups) {
        this.resultsContainer.innerHTML = '';
        this.flatItems = [];
        let index = 0;

        const groupEntries = Object.entries(groups);
        if (groupEntries.length === 0) {
            const query = this.input.value.trim();
            if (query) {
                const empty = document.createElement('div');
                empty.className = 'cmdk-empty';
                empty.textContent = 'No commands found';
                this.resultsContainer.appendChild(empty);
            }
            return;
        }

        for (const [heading, items] of groupEntries) {
            const groupEl = document.createElement('div');
            groupEl.className = 'cmdk-group';

            const headingEl = document.createElement('div');
            headingEl.className = 'cmdk-group-heading';
            headingEl.textContent = heading;
            groupEl.appendChild(headingEl);

            for (const item of items) {
                const itemEl = this.createItemElement(item, index);
                groupEl.appendChild(itemEl);
                this.flatItems.push(item);
                index++;
            }

            this.resultsContainer.appendChild(groupEl);
        }

        this.updateSelection();
    }

    createItemElement(item, index) {
        const el = document.createElement('div');
        el.className = 'cmdk-item';
        el.id = `cmdk-item-${index}`;
        el.setAttribute('role', 'option');
        el.setAttribute('data-index', index);
        el.setAttribute('aria-selected', index === this.selectedIndex ? 'true' : 'false');
        if (index === this.selectedIndex) el.setAttribute('data-selected', 'true');

        let iconHtml = '';
        if (item.image) {
            iconHtml = `<div class="cmdk-item-icon"><img src="${escapeHtml(item.image)}" crossorigin="anonymous" alt="" loading="lazy" /></div>`;
        } else if (item.icon && ICONS[item.icon]) {
            const iconSvg = ICONS[item.icon];
            // If it's a function (like SVG_ATMOS), call it, otherwise use it as is
            const finalIcon = typeof iconSvg === 'function' ? iconSvg(ICON_SIZE) : iconSvg;
            iconHtml = `<div class="cmdk-item-icon">${finalIcon}</div>`;
        }

        let shortcutHtml = '';
        if (item.shortcut) {
            const keys = item.shortcut.split('+');
            shortcutHtml = `<div class="cmdk-item-shortcut">${keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</div>`;
        }

        const descHtml = item.description
            ? `<span class="cmdk-item-description">${escapeHtml(item.description)}</span>`
            : '';

        el.innerHTML = `${iconHtml}<div class="cmdk-item-content"><span class="cmdk-item-label">${escapeHtml(item.label)}</span>${descHtml}</div>${shortcutHtml}`;

        el.addEventListener('click', () => {
            this.selectedIndex = index;
            this.executeSelected();
        });

        el.addEventListener('mouseenter', () => {
            this.selectedIndex = index;
            this.updateSelection();
        });

        return el;
    }

    updateSelection() {
        const items = this.resultsContainer.querySelectorAll('.cmdk-item');
        items.forEach((item) => {
            const idx = parseInt(item.getAttribute('data-index'));
            if (idx === this.selectedIndex) {
                item.setAttribute('data-selected', 'true');
                item.setAttribute('aria-selected', 'true');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.removeAttribute('data-selected');
                item.setAttribute('aria-selected', 'false');
            }
        });
        this.input.setAttribute('aria-activedescendant', `cmdk-item-${this.selectedIndex}`);
    }

    async executeSelected() {
        const item = this.flatItems[this.selectedIndex];
        if (!item || !item.action) return;

        if (item.keepOpen) {
            try {
                await item.action();
            } catch (e) {
                console.error('Command palette action error:', e);
            }
            return;
        }

        try {
            await item.action();
        } catch (e) {
            console.error('Command palette action error:', e);
        }
        this.close();
    }

    renderSettingsResults(query) {
        if (this.allSettings.length === 0) this.cacheAllSettings();

        let results = this.allSettings;
        if (query) {
            results = this.settingsFuse.search(query).map((r) => r.item);
        }

        const items = results.map((setting) => ({
            id: `setting-${setting.id}`,
            group: `Settings \u2022 ${setting.tab}`,
            icon: 'settings',
            label: setting.label,
            description: setting.description,
            action: () => this.navigateToSetting(setting),
        }));

        const groups = this.groupBy(items, 'group');
        this.renderGroups(groups);
    }

    cacheAllSettings() {
        const settingItems = document.querySelectorAll('#page-settings .setting-item');
        this.allSettings = Array.from(settingItems)
            .map((item) => {
                const labelEl = item.querySelector('.label');
                const descEl = item.querySelector('.description');
                const tabEl = item.closest('.settings-tab-content');

                const label = labelEl ? labelEl.textContent.trim() : '';
                const description = descEl ? descEl.textContent.trim() : '';
                const tab = tabEl ? tabEl.id.replace('settings-tab-', '') : '';

                if (!item.id) {
                    const inputEl = item.querySelector('input[id], select[id], button[id]');
                    item.id = inputEl
                        ? `setting-item-for-${inputEl.id}`
                        : `setting-item-${Math.random().toString(36).substr(2, 9)}`;
                }

                return { id: item.id, label, description, tab };
            })
            .filter((s) => s.label);

        this.settingsFuse = new Fuse(this.allSettings, {
            keys: ['label', 'description'],
            includeScore: true,
            threshold: 0.4,
            ignoreLocation: true,
        });
    }

    async navigateToSetting(setting) {
        navigate('/settings');

        await new Promise((resolve) => setTimeout(resolve, 100));

        const tabButton = document.querySelector(`.settings-tab[data-tab="${setting.tab}"]`);
        if (tabButton && !tabButton.classList.contains('active')) {
            tabButton.click();
        }

        await new Promise((resolve) => setTimeout(resolve, 50));

        const settingElement = document.getElementById(setting.id);
        if (settingElement) {
            settingElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            settingElement.style.transition = 'background-color 0.3s ease-out, box-shadow 0.3s ease-out';
            settingElement.style.backgroundColor = 'rgba(var(--highlight-rgb), 0.2)';
            settingElement.style.boxShadow = '0 0 0 2px rgba(var(--highlight-rgb), 0.5)';
            setTimeout(() => {
                settingElement.style.backgroundColor = '';
                settingElement.style.boxShadow = '';
            }, 2000);
        }
    }

    async createPlaylist() {
        const name = `New Playlist ${new Date().toLocaleDateString()}`;
        await db.createPlaylist(name);
        navigate('/library');
        this.notify('Playlist created');
    }

    async clearCache() {
        const api = UIRenderer.instance?.api;
        if (api) {
            await api.clearCache();
            this.notify('Cache cleared');
        }
    }

    async notify(message) {
        const { showNotification } = await import('./downloads.js');
        if (showNotification) {
            showNotification(message);
        } else {
            console.log('Notification:', message);
        }
    }
}

export const commandPalette = new CommandPalette();
