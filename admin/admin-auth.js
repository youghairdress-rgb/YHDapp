import { onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from './firebase-init.js';

const CLOUD_FUNCTIONS_URL = "https://asia-northeast1-yhd-db.cloudfunctions.net";

// --- DOM操作ヘルパー関数 ---
const loadingContainer = document.getElementById('loading-container');
const contentContainer = document.getElementById('content-container');
const loadingText = document.getElementById('loading-text');
const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');

const showLoading = (text) => {
    if (loadingText) loadingText.textContent = text;
    if (loadingContainer) loadingContainer.style.display = 'flex';
    if (contentContainer) contentContainer.style.display = 'none';
    if (errorContainer) errorContainer.style.display = 'none';
};

const showContent = () => {
    if (loadingContainer) loadingContainer.style.display = 'none';
    if (contentContainer) contentContainer.style.display = 'block';
};

const showError = (text) => {
    console.error("エラーが発生しました:", text);
    if (errorMessage) errorMessage.textContent = text;
    if (loadingContainer) loadingContainer.style.display = 'none';
    if (errorContainer) errorContainer.style.display = 'block';
};

/**
 * LIFF経由でFirebaseにログインし、Firebaseユーザー情報を返す
 */
const liffLoginAndAuth = async () => {
    if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
        return new Promise(() => {}); // login()はリダイレクトするので、実行が止まるように解決しないPromiseを返す
    }

    const accessToken = liff.getAccessToken();
    if (!accessToken) {
        throw new Error("LIFFアクセストークンが取得できませんでした。");
    }

    const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createFirebaseCustomToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: accessToken })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`カスタムトークンの取得に失敗しました: ${errorText}`);
    }

    const { customToken } = await response.json();
    const userCredential = await signInWithCustomToken(auth, customToken);
    return userCredential.user;
};

/**
 * Firebaseの現在のログイン状態を確実に取得する
 * @returns {Promise<User|null>}
 */
const getCurrentUser = () => {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe(); // 最初の状態を取得したらすぐに監視を解除
            resolve(user);
        }, (error) => {
            unsubscribe();
            reject(error);
        });
    });
};

/**
 * 各管理者ページのメイン処理を実行するエンジン
 * @param {function} mainFunction - 各ページ固有のメイン処理
 */
export const runAdminPage = (mainFunction) => {
    document.addEventListener('DOMContentLoaded', async () => {
        showLoading("LIFFを初期化中...");
        try {
            await liff.init({ liffId: "2008029428-Go8VM98w" });

            showLoading("Firebaseと同期中...");
            let user = await getCurrentUser(); // ★変更点：まずFirebaseの状態を確実に待つ

            if (!user) {
                showLoading("管理者情報を認証中...");
                user = await liffLoginAndAuth();
            }

            if (!user) {
                throw new Error("Firebaseへのログインに失敗しました。");
            }

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
    });
};
// ★変更点: ファイル末尾の余分な '}' を削除

