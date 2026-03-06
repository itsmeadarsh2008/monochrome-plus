/**
 * Monochrome+ Custom Titlebar
 * Ephemeral design - visible on hover only
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

    // Setup ephemeral behavior - show on hover
    setupEphemeralBehavior();
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
    // Use the actual app logo (L-shaped geometric design from public/assets/logo.svg)
    const titlebarHTML = `
        <div class="titlebar">
            <div class="titlebar-drag-region" data-tauri-drag-region>
                <div class="titlebar-logo">
                    <svg viewBox="14.75 14.75 70.5 70.5" xmlns="http://www.w3.org/2000/svg">
                        <path fill="currentColor" d="M38.25 14.75H85.25V61.75H61.75V38.25H38.25ZM14.75 38.25H38.25V61.75H61.75V85.25H14.75Z"/>
                    </svg>
                </div>
                <span class="titlebar-app-name">Monochrome+</span>
            </div>
            <div class="titlebar-controls">
                <button id="titlebar-minimize" class="titlebar-button minimize" title="Minimize" aria-label="Minimize">
                    <svg viewBox="0 0 10 1" xmlns="http://www.w3.org/2000/svg">
                        <rect width="10" height="1" fill="currentColor"/>
                    </svg>
                </button>
                <button id="titlebar-maximize" class="titlebar-button maximize" title="Maximize" aria-label="Maximize">
                    <svg id="maximize-icon" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
                        <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/>
                    </svg>
                    <svg id="restore-icon" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" style="display: none;">
                        <rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/>
                        <rect x="0" y="2" width="8" height="8" fill="var(--background)" stroke="currentColor" stroke-width="1"/>
                    </svg>
                </button>
                <button id="titlebar-close" class="titlebar-button close" title="Close" aria-label="Close">
                    <svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
        </div>
    `;

    // Insert at the beginning of body
    document.body.insertAdjacentHTML('afterbegin', titlebarHTML);
}

/**
 * Setup ephemeral behavior - show titlebar on hover
 */
function setupEphemeralBehavior() {
    const titlebar = document.querySelector('.titlebar');
    if (!titlebar) return;

    let hideTimeout;

    const showTitlebar = () => {
        clearTimeout(hideTimeout);
        titlebar.classList.add('visible');
    };

    const hideTitlebar = () => {
        // Delay hiding to allow for button interactions
        hideTimeout = setTimeout(() => {
            // Only hide if not hovering over titlebar or its children
            if (!titlebar.matches(':hover')) {
                titlebar.classList.remove('visible');
            }
        }, 500);
    };

    // Show on mouse near top of screen
    document.addEventListener('mousemove', (e) => {
        if (e.clientY <= 50) {
            showTitlebar();
        }
    });

    // Show/hide based on hover
    titlebar.addEventListener('mouseenter', showTitlebar);
    titlebar.addEventListener('mouseleave', hideTitlebar);

    // Also handle focus for accessibility
    titlebar.addEventListener('focusin', showTitlebar);

    // Keep visible when any button is focused
    const buttons = titlebar.querySelectorAll('.titlebar-button');
    buttons.forEach((btn) => {
        btn.addEventListener('mouseenter', showTitlebar);
        btn.addEventListener('mouseleave', hideTitlebar);
    });
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
        setTimeout(updateMaximizeIcon, 100);
    });

    // Update periodically
    setInterval(updateMaximizeIcon, 500);

    // Initial update
    updateMaximizeIcon();
}

/**
 * Alternative manual drag implementation
 */
export async function initManualDragging() {
    const appWindow = getCurrentWindow();
    const dragRegion = document.querySelector('.titlebar-drag-region');

    if (!dragRegion) return;

    dragRegion.addEventListener('mousedown', async (e) => {
        if (e.buttons === 1) {
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
