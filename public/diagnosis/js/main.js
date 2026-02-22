import liff from '@line/liff';
import html2canvas from 'html2canvas';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

import { appState, IS_DEV_MODE, USE_MOCK_AUTH } from './state.js';
import {
  initializeAppFailure,
  setTextContent,
  hideLoadingScreen,
  compressImage,
  base64ToBlob,
  logger,
} from './helpers.js';
import { changePhase, toggleLoader, showModal, checkAllFilesUploaded } from './ui-core.js';
import { setupAdustmentListeners } from './ui-features.js';
import {
  displayDiagnosisResult,
  displayProposalResult,
  displayGeneratedImage,
  renderGenerationConfigUI,
} from './ui-render.js';
import {
  requestCustomToken,
  requestDiagnosis,
  generateHairstyleImage,
  refineHairstyleImage,
  saveImageToGallery,
  saveScreenshotToGallery,
  uploadFileToStorage,
} from './api.js';

// --- Initialization ---

const initializeAppProcess = async () => {
  try {
    if (IS_DEV_MODE && USE_MOCK_AUTH) {
      return { profile: { userId: 'dev-user', displayName: 'Dev User' }, accessToken: 'dev-token' };
    }
    if (typeof liff === 'undefined') throw new Error('LIFF SDK not loaded.');

    await liff.init({ liffId: appState.liffId });
    if (!liff.isLoggedIn()) {
      liff.login();
      return null;
    }
    return { profile: await liff.getProfile(), accessToken: liff.getAccessToken() };
  } catch (err) {
    console.error('[Init] Failed:', err);
    throw err;
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[main.js] DOMContentLoaded fired');
  const loadTimeout = setTimeout(() => {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen && loadingScreen.style.display !== 'none') {
      hideLoadingScreen();
      changePhase('phase1');
      alert('起動に時間がかかりました。');
    }
  }, 10000);

  try {
    const app = initializeApp(appState.firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);
    const functions = getFunctions(app, 'asia-northeast1');

    // ★重要: オブジェクトを丸ごと上書きせず、個別に代入することで参照を維持する
    appState.firebase.app = app;
    appState.firebase.auth = auth;
    appState.firebase.firestore = db;
    appState.firebase.storage = storage;
    appState.firebase.functions = functions;

    console.log('[main.js] Firebase instances initialized (Reference preserved)');
    // 環境判定とエミュレータ接続
    const isLocalhost =
      import.meta.env.DEV ||
      ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.hostname.startsWith('10.') ||
      window.location.hostname.startsWith('172.');

    if (isLocalhost) {
      const { connectAuthEmulator } = await import('firebase/auth');
      const { connectFirestoreEmulator } = await import('firebase/firestore');
      const { connectStorageEmulator } = await import('firebase/storage');
      const { connectFunctionsEmulator } = await import('firebase/functions');

      const emuHost = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
      connectAuthEmulator(auth, `http://${emuHost}:9099`);
      connectFirestoreEmulator(db, emuHost, 8080);
      connectStorageEmulator(storage, emuHost, 9199);
      connectFunctionsEmulator(functions, emuHost, 5001);
      console.log('[diagnosis] Emulators connected to:', emuHost);
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('customerId')) {
      appState.userProfile.viaAdmin = true;
      appState.userProfile.firebaseUid = params.get('customerId');
      appState.userProfile.displayName = decodeURIComponent(params.get('customerName') || '');
    }

    const liffResult = await initializeAppProcess();
    clearTimeout(loadTimeout);

    if (liffResult) {
      if (!appState.userProfile.viaAdmin) {
        appState.userProfile.userId = liffResult.profile.userId;
        appState.userProfile.firebaseUid = liffResult.profile.userId;
        appState.userProfile.displayName = liffResult.profile.displayName;
      }

      try {
        const performAuth = async () => {
          if (IS_DEV_MODE && USE_MOCK_AUTH) {
            await signInAnonymously(appState.firebase.auth);
          } else {
            console.log('[main.js] Requesting Custom Token...');
            const { customToken } = await requestCustomToken(liffResult.accessToken);
            if (customToken) {
              console.log('[main.js] Signing in with Custom Token...');
              await signInWithCustomToken(appState.firebase.auth, customToken);
            }
          }
        };
        const timeoutAuth = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Firebase Auth Timed out')), 4000)
        );
        await Promise.race([performAuth(), timeoutAuth]);
        console.log('[main.js] Auth Completed');
      } catch (e) {
        console.error('[main.js] Auth flow failed or timed out:', e);
      }
    } else {
      return;
    }

    initializeAppUI();
    hideLoadingScreen();
  } catch (error) {
    clearTimeout(loadTimeout);
    initializeAppFailure(error.message);
  }
});

