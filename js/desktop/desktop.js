// js/desktop/desktop.js
import { initializeDiscordRPC } from './discord-rpc.js';
import { checkForDesktopUpdates } from './tauri-updater.js';

async function initFramelessWindowChrome() {
    if (document.getElementById('tauri-window-chrome')) return;

    document.body.classList.add('tauri-desktop');

    const bar = document.createElement('div');
    bar.id = 'tauri-window-chrome';
    bar.innerHTML = `
        <div class="tauri-window-brand" data-tauri-drag-region>
            <span class="tauri-window-brand-dot"></span>
            <span class="tauri-window-brand-text">Monochrome+</span>
        </div>
        <div class="tauri-window-drag-region" data-tauri-drag-region>
            <button class="tauri-window-grab-handle" type="button" aria-label="Drag window" data-tauri-drag-region>
                <span data-tauri-drag-region></span>
                <span data-tauri-drag-region></span>
                <span data-tauri-drag-region></span>
            </button>
        </div>
        <div class="tauri-window-controls">
            <button id="tauri-window-minimize" class="tauri-window-btn" type="button" aria-label="Minimize">—</button>
            <button id="tauri-window-maximize" class="tauri-window-btn" type="button" aria-label="Maximize">▢</button>
            <button id="tauri-window-close" class="tauri-window-btn close" type="button" aria-label="Close">✕</button>
        </div>
    `;

    document.body.prepend(bar);

    try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        const dragRegion = bar.querySelector('.tauri-window-drag-region');
        const maximizeBtn = bar.querySelector('#tauri-window-maximize');

        const syncMaximizeState = async () => {
            const isMaximized = await appWindow.isMaximized();
            maximizeBtn.textContent = isMaximized ? '❐' : '▢';
            maximizeBtn.setAttribute('aria-label', isMaximized ? 'Restore' : 'Maximize');
        };

        bar.querySelector('#tauri-window-minimize')?.addEventListener('click', async () => {
            await appWindow.minimize();
        });

        maximizeBtn?.addEventListener('click', async () => {
            await appWindow.toggleMaximize();
            await syncMaximizeState();
        });

        bar.querySelector('#tauri-window-close')?.addEventListener('click', async () => {
            await appWindow.close();
        });

        dragRegion?.addEventListener('dblclick', async () => {
            await appWindow.toggleMaximize();
            await syncMaximizeState();
        });

        await syncMaximizeState();
        appWindow.onResized(() => {
            void syncMaximizeState();
        });
    } catch (error) {
        console.warn('[Desktop] Failed to initialize custom window controls:', error);
    }
}

export async function initDesktop(player) {
    console.log('[Desktop] Initializing desktop features...');

    const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

    if (isTauri) {
        console.log('[Desktop] Tauri runtime detected.');
        await initFramelessWindowChrome();
        if (player) {
            initializeDiscordRPC(player);
        }
        checkForDesktopUpdates();
        return;
    }

    console.log('[Desktop] No supported desktop runtime detected.');
}
