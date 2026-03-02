import { isNeutralinoRuntime } from './runtime.js';

const DEFAULT_UPDATE_MANIFEST_URL =
    'https://github.com/itsmeadarsh2008/monochrome-plus/releases/latest/download/latest.json';

function compareVersions(left, right) {
    const leftParts = String(left || '0')
        .split('.')
        .map((part) => Number.parseInt(part, 10) || 0);
    const rightParts = String(right || '0')
        .split('.')
        .map((part) => Number.parseInt(part, 10) || 0);
    const max = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < max; index += 1) {
        const leftPart = leftParts[index] ?? 0;
        const rightPart = rightParts[index] ?? 0;
        if (leftPart > rightPart) return 1;
        if (leftPart < rightPart) return -1;
    }

    return 0;
}

export async function checkForDesktopUpdates() {
    if (!isNeutralinoRuntime()) return;

    const updateManifestUrl = window.MONOCHROME_DESKTOP_UPDATE_MANIFEST_URL || DEFAULT_UPDATE_MANIFEST_URL;

    try {
        if (!window.Neutralino?.updater?.checkForUpdates) {
            console.log('[Desktop][Updater] Neutralino updater API is unavailable.');
            return;
        }

        const manifest = await window.Neutralino.updater.checkForUpdates(updateManifestUrl);
        if (!manifest || !manifest.version) {
            console.log('[Desktop][Updater] No valid update manifest found.');
            return;
        }

        const currentVersion = window.NL_APPVERSION;
        if (compareVersions(manifest.version, currentVersion) <= 0) {
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
