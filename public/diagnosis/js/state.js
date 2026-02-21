/**
 * state.js
 * アプリケーションの状態（State）を一元管理するモジュール
 * ★ データベース・認証は 管理アプリ(yhd-db) を使用
 * ★ AI機能は YHD-DX を使用
 */

export const IS_DEV_MODE = import.meta.env.DEV;
export const USE_MOCK_AUTH = import.meta.env.DEV;

export const appState = {
  // 1. アプリケーション設定
  // ▼▼▼ 修正: データベース接続先を 管理アプリ(yhd-db) に設定 ▼▼▼
  firebaseConfig: {
    apiKey: 'AIzaSyCjZcF8GFC4CJMYmpucjJ_yShsn74wDLVw', // yhd-db API Key
    authDomain: 'yhd-db.firebaseapp.com',
    projectId: 'yhd-db',
    storageBucket: 'yhd-db.firebasestorage.app',
    messagingSenderId: '940208179982',
    appId: '1:940208179982:web:92abb326fa1dc8ee0b655f',
    measurementId: 'G-RSYFJW3TN6',
  },
  // ▲▲▲ 修正ここまで ▲▲▲

  // LIFF ID (YHD-DX用)
  liffId: '2008345232-zq4A3Vg3',

  // 2. Firebase インスタンス
  firebase: {
    app: null,
    auth: null,
    storage: null,
    firestore: null,
    functions: null,
  },

  // 3. ユーザー情報
  userProfile: {
    userId: null,
    displayName: null,
    pictureUrl: null,
    firebaseUid: null,
    viaAdmin: false,
  },

  // 4. 入力データ
  gender: 'female',

  // アップロードされたファイルのURL
  uploadedFileUrls: {
    'item-front-photo': null,
    'item-side-photo': null,
    'item-back-photo': null,
    'item-front-video': null,
    'item-back-video': null,
    'item-inspiration-photo': null,
  },
  localBlobs: {}, // To store File objects for CORS-safe local preview

  inspirationImageUrl: null,
  uploadTasks: {},

  // 5. AI診断・提案結果
  aiDiagnosisResult: null,
  aiProposal: null,

  // 6. ユーザーの選択
  selectedHairstyle: {
    name: null,
    description: null,
  },
  selectedHaircolor: {
    name: null,
    description: null,
  },

  // 7. 生成画像データ
  generatedImageCache: {
    base64: null,
    mimeType: null,
  },
};
