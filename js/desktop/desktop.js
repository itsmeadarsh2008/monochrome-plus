// js/desktop/desktop.js
import { initializeDiscordRPC } from './discord-rpc.js';
import { checkForDesktopUpdates } from './tauri-updater.js';

const DESKTOP_ZOOM_STORAGE_KEY = 'desktopZoomLevel';
const DEFAULT_DESKTOP_ZOOM = 0.9;
const MIN_DESKTOP_ZOOM = 0.75;
const MAX_DESKTOP_ZOOM = 1;
const DESKTOP_ZOOM_STEP = 0.05;

function normalizeDesktopZoom(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_DESKTOP_ZOOM;
    return Math.min(MAX_DESKTOP_ZOOM, Math.max(MIN_DESKTOP_ZOOM, Math.round(numeric * 100) / 100));
}

function getStoredDesktopZoom() {
    try {
        const stored = localStorage.getItem(DESKTOP_ZOOM_STORAGE_KEY);
        if (!stored) return DEFAULT_DESKTOP_ZOOM;
        return normalizeDesktopZoom(stored);
    } catch {
        return DEFAULT_DESKTOP_ZOOM;
    }
}

function applyDesktopZoom(value) {
    const scale = normalizeDesktopZoom(value);
    document.documentElement.style.setProperty('--desktop-zoom-scale', scale.toFixed(2));
    return scale;
}

function persistDesktopZoom(value) {
    try {
        localStorage.setItem(DESKTOP_ZOOM_STORAGE_KEY, value.toFixed(2));
    } catch {
        // no-op
    }
}

async function initFramelessWindowChrome() {
    if (document.getElementById('tauri-window-chrome')) return;

    document.body.classList.add('tauri-desktop');

    const bar = document.createElement('div');
    bar.id = 'tauri-window-chrome';
    bar.innerHTML = `
        <div class="tauri-window-brand" data-tauri-drag-region>
            <span class="tauri-window-brand-handle" data-tauri-drag-region>
                <span data-tauri-drag-region></span>
                <span data-tauri-drag-region></span>
                <span data-tauri-drag-region></span>
            </span>
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
            <div class="tauri-window-zoom-controls" aria-label="Zoom controls">
                <button id="tauri-zoom-out" class="tauri-window-btn" type="button" aria-label="Zoom out">−</button>
                <button id="tauri-zoom-reset" class="tauri-window-btn tauri-window-zoom-value" type="button" aria-label="Reset zoom to default">90%</button>
                <button id="tauri-zoom-in" class="tauri-window-btn" type="button" aria-label="Zoom in">+</button>
            </div>
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
        const zoomOutBtn = bar.querySelector('#tauri-zoom-out');
        const zoomInBtn = bar.querySelector('#tauri-zoom-in');
        const zoomResetBtn = bar.querySelector('#tauri-zoom-reset');
        let currentZoom = applyDesktopZoom(getStoredDesktopZoom());

        const syncZoomUI = () => {
            if (zoomResetBtn) {
                zoomResetBtn.textContent = `${Math.round(currentZoom * 100)}%`;
            }
            if (zoomOutBtn) zoomOutBtn.disabled = currentZoom <= MIN_DESKTOP_ZOOM;
            if (zoomInBtn) zoomInBtn.disabled = currentZoom >= MAX_DESKTOP_ZOOM;
        };

        const setZoom = (nextZoom) => {
            currentZoom = applyDesktopZoom(nextZoom);
            persistDesktopZoom(currentZoom);
            syncZoomUI();
        };

        const adjustZoom = (delta) => {
            setZoom(currentZoom + delta);
        };

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

        zoomOutBtn?.addEventListener('click', () => {
            adjustZoom(-DESKTOP_ZOOM_STEP);
        });

        zoomInBtn?.addEventListener('click', () => {
            adjustZoom(DESKTOP_ZOOM_STEP);
        });

        zoomResetBtn?.addEventListener('click', () => {
            setZoom(DEFAULT_DESKTOP_ZOOM);
        });

        if (!window.__monochromeDesktopZoomHotkeysBound) {
            window.__monochromeDesktopZoomHotkeysBound = true;
            window.addEventListener('keydown', (event) => {
                if (!event.ctrlKey && !event.metaKey) return;
                if (event.altKey) return;
                if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;

                if (event.key === '+' || event.key === '=') {
                    event.preventDefault();
                    adjustZoom(DESKTOP_ZOOM_STEP);
                } else if (event.key === '-') {
                    event.preventDefault();
                    adjustZoom(-DESKTOP_ZOOM_STEP);
                } else if (event.key === '0') {
                    event.preventDefault();
                    setZoom(DEFAULT_DESKTOP_ZOOM);
                }
            });
        }

        dragRegion?.addEventListener('dblclick', async () => {
            await appWindow.toggleMaximize();
            await syncMaximizeState();
        });

        syncZoomUI();
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
