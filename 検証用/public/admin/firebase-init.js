import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Firebaseプロジェクトの設定
const firebaseConfig = {
    apiKey: "AIzaSyCjZcF8GFC4CJMYmpucjJ_yShsn74wDLVw",
    authDomain: "yhd-db.firebaseapp.com",
    projectId: "yhd-db",
    storageBucket: "yhd-db.firebasestorage.app",
    messagingSenderId: "940208179982",
    appId: "1:940208179982:web:92abb326fa1dc8ee0b655f",
    measurementId: "G-RSYFJW3TN6"
};

// Firebaseサービスの初期化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app, "asia-northeast1"); // リージョンを指定

// Cloud FunctionsのURL
const CLOUD_FUNCTIONS_URL = "https://asia-northeast1-yhd-db.cloudfunctions.net";

/**
 * LIFFの初期化とFirebaseへの認証を行う共通関数
 * @param {string} liffId - 初期化するLIFFアプリのID
 * @returns {Promise<{user: import("firebase/auth").User, profile: any}>} 認証済みユーザーとLINEプロフィール
 */
const initializeLiffAndAuth = (liffId) => {
    return new Promise(async (resolve, reject) => {
        try {
            await liff.init({ liffId });

            if (!liff.isLoggedIn()) {
                liff.login({ redirectUri: window.location.href });
                // ログインページへリダイレクトするため、Promiseは解決も拒否もしない
                return;
            }

            const accessToken = liff.getAccessToken();
            if (!accessToken) {
                // アクセストークンがない場合は少し待ってからリトライする
                setTimeout(async () => {
                    const newToken = liff.getAccessToken();
                    if (!newToken) {
                        throw new Error("LIFFアクセストークンが取得できませんでした。");
                    }
                    await firebaseLogin(newToken, resolve);
                }, 1000);
            } else {
                 await firebaseLogin(accessToken, resolve);
            }

        } catch (error) {
            console.error("LIFF初期化またはFirebase認証中にエラー:", error);
            reject(error);
        }
    });
};

const firebaseLogin = async (accessToken, resolve) => {
     // Firebaseにすでにログインしているか確認
    const currentUser = auth.currentUser;
    if (currentUser) {
        const profile = await liff.getProfile();
        resolve({ user: currentUser, profile });
        return;
    }
    
    // Firebaseにログイン
    const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createFirebaseCustomToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Invalid JSON response' }));
        throw new Error(errorData.error || `カスタムトークンの取得に失敗しました: ${response.statusText}`);
    }

    const { customToken } = await response.json();
    const userCredential = await signInWithCustomToken(auth, customToken);
    const profile = await liff.getProfile();
    
    resolve({ user: userCredential.user, profile });
};


// 他のファイルで使えるようにエクスポート
export { db, auth, storage, functions, initializeLiffAndAuth };

