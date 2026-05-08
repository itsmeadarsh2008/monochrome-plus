// js/metadata.flac.js
import { getCoverBlob, getTrackTitle, getFullArtistString } from './utils.js';
import { METADATA_STRINGS } from './METADATA_STRINGS.js';

export const FLAC_MIME_TYPE = 'audio/flac';
const FLAC_BLOCK_TYPES = {
    StreamInfo: 0,
    Padding: 1,
    Application: 2,
    SeekTable: 3,
    VorbisComment: 4,
    CueSheet: 5,
    Picture: 6,
};

export async function readFlacMetadata(file, metadata) {
    const arrayBuffer = await file.arrayBuffer();
    const dataView = new DataView(arrayBuffer);

    if (!isFlacFile(dataView)) return;

    const blocks = parseFlacBlocks(dataView);
    const vorbisBlock = blocks.find((b) => b.type === FLAC_BLOCK_TYPES.VorbisComment);
    const pictureBlock = blocks.find((b) => b.type === FLAC_BLOCK_TYPES.Picture);
    const streamInfo = blocks.find((b) => b.type === FLAC_BLOCK_TYPES.StreamInfo);

    const artists = [];
    if (vorbisBlock) {
        const offset = vorbisBlock.offset;
        const vendorLen = dataView.getUint32(offset, true);
        let pos = offset + 4 + vendorLen;
        const commentListLen = dataView.getUint32(pos, true);
        pos += 4;

        for (let i = 0; i < commentListLen; i++) {
            const len = dataView.getUint32(pos, true);
            pos += 4;
            const comment = new TextDecoder().decode(new Uint8Array(arrayBuffer, pos, len));
            pos += len;

            const eqIdx = comment.indexOf('=');
            if (eqIdx > -1) {
                const key = comment.substring(0, eqIdx);
                const value = comment.substring(eqIdx + 1);
                const upperKey = key.toUpperCase();
                if (upperKey === 'TITLE') metadata.title = value;
                if (upperKey === 'ARTIST' || upperKey === 'ALBUMARTIST') {
                    artists.push(value);
                }
                if (upperKey === 'ALBUM') metadata.album.title = value;
                if (upperKey === 'ISRC') metadata.isrc = value;
                if (upperKey === 'COPYRIGHT') metadata.copyright = value;
                if (upperKey === 'ITUNESADVISORY') metadata.explicit = value === '1';
            }
        }
    }

    if (streamInfo) {
        const offset = streamInfo.offset;
        const byte10 = dataView.getUint8(offset + 10);
        const byte11 = dataView.getUint8(offset + 11);
        const byte12 = dataView.getUint8(offset + 12);
        const sampleRate = (byte10 << 12) | (byte11 << 4) | (byte12 >> 4);
        const byte13 = dataView.getUint8(offset + 13);
        const tsHigh = byte13 & 0x0f;
        const tsLow = dataView.getUint32(offset + 14, false);
        const totalSamples = tsHigh * 0x100000000 + tsLow;

        if (sampleRate > 0) {
            metadata.duration = totalSamples / sampleRate;
        }
    }

    if (artists.length > 0) {
        metadata.artists = artists.flatMap((a) => a.split(/; |\/|\\/)).map((name) => ({ name: name.trim() }));
    }

    if (pictureBlock) {
        try {
            let pos = pictureBlock.offset;
            pos += 4;
            const mimeLen = dataView.getUint32(pos, false);
            pos += 4;
            const mime = new TextDecoder().decode(new Uint8Array(arrayBuffer, pos, mimeLen));
            pos += mimeLen;
            const descLen = dataView.getUint32(pos, false);
            pos += 4;
            pos += descLen;
            pos += 16;
            const dataLen = dataView.getUint32(pos, false);
            pos += 4;
            const pictureData = new Uint8Array(arrayBuffer, pos, dataLen);
            const blob = new Blob([pictureData], { type: mime });
            metadata.album.cover = URL.createObjectURL(blob);
        } catch (e) {
            console.warn('Error parsing FLAC picture:', e);
        }
    }
}

