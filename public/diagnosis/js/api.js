/**
 * api.js
 * Handles communication with Cloud Functions (HTTP) and Firebase Storage
 */

import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { appState } from './state.js';
import { logger } from './helpers.js';

// --- Generic Fetch Wrapper ---

async function fetchInternal(endpointName, body) {
  if (appState.apiBaseUrl === undefined || appState.apiBaseUrl === null) {
    throw new Error("API Base URL is not configured.");
  }
  // If apiBaseUrl is set, use it. Otherwise use relative path (starts with /)
  const url = appState.apiBaseUrl
    ? `${appState.apiBaseUrl}/${endpointName}`
    : `/${endpointName}`;

  logger.log(`[API] Calling ${endpointName}...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch (e) {
        // If not JSON, try text
        const text = await response.text();
        errorData = { message: text || `HTTP Error ${response.status}` };
      }

      const error = new Error(errorData.message || errorData.error || "Unknown Server Error");
      error.status = response.status;
      error.details = errorData;
      throw error;
    }

    const data = await response.json();
    logger.log(`[API] ${endpointName} success`);
    return data; // Result is usually { ...data } or just data

  } catch (error) {
    logger.error(`[API] ${endpointName} failed:`, error);
    throw error;
  }
}

// --- Auth ---

export async function requestCustomToken(accessToken) {
  // 直接Functionsを叩くため、正確な関数名(V2)を指定
  return fetchInternal('createFirebaseCustomTokenV2', { accessToken });
}

// --- Storage & Firestore ---

export async function uploadFileToStorage(file, path) {
  if (!file) throw new Error("No file provided");

  try {
    const storage = getStorage();
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);
    logger.log(`[Upload] Success: ${path}`);
    return url;
  } catch (e) {
    logger.error(`[Upload] Failed: ${path}`, e);
    throw new Error("画像のアップロードに失敗しました。");
  }
}

export async function saveImageToGallery(blob, userId, styleName, colorName, note = "") {
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
      styleName: styleName || "N/A",
      colorName: colorName || "N/A",
      note: note,
      createdAt: serverTimestamp(),
      type: 'generated'
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
      title: title || "スクリーンショット",
      type: "screenshot",
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
};

export async function generateHairstyleImage(params) {
  return fetchInternal('generateHairstyleImage', params);
};

export async function refineHairstyleImage(generatedImageUrl, firebaseUid, refinementText) {
  return fetchInternal('refineHairstyleImage', { generatedImageUrl, firebaseUid, refinementText });
};