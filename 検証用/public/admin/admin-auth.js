import { onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from './firebase-init.js';

const CLOUD_FUNCTIONS_URL = "https://asia-northeast1-yhd-db.cloudfunctions.net";

// --- DOM操作ヘルパー関数 (エクスポート) ---
export const showLoading = (text) => {
    const container = document.getElementById('loading-container');
    if (container) {
        const p = container.querySelector('p');
        if (p) p.textContent = text;
        container.style.display = 'flex';
    }
    const content = document.getElementById('content-container');
    if (content) content.style.display = 'none';
    const errorContainer = document.getElementById('error-container');
    if (errorContainer) errorContainer.style.display = 'none';
};

export const showContent = () => {
    const container = document.getElementById('loading-container');
    if (container) container.style.display = 'none';
    const content = document.getElementById('content-container');
    if (content) content.style.display = 'block';
};

export const showError = (text) => {
    console.error("エラーが発生しました:", text);
    const errorContainer = document.getElementById('error-container');
    if (errorContainer) {
        const p = errorContainer.querySelector('p');
        if (p) p.textContent = text;
        errorContainer.style.display = 'block';

        // ★★★ 修正箇所 ★★★
        // retry-buttonが存在する場合のみイベントリスナーを設定
        const retryButton = document.getElementById('retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => window.location.reload());
        }
        // ★★★ 修正ここまで ★★★
    }
    const container = document.getElementById('loading-container');
    if (container) container.style.display = 'none';
    const content = document.getElementById('content-container');
    if (content) content.style.display = 'none';
};

// --- 認証処理 ---
const liffLoginAndAuth = async (liffId) => {
    if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
        return new Promise(() => { });
    }
    const accessToken = liff.getAccessToken();
    if (!accessToken) throw new Error("LIFFアクセストークンが取得できませんでした。");

    const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createFirebaseCustomToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken })
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`カスタムトークンの取得に失敗しました: ${errorText}`);
    }
    const { customToken } = await response.json();
    const userCredential = await signInWithCustomToken(auth, customToken);
    return userCredential.user;
};

const getCurrentUser = () => {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(auth, user => {
            unsubscribe();
            resolve(user);
        }, error => {
            unsubscribe();
            reject(error);
        });
    });
};

// --- ページ実行のメイン関数 ---
const ADMIN_DEFAULT_LIFF_ID = "2008029428-Go8VM98w";

export const runAdminPage = (mainFunction, pageLiffId = null) => {
    const start = async () => {
        try {
            showLoading("LIFFを初期化中...");
            const liffId = pageLiffId || ADMIN_DEFAULT_LIFF_ID;
            await liff.init({ liffId: liffId });

            showLoading("Firebaseと同期中...");
            let user = await getCurrentUser();
            if (!user) {
                showLoading("管理者情報を認証中...");
                user = await liffLoginAndAuth(liffId);
            }
            if (!user) throw new Error("Firebaseへのログインに失敗しました。");

            showLoading("管理者権限を確認中...");
            const idTokenResult = await user.getIdTokenResult(true);
            if (!idTokenResult.claims.admin) {
                throw new Error("管理者権限がありません。");
            }

            showLoading("ページを読み込み中...");
            await mainFunction(auth, user);
            showContent();
        } catch (error) {
            showError(error.message);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
};

