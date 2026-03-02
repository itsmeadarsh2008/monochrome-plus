export async function checkForDesktopUpdates() {
    const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
    if (!isTauri) return;

    try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const { relaunch } = await import('@tauri-apps/plugin-process');
        const update = await check();
        if (!update) {
            console.log('[Desktop][Updater] App is up to date.');
            return;
        }

        console.log(`[Desktop][Updater] Update available: ${update.version}`);

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

        await relaunch();
    } catch (error) {
        console.warn('[Desktop][Updater] Auto-update check/install failed:', error);
    }
}
