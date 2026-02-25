/**
 * api.js
 * Handles communication with Cloud Functions (HTTP) and Firebase Storage
 */

import { getApp, getApps } from 'firebase/app';
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
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable, getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { appState } from './state.js';
import { logger } from './helpers.js';

// --- Generic Fetch Wrapper ---

function getFunctionsInstance() {
  // 1. 既にインスタンスがあればそれを返す
  if (appState.firebase.functions) return appState.firebase.functions;

  // 2. appState.firebase.app が null の場合、既存のアプリがあれば救出する (HMR対策)
  if (!appState.firebase.app && getApps().length > 0) {
    logger.log('[API] Recovering Firebase App from existing instance (HMR detected)');
    appState.firebase.app = getApp();
  }

  // 3. インスタンスがない場合、app があればその場で初期化を試みる
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
      try {
        connectFunctionsEmulator(functions, emuHost, 5001);
        logger.log(`[API] Connected to Functions Emulator: ${emuHost}:5001`);
      } catch (e) {
        // HMRなどで既に接続済みの場合は無視する
        if (e.code === 'failed-precondition' || (e.message && e.message.includes('already been started'))) {
          logger.log('[API] Functions Emulator already connected, skipping...');
        } else {
          logger.error('[API] Emulator connection error:', e);
        }
      }
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
    throw new Error('システムエラー: 通信の準備ができていません。画面を再読み込みしてください。');
  }

  logger.log(`[API] Calling ${endpointName} via httpsCallable...`);

  try {
    const callable = httpsCallable(functions, `${endpointName}Call`);
    const result = await callable(body);
    logger.log(`[API] ${endpointName} success`);
    return result.data;
  } catch (error) {
    logger.error(`[API] ${endpointName} failed:`, error);
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

export async function getGalleryImages(userId) {
  try {
    const db = getFirestore();
    const galleryRef = collection(db, `users/${userId}/gallery`);
    const q = query(galleryRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const images = [];
    snapshot.forEach((doc) => {
      images.push({ id: doc.id, ...doc.data() });
    });
    return images;
  } catch (e) {
    logger.error(`[Gallery] Failed to fetch images for ${userId}:`, e);
    return [];
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
  // ユーザー要件: Canvas加工でフェーダーが最も効果的に機能する「編集しやすい画像」を出力させるためのプロンプト
  const canvasOptimizedPrompt = `
[Role: Master Hair Colorist & Digital Imaging Specialist]

[Task: AI Hairstyle Simulation]
Generate a high-resolution, photorealistic image of the user with the specified hairstyle and color. 
The output MUST be optimized for real-time post-processing (HTML5 Canvas manipulation).

[Technical Specifications for Canvas Compatibility]
1. CLEAR SEPARATION: Ensure a distinct contrast between hair strands and the background to assist AI segmentation.
2. LIGHTING CONSISTENCY: Use neutral, studio-quality lighting to prevent color distortion during brightness/hue adjustments.
3. PRESERVE IDENTITY: Keep facial features, skin texture, and eye color 100% identical to the source image.
4. MASK-FRIENDLY EDGES: Render hair edges with high fidelity—no blurring or "halos" that break the alpha mask.

[Style Context]
- Target Style: ${params.hairstyleName || ''}
- Target Color: ${params.haircolorName || ''} (Level: ${params.recommendedLevel || ''})
- User Request: ${params.userRequestsText || ''}

[Final Output Quality]
8k resolution, salon-grade texture, maintaining the original subject's head position and environment.

[Negative Prompt]
blurry, low-res, cartoon, altered face, changed skin tone, messy artifacts at hair boundaries, unrealistic saturation.`;

  // Provide to backend. Use userRequestsText replacement or a dedicated override field to guarantee injection
  params.userRequestsText = canvasOptimizedPrompt;
  params.canvasOptimizedPrompt = canvasOptimizedPrompt;

  return fetchInternal('generateHairstyleImage', params);
}

export async function refineHairstyleImage(generatedImageUrl, firebaseUid, refinementText) {
  return fetchInternal('refineHairstyleImage', { generatedImageUrl, firebaseUid, refinementText });
}
