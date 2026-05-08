// js/progressEvents.js
export class DownloadProgress {
    constructor(receivedBytes, totalBytes) {
        this.stage = 'downloading';
        this.receivedBytes = receivedBytes;
        this.totalBytes = totalBytes;
    }
}

export class SegmentedDownloadProgress extends DownloadProgress {
    constructor(receivedBytes, totalBytes, currentSegment, totalSegments) {
        super(receivedBytes, totalBytes);
        this.currentSegment = currentSegment;
        this.totalSegments = totalSegments;
    }
}

export class ProgressMessage {
    constructor(message) {
        this.message = message;
    }
}
