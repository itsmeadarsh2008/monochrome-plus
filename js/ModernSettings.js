// js/ModernSettings.js
import { db } from './db.js';

/**
 * A dynamically typed settings container that lazily loads and persists values.
 * Properties are added via addProperty and automatically persisted to db.
 */
class ModernSettings {
    #pending = {};
    #finalized = false;

    constructor() {}

    /**
     * Waits until all pending asynchronous operations (initial load, writes) complete.
     */
    async waitPending() {
        while (true) {
            const promises = Object.getOwnPropertySymbols(this.#pending).map((s) => this.#pending[s]);
            if (promises.length) {
                await Promise.all(promises);
            } else {
                break;
            }
        }
    }

    /**
     * Tracks a promise as a pending operation.
     */
    #addPending(callback) {
        const sym = Symbol();
        const promise = callback().finally(() => {
            delete this.#pending[sym];
        });
        this.#pending[sym] = promise;
        return promise;
    }

    #checkKey(key) {
        if (this.#finalized) throw new Error("Can't add a key after finalization.");
        if (Object.keys(this).includes(key)) throw new Error("Can't add a key that already exists.");
    }

    /**
     * Registers a new property.
     * @param {string} key - Property name
     * @param {*} defaultValue - Fallback value
     * @param {Object} options - configuration options (getter, setter, legacy migration)
     */
    addProperty(key, defaultValue, options = {}) {
        const { backingKey, getter, setter, legacy } = options;
        this.#checkKey(key);

        let value = defaultValue;
        const storageKey = backingKey ?? key;

        this.#addPending(async () => {
            // Handle legacy migration from localStorage
            if (legacy?.transformer != null) {
                const legacyKey = legacy.key ?? storageKey;
                const legacyValue = localStorage.getItem(legacyKey);
                if (legacyValue !== null) {
                    const transformed = legacy.transformer(legacyValue);
                    await db.saveSetting(storageKey, transformed);
                    localStorage.removeItem(legacyKey);
                }
            }

            try {
                const stored = await db.getSetting(storageKey);
                if (stored !== undefined && stored !== null) {
                    value = stored;
                }
            } catch (e) {
                console.warn(`Failed to lead setting ${storageKey}:`, e);
            }
        });

        Object.defineProperty(this, key, {
            get: () => (getter ? getter(value, this) : value),
            set: (newValue) => {
                value = setter ? setter(newValue, this) : newValue;
                this.#addPending(() => db.saveSetting(storageKey, value));
            },
            enumerable: true,
            configurable: true,
        });

        return this;
    }

    /**
     * Prevents further property additions.
     */
    finalize() {
        this.#finalized = true;
        return this;
    }
}

export const BulkDownloadMethod = {
    Zip: 'zip',
    Folder: 'folder',
    Individual: 'individual',
    LocalMedia: 'local',
};

export const modernSettings = new ModernSettings()
    .addProperty('bulkDownloadFolder', null)
    .addProperty('forceZipBlob', false, {
        legacy: { key: 'bulk-download-force-zip-blob', transformer: (v) => v === 'true' },
    })
    .addProperty('rememberBulkDownloadFolder', false, {
        legacy: { key: 'bulk-download-remember-folder', transformer: (v) => v === 'true' },
    })
    .addProperty('downloadSinglesToFolder', false, {
        legacy: { key: 'bulk-download-single-to-folder', transformer: (v) => v === 'true' },
    })
    .addProperty('force-individual-downloads', false, {
        legacy: { transformer: (v) => v === 'true' },
    })
    .addProperty('bulkDownloadMethod', BulkDownloadMethod.Zip, {
        getter: (stored, settings) => {
            if (stored && Object.values(BulkDownloadMethod).includes(stored)) return stored;
            if (settings['force-individual-downloads']) {
                settings['force-individual-downloads'] = false;
                return (settings.bulkDownloadMethod = BulkDownloadMethod.Individual);
            }
            return BulkDownloadMethod.Zip;
        },
    })
    .addProperty('folderTemplate', '', {
        getter: (stored) => stored || '{albumTitle} - {albumArtist}',
        legacy: { key: 'zip-folder-template', transformer: String },
    })
    .addProperty('filenameTemplate', '', {
        getter: (stored) => stored || '{trackNumber} - {artist} - {title}',
        legacy: { key: 'filename-template', transformer: String },
    })
    .finalize();
