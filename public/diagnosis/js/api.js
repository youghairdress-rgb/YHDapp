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
import { httpsCallable } from 'firebase/functions';
import { appState } from './state.js';
import { logger } from './helpers.js';

// --- Generic Fetch Wrapper ---

async function fetchInternal(endpointName, body) {
  const functions = appState.firebase.functions;
  if (!functions) {
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
