// js/ffmpeg.types.js
export class FfmpegProgress {
    constructor(stage, progress, message) {
        this.stage = stage;
        this.progress = progress;
        this.message = message;
    }
}
