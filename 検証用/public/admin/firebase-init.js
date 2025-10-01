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
    storageBucket: "yhd-db.appspot.com",
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

const initializeLiffAndAuth = (liffId) => {
    return new Promise(async (resolve, reject) => {
        try {
            console.log("LIFF initialization started with Liff ID:", liffId);
            await liff.init({ liffId });
            console.log("LIFF initialization successful.");

            if (!liff.isLoggedIn()) {
                console.log("Not logged in to LIFF. Redirecting to login page.");
                liff.login({ redirectUri: window.location.href });
                return;
            }
            console.log("Logged in to LIFF.");

            const accessToken = liff.getAccessToken();
            if (!accessToken) {
                console.error("Failed to get LIFF access token on first try.");
                throw new Error("LIFFアクセストークンが取得できませんでした。");
            }
            
            console.log("Successfully retrieved access token.");
            await firebaseLogin(accessToken, resolve, reject);

        } catch (error) {
            console.error("LIFF initialization or Firebase authentication error:", error);
            reject(new Error(`LIFFの初期化に失敗しました: ${error.message}`));
        }
    });
};

const firebaseLogin = async (accessToken, resolve, reject) => {
    const currentUser = auth.currentUser;
    if (currentUser) {
        console.log("Already logged in to Firebase. User:", currentUser.uid);
        try {
            const profile = await liff.getProfile();
            resolve({ user: currentUser, profile });
            return;
        } catch (profileError) {
            reject(new Error(`LINEプロフィールの取得に失敗しました: ${profileError.message}`));
            return;
        }
    }
    
    console.log("Attempting to get custom token from Cloud Function...");
    
    try {
        const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createFirebaseCustomToken`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken })
        });
        
        console.log("Cloud Function response status:", response.status);

        if (!response.ok) {
            // ▼▼▼ 修正箇所 ▼▼▼
            // 401 Unauthorizedエラーの場合は再ログインを促す
            if (response.status === 401) {
                console.warn("Access token seems to be invalid (401). Forcing LIFF login to refresh token.");
                liff.login({ redirectUri: window.location.href });
                return; // リダイレクトするのでここで処理を中断
            }
            // ▲▲▲ 修正ここまで ▲▲▲

            const errorText = await response.text();
            console.error("Failed to get custom token. Server response:", errorText);
            throw new Error(`カスタムトークンの取得に失敗しました: ${response.statusText} - ${errorText}`);
        }

        const { customToken } = await response.json();
        console.log("Successfully received custom token.");

        const userCredential = await signInWithCustomToken(auth, customToken);
        console.log("Successfully signed in to Firebase. User UID:", userCredential.user.uid);

        const profile = await liff.getProfile();
        console.log("Successfully retrieved LINE profile.");
        
        resolve({ user: userCredential.user, profile });
    } catch(error) {
        console.error("Error during firebaseLogin process:", error);
        reject(error);
    }
};

export { db, auth, storage, functions, initializeLiffAndAuth };

