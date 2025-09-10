import * as api from './api.js';

// このモジュールは、LIFFとFirebaseの認証ロジックを一元管理します。
const authManager = {
    liff: null,
    profile: null,
    idToken: null,
    isAdmin: false,

    /**
     * LIFFアプリを初期化し、LINEで認証し、Firebaseにサインインします。
     * @param {function} onReady - 初期化成功後に実行するコールバック関数。
     * @param {boolean} isAdmin - 管理者コンソール用のフラグ。
     */
    async init(onReady, isAdmin = false) {
        this.isAdmin = isAdmin;
        const loadingMessage = document.getElementById('loading-message');
        if (!loadingMessage) {
            console.error("Loading message element not found.");
            return;
        }

        try {
            console.log(`[Auth] Initializing with LIFF... (isAdmin: ${this.isAdmin})`);
            
            // バックエンドからLIFF IDを取得
            const config = await api.getPublicConfig();
            const liffId = this.isAdmin ? config.adminLiffId : config.userLiffId;
            if (!liffId) throw new Error("LIFF IDをバックエンドから取得できませんでした。");

            await liff.init({ liffId: liffId });
            this.liff = liff;

            if (!liff.isLoggedIn()) {
                console.log('[Auth] Not logged in to LIFF. Redirecting to login.');
                loadingMessage.textContent = 'LINEログインを開始します...';
                liff.login(); // ユーザーをリダイレクトするため、スクリプトはここで停止します。
                return;
            }

            console.log('[Auth] LIFF login successful. Getting ID token...');
            this.idToken = liff.getIDToken();
            if (!this.idToken) {
                throw new Error("Could not get ID token from LINE.");
            }
            console.log('[Auth] LIFF ID Token obtained.');

            // APIモジュールに認証トークンを設定
            api.setAuthToken(this.idToken);
            console.log('[Auth] API Auth token has been set.');
            
            this.profile = await liff.getProfile();
            console.log('[Auth] LIFF Profile obtained.');

            console.log('[Auth] Initialization complete. Firing onReady callback.');
            onReady();

        } catch (error) {
            console.error('[Auth] Initialization failed:', error);
            // バックエンドからの詳細なエラーメッセージ、または一般的なエラーメッセージを表示
            loadingMessage.textContent = `認証エラー: ${error.message} ページを再読み込みしてください。`;
        }
    },

    /**
     * 認証されたユーザーのLINEプロフィールを取得します。
     * @returns {object|null} - LIFFのプロフィールオブジェクト。
     */
    getProfile() {
        return this.profile;
    }
};

export { authManager };

