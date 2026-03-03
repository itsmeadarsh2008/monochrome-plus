let tauriRuntimePromise = null;
let tauriCorePromise = null;
let tauriWindowPromise = null;

export async function isTauriRuntime() {
    if (tauriRuntimePromise) return tauriRuntimePromise;

    tauriRuntimePromise = (async () => {
        if (typeof window === 'undefined') return false;

        if (window.__MONOCHROME_FORCE_TAURI__ === true) return true;

        if (window.__TAURI_INTERNALS__ || window.__TAURI__ || window.__TAURI_IPC__) {
            return true;
        }

        try {
            await import('@tauri-apps/api/core');
            return true;
        } catch {
            return /\btauri\b/i.test(navigator.userAgent || '');
        }
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