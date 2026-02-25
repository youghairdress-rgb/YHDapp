/**
 * hair_app_pc.js
 * PC Logic: Fetch Image -> AI Generation (Tone) -> MediaPipe (Color)
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  connectAuthEmulator,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  limit,
  getDocs,
  addDoc,
  serverTimestamp,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  getDownloadURL,
  uploadBytes,
  connectStorageEmulator,
} from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

// Reusing existing API logic helper (simplified)
import { generateHairstyleImage } from '../diagnosis/js/api.js';
import { appState } from '../diagnosis/js/state.js';

// --- State ---
let currentCustomer = null;
let originalImageSrc = null;
let generatedImageSrc = null;
let imageSegmenter = null;
let hairMaskBitmap = null;
let currentImageBitmap = null; // Can be original or generated

// --- Initialize ---
const app = initializeApp(appState.firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-northeast1');

// Mock AppState for API usage
appState.firebase = { app, auth, storage, firestore: db, functions };

const isLocalhost =
  import.meta.env.DEV ||
  ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) ||
  window.location.hostname.startsWith('192.168.') ||
  window.location.hostname.startsWith('10.') ||
  window.location.hostname.startsWith('172.');
if (isLocalhost) {
  const emuHost = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
  connectAuthEmulator(auth, `http://${emuHost}:9099`);
  connectFirestoreEmulator(db, emuHost, 8080);
  connectStorageEmulator(storage, emuHost, 9199);
  connectFunctionsEmulator(functions, emuHost, 5001);
  console.log('[hair_app_pc] Emulators connected to:', emuHost);
}

document.addEventListener('DOMContentLoaded', async () => {
  await signInAnonymously(auth);

  const params = new URLSearchParams(window.location.search);
  const customerId = params.get('customerId');

  if (!customerId) {
    alert('顧客IDが指定されていません。');
    return;
  }

  await loadCustomer(customerId);
  setupEventListeners();
  setupColorPresets();
});

async function loadCustomer(id) {
  showLoading(true, '顧客データを取得中...');
  try {
    const docRef = doc(db, 'users', id);
    const snapshot = await getDoc(docRef);

    if (snapshot.exists()) {
      currentCustomer = { id: snapshot.id, ...snapshot.data() };
      document.getElementById('customer-name-display').textContent = `${currentCustomer.name} 様`; // UI request: Hide ID

      // Fetch Latest Image from hair_upload.html (Mobile App)
      // The mobile app uploads to `hair_app_uploads/{id}/{timestamp}.jpg`
      // AND updates `hair_app_latest` field in Firestore.
      let imageUrl = null;

      if (currentCustomer.hair_app_latest) {
        imageUrl = currentCustomer.hair_app_latest;
        console.log('Loaded from hair_app_latest:', imageUrl);
      } else {
        // Fallback or Alert
        console.log('No hair_app_latest field found.');
      }

      if (imageUrl) {
        originalImageSrc = imageUrl;
        showStep1(imageUrl);
      } else {
        alert(
          'モバイルアプリからアップロードされた画像が見つかりません。\n(hair_upload.html からアップロードしてください)'
        );
      }
    } else {
      alert('顧客データが見つかりません。');
    }
  } catch (e) {
    console.error(e);
    alert('データ読み込みエラー: ' + e.message);
  } finally {
    showLoading(false);
  }
}

// --- UI Logic ---

function showStep1(src) {
  // document.getElementById('step1-controls').classList.add('active'); // Removed: Not in HTML
  // document.getElementById('step2-controls').classList.remove('active'); // Removed: Not in HTML

  const img = document.getElementById('source-image');
  img.src = src;
  img.style.display = 'block';

  const canvas = document.getElementById('transform-canvas');
  canvas.style.display = 'none';

  // Hide Placeholder
  const placeholder = document.getElementById('image-placeholder');
  if (placeholder) placeholder.style.display = 'none';
}

async function handleGenerateTone() {
  const toneVal = document.getElementById('hair-tone-select').value;
  const promptVal = document.getElementById('refinement-prompt-input').value.trim(); // Use prompt
  const isPromptActive = !!promptVal;

  showLoading(true, 'AIが画像を生成中...');

  try {
    const params = {
      originalImageUrl: originalImageSrc,
      firebaseUid: currentCustomer.id,
      hairstyleName: isPromptActive ? 'ご希望スタイル' : '現在の髪型',
      hairstyleDesc: isPromptActive ? promptVal : '維持',
      haircolorName: isPromptActive ? 'ご希望カラー' : '現在の髪色',
      haircolorDesc: isPromptActive ? promptVal : '維持',
      recommendedLevel: toneVal || 'Tone 7',
      currentLevel: 'Tone 7', // Default assumption
      userRequestsText: promptVal,
      isUserStyle: false, // Always false to prioritize keepStyle
      isUserColor: isPromptActive, // Treat as user request
      hasToneOverride: !!toneVal,
      keepStyle: true, // User requested strict style preservation
      keepColor: !isPromptActive, // Release color hold if prompt active
    };

    const res = await generateHairstyleImage(params);

    // Success
    generatedImageSrc = `data:${res.mimeType};base64,${res.imageBase64}`;

    await showStep2(generatedImageSrc);
  } catch (e) {
    console.error(e);
    alert('生成エラー: ' + e.message);
  } finally {
    showLoading(false);
  }
}

async function showStep2(src) {
  // document.getElementById('step1-controls').classList.remove('active'); // Removed
  // document.getElementById('step2-controls').classList.add('active'); // Removed

  const img = document.getElementById('source-image');
  img.style.display = 'none';

  const canvas = document.getElementById('transform-canvas');
  canvas.style.display = 'block';

  // Hide Placeholder (Just in case)
  const placeholder = document.getElementById('image-placeholder');
  if (placeholder) placeholder.style.display = 'none';

  // Initialize MediaPipe
  if (!imageSegmenter) {
    showLoading(true, 'AIモデルを準備中...');
    await initializeHairSegmenter();
    showLoading(false);
  }

  // Load Image onto Canvas & Run Segmentation
  // Pass src directly to runHairSegmentation (it handles offscreen loading now)
  await runHairSegmentation(src);
}

// --- MediaPipe & Canvas Logic (Ported from ui-features.js) ---

let originalImageBitmap = null;
// let hairMaskBitmap = null; // Defined globally

async function initializeHairSegmenter() {
  if (imageSegmenter) return;
  try {
    const visionTasks = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
    );
    imageSegmenter = await ImageSegmenter.createFromOptions(visionTasks, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite',
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    console.log('Hair Segmenter Initialized');
  } catch (e) {
    console.error('MediaPipe Init Error:', e);
    alert('AI機能の初期化に失敗しました。');
  }
}

async function runHairSegmentation(imgElementOrSrc) {
  if (!imageSegmenter) await initializeHairSegmenter();
  if (!imageSegmenter) return;

  try {
    const src = typeof imgElementOrSrc === 'string' ? imgElementOrSrc : imgElementOrSrc.src;
    if (!src) return;

    // Load into offscreen image (Diagnosis Logic)
    const offscreenImg = new Image();
    offscreenImg.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      offscreenImg.onload = resolve;
      offscreenImg.onerror = reject;
      offscreenImg.src = src;
    });

    const canvas = document.getElementById('transform-canvas');
    if (!canvas) return;

    canvas.width = offscreenImg.naturalWidth;
    canvas.height = offscreenImg.naturalHeight;

    // 1. Store Original
    originalImageBitmap = offscreenImg; // Use offscreen image as bitmap

    // Initial Draw (Show image while segmenting)
    applyImageAdjustments();

    // Segment
    const result = imageSegmenter.segment(offscreenImg);
    const categoryMask = result.categoryMask;

    const maskWidth = categoryMask.width;
    const maskHeight = categoryMask.height;
    const maskImageData = new ImageData(maskWidth, maskHeight);
    const maskArray = categoryMask.getAsUint8Array();

    for (let i = 0; i < maskArray.length; ++i) {
      const val = maskArray[i];
      const alpha = val === 1 ? 255 : 0; // Hair = 1
      const idx = i * 4;
      maskImageData.data[idx] = 0;
      maskImageData.data[idx + 1] = 0;
      maskImageData.data[idx + 2] = 0;
      maskImageData.data[idx + 3] = alpha;
    }

    hairMaskBitmap = await createImageBitmap(maskImageData);

    // Re-draw with mask
    applyImageAdjustments();
  } catch (e) {
    console.error('Segmentation Failed:', e);
  }
}

function applyImageAdjustments() {
  const canvas = document.getElementById('transform-canvas');
  if (!canvas || !originalImageBitmap) return; // Need original at least

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Get Slider Values
  const bInput = document.getElementById('range-brightness');
  const bVal = parseInt(bInput?.value || '10');

  const hInput = document.getElementById('range-hue');
  const hVal = parseInt(hInput?.value || '180');

  const sInput = document.getElementById('range-saturate');
  const sVal = parseInt(sInput?.value || '0');

  // Logic (Exact Match to Diagnosis):
  const brightnessScale = 1.0 + (bVal - 10) / 10.0;
  const colorOpacity = sVal / 100.0;
  const colorString = `hsl(${hVal}, 50%, 50%)`;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // 1. Draw Background (Original)
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.drawImage(originalImageBitmap, 0, 0, width, height);

  if (!hairMaskBitmap) {
    ctx.restore();
    return;
  }

  // 2. Prepare Treated Layer
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');

  // A. Brightness (Filter)
  tempCtx.filter = `brightness(${brightnessScale})`;
  tempCtx.drawImage(originalImageBitmap, 0, 0, width, height);
  tempCtx.filter = 'none';

  // B. Mask Hair
  tempCtx.globalCompositeOperation = 'destination-in';
  tempCtx.drawImage(hairMaskBitmap, 0, 0, width, height);

  // C. Color Tint
  if (colorOpacity > 0) {
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = width;
    colorCanvas.height = height;
    const colorCtx = colorCanvas.getContext('2d');

    colorCtx.fillStyle = colorString;
    colorCtx.fillRect(0, 0, width, height);

    colorCtx.globalCompositeOperation = 'destination-in';
    colorCtx.drawImage(hairMaskBitmap, 0, 0, width, height);

    tempCtx.globalCompositeOperation = 'color';
    tempCtx.globalAlpha = colorOpacity;
    tempCtx.drawImage(colorCanvas, 0, 0);
  }

  // 3. Composite Treated Layer
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0;
  ctx.drawImage(tempCanvas, 0, 0);

  ctx.restore();
}

// --- Listeners ---
function setupEventListeners() {
  document.getElementById('btn-generate-tone').addEventListener('click', handleGenerateTone);

  const updateLabel = (rangeId, labelId, suffix) => {
    const r = document.getElementById(rangeId);
    const l = document.getElementById(labelId);
    if (r && l) l.textContent = `(${r.value}${suffix})`;
  };

  const handleInput = () => {
    applyImageAdjustments();
    updateLabel('range-brightness', 'label-brightness-val', 'tone');
    updateLabel('range-hue', 'label-hue-val', '°');
    updateLabel('range-saturate', 'label-saturate-val', '%');
  };

  ['range-brightness', 'range-hue', 'range-saturate'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', handleInput);
  });

  // Reset
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('input'));
      }
    };
    setVal('range-brightness', 10);
    setVal('range-hue', 180);
    setVal('range-saturate', 0);
  });

  document.getElementById('btn-save-image').addEventListener('click', async () => {
    const canvas = document.getElementById('transform-canvas');

    // If canvas is hidden (no generation yet), warn.
    if (canvas.style.display === 'none') {
      alert('画像を生成してください。');
      return;
    }

    // 2. Save to Firestore Gallery
    if (confirm('マイページのギャラリーに保存しますか？')) {
      await saveToGallery(canvas);
    }
  });
}

async function saveToGallery(canvas) {
  showLoading(true, 'ギャラリーに保存中...');
  try {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const filename = `transform_${Date.now()}.png`;

    // User Request: "Dedicated folder for PC, separate from mobile"
    // Mobile uses: guest_uploads or uploads
    // PC will use: pc_generated
    const storagePath = `pc_generated/${currentCustomer.id}/${filename}`;

    // Use the correctly imported ref from firebase/storage
    const sRef = ref(storage, storagePath);

    // Upload to Storage (Dedicated Folder)
    await uploadBytes(sRef, blob);
    const url = await getDownloadURL(sRef);

    // Firestore (Shared Gallery)
    // This ensures it appears in My Page Gallery
    await addDoc(collection(db, `users/${currentCustomer.id}/gallery`), {
      url: url,
      storagePath: storagePath, // Save the PC specific path
      createdAt: serverTimestamp(),
      title: '髪色シミュレーション (PC)',
      type: 'hair_simulation_pc',
      isUserUpload: false, // Differentiate if needed
    });

    alert('保存しました！\nマイページのギャラリーに表示されます。');
  } catch (e) {
    console.error('Save Error:', e);
    alert('保存に失敗しました: ' + e.message);
  } finally {
    showLoading(false);
  }
}

function setupColorPresets() {
  const presets = [
    { h: 0, s: 0, color: '#333' }, // Black/Dark
    { h: 30, s: 60, color: '#8B4513' }, // Brown
    { h: 45, s: 80, color: '#DAA520' }, // Gold/Blonde
    { h: 0, s: 60, color: '#CD5C5C' }, // Red
    { h: 300, s: 40, color: '#800080' }, // Purple
  ];

  const container = document.getElementById('color-presets');
  if (!container) return; // Safely exit if not found
  presets.forEach((p) => {
    const btn = document.createElement('div');
    btn.className = 'color-preset-btn';
    btn.style.backgroundColor = p.color;
    btn.addEventListener('click', () => {
      const hueInput = document.getElementById('range-hue');
      const satInput = document.getElementById('range-sat');
      if (hueInput && satInput) {
        hueInput.value = p.h;
        satInput.value = p.s;
        // Trigger input events to update labels and canvas
        hueInput.dispatchEvent(new Event('input'));
        satInput.dispatchEvent(new Event('input'));
      }
    });
    container.appendChild(btn);
  });
}

function showLoading(show, text) {
  const el = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (show) {
    el.style.display = 'flex';
    txt.textContent = text;
  } else {
    el.style.display = 'none';
  }
}
