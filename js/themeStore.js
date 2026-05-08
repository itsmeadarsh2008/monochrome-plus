import { databases, Query, ID } from './lib/appwrite.js';
import { syncManager } from './accounts/appwrite-sync.js';
import { authManager } from './accounts/auth.js';
import { SVG_BIN, SVG_SQUARE_PEN } from './icons.js';

const THEMES_PER_PAGE = 50;
const DATABASE_ID = 'monochrome-plus';
const THEMES_COLLECTION = 'DB_themes';

const GENERIC_FONT_FAMILIES = [
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'inter',
    'ibm plex mono',
    'roboto',
    'open sans',
    'lato',
    'montserrat',
    'poppins',
    'apple music',
    'sf pro display',
    'courier new',
    'times new roman',
    'arial',
    'helvetica',
    'verdana',
    'tahoma',
    'trebuchet ms',
    'impact',
    'gill sans',
];

export class ThemeStore {
    constructor() {
        this.modal = document.getElementById('theme-store-modal');
        this.grid = document.getElementById('community-themes-grid');
        this.uploadForm = document.getElementById('theme-upload-form');
        this.searchInput = document.getElementById('theme-store-search');
        this.loadingIndicator = document.getElementById('theme-store-loading');
        this._isCheckingAuth = false;
        this.editingThemeId = null;
        this.init();
    }

