// js/accounts/auth.js
import { account } from '../lib/appwrite.js';
import { Account, Client, ID } from 'appwrite';

const OAUTH_ATTEMPT_KEY = 'mono-oauth-attempt';
const OAUTH_ATTEMPT_MAX_AGE_MS = 2 * 60 * 1000;
const APPWRITE_PROJECT_ID = 'monochrome-plus';
const APPWRITE_OAUTH_FALLBACK_ENDPOINTS = ['https://cloud.appwrite.io/v1', 'https://sgp.cloud.appwrite.io/v1'];
const DEFAULT_OAUTH_REDIRECT_URL = 'https://monochrome-plus.appwrite.network';
const DESKTOP_OAUTH_REDIRECT_FALLBACK_URLS = [DEFAULT_OAUTH_REDIRECT_URL];

function isHttpUrl(value) {
    return /^https?:\/\//i.test(value || '');
}

function appendUniqueUrl(target, value) {
    if (!isHttpUrl(value)) return;
    if (!target.includes(value)) {
        target.push(value);
    }
}

function isDesktopTauriContext() {
    if (typeof window === 'undefined') return false;

    if (window.__MONOCHROME_FORCE_TAURI__ === true) return true;

    if (window.__TAURI_INTERNALS__ || window.__TAURI__ || window.__TAURI_IPC__) {
        return true;
    }

    return /\btauri\b/i.test(navigator.userAgent || '');
}

function getOAuthRedirectUrls() {
    const origin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
    const redirects = [];

    appendUniqueUrl(redirects, origin);

    if (isDesktopTauriContext()) {
        for (const fallbackUrl of DESKTOP_OAUTH_REDIRECT_FALLBACK_URLS) {
            appendUniqueUrl(redirects, fallbackUrl);
        }

        return redirects.length ? redirects : [DEFAULT_OAUTH_REDIRECT_URL];
    }

    return redirects.length ? redirects : [DEFAULT_OAUTH_REDIRECT_URL];
}

async function createOAuthSessionWithFallback(provider, redirectUrls) {
    const endpointCandidates = [null, ...APPWRITE_OAUTH_FALLBACK_ENDPOINTS];
    const redirectCandidates = Array.isArray(redirectUrls) ? redirectUrls : [redirectUrls];

    for (const redirectUrl of redirectCandidates) {
        for (const endpoint of endpointCandidates) {
            try {
                if (!endpoint) {
                    await account.createOAuth2Session(provider, redirectUrl, redirectUrl);
                    console.log(
                        `[Appwrite] ${provider} login initiated (primary endpoint, redirect: ${redirectUrl})...`
                    );
                    return;
                }

                const fallbackClient = new Client().setEndpoint(endpoint).setProject(APPWRITE_PROJECT_ID);
                const fallbackAccount = new Account(fallbackClient);
                await fallbackAccount.createOAuth2Session(provider, redirectUrl, redirectUrl);
                console.log(
                    `[Appwrite] ${provider} login initiated (fallback endpoint: ${endpoint}, redirect: ${redirectUrl})...`
                );
                return;
            } catch (error) {
                console.warn(
                    `[Appwrite] ${provider} OAuth endpoint failed${endpoint ? ` (${endpoint})` : ''} with redirect ${redirectUrl}:`,
                    error?.message || error
                );
            }
        }
    }

    throw new Error(`${provider} OAuth is temporarily unavailable. Please retry in a moment or use Email sign-in.`);
}

export class AuthManager {
    constructor() {
        this.user = null;
        this.authListeners = [];
        this.initialized = this.init();
    }

    async _refreshUser() {
        const user = await account.get();
        this.user = user;
        this.updateUI(user);
        this.authListeners.forEach((listener) => listener(user));
        return user;
    }

    async init() {
        try {
            // Check for existing session (persistent auth)
            const user = await account.get();
            this.user = user;
            console.log(
                '[Appwrite] ✓ Authentication successful. Session restored:',
                user.email || user.name || user.$id
            );
            this.updateUI(user);
            this.authListeners.forEach((listener) => listener(user));

            localStorage.removeItem(OAUTH_ATTEMPT_KEY);
        } catch {
            console.log('[Appwrite] Info: No active session found on initialization');
            this.user = null; // Explicitly null
            this.updateUI(null);
            this.authListeners.forEach((listener) => listener(null));

            try {
                const rawAttempt = localStorage.getItem(OAUTH_ATTEMPT_KEY);
                if (!rawAttempt) return;

                const attempt = JSON.parse(rawAttempt);
                const age = Date.now() - Number(attempt?.ts || 0);
                if (age <= OAUTH_ATTEMPT_MAX_AGE_MS && attempt?.provider) {
                    window.dispatchEvent(
                        new CustomEvent('auth-oauth-blocked', {
                            detail: {
                                provider: attempt.provider,
                            },
                        })
                    );
                }
            } catch {
                // Ignore malformed localStorage payloads
            } finally {
                localStorage.removeItem(OAUTH_ATTEMPT_KEY);
            }
        }
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        // Trigger immediately so caller knows current state (even if Guest)
        callback(this.user);
    }

