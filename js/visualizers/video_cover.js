export class VideoCoverPreset {
    constructor(api) {
        this.name = 'Video Cover';
        this.api = api;
        this.requiresAnalyser = false;
        this.requiresAnimation = false;
        this.canvas = null;
        this.video = null;
        this.track = null;
        this.candidateUrls = [];
        this.currentCandidateIndex = 0;
    }

    start(canvas, context = {}) {
        this.canvas = canvas;
        if (context.track) {
            this.track = context.track;
        }

        this.ensureVideoElement();
        this.applyTrackSource();
    }

    stop() {
        if (this.video) {
            try {
                this.video.pause();
            } catch {}
            this.video.remove();
            this.video = null;
        }

        const overlay = document.getElementById('fullscreen-cover-overlay');
        overlay?.classList.remove('video-visualizer-active');

        if (this.canvas) {
            this.canvas.style.removeProperty('display');
        }

        this.candidateUrls = [];
        this.currentCandidateIndex = 0;
    }

    destroy() {
        this.stop();
    }

    resize() {}

    setTrack(track) {
        this.track = track || null;
        this.applyTrackSource();
    }

    draw() {}

    ensureVideoElement() {
        if (!this.canvas) return;

        const parent = this.canvas.parentElement;
        if (!parent) return;

        if (!this.video) {
            this.video = document.createElement('video');
            this.video.id = 'fullscreen-video-visualizer';
            this.video.className = 'fullscreen-video-visualizer';
            this.video.autoplay = true;
            this.video.loop = true;
            this.video.muted = true;
            this.video.playsInline = true;
            this.video.preload = 'metadata';
            parent.insertBefore(this.video, this.canvas.nextSibling);

            this.video.addEventListener('loadeddata', () => {
                this.video
                    .play()
                    .then(() => {
                        const overlay = document.getElementById('fullscreen-cover-overlay');
                        overlay?.classList.add('video-visualizer-active');
                        if (this.canvas) this.canvas.style.display = 'none';
                    })
                    .catch(() => {
                        this.useFallbackCanvas();
                    });
            });

            this.video.addEventListener('error', () => {
                this.tryNextCandidate();
            });
        }
    }

    useFallbackCanvas() {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        overlay?.classList.remove('video-visualizer-active');
        if (this.canvas) {
            this.canvas.style.removeProperty('display');
        }
    }

    getTrackVideoCandidates(track) {
        const videoCoverId = track?.album?.videoCover || track?.videoCover;
        if (!videoCoverId || !this.api?.getVideoCoverUrl) return [];

        const sizes = ['1280x720', '1920x1080', '1080x1080', '720x720'];
        const urls = sizes.map((size) => this.api.getVideoCoverUrl(videoCoverId, size)).filter(Boolean);

        return Array.from(new Set(urls));
    }

    applyTrackSource() {
        if (!this.video) return;

        this.candidateUrls = this.getTrackVideoCandidates(this.track);
        this.currentCandidateIndex = 0;

        if (this.candidateUrls.length === 0) {
            this.video.removeAttribute('src');
            this.video.load();
            this.useFallbackCanvas();
            return;
        }

        this.video.src = this.candidateUrls[0];
        this.video.load();
    }

    tryNextCandidate() {
        if (!this.video) {
            this.useFallbackCanvas();
            return;
        }

        this.currentCandidateIndex += 1;
        if (this.currentCandidateIndex >= this.candidateUrls.length) {
            this.useFallbackCanvas();
            return;
        }

        this.video.src = this.candidateUrls[this.currentCandidateIndex];
        this.video.load();
    }
}
