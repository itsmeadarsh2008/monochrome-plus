// js/ffmpeg.worker.js
import { FFmpeg } from '@ffmpeg/ffmpeg';

let ffmpeg = null;
let loadingPromise = null;

let totalDurationSeconds = null;
let lastProgress = 0;

function parseTimestamp(str) {
    const match = str.match(/(\d+):(\d+):(\d+\.?\d*)/);
    if (!match) return null;
    const [, h, m, s] = match;
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
}

function extractDurationFromLog(log) {
    const match = log.match(/Duration: (\d+:\d+:\d+\.?\d*)/);
    if (match) return parseTimestamp(match[1]);
    return null;
}

function extractTimeFromLog(log) {
    const match = log.match(/time=(\d+:\d+:\d+\.?\d*)/);
    if (match) return parseTimestamp(match[1]);
    return null;
}

async function loadFFmpeg(loadOptions = {}) {
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        ffmpeg = new FFmpeg();

        ffmpeg.on('log', ({ message }) => {
            self.postMessage({ type: 'log', message });

            if (totalDurationSeconds === null) {
                const dur = extractDurationFromLog(message);
                if (dur) {
                    totalDurationSeconds = dur;
                    self.postMessage({ type: 'progress', stage: 'parsing', message: `Detected duration: ${dur}s` });
                }
            }

            if (totalDurationSeconds) {
                const cur = extractTimeFromLog(message);
                if (cur !== null) {
                    let progress = Math.min(100, (cur / totalDurationSeconds) * 100);
                    if (progress - lastProgress >= 0.1 || progress === 100) {
                        lastProgress = progress;
                        self.postMessage({
                            type: 'progress',
                            stage: 'encoding',
                            progress,
                            time: cur,
                            message: `Encoding: ${progress.toFixed(1)}% (${cur.toFixed(2)}s / ${totalDurationSeconds.toFixed(2)}s)`,
                        });
                    }
                }
            }
        });

        ffmpeg.on('progress', ({ progress, time }) => {
            if (!totalDurationSeconds) {
                self.postMessage({
                    type: 'progress',
                    stage: 'encoding',
                    progress: progress * 100,
                    time,
                });
            }
        });

        self.postMessage({ type: 'progress', stage: 'loading', message: 'Loading FFmpeg...' });
        await ffmpeg.load(loadOptions);
        totalDurationSeconds = null;
        lastProgress = 0;
    })();

    return loadingPromise;
}

self.onmessage = async (e) => {
    const {
        audioData,
        extraFiles = [],
        args = [],
        output = {
            name: 'output',
            mime: 'application/octet-stream',
        },
        encodeStartMessage = 'Encoding...',
        encodeEndMessage = 'Finalizing...',
        loadOptions = {},
    } = e.data;

    try {
        await loadFFmpeg(loadOptions);
        self.postMessage({ type: 'progress', stage: 'encoding', message: encodeStartMessage, progress: 0.0 });

        try {
            if (audioData) {
                await ffmpeg.writeFile('input', new Uint8Array(audioData));
            }

            for (const file of extraFiles) {
                await ffmpeg.writeFile(file.name, new Uint8Array(file.data));
            }

            const ffmpegArgs = ['-i', 'input', ...args, output.name];
            self.postMessage({ type: 'log', message: `FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}` });

            const exitCode = await ffmpeg.exec(ffmpegArgs);
            if (exitCode !== 0) {
                throw new Error(`FFmpeg failed with exit code ${exitCode}.`);
            }

            self.postMessage({ type: 'progress', stage: 'finalizing', message: encodeEndMessage, progress: 100.0 });

            const data = await ffmpeg.readFile(output.name);
            const outputBlob = new Blob([data], { type: output.mime });

            self.postMessage({ type: 'complete', blob: outputBlob });
        } finally {
            try {
                if (audioData) await ffmpeg.deleteFile('input');
            } catch {
                /* cleanup */
            }
            for (const file of extraFiles) {
                try {
                    await ffmpeg.deleteFile(file.name);
                } catch {
                    /* cleanup */
                }
            }
            try {
                await ffmpeg.deleteFile(output.name);
            } catch {
                /* cleanup */
            }
        }
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};
