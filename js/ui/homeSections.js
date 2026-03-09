// js/ui/homeSections.js

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape HTML to prevent XSS
 */
export function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"');
}

/**
 * Get cover URL from Tidal cover ID
 */
export function coverUrl(cover, size = 320) {
    if (!cover) return '/assets/placeholder.png';
    return `https://resources.tidal.com/images/${cover.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

/**
 * Format duration in seconds to MM:SS
 */
export function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
}

/**
 * Generate quality badges for tracks/albums
 */
export function qualityBadges(item) {
    const tags = item?.mediaMetadata?.tags ?? [];
    const badges = [];
    if (item?.explicit) badges.push(`<span class="badge badge--e">E</span>`);
    if (tags.includes('HIRES_LOSSLESS') || tags.includes('HI_RES')) {
        badges.push(`<span class="badge badge--hd">HD</span>`);
    }
    return badges.join('');
}

// ─── Genres ───────────────────────────────────────────────────────────────────

/**
 * Renders a pill row of genre links.
 * @param {HTMLElement} container
 * @param {Array} genres  — each item: { name, path } or { title }
 * @param {Function} onClick  (genre) => void
 */
export function renderGenres(container, genres, onClick) {
    container.innerHTML = '';
    if (!genres.length) {
        container.closest('.home-section')?.style.setProperty('display', 'none');
        return;
    }
    container.closest('.home-section')?.style.setProperty('display', '');

    genres.forEach((g) => {
        const pill = document.createElement('button');
        pill.className = 'genre-pill';
        pill.textContent = g.name ?? g.title ?? '';
        pill.addEventListener('click', () => onClick(g));
        container.appendChild(pill);
    });
}

// ─── Album Grid (Trending Albums / New Albums) ────────────────────────────────

/**
 * Renders a horizontally-scrollable row of album cards.
 * @param {HTMLElement} container
 * @param {Array} albums
 * @param {Function} onClick  (album) => void
 */
export function renderAlbumRow(container, albums, onClick) {
    container.innerHTML = '';
    if (!albums.length) {
        container.closest('.home-section')?.style.setProperty('display', 'none');
        return;
    }
    container.closest('.home-section')?.style.setProperty('display', '');

    albums.forEach((album) => {
        const card = document.createElement('div');
        card.className = 'album-card';
        card.dataset.id = album.id;

        // Get vibrant color or use default
        const vibrantColor = album.vibrantColor ?? album.album?.vibrantColor ?? '#222';

        card.innerHTML = `
      <div class="album-card__art" style="--vibrant:${vibrantColor}">
        <img src="${coverUrl(album.cover ?? album.album?.cover)}"
             alt="${esc(album.title)}" loading="lazy"
             onerror="this.src='/assets/placeholder.png'"/>
        <button class="album-card__play" aria-label="Play ${esc(album.title)}">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <div class="album-card__meta">
        <span class="album-card__title">${esc(album.title)} ${qualityBadges(album)}</span>
        <span class="album-card__sub">${esc(album.artist?.name ?? album.artists?.[0]?.name ?? '')} • ${album.releaseDate?.slice(0, 4) ?? ''}</span>
      </div>
    `;
        card.addEventListener('click', () => onClick(album));
        container.appendChild(card);
    });
}

// ─── Track List (Trending Tracks / New Tracks / Spotlighted Uploads) ─────────

/**
 * Renders a list of track rows.
 * @param {HTMLElement} container
 * @param {Array} tracks
 * @param {Function} onClick  (track) => void
 */
export function renderTrackList(container, tracks, onClick) {
    container.innerHTML = '';
    if (!tracks.length) {
        container.closest('.home-section')?.style.setProperty('display', 'none');
        return;
    }
    container.closest('.home-section')?.style.setProperty('display', '');

    tracks.forEach((track, i) => {
        const row = document.createElement('div');
        row.className = 'track-row';
        row.dataset.id = track.id;
        row.innerHTML = `
      <span class="track-row__num">${i + 1}</span>
      <div class="track-row__art">
        <img src="${coverUrl(track.album?.cover ?? track.cover, 80)}"
             alt="" loading="lazy" onerror="this.src='/assets/placeholder.png'"/>
      </div>
      <div class="track-row__info">
        <span class="track-row__title">${esc(track.title)} ${qualityBadges(track)}</span>
        <span class="track-row__sub">${esc(track.artist?.name ?? track.artists?.[0]?.name ?? '')} • ${track.album?.title ? esc(track.album.title) : ''}</span>
      </div>
      <span class="track-row__duration">${formatDuration(track.duration)}</span>
    `;
        row.addEventListener('click', () => onClick(track));
        container.appendChild(row);
    });
}

// ─── Playlist Row (Featured Playlists / From Our Editors) ─

/**
 * Renders a horizontally-scrollable row of playlist cards.
 * @param {HTMLElement} container
 * @param {Array} playlists
 * @param {Function} onClick  (playlist) => void
 */
export function renderPlaylistRow(container, playlists, onClick) {
    container.innerHTML = '';
    if (!playlists.length) {
        container.closest('.home-section')?.style.setProperty('display', 'none');
        return;
    }
    container.closest('.home-section')?.style.setProperty('display', '');

    playlists.forEach((pl) => {
        const card = document.createElement('div');
        card.className = 'album-card'; // reuse same card style
        card.dataset.id = pl.uuid ?? pl.id;
        card.dataset.type = 'playlist';
        card.innerHTML = `
      <div class="album-card__art">
        <img src="${coverUrl(pl.squareImage ?? pl.image)}"
             alt="${esc(pl.title)}" loading="lazy"
             onerror="this.src='/assets/placeholder.png'"/>
        <button class="album-card__play" aria-label="Play ${esc(pl.title)}">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <div class="album-card__meta">
        <span class="album-card__title">${esc(pl.title)}</span>
        <span class="album-card__sub">${pl.numberOfTracks ?? 0} tracks</span>
      </div>
    `;
        card.addEventListener('click', () => onClick(pl));
        container.appendChild(card);
    });
}

// ─── Skeleton Loader ──────────────────────────────────────────────────────────

/**
 * Show skeleton loaders while content is loading
 */
export function showSkeletons(container, count = 6, type = 'card') {
    container.innerHTML = Array.from({ length: count }, () =>
        type === 'track'
            ? `<div class="skeleton-track">
           <div class="skeleton skeleton--square" style="width:44px;height:44px;border-radius:4px"></div>
           <div style="flex:1;display:flex;flex-direction:column;gap:6px">
             <div class="skeleton" style="height:12px;width:70%"></div>
             <div class="skeleton" style="height:10px;width:45%"></div>
           </div>
         </div>`
            : `<div class="skeleton-card">
           <div class="skeleton" style="aspect-ratio:1;border-radius:6px"></div>
           <div class="skeleton" style="height:12px;width:80%;margin-top:8px"></div>
           <div class="skeleton" style="height:10px;width:55%;margin-top:6px"></div>
         </div>`
    ).join('');
}

/**
 * Hide all home sections
 */
export function hideHomeSections() {
    const sectionIds = [
        'section-genres',
        'section-trending-albums',
        'section-trending-tracks',
        'section-featured-playlists',
        'section-new-tracks',
        'section-new-albums',
        'section-spotlighted-uploads',
        'section-from-editors',
    ];

    sectionIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

/**
 * Show all home sections
 */
export function showHomeSections() {
    const sectionIds = [
        'section-genres',
        'section-trending-albums',
        'section-trending-tracks',
        'section-featured-playlists',
        'section-new-tracks',
        'section-new-albums',
        'section-spotlighted-uploads',
        'section-from-editors',
    ];

    sectionIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
    });
}