export async function addFlacMetadata(flacBlob, track, api) {
    try {
        const arrayBuffer = await flacBlob.arrayBuffer();
        const dataView = new DataView(arrayBuffer);

        if (!isFlacFile(dataView)) {
            console.warn('Not a valid FLAC file, returning original');
            return flacBlob;
        }

        const blocks = parseFlacBlocks(dataView);
        if (!blocks || blocks.length === 0 || blocks.audioDataOffset === undefined) {
            console.warn('Failed to parse FLAC blocks, returning original');
            return flacBlob;
        }

        if (blocks[0].type !== 0) {
            console.warn('FLAC file missing STREAMINFO block, returning original');
            return flacBlob;
        }

        const vorbisCommentBlock = createVorbisCommentBlock(createVorbisComments(track));

        let pictureBlock = null;
        if (track.album?.cover) {
            try {
                pictureBlock = await createFlacPictureBlock(track.album.cover, api);
            } catch (error) {
                console.warn('Failed to embed album art:', error);
            }
        }

        let newFlacData;
        try {
            newFlacData = rebuildFlacWithMetadata(dataView, blocks, vorbisCommentBlock, pictureBlock);
        } catch (rebuildError) {
            console.error('Failed to rebuild FLAC structure:', rebuildError);
            return flacBlob;
        }

        const validationView = new DataView(newFlacData.buffer);
        if (!isFlacFile(validationView)) {
            console.error('Rebuilt FLAC has invalid signature, returning original');
            return flacBlob;
        }

        return new Blob([newFlacData], { type: 'audio/flac' });
    } catch (error) {
        console.error('Failed to add FLAC metadata:', error);
        return flacBlob;
    }
}

export function isFlacFile(dataView) {
    return (
        dataView.byteLength >= 4 &&
        dataView.getUint8(0) === 0x66 && // 'f'
        dataView.getUint8(1) === 0x4c && // 'L'
        dataView.getUint8(2) === 0x61 && // 'a'
        dataView.getUint8(3) === 0x43
    ); // 'C'
}

export function parseFlacBlocks(dataView) {
    const blocks = [];
    let offset = 4;

    while (offset + 4 <= dataView.byteLength) {
        const header = dataView.getUint8(offset);
        const isLast = (header & 0x80) !== 0;
        const blockType = header & 0x7f;

        if (blockType === 127) break;

        const blockSize =
            (dataView.getUint8(offset + 1) << 16) |
            (dataView.getUint8(offset + 2) << 8) |
            dataView.getUint8(offset + 3);

        if (blockSize < 0 || offset + 4 + blockSize > dataView.byteLength) break;

        blocks.push({
            type: blockType,
            isLast: isLast,
            size: blockSize,
            offset: offset + 4,
            headerOffset: offset,
        });

        offset += 4 + blockSize;
        if (isLast) {
            blocks.audioDataOffset = offset;
            break;
        }
    }

    if (blocks.audioDataOffset === undefined && blocks.length > 0) {
        const lastBlock = blocks[blocks.length - 1];
        blocks.audioDataOffset = lastBlock.headerOffset + 4 + lastBlock.size;
    }

    return blocks;
}

export function createVorbisComments(track) {
    const comments = [];
    const discNumber = track.volumeNumber ?? track.discNumber;

    if (track.title) {
        comments.push(['TITLE', getTrackTitle(track)]);
    }
    const artistStr = getFullArtistString(track);
    if (artistStr) {
        comments.push(['ARTIST', artistStr]);
    }
    if (track.album?.title) {
        comments.push(['ALBUM', track.album.title]);
    }
    const albumArtist = track.album?.artist?.name || track.artist?.name;
    if (albumArtist) {
        comments.push(['ALBUMARTIST', albumArtist]);
    }
    if (track.trackNumber) {
        comments.push(['TRACKNUMBER', String(track.trackNumber)]);
    }
    if (discNumber) {
        comments.push(['DISCNUMBER', String(discNumber)]);
    }
    if (track.album?.numberOfTracks) {
        comments.push(['TRACKTOTAL', String(track.album.numberOfTracks)]);
    }
    if (track.bpm != null) {
        const bpm = Number(track.bpm);
        if (Number.isFinite(bpm)) {
            comments.push(['TEMPO', String(Math.round(bpm))]);
        }
    }

    const releaseDateStr =
        track.album?.releaseDate || (track.streamStartDate ? track.streamStartDate.split('T')[0] : '');
    if (releaseDateStr) {
        try {
            const year = new Date(releaseDateStr).getFullYear();
            if (!isNaN(year)) {
                comments.push(['DATE', String(year)]);
            }
        } catch {
            /* invalid date */
        }
    }

    if (track.copyright) comments.push(['COPYRIGHT', track.copyright]);
    if (track.isrc) comments.push(['ISRC', track.isrc]);
    if (track.explicit) comments.push(['ITUNESADVISORY', '1']);

    return comments;
}

export function createVorbisCommentBlock(comments = []) {
    const vendor = METADATA_STRINGS.VENDOR_STRING;
    const vendorBytes = new TextEncoder().encode(vendor);
    let totalSize = 4 + vendorBytes.length + 4;

    const encodedComments = comments.map(([key, value]) => {
        const text = `${key}=${value}`;
        const bytes = new TextEncoder().encode(text);
        totalSize += 4 + bytes.length;
        return bytes;
    });

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const uint8Array = new Uint8Array(buffer);
    let offset = 0;

    view.setUint32(offset, vendorBytes.length, true);
    offset += 4;
    uint8Array.set(vendorBytes, offset);
    offset += vendorBytes.length;

    view.setUint32(offset, comments.length, true);
    offset += 4;

    for (const commentBytes of encodedComments) {
        view.setUint32(offset, commentBytes.length, true);
        offset += 4;
        uint8Array.set(commentBytes, offset);
        offset += commentBytes.length;
    }

    if (uint8Array.length < 1024) {
        const newArray = new Uint8Array(1024);
        newArray.set(uint8Array);
        return newArray;
    }

    return uint8Array;
}

