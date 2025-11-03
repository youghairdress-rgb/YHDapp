import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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
const functions = getFunctions(app, "asia-northeast1");

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
            console.log(`LIFFを初期化します。LIFF ID: ${liffId}`);
            await liff.init({ liffId });
            console.log("LIFFの初期化が完了しました。");

            if (!liff.isLoggedIn()) {
                console.log("LIFFにログインしていません。ログインページにリダイレクトします。");
                liff.login({ redirectUri: window.location.href });
                return; // リダイレクトするためPromiseは解決しない
            }
            console.log("LIFFにログイン済みです。");

            const accessToken = liff.getAccessToken();
            if (!accessToken) {
                // トークンが即座に利用できない場合があるため、1秒待ってから再試行
                console.warn("アクセストークンがすぐに取得できませんでした。1秒後に再試行します。");
                setTimeout(async () => {
                    const newAccessToken = liff.getAccessToken();
                    if (!newAccessToken) {
                        console.error("アクセストークンの再取得に失敗しました。");
                        return reject(new Error("LIFFアクセストークンが取得できませんでした。ログインし直してください。"));
                    }
                    console.log("アクセストークンを再取得しました。");
                    await firebaseLogin(newAccessToken, resolve, reject);
                }, 1000);
            } else {
                console.log("アクセストークンを取得しました。");
                await firebaseLogin(accessToken, resolve, reject);
            }
        } catch (error) {
            console.error("LIFFの初期化または認証プロセスでエラーが発生しました:", error);
            reject(new Error(`LIFFの処理中にエラーが発生しました: ${error.message}`));
        }
    });
};

const firebaseLogin = async (accessToken, resolve, reject) => {
    // 既にFirebaseにサインインしているか確認
    const currentUser = auth.currentUser;
    if (currentUser) {
        console.log(`Firebaseにログイン済みです。ユーザー: ${currentUser.uid}`);
        try {
            const profile = await liff.getProfile();
            return resolve({ user: currentUser, profile });
        } catch (profileError) {
            return reject(new Error(`LINEプロフィールの取得に失敗しました: ${profileError.message}`));
        }
    }
    
    console.log("Firebaseのカスタムトークンを取得します...");
    
    try {
        const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createFirebaseCustomToken`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken })
        });

        if (!response.ok) {
            // アクセストークンの有効期限切れなどで401エラーが返ってきた場合、
            // LIFFのログインを再度実行させてトークンを更新させる
            if (response.status === 401) {
                console.warn("アクセストークンが無効(401)です。LIFFの再ログインを試みます。");
                liff.login({ redirectUri: window.location.href });
                return; // 再ログインのためリダイレクト
            }
            // その他のサーバーエラー
            const errorText = await response.text();
            throw new Error(`カスタムトークンの取得に失敗しました。ステータス: ${response.status}, サーバー応答: ${errorText}`);
        }

        const { customToken } = await response.json();
        console.log("カスタムトークンを正常に取得しました。");

        const userCredential = await signInWithCustomToken(auth, customToken);
        console.log(`Firebaseへのサインインに成功しました。UID: ${userCredential.user.uid}`);

        const profile = await liff.getProfile();
        console.log("LINEプロフィールを正常に取得しました。");
        
        resolve({ user: userCredential.user, profile });
    } catch(error) {
        console.error("Firebaseログイン処理中にエラーが発生しました:", error);
        reject(error); // エラーを呼び出し元に伝える
    }
};

export { db, auth, storage, functions, initializeLiffAndAuth };

