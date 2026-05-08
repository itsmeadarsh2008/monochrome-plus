// js/metadata.js
import { addFlacMetadata, readFlacMetadata } from './metadata.flac.js';
import { addMp4Metadata, readMp4Metadata } from './metadata.mp4.js';
import { addMp3Metadata, readMp3Metadata } from './metadata.mp3.js';

/**
 * Adds metadata tags to audio files (FLAC, M4A, or MP3)
 * @param {Blob} audioBlob - The audio file blob
 * @param {Object} track - Track metadata
 * @param {Object} api - API instance for fetching album art
 * @param {string} quality - Audio quality
 * @returns {Promise<Blob>} - Audio blob with embedded metadata
 */
export async function addMetadataToAudio(audioBlob, track, api, _quality) {
    // Check actual file signature
    const buffer = await audioBlob.slice(0, 12).arrayBuffer();
    const view = new DataView(buffer);

    // Check for FLAC signature: "fLaC" (0x66 0x4C 0x61 0x43)
    const isFlac =
        view.byteLength >= 4 &&
        view.getUint8(0) === 0x66 &&
        view.getUint8(1) === 0x4c &&
        view.getUint8(2) === 0x61 &&
        view.getUint8(3) === 0x43;

    if (isFlac) {
        return await addFlacMetadata(audioBlob, track, api);
    }

    // Check for MP4/M4A signature: "ftyp" at offset 4
    const isMp4 =
        view.byteLength >= 8 &&
        view.getUint8(4) === 0x66 &&
        view.getUint8(5) === 0x74 &&
        view.getUint8(6) === 0x79 &&
        view.getUint8(7) === 0x70;

    if (isMp4) {
        return await addMp4Metadata(audioBlob, track, api);
    }

    // Check for MP3 signature: "ID3" (0x49 0x44 0x33)
    const isMp3 =
        view.byteLength >= 3 && view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33;

    if (isMp3) {
        return await addMp3Metadata(audioBlob, track, api);
    }

    // Fallback: check MIME type from blob
    const mime = audioBlob.type;
    if (mime === 'audio/flac') {
        return await addFlacMetadata(audioBlob, track, api);
    }
    if (mime === 'audio/mp4' || mime === 'audio/x-m4a') {
        return await addMp4Metadata(audioBlob, track, api);
    }
    if (mime === 'audio/mpeg') {
        return await addMp3Metadata(audioBlob, track, api);
    }

    // Unknown format - return original without modification
    console.warn(`Unknown audio format (mime: ${mime}), returning original blob`);
    return audioBlob;
}

/**
 * Reads metadata from a file
 * @param {File} file
 * @returns {Promise<Object>} Track metadata
 */
export async function readTrackMetadata(file) {
    const metadata = {
        title: file.name.replace(/\.[^/.]+$/, ''),
        artists: [],
        artist: { name: 'Unknown Artist' },
        album: { title: 'Unknown Album', cover: 'assets/appicon.png', releaseDate: null },
        duration: 0,
        isLocal: true,
        file: file,
        id: `local-${file.name}-${file.lastModified}`,
    };

    try {
        const type = file.type;
        const name = file.name.toLowerCase();

        if (type === 'audio/flac' || name.endsWith('.flac')) {
            await readFlacMetadata(file, metadata);
        } else if (type === 'audio/mp4' || name.endsWith('.m4a') || name.endsWith('.mp4')) {
            await readMp4Metadata(file, metadata);
        } else if (type === 'audio/mpeg' || name.endsWith('.mp3')) {
            await readMp3Metadata(file, metadata);
        }
    } catch (e) {
        console.warn('Error reading metadata for', file.name, e);
    }

    if (metadata.artists.length > 0) {
        metadata.artist = metadata.artists[0];
    }

    return metadata;
}
