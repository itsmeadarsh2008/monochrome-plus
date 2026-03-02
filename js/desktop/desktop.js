// js/desktop/desktop.js
import { initializeDiscordRPC } from './discord-rpc.js';
import { checkForDesktopUpdates } from './tauri-updater.js';

export async function initDesktop(player) {
    console.log('[Desktop] Initializing desktop features...');

    const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

    if (isTauri) {
        console.log('[Desktop] Tauri runtime detected.');
        if (player) {
            initializeDiscordRPC(player);
        }
        checkForDesktopUpdates();
        return;
    }

    console.log('[Desktop] No supported desktop runtime detected.');
}
