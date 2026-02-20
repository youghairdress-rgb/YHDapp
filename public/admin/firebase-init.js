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
const CLOUD_FUNCTIONS_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:5001/yhd-db/asia-northeast1'
  : 'https://asia-northeast1-yhd-db.cloudfunctions.net';

// エミュレータの設定
if (import.meta.env.DEV) {
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
    if (import.meta.env.DEV) {
      console.log('ローカル開発環境を検出しました(DEVモード)。LINE認証をバイパスします。');

      // モックのプロフィール情報を定義
      const mockProfile = {
        userId: 'U1234567890abcdef1234567890abcdef',
        displayName: 'Local Admin (Dev)',
        pictureUrl: 'https://placehold.jp/150x150.png',
        statusMessage: 'Local development mode'
      };

      // 実ユーザーがいる場合はそれを使うが、いない場合はローカル用のトークンを取得してログイン
      let currentUser = auth.currentUser;

      if (!currentUser) {
        try {
          console.log('ローカル開発用管理者トークンを生成中...');
          // 本来のログインフローをシミュレートし、内部的に admin: true を持つトークンを取得
          const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createFirebaseCustomToken`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: 'local-admin-dev-token' }),
          });

          if (response.ok) {
            const { customToken } = await response.json();
            const userCred = await signInWithCustomToken(auth, customToken);
            currentUser = userCred.user;
            console.log('ローカル管理者としてのログインに成功しました:', currentUser.uid);
          } else {
            throw new Error('管理者トークンの取得に失敗しました');
          }
        } catch (authError) {
          console.error('ローカルログインに失敗しました。', authError);
        }
      }

      // さらに、getIdTokenResult などをモック化（isAdmin()チェックを通すため）
      // ※ 上記のログインが失敗した場合に currentUser が null のままだとエラーになるため、
      //    ログイン失敗時はダミーオブジェクトを割り当てる
      if (!currentUser) {
        currentUser = {
          uid: 'mock-admin-uid',
          displayName: 'Local Admin',
          email: 'admin@localhost',
          isAnonymous: false,
          getIdTokenResult: async () => ({ claims: { admin: true } }),
          getIdToken: async () => 'mock-token'
        };
      } else {
        const originalGetIdTokenResult = currentUser.getIdTokenResult;
        currentUser.getIdTokenResult = async (force) => {
          if (import.meta.env.DEV) {
            return { claims: { admin: true } };
          }
          return originalGetIdTokenResult.call(currentUser, force);
        };
      }

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
