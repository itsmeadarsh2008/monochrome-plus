// js/metadata.mp3.js
import { getCoverBlob, getTrackTitle, getTrackCoverId } from './utils.js';

export async function writeID3v2Tag(mp3Blob, metadata, coverBlob = null) {
    const frames = [];

    if (metadata.title) {
        frames.push(createTextFrame('TIT2', getTrackTitle(metadata)));
    }

    const artistName = metadata.artist?.name || metadata.artists?.[0]?.name;
    if (artistName) {
        frames.push(createTextFrame('TPE1', artistName));
    }

    if (metadata.album?.title) {
        frames.push(createTextFrame('TALB', metadata.album.title));
    }

    const albumArtistName = metadata.album?.artist?.name || metadata.artist?.name || metadata.artists?.[0]?.name;
    if (albumArtistName) {
        frames.push(createTextFrame('TPE2', albumArtistName));
    }

    if (metadata.trackNumber) {
        frames.push(createTextFrame('TRCK', metadata.trackNumber.toString()));
    }

    if (metadata.album?.releaseDate) {
        const year = new Date(metadata.album.releaseDate).getFullYear();
        if (!Number.isNaN(year) && Number.isFinite(year)) {
            frames.push(createTextFrame('TYER', year.toString()));
        }
    }

    if (metadata.isrc) {
        frames.push(createTextFrame('TSRC', metadata.isrc));
    }

    if (metadata.copyright) {
        frames.push(createTextFrame('TCOP', metadata.copyright));
    }

    frames.push(createTextFrame('TENC', 'Monochrome+'));

    if (coverBlob) {
        frames.push(await createAPICFrame(coverBlob));
    }

    return buildID3v2Tag(mp3Blob, frames);
}

export function createTextFrame(frameId, text) {
    const bom = new Uint8Array([0xff, 0xfe]);
    const utf16Bytes = new Uint8Array(text.length * 2);

    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        utf16Bytes[i * 2] = charCode & 0xff;
        utf16Bytes[i * 2 + 1] = (charCode >> 8) & 0xff;
    }

    const frameSize = 1 + bom.length + utf16Bytes.length;
    const frame = new Uint8Array(10 + frameSize);
    const view = new DataView(frame.buffer);

    for (let i = 0; i < 4; i++) {
        frame[i] = frameId.charCodeAt(i);
    }

    view.setUint32(4, frameSize, false);
    frame[10] = 0x01;
    frame.set(bom, 11);
    frame.set(utf16Bytes, 11 + bom.length);

    return frame;
}

export async function createAPICFrame(coverBlob) {
    const imageBytes = new Uint8Array(await coverBlob.arrayBuffer());
    const mimeType = coverBlob.type || 'image/jpeg';
    const mimeBytes = new TextEncoder().encode(mimeType);

    const frameSize = 1 + mimeBytes.length + 1 + 1 + 1 + imageBytes.length;

    const frame = new Uint8Array(10 + frameSize);
    const view = new DataView(frame.buffer);

    for (let i = 0; i < 4; i++) {
        frame[i] = 'APIC'.charCodeAt(i);
    }

    view.setUint32(4, frameSize, false);

    let offset = 10;
    frame[offset++] = 0x00;

    frame.set(mimeBytes, offset);
    offset += mimeBytes.length;
    frame[offset++] = 0x00;

    frame[offset++] = 0x03;
    frame[offset++] = 0x00;

    frame.set(imageBytes, offset);

    return frame;
}

export function buildID3v2Tag(mp3Blob, frames) {
    const framesData = new Uint8Array(frames.reduce((acc, f) => acc + f.length, 0));
    let offset = 0;
    for (const frame of frames) {
        framesData.set(frame, offset);
        offset += frame.length;
    }

    const tagSize = framesData.length;
    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 0x03;
    header[4] = 0x00;
    header[5] = 0x00;

    header[6] = (tagSize >> 21) & 0x7f;
    header[7] = (tagSize >> 14) & 0x7f;
    header[8] = (tagSize >> 7) & 0x7f;
    header[9] = tagSize & 0x7f;

    return new Blob([header, framesData, mp3Blob], { type: 'audio/mpeg' });
}