    init() {
        document.getElementById('open-theme-store-btn')?.addEventListener('click', () => {
            this.modal.classList.add('active');
            this.loadThemes();
        });

        this.modal?.querySelector('.close-modal-btn')?.addEventListener('click', () => {
            this.modal.classList.remove('active');
        });

        const tabs = this.modal?.querySelectorAll('.search-tab');
        tabs?.forEach((tab) => {
            tab.addEventListener('click', () => {
                tabs.forEach((t) => t.classList.remove('active'));
                this.modal.querySelectorAll('.search-tab-content').forEach((c) => c.classList.remove('active'));
                tab.classList.add('active');
                const contentId = tab.dataset.tab === 'browse' ? 'theme-store-browse' : 'theme-store-upload';
                document.getElementById(contentId)?.classList.add('active');
                if (tab.dataset.tab === 'upload') {
                    this.checkAuth();
                } else {
                    this.resetEditState();
                }
            });
        });

        let debounceTimer;
        this.searchInput?.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.loadThemes(e.target.value), 300);
        });

        this.uploadForm?.addEventListener('submit', (e) => this.handleUpload(e));

        if (authManager) {
            authManager.onAuthStateChanged(() => {
                if (this.modal.classList.contains('active')) {
                    this.checkAuth();
                }
            });
        }

        document.getElementById('theme-store-login-btn')?.addEventListener('click', () => {
            this.modal.classList.remove('active');
            document.getElementById('email-auth-modal')?.classList.add('active');
        });

        document.getElementById('theme-upload-cancel-edit')?.addEventListener('click', () => {
            this.resetEditState();
        });

        this.applySavedTheme();
    }

    applySavedTheme() {
        const theme = localStorage.getItem('monochrome-theme');
        const css = localStorage.getItem('custom_theme_css');
        if (theme === 'custom' && css) {
            const metadataStr = localStorage.getItem('community-theme');
            let metadata = null;
            if (metadataStr) {
                try {
                    metadata = JSON.parse(metadataStr);
                } catch (e) {
                    console.warn(e);
                }
            }

            if (metadata) {
                this.applyTheme({
                    css: css,
                    id: metadata.id,
                    name: metadata.name,
                    authorName: metadata.author,
                });
            } else {
                this.applyTheme(css);
            }
        }
    }

    async loadThemes(query = '') {
        if (!this.grid) return;
        this.grid.innerHTML = '';
        this.loadingIndicator.style.display = 'block';

        let currentUserId = null;
        if (authManager.user) {
            try {
                const record = await syncManager._getUserRecord();
                currentUserId = record?.$id;
            } catch (e) {
                console.warn('Failed to resolve user ID for theme ownership check', e);
            }
        }

        try {
            const queries = [Query.orderDesc('$createdAt'), Query.limit(THEMES_PER_PAGE)];

            if (query) {
                queries.push(Query.or([Query.search('name', query), Query.search('description', query)]));
            }

            const result = await databases.listDocuments(DATABASE_ID, THEMES_COLLECTION, queries);

            this.loadingIndicator.style.display = 'none';
            if (result.documents.length === 0) {
                this.grid.innerHTML = '<div class="empty-state">No themes found.</div>';
                return;
            }

            result.documents.forEach((theme) => {
                this.grid.appendChild(this.createThemeCard(theme, currentUserId));
            });
        } catch (err) {
            console.error('Failed to load themes:', err);
            // Fallback for missing collection / errors
            this.loadingIndicator.style.display = 'none';
            this.grid.innerHTML =
                '<div class="empty-state">Failed to load themes. (Check if DB_themes collection exists)</div>';
        }
    }

    createThemeCard(theme, currentUserId) {
        const div = document.createElement('div');
        div.className = 'card theme-card';

        const authorName = theme.authorName || 'Unknown';

        const shortDesc = theme.description
            ? theme.description.length > 80
                ? theme.description.substring(0, 80) + '...'
                : theme.description
            : '';

        let authorHtml = this.escapeHtml(authorName);
        if (theme.authorUrl) {
            authorHtml = `<a href="${this.escapeHtml(theme.authorUrl)}" target="_blank" style="color: inherit; text-decoration: underline;" onclick="event.stopPropagation();">${this.escapeHtml(authorName)}</a>`;
        }

        let actionBtnsHtml = '';
        if (currentUserId && theme.author === currentUserId) {
            actionBtnsHtml = `
                <div style="position: absolute; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.25rem; z-index: 10;">
                    <button class="btn-icon edit-theme-btn" title="Edit Theme" style="background: rgba(0,0,0,0.6); color: white; border-radius: 50%; padding: 0.25rem; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer;">
                        ${SVG_SQUARE_PEN(14)}
                    </button>
                    <button class="btn-icon delete-theme-btn" title="Delete Theme" style="background: rgba(0,0,0,0.6); color: white; border-radius: 50%; padding: 0.25rem; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer;">
                        ${SVG_BIN}
                    </button>
                </div>`;
        }

        div.innerHTML = `
            ${actionBtnsHtml}
            <div class="theme-card-preview" style="background: #111; height: 100px; border-radius: 6px; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative;">
                <div class="theme-preview-colors" style="display: flex; gap: 0.5rem;">
                    <div style="width: 20px; height: 20px; border-radius: 50%; background: var(--primary, #fff); border: 1px solid rgba(255,255,255,0.1);"></div>
                    <div style="width: 20px; height: 20px; border-radius: 50%; background: var(--secondary, #222); border: 1px solid rgba(255,255,255,0.1);"></div>
                </div>
                <div style="position: absolute; bottom: 0.25rem; right: 0.25rem; font-size: 10px; opacity: 0.5;">Preview not available</div>
            </div>
            <div class="theme-card-info">
                <h4 style="margin: 0 0 0.25rem 0; font-size: 1.1rem;">${this.escapeHtml(theme.name)}</h4>
                <div style="font-size: 0.85rem; opacity: 0.6; margin-bottom: 0.5rem;">by ${authorHtml}</div>
                <p style="font-size: 0.9rem; margin: 0; line-height: 1.4; opacity: 0.8; height: 3.8em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">
                    ${this.escapeHtml(shortDesc)}
                </p>
                <div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                    <button class="btn-primary apply-theme-btn" style="flex: 1; padding: 0.5rem; font-size: 0.9rem;">Apply</button>
                    <button class="btn-secondary details-theme-btn" style="padding: 0.5rem 0.75rem; font-size: 0.9rem;">Details</button>
                </div>
            </div>`;

        div.querySelector('.apply-theme-btn').addEventListener('click', () => {
            this.applyTheme({
                css: theme.css,
                id: theme.$id,
                name: theme.name,
                authorName: authorName,
            });
            alert(`Theme "${theme.name}" applied!`);
        });

        div.querySelector('.details-theme-btn').addEventListener('click', () => {
            this.showThemeDetails(theme);
        });

        const editBtn = div.querySelector('.edit-theme-btn');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startEditTheme(theme);
            });
        }

        const deleteBtn = div.querySelector('.delete-theme-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteTheme(theme.$id);
            });
        }

        return div;
    }

    showThemeDetails(theme) {
        const modal = document.getElementById('theme-details-modal');
        if (!modal) return;

        modal.querySelector('.theme-details-name').textContent = theme.name;
        modal.querySelector('.theme-details-author').textContent = `by ${theme.authorName || 'Unknown'}`;
        modal.querySelector('.theme-details-description').textContent = theme.description || 'No description provided.';
        modal.querySelector('.theme-details-css-code').textContent = theme.css;

        modal.classList.add('active');

        modal.querySelector('.apply-details-btn').onclick = () => {
            this.applyTheme({
                css: theme.css,
                id: theme.$id,
                name: theme.name,
                authorName: theme.authorName,
            });
            modal.classList.remove('active');
            alert(`Theme "${theme.name}" applied!`);
        };

        modal.querySelector('.close-details-btn').onclick = () => {
            modal.classList.remove('active');
        };
    }

    applyTheme(themeData) {
        let css, id, name, authorName;
        if (typeof themeData === 'string') {
            css = themeData;
        } else {
            ({ css, id, name, authorName } = themeData);
        }

        let styleEl = document.getElementById('monochrome-dynamic-theme');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'monochrome-dynamic-theme';
            document.head.appendChild(styleEl);
        }

        // Handle fonts if present in CSS
        const fontMatch = css.match(/--font-family:\s*([^;}]+)/);
        const urlMatch = css.match(/--font-url:\s*([^;}]+)/);

        if (fontMatch && fontMatch[1]) {
            const fontFamilyValue = fontMatch[1].trim();
            const mainFont = fontFamilyValue.split(',')[0].trim().replace(/['"]/g, '');
            const isPresetOrGeneric = GENERIC_FONT_FAMILIES.some((g) => mainFont.toLowerCase() === g);

            if (!isPresetOrGeneric) {
                const FONT_LINK_ID = 'monochrome-dynamic-font';
                let link = document.getElementById(FONT_LINK_ID);

                if (urlMatch && urlMatch[1]) {
                    const customUrl = urlMatch[1].trim().replace(/['"]/g, '');
                    if (customUrl.match(/\.(css)$/i) || customUrl.includes('fonts.googleapis.com')) {
                        if (!link) {
                            link = document.createElement('link');
                            link.id = FONT_LINK_ID;
                            link.rel = 'stylesheet';
                            document.head.appendChild(link);
                        }
                        link.href = customUrl;
                    } else {
                        if (link) link.remove();
                        const fontFace = `\n@font-face {\n    font-family: '${mainFont}';\n    src: url('${customUrl}');\n    font-weight: 100 900;\n    font-display: swap;\n}\n`;
                        css = fontFace + css;
                    }
                } else {
                    const encodedFamily = encodeURIComponent(mainFont);
                    const url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@100;200;300;400;500;600;700;800;900&display=swap`;
                    if (!link) {
                        link = document.createElement('link');
                        link.id = FONT_LINK_ID;
                        link.rel = 'stylesheet';
                        document.head.appendChild(link);
                    }
                    link.href = url;
                }
            }
        }

        styleEl.textContent = css;

        const root = document.documentElement;
        ['background', 'foreground', 'primary', 'secondary', 'muted', 'border', 'highlight', 'font-family'].forEach(
            (key) => {
                root.style.removeProperty(`--${key}`);
            }
        );
        root.setAttribute('data-theme', 'custom');

        document.querySelectorAll('.theme-option').forEach((el) => el.classList.remove('active'));
        document.querySelector('[data-theme="custom"]')?.classList.add('active');

        // Persistence
        localStorage.setItem('monochrome-theme', 'custom');
        localStorage.setItem('custom_theme_css', css);
        if (id) {
            localStorage.setItem('community-theme', JSON.stringify({ id, name, author: authorName }));
        } else {
            localStorage.removeItem('community-theme');
        }

        window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: 'custom' } }));
    }

    async handleUpload(e) {
        e.preventDefault();
        if (!authManager.user) {
            alert('You must be logged in to upload themes.');
            return;
        }

        const name = document.getElementById('theme-upload-name').value;
        const desc = document.getElementById('theme-upload-desc').value;
        const css = document.getElementById('theme-upload-css').value;
        const website = document.getElementById('theme-upload-website')?.value;

        if (!name || !css) {
            alert('Please fill in at least the theme name and CSS.');
            return;
        }

        try {
            const userRecord = await syncManager._getUserRecord();
            const userId = userRecord.$id;
            const userName = userRecord.username || userRecord.display_name || authManager.user.name;

            const payload = {
                name,
                description: desc,
                css,
                author: userId,
                authorName: userName,
                authorUrl: website || '',
            };

            if (this.editingThemeId) {
                await databases.updateDocument(DATABASE_ID, THEMES_COLLECTION, this.editingThemeId, payload);
                alert('Theme updated successfully!');
            } else {
                await databases.createDocument(DATABASE_ID, THEMES_COLLECTION, ID.unique(), payload);
                alert('Theme uploaded successfully!');
            }

            this.resetEditState();
            this.modal.querySelector('[data-tab="browse"]').click();
            this.loadThemes();
        } catch (err) {
            console.error('Theme upload failed:', err);
            alert(`Failed to upload theme: ${err.message}`);
        }
    }

    async deleteTheme(id) {
        if (!confirm('Are you sure you want to delete this theme?')) return;
        try {
            await databases.deleteDocument(DATABASE_ID, THEMES_COLLECTION, id);
            alert('Theme deleted!');
            this.loadThemes();
        } catch (err) {
            console.error('Delete failed:', err);
            alert('Failed to delete theme.');
        }
    }

    startEditTheme(theme) {
        this.editingThemeId = theme.$id;
        document.getElementById('theme-upload-name').value = theme.name;
        document.getElementById('theme-upload-desc').value = theme.description || '';
        document.getElementById('theme-upload-css').value = theme.css;
        if (document.getElementById('theme-upload-website')) {
            document.getElementById('theme-upload-website').value = theme.authorUrl || '';
        }

        document.getElementById('theme-upload-submit').textContent = 'Update Theme';
        document.getElementById('theme-upload-cancel-edit').style.display = 'block';

        this.modal.querySelector('[data-tab="upload"]').click();
    }

    resetEditState() {
        this.editingThemeId = null;
        this.uploadForm.reset();
        document.getElementById('theme-upload-submit').textContent = 'Upload Theme';
        document.getElementById('theme-upload-cancel-edit').style.display = 'none';
    }

    async checkAuth() {
        if (this._isCheckingAuth) return;
        this._isCheckingAuth = true;

        const isLoggedIn = !!authManager?.user;
        const authMessage = document.getElementById('theme-upload-auth-message');
        const form = document.getElementById('theme-upload-form');

        if (isLoggedIn) {
            authMessage.style.display = 'none';
            form.style.display = 'block';
        } else {
            authMessage.style.display = 'block';
            form.style.display = 'none';
        }
        this._isCheckingAuth = false;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