function initializeAppUI() {
  setupEventListeners();
  setTextContent('display-name', appState.userProfile.displayName || 'ゲスト');

  // Greeting
  const greetingEl = document.getElementById('user-greeting');
  if (greetingEl) {
    const userName = appState.userProfile.displayName || 'ゲスト';
    greetingEl.textContent = `ようこそ ${userName} 様！`;
  }

  const genderRadio = document.querySelector(`input[name="gender"][value="${appState.gender}"]`);
  if (genderRadio) genderRadio.checked = true;

  changePhase('phase1');
  document.body.style.display = 'block';
}

function setupEventListeners() {
  // Phase Navigation
  document.getElementById('start-btn')?.addEventListener('click', () => changePhase('phase2'));
  document.getElementById('next-to-upload-btn')?.addEventListener('click', () => {
    const g = document.querySelector('input[name="gender"]:checked');
    if (g) appState.gender = g.value;
    changePhase('phase3');
    checkCloudUploads();
  });

  // Inspiration Upload
  const inspInput = document.getElementById('inspiration-image-input');
  const inspBtn = document.getElementById('inspiration-upload-btn');
  if (inspInput) {
    const trigger = (e) => {
      e.stopPropagation();
      inspInput.click();
    };
    document.getElementById('inspiration-upload-container')?.addEventListener('click', trigger);
    if (inspBtn) inspBtn.addEventListener('click', trigger);
    inspInput.addEventListener('change', handleInspirationSelect);
  }
  document.getElementById('inspiration-delete-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    handleInspirationDelete();
  });

  // Phase 3 Viewer
  document.getElementById('reload-viewer-btn')?.addEventListener('click', checkCloudUploads);
  document
    .getElementById('request-diagnosis-btn-viewer')
    ?.addEventListener('click', handleDiagnosisRequest);

  // File Selection (Photos/Videos)
  document.querySelectorAll('.upload-item').forEach((item) => {
    if (item.closest('#phase3')) return; // Check logic from legacy
    const btn = item.querySelector('button');
    const input = item.querySelector('.file-input');
    if (btn && input) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!btn.disabled) input.click();
      });
      input.addEventListener('change', (e) => handleFileSelect(e, item.id, btn));
    }
  });

  // Proposals
  document.getElementById('next-to-proposal-btn')?.addEventListener('click', () => {
    displayProposalResult(appState.aiProposal);
    changePhase('phase5');
  });

  // Navigation between Phase 5 and Phase 5-2
  document.getElementById('next-to-phase5-2-btn')?.addEventListener('click', () => {
    changePhase('phase5-2');
  });

  document.getElementById('back-to-phase5-btn')?.addEventListener('click', () => {
    changePhase('phase5');
  });

  document.getElementById('move-to-phase6-btn')?.addEventListener('click', () => {
    renderGenerationConfigUI();
    changePhase('phase6');
  });

  // Generation
  document.getElementById('generate-image-btn')?.addEventListener('click', async () => {
    changePhase('phase7');
    await handleImageGenerationRequest();
  });

  // Adjustments (Phase 7)
  document.getElementById('btn-back-style')?.addEventListener('click', () => changePhase('phase6'));
  document
    .getElementById('refine-image-btn')
    ?.addEventListener('click', handleImageRefinementRequest);
  document.getElementById('btn-save')?.addEventListener('click', handleSaveGeneratedImage);

  // Back Buttons
  document
    .getElementById('back-to-diagnosis-btn')
    ?.addEventListener('click', () => changePhase('phase4'));
  document
    .getElementById('back-to-proposal-btn')
    ?.addEventListener('click', () => changePhase('phase5-2'));
  document
    .getElementById('back-to-proposal-btn-p6')
    ?.addEventListener('click', () => changePhase('phase5-2'));
  document.getElementById('close-liff-btn')?.addEventListener('click', () => liff?.closeWindow());

  // Screenshot Buttons
  document
    .getElementById('save-phase4-btn')
    ?.addEventListener('click', () => captureAndSave('#phase4 .card', 'AI診断結果'));
  document
    .getElementById('save-phase5-btn')
    ?.addEventListener('click', () => captureAndSave('#phase5 .card', 'AI提案内容1'));
  document
    .getElementById('save-phase5-2-btn')
    ?.addEventListener('click', () => captureAndSave('#phase5-2 .card', 'AI提案内容2'));

  // Fader / Adjustment Listeners
  setupAdustmentListeners();
}

