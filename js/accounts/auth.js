// js/accounts/auth.js
import { client, account } from '../lib/appwrite.js';
import { ID } from 'appwrite';

export class AuthManager {
    constructor() {
        this.user = null;
        this.authListeners = [];
        this.initialized = this.init();
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
        } catch (error) {
            console.log('[Appwrite] Info: No active session found on initialization');
            this.user = null; // Explicitly null
            this.updateUI(null);
            this.authListeners.forEach((listener) => listener(null));
        }
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        // Trigger immediately so caller knows current state (even if Guest)
        callback(this.user);
    }

    async signInWithDiscord() {
        try {
            // Use current URL as redirect
            const redirectUrl = window.location.origin;
            await account.createOAuth2Session('discord', redirectUrl, redirectUrl);
            console.log('[Appwrite] Discord login initiated...');
        } catch (error) {
            console.error('[Appwrite] ✗ Discord login failed:', error);
            alert(`Discord login failed: ${error.message}`);
            throw error;
        }
    }

    async signInWithEmail(email, password) {
        try {
            const result = await account.createEmailPasswordSession(email, password);
            const user = await account.get();
            this.user = user;
            console.log('[Appwrite] ✓ Email login successful:', user.email);
            this.updateUI(user);
            this.authListeners.forEach((listener) => listener(user));
            return user;
        } catch (error) {
            console.error('Email Login failed:', error);
            alert(`Login failed: ${error.message}`);
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
            alert(`Sign Up failed: ${error.message}`);
            throw error;
        }
    }

    async sendPasswordReset(email) {
        try {
            const redirectUrl = window.location.origin + '/reset-password';
            await account.createRecovery(email, redirectUrl);
            alert(`Password reset instructions sent to ${email}`);
        } catch (error) {
            console.error('Password reset failed:', error);
            alert(`Failed to send reset email: ${error.message}`);
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
        const connectBtn = document.getElementById('discord-connect-btn');
        const clearDataBtn = document.getElementById('firebase-clear-cloud-btn');
        const statusText = document.getElementById('auth-status');
        const emailContainer = document.getElementById('email-auth-container');
        const emailToggleBtn = document.getElementById('toggle-email-auth-btn');

        if (!connectBtn) return; // UI might not be rendered yet

        if (!user) {
            connectBtn.textContent = 'Connect with Discord';
            connectBtn.classList.remove('danger');
            connectBtn.onclick = () => this.signInWithDiscord();

            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'inline-block';
            if (statusText) statusText.textContent = 'Sync your library across devices';
        } else {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();

            if (clearDataBtn) clearDataBtn.style.display = 'block';
            if (emailContainer) emailContainer.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'none';

            if (statusText) statusText.textContent = `Signed in as ${user.email || user.name}`;
        }

        // Auth gate active: strip down to status + sign out only
        if (window.__AUTH_GATE__) {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();
            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailContainer) emailContainer.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'none';
            if (statusText) statusText.textContent = user ? `Signed in as ${user.email || user.name}` : 'Signed in';

            // Account page: clean up unnecessary text
            const accountPage = document.getElementById('page-account');
            if (accountPage) {
                const title = accountPage.querySelector('.section-title');
                if (title) title.textContent = 'Account';
                // Hide description + privacy paragraphs, keep only status
                accountPage.querySelectorAll('.account-content > p, .account-content > div').forEach((el) => {
                    if (el.id !== 'firebase-status' && el.id !== 'auth-buttons-container') {
                        el.style.display = 'none';
                    }
                });
            }
            return;
        }
    }
}

export const authManager = new AuthManager();
window.authManager = authManager;
