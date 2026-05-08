// js/desktop/desktop.js
import { startAutomaticDesktopUpdates } from './tauri-updater.js';
import { initializeDiscordBridge } from './discord-bridge.js';
import { getCurrentTauriWindow, isTauriRuntime } from './tauri-runtime.js';

const DESKTOP_ZOOM_STORAGE_KEY = 'desktopZoomLevel';
const DEFAULT_DESKTOP_ZOOM = 0.9;
const MIN_DESKTOP_ZOOM = 0.75;
const MAX_DESKTOP_ZOOM = 1;
const DESKTOP_ZOOM_STEP = 0.05;
const USE_CUSTOM_WINDOW_CHROME = true;

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

    const revealHitbox = document.createElement('div');
    revealHitbox.id = 'tauri-window-reveal-hitbox';
    revealHitbox.setAttribute('aria-hidden', 'true');
    document.body.prepend(revealHitbox);

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
            <button id="tauri-window-fullscreen" class="tauri-window-btn" type="button" aria-label="Enter Fullscreen">⤢</button>
            <button id="tauri-window-close" class="tauri-window-btn close" type="button" aria-label="Close">✕</button>
        </div>
    `;

    document.body.prepend(bar);

    try {
        const appWindow = await getCurrentTauriWindow();
        const dragRegion = bar.querySelector('.tauri-window-drag-region');
        const brandRegion = bar.querySelector('.tauri-window-brand');
        const holderHandle = bar.querySelector('.tauri-window-grab-handle');
        const maximizeBtn = bar.querySelector('#tauri-window-maximize');
        const fullscreenBtn = bar.querySelector('#tauri-window-fullscreen');
        const zoomOutBtn = bar.querySelector('#tauri-zoom-out');
        const zoomInBtn = bar.querySelector('#tauri-zoom-in');
        const zoomResetBtn = bar.querySelector('#tauri-zoom-reset');
        let hideChromeTimer = null;
        let currentZoom = applyDesktopZoom(getStoredDesktopZoom());

        const showChrome = () => {
            if (hideChromeTimer) {
                clearTimeout(hideChromeTimer);
                hideChromeTimer = null;
            }
            document.body.classList.add('tauri-chrome-peek');
        };

        const hideChromeSoon = () => {
            if (hideChromeTimer) clearTimeout(hideChromeTimer);
            hideChromeTimer = setTimeout(() => {
                document.body.classList.remove('tauri-chrome-peek');
            }, 900);
        };

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

        const syncFullscreenState = async () => {
            const isFullscreen = await appWindow.isFullscreen();
            fullscreenBtn.textContent = isFullscreen ? '⤡' : '⤢';
            fullscreenBtn.setAttribute('aria-label', isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen');
        };

        const runWindowAction = async (action, label) => {
            try {
                await action();
            } catch (error) {
                console.error(`[Desktop] Failed to ${label}:`, error);
            }
        };

        bar.querySelector('#tauri-window-minimize')?.addEventListener('click', async () => {
            await runWindowAction(() => appWindow.minimize(), 'minimize window');
        });

        maximizeBtn?.addEventListener('click', async () => {
            await runWindowAction(async () => {
                await appWindow.toggleMaximize();
                await syncMaximizeState();
            }, 'toggle maximize');
        });

        fullscreenBtn?.addEventListener('click', async () => {
            await runWindowAction(async () => {
                const isFullscreen = await appWindow.isFullscreen();
                await appWindow.setFullscreen(!isFullscreen);
                await syncFullscreenState();
            }, 'toggle fullscreen');
        });

        bar.querySelector('#tauri-window-close')?.addEventListener('click', async () => {
            await runWindowAction(() => appWindow.close(), 'close window');
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

        if (!window.__monochromeDesktopWindowHotkeysBound) {
            window.__monochromeDesktopWindowHotkeysBound = true;
            window.addEventListener('keydown', async (event) => {
                if (event.key !== 'F11') return;
                event.preventDefault();
                await runWindowAction(async () => {
                    const isFullscreen = await appWindow.isFullscreen();
                    await appWindow.setFullscreen(!isFullscreen);
                    await syncFullscreenState();
                }, 'toggle fullscreen');
            });
        }

        const triggerDrag = async (event) => {
            if (event.target.closest('button') && !event.target.closest('.tauri-window-grab-handle')) return;
            if (event.button !== 0) return;
            try {
                await appWindow.startDragging();
            } catch (error) {
                console.warn('[Desktop] startDragging failed, using drag-region fallback:', error);
            }
        };

        holderHandle?.addEventListener('mousedown', (event) => {
            void triggerDrag(event);
        });
        holderHandle?.addEventListener('pointerdown', (event) => {
            void triggerDrag(event);
        });
        brandRegion?.addEventListener('mousedown', (event) => {
            void triggerDrag(event);
        });
        brandRegion?.addEventListener('pointerdown', (event) => {
            void triggerDrag(event);
        });

        revealHitbox.addEventListener('mouseenter', showChrome);
        bar.addEventListener('mouseenter', showChrome);
        bar.addEventListener('mouseleave', hideChromeSoon);
        window.addEventListener('mousemove', (event) => {
            if (event.clientY <= 6) showChrome();
        });
        window.addEventListener('blur', () => {
            document.body.classList.remove('tauri-chrome-peek');
        });

        dragRegion?.addEventListener('dblclick', async () => {
            await runWindowAction(async () => {
                await appWindow.toggleMaximize();
                await syncMaximizeState();
            }, 'toggle maximize');
        });

        hideChromeSoon();
        syncZoomUI();
        await syncMaximizeState();
        await syncFullscreenState();
        appWindow.onResized(() => {
            void syncMaximizeState();
        });
        appWindow.onMoved(() => {
            void syncFullscreenState();
        });
    } catch (error) {
        console.warn('[Desktop] Failed to initialize custom window controls:', error);
    }
}

export async function initDesktop(player) {
    console.log('[Desktop] Initializing desktop features...');

    const isTauri = await isTauriRuntime();

    if (isTauri) {
        console.log('[Desktop] Tauri runtime detected.');
        initializeDiscordBridge(player);

        if (USE_CUSTOM_WINDOW_CHROME || window.__MONOCHROME_USE_CUSTOM_CHROME__ === true) {
            await initFramelessWindowChrome();
        }

        startAutomaticDesktopUpdates();
        return;
    }

    console.log('[Desktop] No supported desktop runtime detected.');
}
