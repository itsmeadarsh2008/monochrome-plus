/**
 * Monochrome+ Custom Titlebar
 * Beautiful, cross-platform window controls
 */

import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Initialize the custom titlebar
 */
export async function initTitlebar() {
    const appWindow = getCurrentWindow();

    // Detect platform and add appropriate data attribute
    const platform = await detectPlatform();
    document.body.setAttribute('data-platform', platform);

    // Insert titlebar HTML if it doesn't exist
    if (!document.querySelector('.titlebar')) {
        insertTitlebar();
    }

    // Bind button events
    bindTitlebarEvents(appWindow);

    // Add double-click to maximize on drag region
    setupDoubleClickMaximize(appWindow);

    // Update maximize button icon based on window state
    setupWindowStateListener(appWindow);
}

/**
 * Detect the current platform
 */
async function detectPlatform() {
    const userAgent = navigator.userAgent.toLowerCase();

    if (userAgent.indexOf('mac') !== -1) {
        return 'macos';
    } else if (userAgent.indexOf('win') !== -1) {
        return 'windows';
    } else if (userAgent.indexOf('linux') !== -1) {
        return 'linux';
    }

    return 'unknown';
}

/**
 * Insert the titlebar HTML into the page
 */
function insertTitlebar() {
    const titlebarHTML = `
        <div class="titlebar">
            <div class="titlebar-drag-region" data-tauri-drag-region>
                <svg class="titlebar-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                    <circle cx="12" cy="12" r="4" fill="currentColor"/>
                </svg>
                <span class="titlebar-app-name">Monochrome+</span>
            </div>
            <div class="titlebar-controls">
                <button id="titlebar-minimize" class="titlebar-button" title="Minimize" aria-label="Minimize">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="11" width="16" height="2" rx="1"/>
                    </svg>
                </button>
                <button id="titlebar-maximize" class="titlebar-button" title="Maximize" aria-label="Maximize">
                    <svg id="maximize-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
                    </svg>
                    <svg id="restore-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="display: none;">
                        <path fill="none" stroke="currentColor" stroke-width="2" d="M4 9V6a2 2 0 0 1 2-2h3M4 15v3a2 2 0 0 0 2 2h3M20 9V6a2 2 0 0 0-2-2h-3M20 15v3a2 2 0 0 1-2 2h-3"/>
                    </svg>
                </button>
                <button id="titlebar-close" class="titlebar-button" title="Close" aria-label="Close">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
        </div>
    `;

    // Insert at the beginning of body
    document.body.insertAdjacentHTML('afterbegin', titlebarHTML);

    // Adjust content to account for titlebar
    const mainContent =
        document.querySelector('main') || document.querySelector('#app') || document.body.firstElementChild;
    if (mainContent && !mainContent.classList.contains('titlebar')) {
        mainContent.classList.add('content-with-titlebar');
    }
}

/**
 * Bind events to titlebar buttons
 */
function bindTitlebarEvents(appWindow) {
    // Minimize button
    const minimizeBtn = document.getElementById('titlebar-minimize');
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', async () => {
            try {
                await appWindow.minimize();
            } catch (error) {
                console.error('Failed to minimize window:', error);
            }
        });
    }

    // Maximize/Restore button
    const maximizeBtn = document.getElementById('titlebar-maximize');
    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', async () => {
            try {
                await appWindow.toggleMaximize();
            } catch (error) {
                console.error('Failed to toggle maximize:', error);
            }
        });
    }

    // Close button
    const closeBtn = document.getElementById('titlebar-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
            try {
                await appWindow.close();
            } catch (error) {
                console.error('Failed to close window:', error);
            }
        });
    }
}

/**
 * Setup double-click on drag region to maximize/restore
 */
function setupDoubleClickMaximize(appWindow) {
    const dragRegion = document.querySelector('.titlebar-drag-region');
    if (!dragRegion) return;

    let lastClickTime = 0;

    dragRegion.addEventListener('mousedown', async (e) => {
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - lastClickTime;

        // Double click detected (within 300ms)
        if (timeDiff < 300) {
            try {
                await appWindow.toggleMaximize();
            } catch (error) {
                console.error('Failed to toggle maximize on double-click:', error);
            }
        }

        lastClickTime = currentTime;
    });
}

/**
 * Listen for window state changes and update button icons
 */
function setupWindowStateListener(appWindow) {
    const maximizeIcon = document.getElementById('maximize-icon');
    const restoreIcon = document.getElementById('restore-icon');
    const maximizeBtn = document.getElementById('titlebar-maximize');

    if (!maximizeIcon || !restoreIcon || !maximizeBtn) return;

    // Check window state periodically (Tauri doesn't have a direct event for this)
    const updateMaximizeIcon = async () => {
        try {
            const isMaximized = await appWindow.isMaximized();

            if (isMaximized) {
                maximizeIcon.style.display = 'none';
                restoreIcon.style.display = 'block';
                maximizeBtn.title = 'Restore';
                maximizeBtn.setAttribute('aria-label', 'Restore');
            } else {
                maximizeIcon.style.display = 'block';
                restoreIcon.style.display = 'none';
                maximizeBtn.title = 'Maximize';
                maximizeBtn.setAttribute('aria-label', 'Maximize');
            }
        } catch (error) {
            console.error('Failed to check window state:', error);
        }
    };

    // Update on maximize button click
    maximizeBtn.addEventListener('click', () => {
        // Small delay to let the window state update
        setTimeout(updateMaximizeIcon, 100);
    });

    // Update periodically
    setInterval(updateMaximizeIcon, 500);

    // Initial update
    updateMaximizeIcon();
}

/**
 * Alternative manual drag implementation
 * Use this if data-tauri-drag-region doesn't work as expected
 */
export async function initManualDragging() {
    const appWindow = getCurrentWindow();
    const dragRegion = document.querySelector('.titlebar-drag-region');

    if (!dragRegion) return;

    dragRegion.addEventListener('mousedown', async (e) => {
        if (e.buttons === 1) {
            // Primary (left) button
            try {
                await appWindow.startDragging();
            } catch (error) {
                console.error('Failed to start dragging:', error);
            }
        }
    });
}

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTitlebar);
} else {
    initTitlebar();
}
