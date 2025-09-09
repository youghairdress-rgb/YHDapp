/**
 * @file auth.js
 * @description Manages LIFF initialization and Firebase custom token authentication.
 */
// Firebase SDKs are NOT imported here. This module only deals with LIFF.

const authManager = {
    liffId: null,
    idToken: null,
    profile: null,
    isAdminApp: false,

    /**
     * Initializes the LIFF app and handles the login flow.
     * @param {boolean} isAdmin - True if initializing the admin LIFF app.
     * @returns {Promise<boolean>} True if authentication is successful, false otherwise.
     */
    async init(isAdmin = false) {
        this.isAdminApp = isAdmin;
        this.liffId = this.isAdminApp ? '2008029428-ANbgw3b6' : '2008029428-GNNaR1Nm';
        
        console.log(`[Auth] Initializing with LIFF ID: ${this.liffId}`);
        const loadingMessage = document.getElementById('loading-message');

        try {
            await liff.init({ liffId: this.liffId });

            if (!liff.isLoggedIn()) {
                loadingMessage.textContent = 'LINEログインを開始します...';
                liff.login({ redirectUri: window.location.href });
                return false; // Stop execution until redirect
            }

            console.log('[Auth] LIFF login successful. Getting ID token...');
            loadingMessage.textContent = 'アカウント情報を連携中...';
            this.idToken = liff.getIDToken();

            if (!this.idToken) {
                throw new Error("LINEのIDトークンが取得できませんでした。");
            }
            console.log('[Auth] LIFF ID Token obtained.');

            this.profile = await liff.getProfile();
            console.log('[Auth] LIFF Profile obtained.');

            return true;

        } catch (error) {
            console.error('[Auth] Initialization failed:', error);
            const errorElement = document.getElementById('error-message') || loadingMessage;
            errorElement.textContent = `認証エラー: ${error.message}。ページを再読み込みしてください。`;
            return false;
        }
    },

    /**
     * Returns the stored ID token.
     * @returns {string|null} The LIFF ID token.
     */
    getToken() {
        return this.idToken;
    },

    /**
     * Returns the stored user profile.
     * @returns {object|null} The LIFF user profile object.
     */
    getProfile() {
        return this.profile;
    },
};

export { authManager };

