// js/desktop/tauri-runtime.js
// Unified runtime detection — supports Tauri (legacy) and Electrobun.

let desktopRuntimePromise = null;

export function isElectrobunRuntime() {
    if (typeof window === 'undefined') return false;
    return Boolean(window.__ELECTROBUN__);
}

function hasTauriRuntimeMarkers() {
    if (typeof window === 'undefined') return false;
    return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__ || window.__TAURI_IPC__);
}

export async function isTauriRuntime() {
    // Electrobun explicitly clears Tauri globals — return false.
    if (isElectrobunRuntime()) return false;
    return hasTauriRuntimeMarkers();
}

export async function isDesktopRuntime() {
    if (desktopRuntimePromise) return desktopRuntimePromise;
    desktopRuntimePromise = (async () => {
        if (typeof window === 'undefined') return false;
        if (window.__MONOCHROME_FORCE_TAURI__ === true) return true;
        if (isElectrobunRuntime()) return true;
        if (hasTauriRuntimeMarkers()) return true;
        const protocol = String(window.location?.protocol || '').toLowerCase();
        const hostname = String(window.location?.hostname || '').toLowerCase();
        return protocol === 'tauri:' || hostname === 'tauri.localhost';
    })();
    return desktopRuntimePromise;
}

// ─── Electrobun bridge helpers ────────────────────────────────────────────────
export function getElectrobunBridge() {
    return window.electrobunBridge ?? null;
}

// ─── Legacy Tauri helpers (no-ops in Electrobun) ─────────────────────────────
export async function getTauriCore() {
    if (isElectrobunRuntime()) return null;
    return import('@tauri-apps/api/core');
}

export async function invokeTauri(command, args = {}) {
    if (isElectrobunRuntime()) {
        throw new Error('Use electrobunBridge instead of invokeTauri in Electrobun runtime.');
    }
    if (!(await isTauriRuntime())) {
        throw new Error('Tauri runtime is not available.');
    }
    const core = await getTauriCore();
    return core.invoke(command, args);
}

export async function getCurrentTauriWindow() {
    if (isElectrobunRuntime()) {
        throw new Error('Use electrobunBridge for window controls in Electrobun runtime.');
    }
    if (!(await isTauriRuntime())) {
        throw new Error('Tauri runtime is not available.');
    }
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
}