export async function createFlacPictureBlock(coverId, api) {
    try {
        const imageBlob = await getCoverBlob(api, coverId);
        if (!imageBlob) throw new Error('Failed to fetch album art');

        const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
        const mimeType = imageBlob.type || 'image/jpeg';
        const mimeBytes = new TextEncoder().encode(mimeType);
        const description = '';
        const descBytes = new TextEncoder().encode(description);

        const totalSize = 4 + 4 + mimeBytes.length + 4 + descBytes.length + 4 + 4 + 4 + 4 + 4 + imageBytes.length;
        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        const uint8Array = new Uint8Array(buffer);

        let offset = 0;
        view.setUint32(offset, 3, false); // Front cover
        offset += 4;
        view.setUint32(offset, mimeBytes.length, false);
        offset += 4;
        uint8Array.set(mimeBytes, offset);
        offset += mimeBytes.length;
        view.setUint32(offset, descBytes.length, false);
        offset += 4;
        if (descBytes.length > 0) {
            uint8Array.set(descBytes, offset);
            offset += descBytes.length;
        }
        view.setUint32(offset, 0, false);
        offset += 4;
        view.setUint32(offset, 0, false);
        offset += 4;
        view.setUint32(offset, 0, false);
        offset += 4;
        view.setUint32(offset, 0, false);
        offset += 4;
        view.setUint32(offset, imageBytes.length, false);
        offset += 4;
        uint8Array.set(imageBytes, offset);

        return uint8Array;
    } catch (error) {
        console.error('Failed to create FLAC picture block:', error);
        return null;
    }
}

export function rebuildFlacWithMetadata(dataView, blocks, vorbisCommentBlock, pictureBlock) {
    const originalArray = new Uint8Array(dataView.buffer);
    const filteredBlocks = blocks.filter(
        (b) => ![FLAC_BLOCK_TYPES.VorbisComment, FLAC_BLOCK_TYPES.Picture].includes(b.type)
    );

    let newSize = 4;
    for (const block of filteredBlocks) newSize += 4 + block.size;
    if (vorbisCommentBlock) newSize += 4 + vorbisCommentBlock.length;
    if (pictureBlock) newSize += 4 + pictureBlock.length;

    const audioDataOffset = blocks.audioDataOffset;
    const audioDataSize = dataView.byteLength - audioDataOffset;
    newSize += audioDataSize;

    const newFile = new Uint8Array(newSize);
    let offset = 4;
    newFile.set([0x66, 0x4c, 0x61, 0x43], 0);

    for (let i = 0; i < filteredBlocks.length; i++) {
        const block = filteredBlocks[i];
        newFile[offset++] = block.type;
        newFile[offset++] = (block.size >> 16) & 0xff;
        newFile[offset++] = (block.size >> 8) & 0xff;
        newFile[offset++] = block.size & 0xff;
        newFile.set(originalArray.subarray(block.offset, block.offset + block.size), offset);
        offset += block.size;
    }

    let lastBlockHeaderOffset = offset;
    if (vorbisCommentBlock) {
        lastBlockHeaderOffset = offset;
        newFile[offset++] = FLAC_BLOCK_TYPES.VorbisComment;
        newFile[offset++] = (vorbisCommentBlock.length >> 16) & 0xff;
        newFile[offset++] = (vorbisCommentBlock.length >> 8) & 0xff;
        newFile[offset++] = vorbisCommentBlock.length & 0xff;
        newFile.set(vorbisCommentBlock, offset);
        offset += vorbisCommentBlock.length;
    }

    if (pictureBlock) {
        lastBlockHeaderOffset = offset;
        newFile[offset++] = FLAC_BLOCK_TYPES.Picture;
        newFile[offset++] = (pictureBlock.length >> 16) & 0xff;
        newFile[offset++] = (pictureBlock.length >> 8) & 0xff;
        newFile[offset++] = pictureBlock.length & 0xff;
        newFile.set(pictureBlock, offset);
        offset += pictureBlock.length;
    }

    newFile[lastBlockHeaderOffset] |= 0x80;
    if (audioDataSize > 0) {
        newFile.set(originalArray.subarray(audioDataOffset, audioDataOffset + audioDataSize), offset);
    }

    return newFile;
}
