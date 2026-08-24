import homeIcon from '@tabler/icons/filled/home.svg?raw';
import listIcon from '@tabler/icons/filled/list.svg?raw';
import discIcon from '@tabler/icons/filled/disc.svg?raw';
import searchIcon from '@tabler/icons/filled/search.svg?raw';
import settingsIcon from '@tabler/icons/filled/settings.svg?raw';
import playerPlayIcon from '@tabler/icons/filled/player-play.svg?raw';
import playerPauseIcon from '@tabler/icons/filled/player-pause.svg?raw';
import playerSkipBackIcon from '@tabler/icons/filled/player-skip-back.svg?raw';
import playerSkipForwardIcon from '@tabler/icons/filled/player-skip-forward.svg?raw';
import heartIcon from '@tabler/icons/filled/heart.svg?raw';
import downloadIcon from '@tabler/icons/filled/download.svg?raw';
import trashIcon from '@tabler/icons/filled/trash.svg?raw';
import userIcon from '@tabler/icons/filled/user.svg?raw';
import playlistIcon from '@tabler/icons/filled/playlist.svg?raw';
import clockIcon from '@tabler/icons/filled/clock.svg?raw';

const iconMap = {
    house: homeIcon,
    list: listIcon,
    film: discIcon,
    search: searchIcon,
    settings: settingsIcon,
    'player-play': playerPlayIcon,
    'player-pause': playerPauseIcon,
    'arrow-left-to-line': playerSkipBackIcon,
    'arrow-right-to-line': playerSkipForwardIcon,
    heart: heartIcon,
    download: downloadIcon,
    trash: trashIcon,
    user: userIcon,
    playlist: playlistIcon,
    clock: clockIcon,
};

const contextMenuIcons = {
    'shuffle-play-card': 'playlist',
    'start-infinite-radio': 'disc',
    'start-mix': 'playlist',
    'play-next': 'player-skip-forward',
    'add-to-queue': 'list',
    'toggle-like': 'heart',
    'toggle-pin': 'disc',
    'add-to-playlist': 'playlist',
    'add-to-collab-playlist': 'user',
    'go-to-artist': 'user',
    'go-to-album': 'disc',
    'copy-link': 'list',
    'open-in-new-tab': 'player-skip-forward',
    'track-info': 'clock',
    'open-original-url': 'player-skip-forward',
    download: 'download',
    'block-track': 'trash',
    'block-album': 'trash',
    'block-artist': 'trash',
    'back-to-main-menu': 'player-skip-back',
};

function replaceIcon(element, iconName) {
    const svg = iconMap[iconName];
    if (!element || !svg) return;

    const replacement = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    replacement.setAttribute('class', `${element.getAttribute('class') || ''} tabler-filled-icon`);
    replacement.setAttribute('aria-hidden', element.getAttribute('aria-hidden') || 'true');
    replacement.setAttribute('focusable', 'false');
    if (element.getAttribute('width')) replacement.setAttribute('width', element.getAttribute('width'));
    if (element.getAttribute('height')) replacement.setAttribute('height', element.getAttribute('height'));
    element.replaceWith(replacement);
}

function getIconName(element) {
    return [...element.classList]
        .map((className) => className.replace(/^lucide-/, '').replace(/-icon$/, ''))
        .find((className) => iconMap[className]);
}

export function initTablerIcons(root = document) {
    root.querySelectorAll('svg[class*="lucide-"]').forEach((element) => {
        const iconName = getIconName(element);
        const svg = iconName ? iconMap[iconName] : null;
        if (!svg) return;

        replaceIcon(element, iconName);
    });

    const navbarIcons = {
        '#nav-back': 'player-skip-back',
        '#nav-forward': 'player-skip-forward',
        '[data-quick-nav="/"]': 'home',
        '[data-quick-nav="/library"]': 'playlist',
        '[data-quick-nav="/recent"]': 'clock',
        '#header-nav-friends': 'user',
        '[data-quick-nav="/unreleased"]': 'disc',
        '[data-quick-nav="/settings"]': 'settings',
        '#header-account-icon': 'user',
    };

    Object.entries(navbarIcons).forEach(([selector, iconName]) => {
        const element = root.querySelector(`${selector} svg`);
        if (element) replaceIcon(element, iconName);
    });

    const contextMenu = root.querySelector('#context-menu');
    if (contextMenu) {
        const applyContextMenuIcons = () => {
            contextMenu.querySelectorAll('li[data-action]').forEach((item) => {
                if (item.querySelector('.context-menu-icon')) return;
                const iconName = contextMenuIcons[item.dataset.action];
                const svg = iconName ? iconMap[iconName] : null;
                if (!svg) return;
                const icon = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
                icon.classList.add('context-menu-icon', 'tabler-filled-icon');
                icon.setAttribute('aria-hidden', 'true');
                icon.setAttribute('focusable', 'false');
                item.prepend(icon);
            });
        };
        applyContextMenuIcons();
        new MutationObserver(applyContextMenuIcons).observe(contextMenu, { childList: true, subtree: true });
    }
}
