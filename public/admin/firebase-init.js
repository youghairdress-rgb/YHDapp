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

// --- Mock LIFF オブジェクトの定義 ---
class MockLiff {
  constructor() {
    this.id = null;
    console.log('[MockLiff] Mock LIFF instance created.');
  }
  async init({ liffId }) {
    this.id = liffId;
    console.log(`[MockLiff] liff.init called with ID: ${liffId}`);
    return Promise.resolve();
  }
  isLoggedIn() {
    console.log('[MockLiff] liff.isLoggedIn called (returns true)');
    return true;
  }
  login() {
    console.log('[MockLiff] liff.login called (skipped)');
  }
  getAccessToken() {
    console.log('[MockLiff] liff.getAccessToken called');
    return 'dummy-access-token';
  }
  async getProfile() {
    console.log('[MockLiff] liff.getProfile called');
    return {
      displayName: 'Local Admin',
      userId: 'dummy-admin-id',
      pictureUrl: 'https://via.placeholder.com/150',
      statusMessage: 'Developer Mode'
    };
  }
  closeWindow() {
    console.log('[MockLiff] liff.closeWindow called');
  }
}

// 開発モードの判別
const isLocalhost =
  import.meta.env.DEV ||
  ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) ||
  window.location.hostname.startsWith('192.168.') ||
  window.location.hostname.startsWith('10.') ||
  window.location.hostname.startsWith('172.');

const isDev = isLocalhost;

// ローカル環境なら liff をモックに差し替える
const actualLiff = liff;
const effectiveLiff = isLocalhost ? new MockLiff() : actualLiff;

// エミュレータの設定
if (isLocalhost) {
  console.log('開発モード(isLocalhost)を検出しました。エミュレータに接続します。');
  const emuHost = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
  connectFirestoreEmulator(db, emuHost, 8080);
  connectAuthEmulator(auth, `http://${emuHost}:9099`);
  connectStorageEmulator(storage, emuHost, 9199);
  connectFunctionsEmulator(functions, emuHost, 5001);
}

// onAuthStateChanged を Promise 化し、現在の認証状態を取得するヘルパー
const getFirebaseUser = () =>
  new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
  });

/**
 * グローバルなLIFF初期化状態を保持するプロミス（シングルトン・パターン）
 * これにより、複数ファイルから同時に呼ばれても liff.init() が1回しか実行されないことを保証します。
 */
let liffInitPromise = null;

/**
 * LIFFの初期化とFirebaseへの認証を行う共通関数
 */
const initializeLiffAndAuth = async (liffId) => {
  // --- 1. LiffId の厳密なチェック ---
  if (!liffId || typeof liffId !== 'string' || liffId.trim() === '') {
    const errorMsg = '致命的エラー: liffId が設定されていません。環境変数 VITE_LIFF_ID が正しく読み込まれているか確認してください。';
    console.error(errorMsg);
    // UIをブロックしないようにフォールバック（初期化未完了状態）で返す
    return { error: errorMsg };
  }

  // --- 2. ローカル開発環境の完全分離 ---
  if (isLocalhost) {
    console.log('ローカル開発モード: LINE LIFF APIを遮断し、ダミー認証を実行します');
    try {
      await effectiveLiff.init({ liffId });

      // Firebase Auth エミュレータへの匿名ログイン
      const userCredential = await signInAnonymously(auth);
      const user = userCredential.user;

      // 重要: 管理者権限チェックをバイパスするために getIdTokenResult をモック化
      const originalGetIdTokenResult = user.getIdTokenResult;
      user.getIdTokenResult = async (force) => {
        console.log('[MockAuth] user.getIdTokenResult called (returns admin: true)');
        return { claims: { admin: true } };
      };

      const profile = await effectiveLiff.getProfile();
      return { user: user, profile };
    } catch (error) {
      console.error('ローカル認証プロセスでエラーが発生しました:', error);
      return {
        user: { uid: 'mock-admin-uid', getIdTokenResult: async () => ({ claims: { admin: true } }) },
        profile: { displayName: 'Local Admin (Error fallback)' }
      };
    }
  }

  // --- 3. プロダクション環境 (本物の LIFF) ---
  try {
    // シングルトンパターン: 既に初期化実行中、または完了済みの場合はそのPromiseを待つ
    if (!liffInitPromise) {
      console.log(`LIFFを初期化します。LIFF ID: ${liffId}`);
      liffInitPromise = actualLiff.init({ liffId });
    } else {
      console.log('LIFFは既に初期化プロセスに入っています。完了を待機します...');
    }

    // liff.init の完了を待機
    await liffInitPromise;
    console.log('LIFFの初期化が完了しました。');

    if (!actualLiff.isLoggedIn()) {
      console.log('LIFFにログインしていません。ログインページにリダイレクトします。');
      actualLiff.login({ redirectUri: window.location.href });
      return new Promise(() => { });
    }
    console.log('LIFFにログイン済みです。');

    let currentUser = await getFirebaseUser();

    if (currentUser && !currentUser.isAnonymous) {
      console.log(`Firebaseセッションが有効です。ユーザー: ${currentUser.uid}`);
      const profile = await actualLiff.getProfile();
      return { user: currentUser, profile };
    }

    console.log('Firebaseセッションが無効です。カスタムトークンを取得します。');
    const accessToken = actualLiff.getAccessToken();
    if (!accessToken) {
      throw new Error('LIFFアクセストークンが取得できませんでした。');
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