export async function addMp3Metadata(mp3Blob, track, api, coverBlob = null) {
    try {
        if (!coverBlob) {
            const coverId = getTrackCoverId(track);
            if (coverId) {
                try {
                    coverBlob = await getCoverBlob(api, coverId);
                } catch (error) {
                    console.warn('Failed to fetch album art for MP3:', error);
                }
            }
        }
        return await writeID3v2Tag(mp3Blob, track, coverBlob);
    } catch (error) {
        console.error('Failed to add MP3 metadata:', error);
        return mp3Blob;
    }
}

export async function readMp3Metadata(file, metadata) {
    let buffer = await file.slice(0, 10).arrayBuffer();
    let view = new DataView(buffer);

    if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
        const majorVer = view.getUint8(3);
        const size = readSynchsafeInteger32(view, 6);
        const tagSize = size + 10;

        buffer = await file.slice(0, tagSize).arrayBuffer();
        view = new DataView(buffer);

        let offset = 10;
        if ((view.getUint8(5) & 0x40) !== 0) {
            const extSize = readSynchsafeInteger32(view, offset);
            offset += extSize;
        }

        let tpe1 = null,
            tpe2 = null;
        while (offset < view.byteLength) {
            let frameId, frameSize;
            if (majorVer === 3) {
                frameId = new TextDecoder().decode(new Uint8Array(buffer, offset, 4));
                frameSize = view.getUint32(offset + 4, false);
                offset += 10;
            } else if (majorVer === 4) {
                frameId = new TextDecoder().decode(new Uint8Array(buffer, offset, 4));
                frameSize = readSynchsafeInteger32(view, offset + 4);
                offset += 10;
            } else break;

            if (frameId.charCodeAt(0) === 0) break;
            if (offset + frameSize > view.byteLength) break;

            const frameData = new DataView(buffer, offset, frameSize);
            if (frameId === 'TIT2') metadata.title = readID3Text(frameData);
            if (frameId === 'TPE1') tpe1 = readID3Text(frameData);
            if (frameId === 'TPE2') tpe2 = readID3Text(frameData);
            if (frameId === 'TALB') metadata.album.title = readID3Text(frameData);
            if (frameId === 'TSRC') metadata.isrc = readID3Text(frameData);
            if (frameId === 'TCOP') metadata.copyright = readID3Text(frameData);
            if (frameId === 'TYER' || frameId === 'TDRC') {
                const year = readID3Text(frameData);
                if (year) metadata.album.releaseDate = year;
            }
            if (frameId === 'APIC') {
                try {
                    const encoding = frameData.getUint8(0);
                    let pos = 1;
                    while (pos < frameData.byteLength && frameData.getUint8(pos) !== 0) pos++;
                    pos++;
                    pos++;
                    let terminator = encoding === 1 || encoding === 2 ? 2 : 1;
                    while (pos < frameData.byteLength) {
                        if (frameData.getUint8(pos) === 0) {
                            if (terminator === 1) {
                                pos++;
                                break;
                            } else if (pos + 1 < frameData.byteLength && frameData.getUint8(pos + 1) === 0) {
                                pos += 2;
                                break;
                            }
                        }
                        pos++;
                    }
                    const pictureData = new Uint8Array(buffer, offset + pos, frameSize - pos);
                    metadata.album.cover = URL.createObjectURL(new Blob([pictureData], { type: 'image/jpeg' }));
                } catch (e) {
                    console.warn('Error parsing APIC:', e);
                }
            }
            offset += frameSize;
        }
        const artistStr = tpe1 || tpe2;
        if (artistStr) metadata.artists = artistStr.split('/').map((n) => ({ name: n.trim() }));
    }
}

export function readSynchsafeInteger32(view, offset) {
    return (
        ((view.getUint8(offset) & 0x7f) << 21) |
        ((view.getUint8(offset + 1) & 0x7f) << 14) |
        ((view.getUint8(offset + 2) & 0x7f) << 7) |
        (view.getUint8(offset + 3) & 0x7f)
    );
}

export function readID3Text(view) {
    const encoding = view.getUint8(0);
    const buffer = view.buffer.slice(view.byteOffset + 1, view.byteOffset + view.byteLength);
    let decoder;
    if (encoding === 0) decoder = new TextDecoder('iso-8859-1');
    else if (encoding === 1) decoder = new TextDecoder('utf-16');
    else if (encoding === 2) decoder = new TextDecoder('utf-16be');
    else decoder = new TextDecoder('utf-8');
    return decoder.decode(buffer).replace(/\0/g, '');
}
