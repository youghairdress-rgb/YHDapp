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
import { httpsCallable } from 'firebase/functions';

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

// 開発モードの判別（ViteのDEVフラグとホスト名の両方をチェック）
const isLocalhost =
  import.meta.env.DEV ||
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

const isDev = isLocalhost;

// エミュレータの設定
if (isLocalhost) {
  console.log('開発モード(isLocalhost)を検出しました。エミュレータに接続します。');
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
  // --- 超・強制スキップモード (localhost時はLINEを一切無視) ---
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('強制スキップモード起動: Authエミュレータへの匿名ログインを実行します');
    try {
      const userCredential = await signInAnonymously(auth);
      // さらに、getIdTokenResult をモック化（isAdmin()チェックを確実に通すため）
      const user = userCredential.user;
      const originalGetIdTokenResult = user.getIdTokenResult;
      user.getIdTokenResult = async (force) => {
        return { claims: { admin: true } };
      };

      return { user: user, profile: { displayName: 'Local Admin (Dev)' } };
    } catch (error) {
      console.error('匿名ログインに失敗しました:', error);
      // 失敗してもダミーを返して続行を試みる
      return { user: { uid: 'mock-admin-uid', email: 'admin@example.com' } };
    }
  }

  try {
    // 従来の DEV 判定等は上記で包括されるが、念のため残すか、整理する
    // ...

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
    const createTokenCall = httpsCallable(functions, 'createFirebaseCustomTokenCall');
    const result = await createTokenCall({ accessToken });
    const { customToken } = result.data;

    console.log('カスタムトークンを正常に取得しました。');

    const userCredential = await signInWithCustomToken(auth, customToken);
    console.log(`Firebaseへのサインインに成功しました。UID: ${userCredential.user.uid}`);

    const profile = await liff.getProfile();
    console.log('LINEプロフィールを正常に取得しました。');

    return { user: userCredential.user, profile };
  } catch (error) {
    console.error('Firebaseログイン処理中にエラーが発生しました:', error);
    // 401エラー（アクセストークン無効）の場合は再ログイン
    if (error.code === 'unauthenticated' || (error.details && error.details.status === 401)) {
      console.warn('アクセストークンが無効です。LIFFの再ログインを試みます。');
      liff.login({ redirectUri: window.location.href });
      return new Promise(() => { });
    }
    throw error; // エラーを呼び出し元に投げる
  }
};

// 以前の `firebaseLogin` 関数は `initializeLiffAndAuth` に統合・リファクタリングされました。

// --- ▲▲▲ 認証ロジックを修正 ▲▲▲ ---

export { db, auth, storage, functions, initializeLiffAndAuth, isDev, isLocalhost };
