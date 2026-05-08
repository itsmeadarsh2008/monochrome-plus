// js/metadata.mp4.js
import { getCoverBlob, getTrackTitle, getFullArtistString } from './utils.js';

export const MP4_MIME_TYPE = 'audio/mp4';

export async function readMp4Metadata(file, metadata) {
    const arrayBuffer = await file.arrayBuffer();
    const dataView = new DataView(arrayBuffer);
    const atomMap = parseMp4Atoms(dataView);

    const ilst = atomMap.get('ilst');
    if (ilst) {
        const title = getIlstData(ilst, '\xa9nam');
        if (title) metadata.title = title;

        const artist = getIlstData(ilst, '\xa9ART');
        if (artist) metadata.artists = [{ name: artist }];

        const album = getIlstData(ilst, '\xa9alb');
        if (album) metadata.album.title = album;

        const isrc = getIlstData(ilst, 'isrc');
        if (isrc) metadata.isrc = isrc;

        const copyright = getIlstData(ilst, 'cprt');
        if (copyright) metadata.copyright = copyright;

        const cover = getIlstData(ilst, 'covr');
        if (cover instanceof Blob) {
            metadata.album.cover = URL.createObjectURL(cover);
        }
    }

    const mvhd = atomMap.get('mvhd');
    if (mvhd) {
        const timescale = mvhd.getUint32(12);
        const duration = mvhd.getUint32(16);
        if (timescale > 0) metadata.duration = duration / timescale;
    }
}

export async function addMp4Metadata(mp4Blob, track, api) {
    try {
        const arrayBuffer = await mp4Blob.arrayBuffer();
        const dataView = new DataView(arrayBuffer);
        const rootAtoms = parseTopLevelAtoms(dataView);

        const moovAtom = rootAtoms.find((a) => a.type === 'moov');
        if (!moovAtom) return mp4Blob;

        const udtaAtom = findOrAddAtom(moovAtom, 'udta');
        const metaAtom = findOrAddAtom(udtaAtom, 'meta', true);
        const ilstAtom = findOrAddAtom(metaAtom, 'ilst');

        // Update ilst with track data
        updateIlst(ilstAtom, '\xa9nam', getTrackTitle(track));
        updateIlst(ilstAtom, '\xa9ART', getFullArtistString(track));
        if (track.album?.title) updateIlst(ilstAtom, '\xa9alb', track.album.title);
        if (track.trackNumber) {
            const trkn = new Uint8Array(8);
            new DataView(trkn.buffer).setUint16(2, track.trackNumber);
            if (track.album?.numberOfTracks) new DataView(trkn.buffer).setUint16(4, track.album.numberOfTracks);
            updateIlst(ilstAtom, 'trkn', trkn);
        }
        if (track.copyright) updateIlst(ilstAtom, 'cprt', track.copyright);

        if (track.album?.cover) {
            const coverBlob = await getCoverBlob(api, track.album.cover);
            if (coverBlob) {
                const coverData = new Uint8Array(await coverBlob.arrayBuffer());
                updateIlst(ilstAtom, 'covr', coverData, 13); // 13 = JPEG, 14 = PNG
            }
        }

        const newBuffer = rebuildMp4(dataView, rootAtoms);
        return new Blob([newBuffer], { type: 'audio/mp4' });
    } catch (e) {
        console.error('Failed to add MP4 metadata:', e);
        return mp4Blob;
    }
}

function parseMp4Atoms(dataView, offset = 0, limit = dataView.byteLength) {
    const map = new Map();
    let pos = offset;
    while (pos + 8 <= limit) {
        const size = dataView.getUint32(pos);
        const type = String.fromCharCode(
            dataView.getUint8(pos + 4),
            dataView.getUint8(pos + 5),
            dataView.getUint8(pos + 6),
            dataView.getUint8(pos + 7)
        );
        if (size === 0) break;
        const atomData = new DataView(dataView.buffer, pos + 8, size - 8);
        map.set(type, atomData);
        if (['moov', 'udta', 'meta', 'ilst'].includes(type)) {
            const subOffset = type === 'meta' ? 4 : 0;
            const subMap = parseMp4Atoms(atomData, subOffset);
            for (const [k, v] of subMap) map.set(k, v);
        }
        pos += size;
    }
    return map;
}

function getIlstData(ilst, type) {
    const atom = parseMp4Atoms(ilst).get(type);
    if (!atom) return null;
    const data = parseMp4Atoms(atom).get('data');
    if (!data) return null;
    const flag = data.getUint32(0) & 0xffffff;
    if (flag === 1)
        return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset + 8, data.byteLength - 8));
    if (flag === 13 || flag === 14)
        return new Blob([new Uint8Array(data.buffer, data.byteOffset + 8, data.byteLength - 8)]);
    return null;
}

function parseTopLevelAtoms(dataView) {
    const atoms = [];
    let pos = 0;
    while (pos + 8 <= dataView.byteLength) {
        const size = dataView.getUint32(pos);
        const type = String.fromCharCode(
            dataView.getUint8(pos + 4),
            dataView.getUint8(pos + 5),
            dataView.getUint8(pos + 6),
            dataView.getUint8(pos + 7)
        );
        atoms.push({ type, size, pos, data: new Uint8Array(dataView.buffer, pos + 8, size - 8) });
        pos += size;
    }
    return atoms;
}

function findOrAddAtom(parent, type, isFullMeta = false) {
    let atom = (parent.children || []).find((a) => a.type === type);
    if (!atom) {
        atom = { type, data: isFullMeta ? new Uint8Array(4) : new Uint8Array(0), children: [] };
        if (!parent.children) parent.children = [];
        parent.children.push(atom);
    }
    return atom;
}

function updateIlst(ilst, type, value, dataType = 1) {
    let item = ilst.children.find((a) => a.type === type);
    if (!item) {
        item = { type, children: [] };
        ilst.children.push(item);
    }
    let data = item.children.find((a) => a.type === 'data');
    if (!data) {
        data = { type: 'data', children: [] };
        item.children.push(data);
    }
    const valBytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, dataType);
    data.data = new Uint8Array(header.length + valBytes.length);
    data.data.set(header);
    data.data.set(valBytes, 8);
}

function rebuildMp4(originalView, rootAtoms) {
    // Simplified rebuild: mostly needed for moov/ilst updates
    // In a real implementation, we'd recursively calculate sizes
    // This is a placeholder for the logic in metadata.mp4.js
    let totalSize = 0;
    const calculateSize = (atom) => {
        let size = 8 + (atom.data?.length || 0);
        if (atom.children) {
            for (const child of atom.children) size += calculateSize(child);
        }
        atom.calculatedSize = size;
        return size;
    };

    const serialize = (atom, buffer, offset) => {
        const view = new DataView(buffer);
        view.setUint32(offset, atom.calculatedSize);
        for (let i = 0; i < 4; i++) buffer[offset + 4 + i] = atom.type.charCodeAt(i);
        let pos = offset + 8;
        if (atom.data) {
            buffer.set(atom.data, pos);
            pos += atom.data.length;
        }
        if (atom.children) {
            for (const child of atom.children) pos = serialize(child, buffer, pos);
        }
        return pos;
    };

    // Replace the original moov with the updated tree
    // Then concatenate with mdat, etc.
    // For now, returning original if not fully implemented
    return originalView.buffer;
}
