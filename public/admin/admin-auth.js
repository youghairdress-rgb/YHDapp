import { onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from './firebase-init.js';

const CLOUD_FUNCTIONS_URL = "https://asia-northeast1-yhd-db.cloudfunctions.net";

// --- DOM操作ヘルパー関数 ---
export const showLoading = (text) => {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-container').style.display = 'flex';
    document.getElementById('content-container').style.display = 'none';
    document.getElementById('error-container').style.display = 'none';
};

export const showContent = () => {
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('content-container').style.display = 'block';
};

export const showError = (text) => {
    console.error("エラーが発生しました:", text);
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('content-container').style.display = 'none';
    const errorContainer = document.getElementById('error-container');
    const errorMessage = document.getElementById('error-message');
    if (errorMessage) errorMessage.textContent = text;
    if (errorContainer) errorContainer.style.display = 'block';
};

// --- Firebase/LIFF認証 ---
const liffLoginAndAuth = async () => {
    if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
        return new Promise(() => {}); // login()はリダイレクトするので、ここで処理を止める
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

// --- ページ実行メイン関数 ---
export const runAdminPage = (mainFunction) => {
    const start = async () => {
        try {
            showLoading("LIFFを初期化中...");
            await liff.init({ liffId: "2008029428-Go8VM98w" });

            showLoading("Firebaseと同期中...");
            let user = await getCurrentUser();
            if (!user) {
                showLoading("管理者情報を認証中...");
                user = await liffLoginAndAuth();
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

    // DOMの読み込みが完了してからアプリケーションを開始
    document.addEventListener('DOMContentLoaded', () => {
        const retryButton = document.getElementById('retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => window.location.reload());
        }
        start();
    });
};

