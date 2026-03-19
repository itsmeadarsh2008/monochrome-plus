let tauriRuntimePromise = null;
let tauriCorePromise = null;
let tauriWindowPromise = null;

function hasTauriRuntimeMarkers() {
    if (typeof window === 'undefined') return false;
    return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__ || window.__TAURI_IPC__);
}

export async function isTauriRuntime() {
    if (tauriRuntimePromise) return tauriRuntimePromise;

    tauriRuntimePromise = (async () => {
        if (typeof window === 'undefined') return false;

        if (window.__MONOCHROME_FORCE_TAURI__ === true) return true;

        if (hasTauriRuntimeMarkers()) {
            return true;
        }

        const protocol = String(window.location?.protocol || '').toLowerCase();
        const hostname = String(window.location?.hostname || '').toLowerCase();
        const isTauriOrigin = protocol === 'tauri:' || hostname === 'tauri.localhost';
        if (!isTauriOrigin) return false;

        // On tauri origins, double-check globals to avoid false-positives in plain browsers.
        return hasTauriRuntimeMarkers();
    })();

    return tauriRuntimePromise;
}

export async function getTauriCore() {
    if (tauriCorePromise) return tauriCorePromise;

    tauriCorePromise = import('@tauri-apps/api/core');
    return tauriCorePromise;
}

export async function invokeTauri(command, args = {}) {
    if (!(await isTauriRuntime())) {
        throw new Error('Tauri runtime is not available.');
    }

    const core = await getTauriCore();
    return core.invoke(command, args);
}

export async function getCurrentTauriWindow() {
    if (tauriWindowPromise) return tauriWindowPromise;

    tauriWindowPromise = (async () => {
        if (!(await isTauriRuntime())) {
            throw new Error('Tauri runtime is not available.');
        }

        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        return getCurrentWindow();
    })();

    return tauriWindowPromise;
}