// --- Upload Logic Helpers ---

async function handleFileSelect(e, itemId, btn) {
  const file = e.target.files?.[0];
  if (!file) return;

  btn.textContent = '処理中...';
  btn.disabled = true;
  delete appState.uploadedFileUrls[itemId];
  checkAllFilesUploaded(false);

  try {
    const isVideo = itemId.includes('video');
    const processed = !isVideo && file.type.startsWith('image/') ? await compressImage(file) : file;

    // Save Blob locally
    if (!appState.localBlobs) appState.localBlobs = {};
    appState.localBlobs[itemId] = processed;

    // Upload
    const path = `guest_uploads/${appState.userProfile.firebaseUid}/${itemId}`;
    const url = await uploadFileToStorage(processed, path);

    appState.uploadedFileUrls[itemId] = url;
    btn.textContent = '完了';
    btn.classList.replace('btn-outline', 'btn-success');
    document.querySelector(`#${itemId} .upload-icon`)?.classList.add('completed');

    const allSet = [
      'item-front-photo',
      'item-side-photo',
      'item-back-photo',
      'item-front-video',
      'item-back-video',
    ].every((k) => appState.uploadedFileUrls[k]);
    checkAllFilesUploaded(allSet);
  } catch (err) {
    showModal('エラー', 'アップロード失敗: ' + err.message);
    btn.textContent = '撮影';
    btn.disabled = false;
  } finally {
    if (e && e.target) e.target.value = null;
  }
}

async function handleInspirationSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const btn = document.getElementById('inspiration-upload-btn');
  const status = document.getElementById('inspiration-upload-status');
  const preview = document.getElementById('inspiration-image-preview');
  const container = document.getElementById('inspiration-upload-container');

  const localUrl = URL.createObjectURL(file);
  if (preview) preview.src = localUrl;
  if (container) container.classList.add('has-preview');

  if (btn) btn.disabled = true;
  if (status) status.textContent = 'アップロード中...';

  try {
    const processed = file.type.startsWith('image/') ? await compressImage(file) : file;

    // Upload with timestamp
    const timestamp = Date.now();
    const path = `uploads/${appState.userProfile.firebaseUid}/item-inspiration-photo-${timestamp}-${file.name}`;

    const url = await uploadFileToStorage(processed, path);

    appState.uploadedFileUrls['item-inspiration-photo'] = url;
    appState.inspirationImageUrl = url;

    if (preview) preview.src = url;
    document.getElementById('inspiration-upload-title').textContent = '選択済み';
    if (status) status.textContent = 'タップして変更';
    document.getElementById('inspiration-delete-btn').style.display = 'inline-block';
    if (btn) {
      btn.textContent = '変更';
      btn.disabled = false;
    }

    // Save to Gallery Background
    saveImageToGallery(
      appState.userProfile.firebaseUid,
      processed,
      'inspiration',
      'inspiration',
      '参考画像'
    ).catch((e) => console.warn('Background Save Error:', e));
  } catch (err) {
    console.error(err);
    showModal('エラー', 'アップロード失敗: ' + err.message);
    if (btn) btn.disabled = false;
    if (status) status.textContent = 'タップして画像を選択';
    if (preview) preview.removeAttribute('src');
  } finally {
    if (e && e.target) e.target.value = null;
  }
}

