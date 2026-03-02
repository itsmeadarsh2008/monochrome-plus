import { initializeDiscordRPC } from './discord-rpc.js';
import { checkForDesktopUpdates } from './neutralino-updater.js';
import { isNeutralinoRuntime } from './runtime.js';

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
    if (document.getElementById('neutralino-window-chrome')) return;
    if (!isNeutralinoRuntime()) return;

    document.body.classList.add('neutralino-desktop');

    const revealHitbox = document.createElement('div');
    revealHitbox.id = 'neutralino-window-reveal-hitbox';
    revealHitbox.setAttribute('aria-hidden', 'true');
    document.body.prepend(revealHitbox);

    const bar = document.createElement('div');
    bar.id = 'neutralino-window-chrome';
    bar.innerHTML = `
        <div id="neutralino-window-brand" class="neutralino-window-brand">
            <span class="neutralino-window-brand-handle" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
            </span>
            <span class="neutralino-window-brand-text">Monochrome+</span>
        </div>
        <div id="neutralino-window-drag-region" class="neutralino-window-drag-region">
            <button id="neutralino-window-grab-handle" class="neutralino-window-grab-handle" type="button" aria-label="Drag window">
                <span></span>
                <span></span>
                <span></span>
            </button>
        </div>
        <div id="neutralino-window-controls" class="neutralino-window-controls">
            <div class="neutralino-window-zoom-controls" aria-label="Zoom controls">
                <button id="neutralino-zoom-out" class="neutralino-window-btn" type="button" aria-label="Zoom out">−</button>
                <button id="neutralino-zoom-reset" class="neutralino-window-btn neutralino-window-zoom-value" type="button" aria-label="Reset zoom to default">90%</button>
                <button id="neutralino-zoom-in" class="neutralino-window-btn" type="button" aria-label="Zoom in">+</button>
            </div>
            <button id="neutralino-window-minimize" class="neutralino-window-btn" type="button" aria-label="Minimize">—</button>
            <button id="neutralino-window-maximize" class="neutralino-window-btn" type="button" aria-label="Maximize">▢</button>
            <button id="neutralino-window-fullscreen" class="neutralino-window-btn" type="button" aria-label="Enter Fullscreen">⤢</button>
            <button id="neutralino-window-close" class="neutralino-window-btn close" type="button" aria-label="Close">✕</button>
        </div>
    `;

    document.body.prepend(bar);

    try {
        const { Neutralino } = window;
        const dragRegion = bar.querySelector('#neutralino-window-drag-region');
        const brandRegion = bar.querySelector('#neutralino-window-brand');
        const maximizeBtn = bar.querySelector('#neutralino-window-maximize');
        const fullscreenBtn = bar.querySelector('#neutralino-window-fullscreen');
        const zoomOutBtn = bar.querySelector('#neutralino-zoom-out');
        const zoomInBtn = bar.querySelector('#neutralino-zoom-in');
        const zoomResetBtn = bar.querySelector('#neutralino-zoom-reset');
        const minimizeBtn = bar.querySelector('#neutralino-window-minimize');
        const closeBtn = bar.querySelector('#neutralino-window-close');
        let hideChromeTimer = null;
        let currentZoom = applyDesktopZoom(getStoredDesktopZoom());

        await Neutralino.window.setTitle('Monochrome+');

        const draggableExclusions = [
            'neutralino-window-controls',
            'neutralino-window-grab-handle',
            'neutralino-zoom-out',
            'neutralino-zoom-reset',
            'neutralino-zoom-in',
            'neutralino-window-minimize',
            'neutralino-window-maximize',
            'neutralino-window-fullscreen',
            'neutralino-window-close',
        ];

        if (dragRegion) {
            await Neutralino.window.setDraggableRegion(dragRegion, { exclusions: draggableExclusions });
        }
        if (brandRegion) {
            await Neutralino.window.setDraggableRegion(brandRegion, { exclusions: draggableExclusions });
        }

        const showChrome = () => {
            if (hideChromeTimer) {
                clearTimeout(hideChromeTimer);
                hideChromeTimer = null;
            }
            document.body.classList.add('neutralino-chrome-peek');
        };

        const hideChromeSoon = () => {
            if (hideChromeTimer) clearTimeout(hideChromeTimer);
            hideChromeTimer = setTimeout(() => {
                document.body.classList.remove('neutralino-chrome-peek');
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
            const isMaximized = await Neutralino.window.isMaximized();
            maximizeBtn.textContent = isMaximized ? '❐' : '▢';
            maximizeBtn.setAttribute('aria-label', isMaximized ? 'Restore' : 'Maximize');
        };

        const syncFullscreenState = async () => {
            const isFullscreen = await Neutralino.window.isFullScreen();
            fullscreenBtn.textContent = isFullscreen ? '⤡' : '⤢';
            fullscreenBtn.setAttribute('aria-label', isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen');
        };

        minimizeBtn?.addEventListener('click', async () => {
            await Neutralino.window.minimize();
        });

        maximizeBtn?.addEventListener('click', async () => {
            const isMaximized = await Neutralino.window.isMaximized();
            if (isMaximized) {
                await Neutralino.window.unmaximize();
            } else {
                await Neutralino.window.maximize();
            }
            await syncMaximizeState();
        });

        fullscreenBtn?.addEventListener('click', async () => {
            const isFullscreen = await Neutralino.window.isFullScreen();
            if (isFullscreen) {
                await Neutralino.window.exitFullScreen();
            } else {
                await Neutralino.window.setFullScreen();
            }
            await syncFullscreenState();
        });

        closeBtn?.addEventListener('click', async () => {
            await Neutralino.app.exit();
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
                const isFullscreen = await Neutralino.window.isFullScreen();
                if (isFullscreen) {
                    await Neutralino.window.exitFullScreen();
                } else {
                    await Neutralino.window.setFullScreen();
                }
                await syncFullscreenState();
            });
        }

        revealHitbox.addEventListener('mouseenter', showChrome);
        bar.addEventListener('mouseenter', showChrome);
        bar.addEventListener('mouseleave', hideChromeSoon);
        window.addEventListener('mousemove', (event) => {
            if (event.clientY <= 6) showChrome();
        });
        window.addEventListener('blur', () => {
            document.body.classList.remove('neutralino-chrome-peek');
        });

        dragRegion?.addEventListener('dblclick', async () => {
            const isMaximized = await Neutralino.window.isMaximized();
            if (isMaximized) {
                await Neutralino.window.unmaximize();
            } else {
                await Neutralino.window.maximize();
            }
            await syncMaximizeState();
        });

        await Neutralino.events.on('windowClose', async () => {
            await Neutralino.app.exit();
        });

        hideChromeSoon();
        syncZoomUI();
        await syncMaximizeState();
        await syncFullscreenState();
        window.addEventListener('resize', () => {
            void syncMaximizeState();
            void syncFullscreenState();
        });
    } catch (error) {
        console.warn('[Desktop] Failed to initialize custom window controls:', error);
    }
}

export async function initDesktop(player) {
    console.log('[Desktop] Initializing desktop features...');

    if (isNeutralinoRuntime()) {
        console.log('[Desktop] Neutralino runtime detected.');
        await initFramelessWindowChrome();
        if (player) {
            initializeDiscordRPC(player);
        }
        checkForDesktopUpdates();
        return;
    }

    console.log('[Desktop] No supported desktop runtime detected.');
}
