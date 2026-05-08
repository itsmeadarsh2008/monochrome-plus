// js/ffmpeg.js
import FfmpegWorker from './ffmpeg.worker.js?worker';
import { FfmpegProgress } from './ffmpeg.types.js';
import { toBlobURL } from '@ffmpeg/util';

class FfmpegError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FfmpegError';
        this.code = 'FFMPEG_FAILED';
    }
}

export async function loadFfmpeg() {
    if (loadFfmpeg.promise) return loadFfmpeg.promise;

    loadFfmpeg.promise = (async () => {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        return {
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        };
    })();

    return loadFfmpeg.promise;
}

async function ffmpegWorker(
    audioBlob,
    args = [],
    outputName = 'output',
    outputMime = 'application/octet-stream',
    onProgress = null,
    signal = null,
    extraFiles = []
) {
    const audioData = audioBlob ? await audioBlob.arrayBuffer() : null;
    const assets = loadFfmpeg();

    return new Promise((resolve, reject) => {
        const worker = new FfmpegWorker();

        const abortHandler = () => {
            worker.terminate();
            reject(new FfmpegError('FFMPEG aborted'));
        };

        if (signal) {
            if (signal.aborted) {
                abortHandler();
                return;
            }
            signal.addEventListener('abort', abortHandler);
        }

        worker.onmessage = (e) => {
            const { type, blob, message, stage, progress } = e.data;

            if (type === 'complete') {
                if (signal) signal.removeEventListener('abort', abortHandler);
                worker.terminate();
                resolve(blob);
            } else if (type === 'error') {
                if (signal) signal.removeEventListener('abort', abortHandler);
                worker.terminate();
                reject(new FfmpegError(message));
            } else if (type === 'progress' && (message || progress !== undefined)) {
                onProgress?.(new FfmpegProgress(stage, progress || 0, message));
            } else if (type === 'log') {
                console.log('[FFmpeg]', message);
            }
        };

        worker.onerror = (error) => {
            if (signal) signal.removeEventListener('abort', abortHandler);
            worker.terminate();
            reject(new FfmpegError('Worker failed: ' + error.message));
        };

        (async () => {
            const transferables = [];
            if (audioData) transferables.push(audioData);
            for (const f of extraFiles) {
                if (f.data instanceof ArrayBuffer) transferables.push(f.data);
                else if (f.data.buffer instanceof ArrayBuffer) transferables.push(f.data.buffer);
            }

            worker.postMessage(
                {
                    audioData,
                    extraFiles,
                    args,
                    output: { name: outputName, mime: outputMime },
                    loadOptions: await assets,
                },
                transferables
            );
        })();
    });
}

export async function ffmpeg(
    audioBlob,
    args = [],
    outputName = 'output',
    outputMime = 'application/octet-stream',
    onProgress = null,
    signal = null,
    extraFiles = []
) {
    if (typeof Worker !== 'undefined') {
        return await ffmpegWorker(audioBlob, args, outputName, outputMime, onProgress, signal, extraFiles);
    }
    throw new FfmpegError('Web Workers are required for FFMPEG');
}

export async function ffmpegNewContainer(audioBlob, outputExtension, outputMime, onProgress, signal) {
    return await ffmpeg(
        audioBlob,
        ['-map_metadata', '-1', '-c', 'copy', '-strict', '-2'],
        `output.${outputExtension}`,
        outputMime,
        onProgress,
        signal
    );
}

export { FfmpegError };