function handleInspirationDelete() {
  appState.uploadedFileUrls['item-inspiration-photo'] = null;
  appState.inspirationImageUrl = null;
  document.getElementById('inspiration-image-preview').removeAttribute('src');
  document.getElementById('inspiration-upload-container').classList.remove('has-preview');
  document.getElementById('inspiration-upload-title').textContent = '写真を選択';
  document.getElementById('inspiration-delete-btn').style.display = 'none';
  document.getElementById('inspiration-upload-btn').textContent = '選択';
  document.getElementById('inspiration-image-input').value = null;
}

// --- Diagnosis & Viewer ---

async function handleDiagnosisRequest() {
  try {
    changePhase('phase3.5');
    const res = await requestDiagnosis(
      appState.uploadedFileUrls,
      appState.userProfile,
      appState.gender
    );

    appState.aiDiagnosisResult = res.result;
    appState.aiProposal = res.proposal;
    displayDiagnosisResult(res.result);
    changePhase('phase4');
  } catch (err) {
    showModal('診断エラー', err.message);
    changePhase('phase3');
  }
}

async function checkCloudUploads() {
  const uid = appState.userProfile.firebaseUid;
  const items = [
    'item-front-photo',
    'item-side-photo',
    'item-back-photo',
    'item-front-video',
    'item-back-video',
  ];
  let loadedCount = 0;

  const btn = document.getElementById('reload-viewer-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '確認中...';
  }

  for (const itemId of items) {
    const viewId = 'view-' + itemId;
    const viewEl = document.getElementById(viewId);
    if (!viewEl) continue;

    try {
      const path = `guest_uploads/${uid}/${itemId}`;
      const storage = appState.firebase.storage;
      const storageRef = ref(storage, path);
      const url = await getDownloadURL(storageRef);

      appState.uploadedFileUrls[itemId] = url;
      viewEl.classList.remove('pending');
      viewEl.classList.add('ready');
      viewEl.querySelector('.status-badge').textContent = 'OK';

      const thumb = viewEl.querySelector('.viewer-thumbnail');
      thumb.innerHTML = '';
      if (itemId.includes('video')) {
        thumb.innerHTML = `<div style="position:absolute;z-index:1">▶️</div><video src="${url}" muted style="width:100%;height:100%;object-fit:cover"></video>`;
      } else {
        thumb.innerHTML = `<img src="${url}" alt="OK">`;
      }
      loadedCount++;
    } catch (e) {
      viewEl.classList.remove('ready');
      viewEl.classList.add('pending');
      viewEl.querySelector('.status-badge').textContent = '未アップロード';
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = '再読み込み';
  }
  const nextBtn = document.getElementById('request-diagnosis-btn-viewer');
  if (nextBtn) nextBtn.disabled = loadedCount !== items.length;
}

// --- Generation & Refinment ---

async function handleImageGenerationRequest() {
  toggleLoader(true, 'AIが画像を生成しています...');
  try {
    const styleSelect = document.querySelector('input[name="style-select"]:checked')?.value;
    const colorSelect = document.querySelector('input[name="color-select"]:checked')?.value;
    const toneSelect = document.getElementById('hair-tone-select')?.value;

    if (!styleSelect || !colorSelect) throw new Error('スタイルとカラーを選択してください。');

    let hName, hDesc, cName, cDesc, recLevel;
    let isUserStyle = false,
      isUserColor = false,
      keepStyle = false,
      keepColor = false;

    // Logic for Style
    if (styleSelect === 'user_request') {
      hName = 'ご希望スタイル';
      hDesc = '写真から再現';
      isUserStyle = true;
    } else if (styleSelect === 'keep_style') {
      hName = '現在の髪型';
      hDesc = '維持';
      keepStyle = true;
    } else {
      const s = appState.aiProposal.hairstyles[styleSelect];
      hName = s?.name || styleSelect;
      hDesc = s?.description || '';
    }

    // Logic for Color
    if (colorSelect === 'user_request') {
      cName = 'ご希望カラー';
      cDesc = '写真から再現';
      isUserColor = true;
      recLevel = toneSelect || '';
    } else if (colorSelect === 'keep_color') {
      cName = '現在の髪色';
      cDesc = '維持';
      keepColor = true;
      recLevel = toneSelect || '';
    } else {
      const c = appState.aiProposal.haircolors[colorSelect];
      cName = c?.name || colorSelect;
      cDesc = c?.description || '';
      recLevel = toneSelect || c?.recommendedLevel;
    }

    const userReq = document.getElementById('user-requests')?.value || '';

    const params = {
      originalImageUrl: appState.uploadedFileUrls['item-front-photo'],
      firebaseUid: appState.userProfile.firebaseUid,
      hairstyleName: hName,
      hairstyleDesc: hDesc,
      haircolorName: cName,
      haircolorDesc: cDesc,
      recommendedLevel: recLevel,
      currentLevel: appState.aiDiagnosisResult?.hairCondition?.currentLevel || 'Tone 7',
      userRequestsText: userReq,
      inspirationImageUrl: appState.inspirationImageUrl,
      isUserStyle,
      isUserColor,
      hasToneOverride: !!toneSelect,
      keepStyle,
      keepColor,
    };

    const res = await generateHairstyleImage(params);

    appState.generatedImageDataBase64 = res.imageBase64;
    appState.generatedImageMimeType = res.mimeType;

    displayGeneratedImage(res.imageBase64, res.mimeType, hName, cName, recLevel);
  } catch (err) {
    showModal('生成エラー', err.message);
  } finally {
    toggleLoader(false);
  }
}

async function handleImageRefinementRequest() {
  const input = document.getElementById('refinement-prompt-input');
  if (!input?.value || !appState.generatedImageDataBase64) return;

  toggleLoader(true, '修正中...');
  try {
    const dataUrl = `data:${appState.generatedImageMimeType};base64,${appState.generatedImageDataBase64}`;
    const res = await refineHairstyleImage(dataUrl, appState.userProfile.firebaseUid, input.value);

    appState.generatedImageDataBase64 = res.imageBase64;
    appState.generatedImageMimeType = res.mimeType;

    displayGeneratedImage(res.imageBase64, res.mimeType, 'Refined', 'Refined', '');
    input.value = '';
  } catch (err) {
    showModal('調整エラー', err.message);
  } finally {
    toggleLoader(false);
  }
}

async function handleSaveGeneratedImage() {
  // Save the composite canvas (Phase 6 canvas)
  const canvas = document.getElementById('phase6-canvas');
  if (!canvas) return;

  toggleLoader(true, '保存中...');
  try {
    // Create blob from canvas
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Canvas blob creation failed');

    await saveImageToGallery(
      blob,
      appState.userProfile.firebaseUid,
      'Generated',
      'Generated',
      'Manual Save'
    );
    showModal('保存完了', 'ギャラリーに画像を保存しました！');
  } catch (err) {
    showModal('保存エラー', err.message);
  } finally {
    toggleLoader(false);
  }
}

// --- Screenshot Capture ---

async function captureAndSave(selector, title) {
  const element = document.querySelector(selector);
  if (!element) return;
  toggleLoader(true, '保存中...');

  // Store original styles to restore later
  const originalHeight = element.style.height;
  const originalOverflow = element.style.overflow;
  const originalMaxHeight = element.style.maxHeight;

  try {
    // Temporarily expand element to capture full content
    // This is necessary for scrollable containers like Phase 5
    element.style.height = element.scrollHeight + 'px';
    element.style.overflow = 'visible';
    element.style.maxHeight = 'none';

    // Brief delay to ensure layout updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    const canvas = await html2canvas(element, {
      useCORS: true,
      scale: 2,
      backgroundColor: '#ffffff',
      windowHeight: element.scrollHeight,
      scrollY: -window.scrollY, // Correct scrolling offset
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await saveScreenshotToGallery(blob, appState.userProfile.firebaseUid, title);

    showModal('保存完了', `${title}を保存しました！`);
  } catch (error) {
    console.error('Capture failed:', error);
    showModal('保存失敗', '画面の保存に失敗しました。\n' + error.message);
  } finally {
    // Restore original styles
    element.style.height = originalHeight;
    element.style.overflow = originalOverflow;
    element.style.maxHeight = originalMaxHeight;
    toggleLoader(false);
  }
}