    async signInWithGoogle() {
        try {
            const redirectUrls = getOAuthRedirectUrls();
            localStorage.setItem(OAUTH_ATTEMPT_KEY, JSON.stringify({ provider: 'google', ts: Date.now() }));
            await createOAuthSessionWithFallback('google', redirectUrls);
        } catch (error) {
            console.error('[Appwrite] ✗ Google login failed:', error);
            localStorage.removeItem(OAUTH_ATTEMPT_KEY);
            throw error;
        }
    }

    async signInWithDiscord() {
        try {
            const redirectUrls = getOAuthRedirectUrls();
            localStorage.setItem(OAUTH_ATTEMPT_KEY, JSON.stringify({ provider: 'discord', ts: Date.now() }));
            await createOAuthSessionWithFallback('discord', redirectUrls);
        } catch (error) {
            console.error('[Appwrite] ✗ Discord login failed after fallback attempts:', error);
            localStorage.removeItem(OAUTH_ATTEMPT_KEY);
            throw error;
        }
    }

    async signInWithEmail(email, password) {
        try {
            await account.createEmailPasswordSession(email, password);
            const user = await this._refreshUser();
            console.log('[Appwrite] ✓ Email login successful:', user.email);
            return user;
        } catch (error) {
            console.error('Email Login failed:', error);
            throw error;
        }
    }

    async signUpWithEmail(email, password) {
        try {
            await account.create(ID.unique(), email, password);
            // Sign in automatically after sign up
            return await this.signInWithEmail(email, password);
        } catch (error) {
            console.error('Sign Up failed:', error);
            throw error;
        }
    }

    async sendPasswordReset(email) {
        try {
            const redirectUrl = window.location.origin + '/reset-password';
            await account.createRecovery(email, redirectUrl);
            return true;
        } catch (error) {
            console.error('Password reset failed:', error);
            throw error;
        }
    }

    async signOut() {
        try {
            await account.deleteSession('current');
            this.user = null;
            console.log('[Appwrite] ✓ Signed out successfully');
            this.updateUI(null);
            this.authListeners.forEach((listener) => listener(null));

            if (window.__AUTH_GATE__) {
                window.location.href = '/login';
            }
        } catch (error) {
            console.error('Logout failed:', error);
            throw error;
        }
    }

    updateUI(user) {
        const connectBtn = document.getElementById('auth-signout-btn');
        const clearDataBtn = document.getElementById('firebase-clear-cloud-btn');
        const statusText = document.getElementById('auth-status');
        const authMethodsContainer = document.getElementById('auth-buttons-container');
        const authPanel = document.getElementById('auth-panel');
        const userBadge = document.getElementById('auth-user-pill');
        const viewProfileBtn = document.getElementById('view-my-profile-btn');

        if (!statusText) return; // UI might not be rendered yet

        if (!user) {
            if (connectBtn) {
                connectBtn.style.display = 'none';
                connectBtn.classList.remove('danger');
                connectBtn.onclick = null;
            }
            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (statusText) statusText.textContent = 'Authentication required to sync and personalize your experience.';
            if (authMethodsContainer) authMethodsContainer.style.display = '';
            if (authPanel) authPanel.classList.remove('signed-in');
            if (userBadge) userBadge.style.display = 'none';
            if (viewProfileBtn) viewProfileBtn.style.display = 'none';
        } else {
            if (connectBtn) {
                connectBtn.textContent = 'Sign Out';
                connectBtn.style.display = 'inline-flex';
                connectBtn.classList.add('danger');
                connectBtn.onclick = () => this.signOut();
            }

            if (clearDataBtn) clearDataBtn.style.display = 'block';
            if (authMethodsContainer) authMethodsContainer.style.display = 'none';
            if (authPanel) authPanel.classList.add('signed-in');
            if (userBadge) {
                userBadge.style.display = 'inline-flex';
                userBadge.textContent = user.email || user.phone || user.name || user.$id;
            }
            if (viewProfileBtn) viewProfileBtn.style.display = 'inline-flex';
            if (statusText)
                statusText.textContent = `Signed in as ${user.email || user.phone || user.name || user.$id}`;
        }

        // Auth gate active: strip down to status + sign out only
        if (window.__AUTH_GATE__) {
            if (connectBtn) {
                connectBtn.textContent = 'Sign Out';
                connectBtn.classList.add('danger');
                connectBtn.style.display = user ? 'inline-flex' : 'none';
                connectBtn.onclick = () => this.signOut();
            }
            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (authMethodsContainer) authMethodsContainer.style.display = user ? 'none' : '';
            if (statusText)
                statusText.textContent = user
                    ? `Signed in as ${user.email || user.phone || user.name || user.$id}`
                    : 'Authentication required to sync and personalize your experience.';
            return;
        }
    }
}

export const authManager = new AuthManager();
window.authManager = authManager;
