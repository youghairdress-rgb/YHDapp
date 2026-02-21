/**
 * api.js
 * Handles communication with Cloud Functions (HTTP) and Firebase Storage
 */

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable, getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { appState } from './state.js';
import { logger } from './helpers.js';

// --- Generic Fetch Wrapper ---

/**
 * Firebase Functions インスタンスを安全に取得する
 * (main.js での初期化漏れやタイミング問題を解消するための自己修復ロジック)
 */
function getFunctionsInstance() {
  // 1. 既にインスタンスがあればそれを返す
  if (appState.firebase.functions) return appState.firebase.functions;

  // 2. インスタンスがない場合、app があればその場で初期化を試みる
  if (appState.firebase.app) {
    logger.log('[API] Initializing Functions on-demand...');
    const functions = getFunctions(appState.firebase.app, 'asia-northeast1');

    // エミュレータ接続が必要か判定
    const isLocalhost =
      import.meta.env.DEV ||
      ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.hostname.startsWith('10.') ||
      window.location.hostname.startsWith('172.');

    if (isLocalhost) {
      const emuHost = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
      connectFunctionsEmulator(functions, emuHost, 5001);
      logger.log(`[API] Connected to Functions Emulator: ${emuHost}:5001`);
    }

    appState.firebase.functions = functions;
    return functions;
  }

  return null;
}

async function fetchInternal(endpointName, body) {
  const functions = getFunctionsInstance();
  if (!functions) {
    logger.error('[API] Critical Error: Firebase app is not initialized yet.');
    throw new Error('Firebase Functions is not initialized.');
  }

  logger.log(`[API] Calling ${endpointName} via httpsCallable...`);

  try {
    const callable = httpsCallable(functions, `${endpointName}Call`);
    const result = await callable(body);
    logger.log(`[API] ${endpointName} success`);
    return result.data;
  } catch (error) {
    logger.error(`[API] ${endpointName} failed:`, error);
    // HttpsError の情報を抽出
    const message = error.message || 'Unknown Server Error';
    const err = new Error(message);
    err.status = error.code;
    err.details = error.details;
    throw err;
  }
}

// --- Auth ---

export async function requestCustomToken(accessToken) {
  // 直接Functionsを叩くため、正確な関数名(V2)を指定
  return fetchInternal('createFirebaseCustomTokenV2', { accessToken });
}

// --- Storage & Firestore ---

export async function uploadFileToStorage(file, path) {
  if (!file) throw new Error('No file provided');

  try {
    const storage = getStorage();
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);
    logger.log(`[Upload] Success: ${path}`);
    return url;
  } catch (e) {
    logger.error(`[Upload] Failed: ${path}`, e);
    throw new Error('画像のアップロードに失敗しました。', { cause: e });
  }
}

export async function saveImageToGallery(blob, userId, styleName, colorName, note = '') {
  // 1. Upload to Storage
  const timestamp = Date.now();
  const fileName = `gen-${timestamp}.png`;
  const path = `users/${userId}/gallery/${fileName}`;

  const url = await uploadFileToStorage(blob, path);

  // 2. Save Metadata to Firestore
  try {
    const db = getFirestore();
    const galleryRef = collection(db, `users/${userId}/gallery`);
    await addDoc(galleryRef, {
      url: url,
      storagePath: path,
      styleName: styleName || 'N/A',
      colorName: colorName || 'N/A',
      note: note,
      createdAt: serverTimestamp(),
      type: 'generated',
    });
    logger.log(`[Gallery] Saved to Firestore: ${path}`);
    return url;
  } catch (e) {
    logger.error(`[Gallery] Firestore save failed:`, e);
    // Even if Firestore fails, return URL as upload succeeded
    return url;
  }
}

export async function saveScreenshotToGallery(blob, userId, title) {
  const timestamp = Date.now();
  const fileName = `capture-${timestamp}.png`;
  const path = `users/${userId}/gallery/${fileName}`;

  const url = await uploadFileToStorage(blob, path);

  try {
    const db = getFirestore();
    const galleryRef = collection(db, `users/${userId}/gallery`);
    await addDoc(galleryRef, {
      url: url,
      storagePath: path,
      title: title || 'スクリーンショット',
      type: 'screenshot',
      createdAt: serverTimestamp(),
    });
    logger.log(`[Gallery] Screenshot saved: ${path}`);
    return url;
  } catch (e) {
    logger.error(`[Gallery] Screenshot save failed:`, e);
    return url;
  }
}

// --- AI機能 (YHD-DX Functions) ---

export async function requestDiagnosis(fileUrls, user, gender) {
  return fetchInternal('requestDiagnosis', {
    fileUrls: fileUrls,
    userProfile: { firebaseUid: user.firebaseUid, lineUserId: user.userId },
    gender: gender,
  });
}

export async function generateHairstyleImage(params) {
  return fetchInternal('generateHairstyleImage', params);
}

export async function refineHairstyleImage(generatedImageUrl, firebaseUid, refinementText) {
  return fetchInternal('refineHairstyleImage', { generatedImageUrl, firebaseUid, refinementText });
}
