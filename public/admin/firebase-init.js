import liff from '@line/liff';
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { connectFirestoreEmulator } from 'firebase/firestore';
import {
  getAuth,
  signInWithCustomToken,
  onAuthStateChanged,
  connectAuthEmulator,
  signInAnonymously,
} from 'firebase/auth';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: 'AIzaSyCjZcF8GFC4CJMYmpucjJ_yShsn74wDLVw',
  authDomain: 'yhd-db.firebaseapp.com',
  projectId: 'yhd-db',
  storageBucket: 'yhd-db.firebasestorage.app',
  messagingSenderId: '940208179982',
  appId: '1:940208179982:web:92abb326fa1dc8ee0b655f',
  measurementId: 'G-RSYFJW3TN6',
};

// Firebaseサービスの初期化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app, 'asia-northeast1');

// Cloud FunctionsのURL
const CLOUD_FUNCTIONS_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:5001/yhd-db/asia-northeast1'
  : 'https://asia-northeast1-yhd-db.cloudfunctions.net';

// エミュレータの設定
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  console.log('エミュレータに接続します。');
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

// --- ▼▼▼ 認証ロジックを修正 ▼▼▼ ---

// onAuthStateChanged を Promise 化し、現在の認証状態を取得するヘルパー
const getFirebaseUser = () =>
  new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe(); // 最初の状態変更でリスナーを解除
        resolve(user); // ユーザー情報（ログインしていなければ null）を解決
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
  });

/**
 * LIFFの初期化とFirebaseへの認証を行う共通関数
 * @param {string} liffId - 初期化するLIFFアプリのID
 * @returns {Promise<{user: import("firebase/auth").User, profile: any}>} 認証済みユーザーとLINEプロフィール
 */
const initializeLiffAndAuth = async (liffId) => {
  try {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
      console.log('ローカル環境を検出しました。LINE認証をバイパスします。');

      // モックのプロフィール情報を定義
      const mockProfile = {
        userId: 'U1234567890abcdef1234567890abcdef',
        displayName: 'Local Admin (Dev)',
        pictureUrl: 'https://placehold.jp/150x150.png',
        statusMessage: 'Local development mode'
      };

      // 実ユーザーがいる場合はそれを使うが、いない場合はアノニマスログインを試行
      let currentUser = auth.currentUser;

      if (!currentUser) {
        try {
          console.log('Firebaseにログインユーザーがないため、匿名ログインを試行します...');
          const userCred = await signInAnonymously(auth);
          currentUser = userCred.user;
          console.log('匿名ログインに成功しました:', currentUser.uid);
        } catch (authError) {
          console.error('匿名ログインに失敗しました:', authError);
          // 失敗してもダミーオブジェクトで続行を試みる（既存ロジック）
          currentUser = {
            uid: 'mock-admin-uid',
            displayName: 'Local Admin',
            email: 'admin@localhost',
            isAnonymous: false,
            getIdTokenResult: async () => ({ claims: { admin: true } }),
            getIdToken: async () => 'mock-token'
          };
        }
      }

      // さらに、getIdTokenResult などをモック化（isAdmin()チェックを通すため）
      const originalGetIdTokenResult = currentUser.getIdTokenResult;
      currentUser.getIdTokenResult = async (force) => {
        if (isLocalhost) {
          return { claims: { admin: true } };
        }
        return originalGetIdTokenResult.call(currentUser, force);
      };

      return { user: currentUser, profile: mockProfile };
    }

    console.log(`LIFFを初期化します。LIFF ID: ${liffId}`);
    await liff.init({ liffId });
    console.log('LIFFの初期化が完了しました。');

    if (!liff.isLoggedIn()) {
      console.log('LIFFにログインしていません。ログインページにリダイレクトします。');
      liff.login({ redirectUri: window.location.href });
      // リダイレクトするため解決を待機するPromiseを返すが、実際には遷移する
      return new Promise(() => { });
    }
    console.log('LIFFにログイン済みです。');

    // まずローカルのFirebaseセッションを確認
    let currentUser = await getFirebaseUser();

    if (currentUser && !currentUser.isAnonymous) {
      console.log(`Firebaseセッションが有効です。ユーザー: ${currentUser.uid}`);
      // セッションは有効だが、念のためLINEプロフィールを取得
      try {
        const profile = await liff.getProfile();
        return { user: currentUser, profile };
      } catch (profileError) {
        throw new Error(`LINEプロフィールの取得に失敗しました: ${profileError.message}`, {
          cause: profileError,
        });
      }
    }

    // Firebaseセッションが無効、または初回ログインの場合
    console.log('Firebaseセッションが無効です。カスタムトークンを取得します。');
    const accessToken = liff.getAccessToken();
    if (!accessToken) {
      throw new Error('LIFFアクセストークンが取得できませんでした。ログインし直してください。');
    }

    return await firebaseLoginWithToken(accessToken);
  } catch (error) {
    console.error('LIFFの初期化または認証プロセスでエラーが発生しました:', error);
    throw new Error(`LIFFの処理中にエラーが発生しました: ${error.message}`, { cause: error });
  }
};

// カスタムトークンを使用してFirebaseにログインする関数
const firebaseLoginWithToken = async (accessToken) => {
  try {
    const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createFirebaseCustomToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        console.warn('アクセストークンが無効(401)です。LIFFの再ログインを試みます。');
        liff.login({ redirectUri: window.location.href });
        // リダイレクト待機
        return new Promise(() => { });
      }
      const errorText = await response.text();
      throw new Error(
        `カスタムトークンの取得に失敗しました。ステータス: ${response.status}, サーバー応答: ${errorText}`
      );
    }

    const { customToken } = await response.json();
    console.log('カスタムトークンを正常に取得しました。');

    const userCredential = await signInWithCustomToken(auth, customToken);
    console.log(`Firebaseへのサインインに成功しました。UID: ${userCredential.user.uid}`);

    const profile = await liff.getProfile();
    console.log('LINEプロフィールを正常に取得しました。');

    return { user: userCredential.user, profile };
  } catch (error) {
    console.error('Firebaseログイン処理中にエラーが発生しました:', error);
    throw error; // エラーを呼び出し元に投げる
  }
};

// 以前の `firebaseLogin` 関数は `initializeLiffAndAuth` に統合・リファクタリングされました。

// --- ▲▲▲ 認証ロジックを修正 ▲▲▲ ---

export { db, auth, storage, functions, initializeLiffAndAuth };
