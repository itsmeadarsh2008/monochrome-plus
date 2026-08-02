// js/metadata.mp4.js
import { getCoverBlob, getTrackTitle, getFullArtistString } from './utils.js';

export const MP4_MIME_TYPE = 'audio/mp4';

const CONTAINER_TYPES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'meta', 'ilst']);

/**
 * Parses a range of bytes into an atom tree.
 * @param {DataView} view
 * @param {number} start
 * @param {number} end
 * @param {boolean} forceContainer - treat every child as a container (for ilst items)
 * @returns {Array} array of atoms { type, pos, size, fullbox, children, payload }
 */
function parseChildren(view, start, end, forceContainer = false) {
    const children = [];
    let pos = start;
    while (pos + 8 <= end) {
        let size = view.getUint32(pos);
        let headerSize = 8;
        if (size === 1) {
            headerSize = 16;
            const high = view.getUint32(pos + 8);
            const low = view.getUint32(pos + 12);
            size = high * 4294967296 + low;
            if (size > 0xffffffff) throw new Error('Atom larger than 4GB is not supported');
        } else if (size === 0) {
            size = end - pos;
        }
        if (size < headerSize || pos + size > end) throw new Error('Malformed MP4 atom');

        const type = String.fromCharCode(
            view.getUint8(pos + 4),
            view.getUint8(pos + 5),
            view.getUint8(pos + 6),
            view.getUint8(pos + 7)
        );

        const atom = { type, pos, size, fullbox: false, children: null, payload: null };
        if (forceContainer || CONTAINER_TYPES.has(type)) {
            let innerStart = pos + headerSize;
            if (type === 'meta') {
                atom.fullbox = true;
                innerStart += 4;
            }
            atom.children = parseChildren(view, innerStart, pos + size, type === 'ilst');
        } else {
            atom.payload = new Uint8Array(view.buffer, view.byteOffset + pos + headerSize, size - headerSize);
        }
        children.push(atom);
        pos += size;
    }
    return children;
}

function concatBytes(parts) {
    let total = 0;
    for (const part of parts) total += part.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function serializeAtom(atom) {
    let payloadBytes;
    if (atom.children) {
        payloadBytes = concatBytes(atom.children.map(serializeAtom));
        if (atom.fullbox) {
            payloadBytes = concatBytes([new Uint8Array(4), payloadBytes]);
        }
    } else {
        payloadBytes = atom.payload || new Uint8Array(0);
    }
    const total = 8 + payloadBytes.length;
    if (total > 0xffffffff) throw new Error('Atom larger than 4GB is not supported');
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, total);
    for (let i = 0; i < 4; i++) out[4 + i] = atom.type.charCodeAt(i);
    out.set(payloadBytes, 8);
    return out;
}

function findOrCreate(children, type, factory) {
    let atom = children.find((a) => a.type === type);
    if (!atom) {
        atom = factory();
        children.push(atom);
    }
    return atom;
}

function findOrCreateData(item) {
    let data = (item.children || []).find((a) => a.type === 'data');
    if (!data) {
        data = { type: 'data', children: null, payload: new Uint8Array(8) };
        if (!item.children) item.children = [];
        item.children.push(data);
    }
    return data;
}

function setIlstItem(ilst, type, valueBytes, dataType) {
    const item = findOrCreate(ilst.children, type, () => ({
        type,
        children: [],
        payload: null,
    }));
    const data = findOrCreateData(item);
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(0, dataType);
    data.payload = concatBytes([header, valueBytes]);
}

const textBytes = (value) => new TextEncoder().encode(String(value));

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
        const view = new DataView(arrayBuffer);
        const topLevel = parseChildren(view, 0, arrayBuffer.byteLength);
        const moovIndex = topLevel.findIndex((a) => a.type === 'moov');
        if (moovIndex === -1) return mp4Blob;

        const moov = topLevel[moovIndex];
        const udta = findOrCreate(moov.children, 'udta', () => ({
            type: 'udta',
            children: [],
            payload: null,
        }));
        const meta = findOrCreate(udta.children, 'meta', () => ({
            type: 'meta',
            fullbox: true,
            children: [],
            payload: null,
        }));
        const ilst = findOrCreate(meta.children, 'ilst', () => ({
            type: 'ilst',
            children: [],
            payload: null,
        }));

        setIlstItem(ilst, '\xa9nam', textBytes(getTrackTitle(track)), 1);
        setIlstItem(ilst, '\xa9ART', textBytes(getFullArtistString(track)), 1);
        if (track.album?.title) setIlstItem(ilst, '\xa9alb', textBytes(track.album.title), 1);

        const albumArtist = track.album?.artist?.name || track.artist?.name || track.artists?.[0]?.name;
        if (albumArtist) setIlstItem(ilst, 'aART', textBytes(albumArtist), 1);

        if (track.isrc) setIlstItem(ilst, 'isrc', textBytes(track.isrc), 1);

        const releaseDate = track.album?.releaseDate || track.streamStartDate;
        if (releaseDate) {
            const year = new Date(releaseDate).getFullYear();
            if (!Number.isNaN(year)) setIlstItem(ilst, '\xa9day', textBytes(String(year)), 1);
        }

        if (track.copyright) setIlstItem(ilst, 'cprt', textBytes(track.copyright), 1);

        if (track.trackNumber) {
            const trkn = new Uint8Array(8);
            const trknView = new DataView(trkn.buffer);
            trknView.setUint16(2, track.trackNumber);
            if (track.album?.numberOfTracks) trknView.setUint16(4, track.album.numberOfTracks);
            setIlstItem(ilst, 'trkn', trkn, 0);
        }

        if (track.album?.cover) {
            const coverBlob = await getCoverBlob(api, track.album.cover);
            if (coverBlob) {
                const coverData = new Uint8Array(await coverBlob.arrayBuffer());
                const dataType = coverBlob.type === 'image/png' ? 14 : 13;
                setIlstItem(ilst, 'covr', coverData, dataType);
            }
        }

        const newMoov = serializeAtom(moov);
        const prefix = new Uint8Array(arrayBuffer, 0, moov.pos);
        const suffix = new Uint8Array(arrayBuffer, moov.pos + moov.size);
        const out = new Uint8Array(prefix.length + newMoov.length + suffix.length);
        out.set(prefix, 0);
        out.set(newMoov, prefix.length);
        out.set(suffix, prefix.length + newMoov.length);
        return new Blob([out], { type: 'audio/mp4' });
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
