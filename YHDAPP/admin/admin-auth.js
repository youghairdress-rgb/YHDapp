import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, OAuthProvider, signInWithCredential } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ★★★ ここにご自身のFirebaseプロジェクトの設定をペーストしてください ★★★
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// ★★★ ここにご自身の「管理者向け」LIFF ID を設定してください ★★★
const ADMIN_LIFF_ID = "YOUR_ADMIN_LIFF_ID";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

/**
 * 管理者認証ガード
 * ページの読み込み時に実行し、管理者でなければアクセスを拒否する
 * @returns {Promise<object|null>} 認証成功時は { fbApp, auth, db } を、失敗時は null を返す
 */
export async function adminAuthGuard() {
    const loadingMessage = document.getElementById('loading-message');
    if (!loadingMessage) {
        console.error("Loading message element not found.");
        return null;
    }

    if (!ADMIN_LIFF_ID || ADMIN_LIFF_ID === "YOUR_ADMIN_LIFF_ID") {
        loadingMessage.textContent = '管理者用LIFF IDが設定されていません。';
        console.error("LIFF ID is not set.");
        return null;
    }

    try {
        loadingMessage.textContent = 'LIFFを初期化中...';
        await liff.init({ liffId: ADMIN_LIFF_ID });

        if (!liff.isLoggedIn()) {
            liff.login({ redirectUri: window.location.href });
            return null; // ログインページにリダイレクトされるため、ここで処理を中断
        }

        loadingMessage.textContent = 'Firebaseにログイン中...';
        const idToken = liff.getIDToken();
        if (!idToken) throw new Error("Could not get ID token from LINE.");
        
        // ★★★ OIDCで設定した場合、'oidc.your_provider_id' に変更してください ★★★
        const provider = new OAuthProvider('line.me');
        const credential = provider.credential({ idToken });
        const userCredential = await signInWithCredential(auth, credential);
        const firebaseUser = userCredential.user;

        if (!firebaseUser) throw new Error("Firebase authentication failed.");

        loadingMessage.textContent = '管理者権限を確認中...';
        const adminRef = doc(db, `admins/${firebaseUser.uid}`);
        const adminDoc = await getDoc(adminRef);

        if (!adminDoc.exists()) {
            throw new Error("管理者権限がありません。");
        }

        console.log("Admin authentication successful.");
        
        // ローディング画面を非表示にし、アプリ本体を表示する
        const loadingOverlay = document.getElementById('loading-overlay');
        const appContainer = document.getElementById('app');
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        if (appContainer) appContainer.style.display = 'block';

        return { fbApp, auth, db, firebaseUser };

    } catch (error) {
        console.error("Authentication Guard Error:", error);
        loadingMessage.textContent = `エラー: ${error.message}`;
        return null;
    }
}
