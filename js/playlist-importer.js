/**
 * Helper function to get track artists string
 */
function getTrackArtists(track) {
    if (track.artists && track.artists.length > 0) {
        return track.artists.map((artist) => artist.name).join(', ');
    }
    return track.artist?.name || 'Unknown Artist';
}

const IMPORT_SEARCH_DELAY_MS = 220;

const IMPORT_MATCH_PROFILES = {
    strict: {
        minTitleScore: 0.72,
        minArtistScore: 0.64,
        minAlbumScore: 0.38,
        minScoreWithAlbum: 0.77,
        minScoreNoArtist: 0.73,
        minScoreWithArtist: 0.69,
    },
    lenient: {
        minTitleScore: 0.62,
        minArtistScore: 0.5,
        minAlbumScore: 0.28,
        minScoreWithAlbum: 0.62,
        minScoreNoArtist: 0.58,
        minScoreWithArtist: 0.57,
    },
};

function resolveImportOptions(options = {}) {
    const mode =
        typeof options === 'string' ? options : options?.mode || options?.matchMode || options?.profile || 'strict';
    return {
        mode: mode === 'lenient' ? 'lenient' : 'strict',
    };
}

function sanitizeImportValue(value) {
    const withoutControlChars = Array.from(String(value || ''))
        .filter((char) => {
            const code = char.charCodeAt(0);
            return code >= 32 && code !== 127;
        })
        .join('');

    return withoutControlChars.replace(/\s+/g, ' ').trim();
}

