import { invokeTauri, isTauriRuntime } from './tauri-runtime.js';

export async function isLinuxTauri() {
    if (!(await isTauriRuntime())) return false;
    return /linux/i.test(navigator.platform || '') || /linux/i.test(navigator.userAgent || '');
}

export async function audioEngineInit() {
    return invokeTauri('audio_engine_init');
}

export async function audioEngineLoad(sourceDescriptor) {
    return invokeTauri('audio_engine_load', { sourceDescriptor });
}

export async function audioEnginePlay() {
    return invokeTauri('audio_engine_play');
}

export async function audioEnginePause() {
    return invokeTauri('audio_engine_pause');
}

export async function audioEngineStop() {
    return invokeTauri('audio_engine_stop');
}

export async function audioEngineSeek(positionMs) {
    return invokeTauri('audio_engine_seek', { positionMs });
}

export async function audioEngineSetVolume(volume) {
    return invokeTauri('audio_engine_set_volume', { volume });
}

export async function audioEngineGetState() {
    return invokeTauri('audio_engine_get_state');
}

export async function blobUrlToMpdXml(blobUrl) {
    if (!blobUrl || !blobUrl.startsWith('blob:')) return null;
    try {
        const response = await fetch(blobUrl);
        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    }
}
