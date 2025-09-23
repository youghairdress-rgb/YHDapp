import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
// 【ここから追記】Firebase Functions SDKをインポート
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Firebaseプロジェクトの設定 (既存のまま)
const firebaseConfig = {
    apiKey: "AIzaSyCjZcF8GFC4CJMYmpucjJ_yShsn74wDLVw",
    authDomain: "yhd-db.firebaseapp.com",
    projectId: "yhd-db",
    storageBucket: "yhd-db.firebasestorage.app",
    messagingSenderId: "940208179982",
    appId: "1:940208179982:web:92abb326fa1dc8ee0b655f",
    measurementId: "G-RSYFJW3TN6"
};

// Firebaseの初期化 (既存のまま)
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
// 【ここから追記】Functionsを初期化
const functions = getFunctions(app, "asia-northeast1"); // Cloud Functionsのリージョンを指定

// 他のファイルで使えるようにエクスポート (functionsを追加)
export { db, auth, storage, functions };