function normalizeForCompare(value) {
    return sanitizeImportValue(value)
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[“”„‟«»]/g, '"')
        .replace(/[’‘‚‛]/g, "'")
        .replace(/[‐‑‒–—―]/g, '-')
        .replace(/[()\[\]{}]/g, ' ')
        .replace(/\s+(feat|featuring|ft)\.?\s+/giu, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function foldForCompare(value) {
    return normalizeForCompare(value).normalize('NFKD').replace(/\p{M}/gu, '').trim();
}

function tokenSet(value) {
    return new Set(foldForCompare(value).split(' ').filter(Boolean));
}

function tokenSimilarity(expected, actual) {
    const a = tokenSet(expected);
    const b = tokenSet(actual);
    if (!a.size || !b.size) return 0;

    let common = 0;
    for (const token of a) {
        if (b.has(token)) common += 1;
    }

    const precision = common / a.size;
    const recall = common / b.size;
    const jaccard = common / (a.size + b.size - common);
    return Math.max(jaccard, (precision + recall) / 2);
}

function fieldSimilarity(expected, actual) {
    const expectedRaw = normalizeForCompare(expected);
    const actualRaw = normalizeForCompare(actual);
    const expectedFold = foldForCompare(expected);
    const actualFold = foldForCompare(actual);

    if (!expectedRaw || !actualRaw) return 0;
    if (expectedRaw === actualRaw) return 1;
    if (expectedFold && expectedFold === actualFold) return 0.99;

    if (
        (expectedRaw.length > 2 && actualRaw.includes(expectedRaw)) ||
        (actualRaw.length > 2 && expectedRaw.includes(actualRaw))
    ) {
        return 0.92;
    }

    if (
        (expectedFold.length > 2 && actualFold.includes(expectedFold)) ||
        (actualFold.length > 2 && expectedFold.includes(actualFold))
    ) {
        return 0.9;
    }

    return tokenSimilarity(expected, actual);
}

function buildSearchQueries({ title, artist, album }) {
    const safeTitle = sanitizeImportValue(title);
    const safeArtist = sanitizeImportValue(artist);
    const safeAlbum = sanitizeImportValue(album);

    const queries = [
        `"${safeTitle}" ${safeArtist} ${safeAlbum}`.trim(),
        `${safeTitle} ${safeArtist} ${safeAlbum}`.trim(),
        `"${safeTitle}" ${safeArtist}`.trim(),
        `${safeTitle} ${safeArtist}`.trim(),
        `${safeTitle} ${safeAlbum}`.trim(),
        safeTitle,
    ].filter(Boolean);

    return Array.from(new Set(queries));
}

function splitArtistCandidates(value) {
    const raw = sanitizeImportValue(value);
    if (!raw) return [];

    const normalized = raw
        .replace(/\s+(feat|featuring|ft)\.?\s+/giu, ',')
        .replace(/\s+(with|x|vs)\s+/giu, ',')
        .replace(/[;&|/]+/g, ',');

    return Array.from(
        new Set(
            normalized
                .split(',')
                .map((entry) => sanitizeImportValue(entry))
                .filter(Boolean)
        )
    );
}

function getPrimaryArtistName(track) {
    if (Array.isArray(track?.artists) && track.artists.length > 0) {
        return sanitizeImportValue(track.artists[0]?.name || '');
    }
    return sanitizeImportValue(track?.artist?.name || '');
}

function scoreCandidate(candidate, expected) {
    const candidateTitle = sanitizeImportValue(candidate?.title);
    const candidateArtist = sanitizeImportValue(getTrackArtists(candidate));
    const candidatePrimaryArtist = getPrimaryArtistName(candidate);
    const candidateAlbum = sanitizeImportValue(candidate?.album?.title);

    const titleScore = fieldSimilarity(expected.title, candidateTitle);
    let artistScore = 0.5;
    if (expected.artist) {
        const expectedArtists = splitArtistCandidates(expected.artist);
        const comparisons = [];

        if (candidateArtist) {
            comparisons.push(
                ...expectedArtists.map((artist) => fieldSimilarity(artist, candidateArtist)),
                fieldSimilarity(expected.artist, candidateArtist)
            );
        }

        if (candidatePrimaryArtist) {
            comparisons.push(
                ...expectedArtists.map((artist) => fieldSimilarity(artist, candidatePrimaryArtist)),
                fieldSimilarity(expected.artist, candidatePrimaryArtist)
            );
        }

        artistScore = comparisons.length ? Math.max(...comparisons) : 0;
    }
    const albumScore = expected.album ? fieldSimilarity(expected.album, candidateAlbum) : 0.5;

    let totalWeight = 0;
    let weighted = 0;

    totalWeight += 0.62;
    weighted += titleScore * 0.62;

    if (expected.artist) {
        totalWeight += 0.28;
        weighted += artistScore * 0.28;
    }

    if (expected.album) {
        totalWeight += 0.1;
        weighted += albumScore * 0.1;
    }

    return {
        score: totalWeight > 0 ? weighted / totalWeight : 0,
        titleScore,
        artistScore,
        albumScore,
    };
}

async function findBestTrackMatch(api, metadata, options = {}) {
    const expected = {
        title: sanitizeImportValue(metadata.title),
        artist: sanitizeImportValue(metadata.artist),
        album: sanitizeImportValue(metadata.album),
    };
    const { mode } = resolveImportOptions(options);
    const profile = IMPORT_MATCH_PROFILES[mode];

    if (!expected.title) return null;

    const queries = buildSearchQueries(expected);
    const candidates = [];
    const seen = new Set();

    for (const query of queries) {
        try {
            const result = await api.searchTracks(query, { limit: 12 });
            const items = Array.isArray(result?.items) ? result.items : [];

            for (const item of items) {
                const key = String(item?.id || `${item?.title || ''}|${getTrackArtists(item)}`);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                candidates.push(item);
            }

            if (candidates.length >= 24) break;
        } catch {
            // Continue trying fallback queries
        }
    }

    if (!candidates.length) return null;

    let best = candidates[0];
    let bestMetrics = scoreCandidate(best, expected);
    for (let i = 1; i < candidates.length; i++) {
        const candidate = candidates[i];
        const metrics = scoreCandidate(candidate, expected);
        if (metrics.score > bestMetrics.score) {
            best = candidate;
            bestMetrics = metrics;
        }
    }

    const hasExpectedArtist = Boolean(expected.artist);
    const requiresAlbumCheck = Boolean(expected.album);

    if (bestMetrics.titleScore < profile.minTitleScore) return null;
    if (hasExpectedArtist && bestMetrics.artistScore < profile.minArtistScore) return null;
    if (
        requiresAlbumCheck &&
        bestMetrics.albumScore < profile.minAlbumScore &&
        bestMetrics.score < profile.minScoreWithAlbum
    ) {
        return null;
    }
    if (!hasExpectedArtist && bestMetrics.score < profile.minScoreNoArtist) return null;
    if (hasExpectedArtist && bestMetrics.score < profile.minScoreWithArtist) return null;

    return best;
}

async function importTracksFromMetadata(entries, api, onProgress, options = {}) {
    const importOptions = resolveImportOptions(options);
    const tracks = [];
    const missingTracks = [];
    const totalTracks = entries.length;

    for (let i = 0; i < entries.length; i++) {
        const entry = {
            title: sanitizeImportValue(entries[i]?.title),
            artist: sanitizeImportValue(entries[i]?.artist),
            album: sanitizeImportValue(entries[i]?.album),
        };

        if (onProgress) {
            onProgress({
                current: i,
                total: totalTracks,
                currentTrack: entry.title || 'Unknown track',
                currentArtist: entry.artist || '',
            });
        }

        if (!entry.title) {
            missingTracks.push(entry);
            continue;
        }

        await new Promise((resolve) => setTimeout(resolve, IMPORT_SEARCH_DELAY_MS));

        const match = await findBestTrackMatch(api, entry, importOptions);
        if (match) {
            tracks.push(match);
        } else {
            missingTracks.push(entry);
        }
    }

    return { tracks, missingTracks };
}

/**
 * Generates CSV playlist export
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @returns {string} CSV content
 */
export function generateCSV(_playlist, tracks) {
    const headers = ['Track Name', 'Artist Name(s)', 'Album', 'Duration'];
    let content = headers.map((h) => `"${h}"`).join(',') + '\n';

    tracks.forEach((track) => {
        const title = (track.title || '').replace(/"/g, '""');
        const artist = getTrackArtists(track).replace(/"/g, '""');
        const album = (track.album?.title || '').replace(/"/g, '""');
        const duration = formatDuration(track.duration || 0);

        content += `"${title}","${artist}","${album}","${duration}"\n`;
    });

    return content;
}

/**
 * Generates XSPF (XML Shareable Playlist Format) export
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @returns {string} XSPF XML content
 */
export function generateXSPF(playlist, tracks) {
    const date = new Date().toISOString();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<playlist xmlns="http://xspf.org/ns/0/" version="1">\n';
    xml += `  <title>${escapeXml(playlist.title || 'Unknown Playlist')}</title>\n`;
    xml += `  <creator>${escapeXml(playlist.artist || 'Various Artists')}</creator>\n`;
    xml += `  <date>${date}</date>\n`;
    xml += '  <trackList>\n';

    tracks.forEach((track) => {
        xml += '    <track>\n';
        xml += `      <title>${escapeXml(track.title || 'Unknown Title')}</title>\n`;
        xml += `      <creator>${escapeXml(getTrackArtists(track))}</creator>\n`;
        if (track.album?.title) {
            xml += `      <album>${escapeXml(track.album.title)}</album>\n`;
        }
        if (track.duration) {
            xml += `      <duration>${Math.round(track.duration * 1000)}</duration>\n`;
        }
        xml += '    </track>\n';
    });

    xml += '  </trackList>\n';
    xml += '</playlist>\n';

    return xml;
}

/**
 * Generates generic XML playlist export
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @returns {string} XML content
 */
export function generateXML(playlist, tracks) {
    const date = new Date().toISOString();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<playlist>\n';
    xml += `  <name>${escapeXml(playlist.title || 'Unknown Playlist')}</name>\n`;
    xml += `  <creator>${escapeXml(playlist.artist || 'Various Artists')}</creator>\n`;
    xml += `  <created>${date}</created>\n`;
    xml += `  <trackCount>${tracks.length}</trackCount>\n`;
    xml += '  <tracks>\n';

    tracks.forEach((track, index) => {
        xml += '    <track>\n';
        xml += `      <position>${index + 1}</position>\n`;
        xml += `      <title>${escapeXml(track.title || '')}</title>\n`;
        xml += `      <artist>${escapeXml(getTrackArtists(track) || '')}</artist>\n`;
        xml += `      <album>${escapeXml(track.album?.title || '')}</album>\n`;
        xml += `      <duration>${Math.round(track.duration || 0)}</duration>\n`;
        xml += '    </track>\n';
    });

    xml += '  </tracks>\n';
    xml += '</playlist>\n';

    return xml;
}

/**
 * Parses CSV playlist format
 * @param {string} csvText - CSV content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
export async function parseCSV(csvText, api, onProgress, options = {}) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return { tracks: [], missingTracks: [] };

    // Robust CSV line parser that respects quotes
    const parseLine = (text) => {
        const values = [];
        let current = '';
        let inQuote = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (char === '"') {
                if (inQuote && text[i + 1] === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuote = !inQuote;
                }
            } else if (char === ',' && !inQuote) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        return values.map((v) => v.trim());
    };

    const headers = parseLine(lines[0]).map((h) => h.replace(/^\uFEFF/, ''));
    const rows = lines.slice(1);

    const trackEntries = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.trim()) continue;

        const values = parseLine(row);

        if (values.length >= headers.length) {
            let trackTitle = '';
            let artistNames = '';
            let albumName = '';

            headers.forEach((header, index) => {
                const value = values[index];
                if (!value) return;

                switch (header.toLowerCase()) {
                    case 'track name':
                    case 'title':
                    case 'song':
                    case 'name':
                        trackTitle = value;
                        break;
                    case 'artist name(s)':
                    case 'artist name':
                    case 'artist':
                    case 'artists':
                    case 'creator':
                        artistNames = value;
                        break;
                    case 'album':
                    case 'album name':
                        albumName = value;
                        break;
                }
            });

            if (trackTitle) {
                trackEntries.push({
                    title: trackTitle,
                    artist: artistNames,
                    album: albumName,
                });
            }
        }
    }

    return importTracksFromMetadata(trackEntries, api, onProgress, options);
}

/**
 * Parses JSPF (JSON Shareable Playlist Format)
 * @param {string} jspfText - JSPF JSON content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
export async function parseJSPF(jspfText, api, onProgress, options = {}) {
    try {
        const jspfData = JSON.parse(jspfText);

        if (!jspfData.playlist || !Array.isArray(jspfData.playlist.track)) {
            throw new Error('Invalid JSPF format: missing playlist or track array');
        }

        const playlist = jspfData.playlist;
        const trackEntries = [];

        for (const jspfTrack of playlist.track) {
            const trackTitle = jspfTrack.title;
            const trackCreator = jspfTrack.creator;
            const trackAlbum = jspfTrack.album;

            if (trackTitle) {
                trackEntries.push({
                    title: trackTitle,
                    artist: trackCreator,
                    album: trackAlbum,
                });
            }
        }

        const result = await importTracksFromMetadata(trackEntries, api, onProgress, options);
        return { ...result, jspfData };
    } catch (error) {
        throw new Error('Failed to parse JSPF: ' + error.message);
    }
}

/**
 * Parses XSPF (XML Shareable Playlist Format)
 * @param {string} xspfText - XSPF XML content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
export async function parseXSPF(xspfText, api, onProgress, options = {}) {
    // Validate input to prevent potential XXE attacks
    if (!xspfText || typeof xspfText !== 'string' || xspfText.length > 10 * 1024 * 1024) {
        throw new Error('Invalid XSPF content');
    }
    // Reject potential XXE payloads
    if (xspfText.includes('<!ENTITY') || xspfText.includes('<!DOCTYPE')) {
        throw new Error('XSPF content contains potentially dangerous declarations');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xspfText, 'application/xml');

    const trackList = xmlDoc.getElementsByTagName('track');
    const trackEntries = [];

    for (let i = 0; i < trackList.length; i++) {
        const trackEl = trackList[i];
        const title = trackEl.getElementsByTagName('title')[0]?.textContent || '';
        const creator = trackEl.getElementsByTagName('creator')[0]?.textContent || '';
        const album = trackEl.getElementsByTagName('album')[0]?.textContent || '';

        if (title) {
            trackEntries.push({
                title,
                artist: creator,
                album,
            });
        }
    }

    return importTracksFromMetadata(trackEntries, api, onProgress, options);
}

/**
 * Parses generic XML playlist format
 * @param {string} xmlText - XML content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
export async function parseXML(xmlText, api, onProgress, options = {}) {
    // Validate input to prevent potential XXE attacks
    if (!xmlText || typeof xmlText !== 'string' || xmlText.length > 10 * 1024 * 1024) {
        throw new Error('Invalid XML content');
    }
    // Reject potential XXE payloads
    if (xmlText.includes('<!ENTITY') || xmlText.includes('<!DOCTYPE')) {
        throw new Error('XML content contains potentially dangerous declarations');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

    // Try different track element names
    let trackElements = xmlDoc.getElementsByTagName('track');
    if (trackElements.length === 0) {
        trackElements = xmlDoc.getElementsByTagName('song');
    }
    if (trackElements.length === 0) {
        trackElements = xmlDoc.getElementsByTagName('item');
    }

    const trackEntries = [];

    for (let i = 0; i < trackElements.length; i++) {
        const trackEl = trackElements[i];

        // Try different element names for title/artist
        const title =
            trackEl.getElementsByTagName('title')[0]?.textContent ||
            trackEl.getElementsByTagName('name')[0]?.textContent ||
            '';
        const artist =
            trackEl.getElementsByTagName('artist')[0]?.textContent ||
            trackEl.getElementsByTagName('creator')[0]?.textContent ||
            trackEl.getElementsByTagName('performer')[0]?.textContent ||
            '';
        const album = trackEl.getElementsByTagName('album')[0]?.textContent || '';

        if (title) {
            trackEntries.push({
                title,
                artist,
                album,
            });
        }
    }

    return importTracksFromMetadata(trackEntries, api, onProgress, options);
}

/**
 * Parses M3U/M3U8 playlist format
 * @param {string} m3uText - M3U content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
export async function parseM3U(m3uText, api, onProgress, options = {}) {
    const lines = m3uText.trim().split('\n');

    const trackInfo = [];
    let currentInfo = null;

    // Parse M3U format
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#EXTM3U')) continue;

        if (trimmed.startsWith('#EXTINF:')) {
            // Parse EXTINF line: #EXTINF:duration,Artist - Title
            const match = trimmed.match(/#EXTINF:(-?\d+)?,(.+)/);
            if (match) {
                const displayName = match[2];
                const parts = displayName.split(' - ');
                currentInfo = {
                    title: parts.length > 1 ? parts.slice(1).join(' - ') : displayName,
                    artist: parts.length > 1 ? parts[0] : '',
                };
            }
        } else if (!trimmed.startsWith('#')) {
            // This is a file path line
            if (currentInfo) {
                trackInfo.push(currentInfo);
                currentInfo = null;
            } else {
                const fileName = trimmed
                    .split(/[/\\]/)
                    .pop()
                    ?.replace(/\.[a-z0-9]{1,5}$/i, '')
                    ?.trim();

                if (fileName) {
                    const parts = fileName.split(' - ');
                    trackInfo.push({
                        title: parts.length > 1 ? parts.slice(1).join(' - ') : fileName,
                        artist: parts.length > 1 ? parts[0] : '',
                        album: '',
                    });
                }
            }
        }
    }

    return importTracksFromMetadata(trackInfo, api, onProgress, options);
}

/**
 * Formats duration in MM:SS format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Helper function to escape XML special characters
 */
function escapeXml(text) {
    if (!text) return '';
    return text
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Export all functions
export { getTrackArtists };
