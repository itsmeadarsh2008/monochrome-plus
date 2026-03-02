import { isNeutralinoRuntime } from './runtime.js';

const DEFAULT_UPDATE_MANIFEST_URL =
    'https://github.com/itsmeadarsh2008/monochrome-plus/releases/latest/download/latest.json';

export async function checkForDesktopUpdates() {
    if (!isNeutralinoRuntime()) return;

    const updateManifestUrl =
        window.MONOCHROME_DESKTOP_UPDATE_MANIFEST_URL || DEFAULT_UPDATE_MANIFEST_URL;

    try {
        if (!window.Neutralino?.updater?.checkForUpdates) {
            console.log('[Desktop][Updater] Neutralino updater API is unavailable.');
            return;
        }

        const manifest = await window.Neutralino.updater.checkForUpdates(updateManifestUrl);
        if (!manifest || manifest.version === window.NL_APPVERSION) {
            console.log('[Desktop][Updater] App is up to date.');
            return;
        }

        console.log(`[Desktop][Updater] Update available: ${manifest.version}`);
        await window.Neutralino.updater.install();
        await window.Neutralino.app.restartProcess();
    } catch (error) {
        console.warn('[Desktop][Updater] Auto-update check/install failed:', error);
    }
}
