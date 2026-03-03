import { isTauriRuntime } from './tauri-runtime.js';

export async function checkForDesktopUpdates() {
    const isTauri = await isTauriRuntime();
    if (!isTauri) return;

    try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const { relaunch } = await import('@tauri-apps/plugin-process');
        const update = await check();
        if (!update) {
            console.log('[Desktop][Updater] App is up to date.');
            return;
        }

        const updateVersion = update.version || 'unknown';
        console.log(`[Desktop][Updater] Update available: ${updateVersion}`);

        let downloaded = 0;
        let contentLength = 0;
        await update.downloadAndInstall((event) => {
            switch (event.event) {
                case 'Started':
                    contentLength = event.data.contentLength;
                    console.log(`[Desktop][Updater] Download started, ${contentLength} bytes`);
                    break;
                case 'Progress':
                    downloaded += event.data.chunkLength;
                    console.log(`[Desktop][Updater] Downloaded ${downloaded}/${contentLength}`);
                    break;
                case 'Finished':
                    console.log('[Desktop][Updater] Download finished, installing...');
                    break;
            }
        });

        console.log('[Desktop][Updater] Relaunching app to apply update...');
        await relaunch();
    } catch (error) {
        console.warn('[Desktop][Updater] Auto-update check/install failed:', error);
    }
}
