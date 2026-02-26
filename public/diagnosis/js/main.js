import liff from '@line/liff';
import html2canvas from 'html2canvas';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import { getStorage, ref, getDownloadURL, listAll } from 'firebase/storage';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { initializeLiffAndAuth, db, auth, storage, functions } from '../../admin/firebase-init.js';

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
  getGalleryImages,
} from './api.js';

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[main.js] DOMContentLoaded fired');
  const loadTimeout = setTimeout(() => {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen && loadingScreen.style.display !== 'none') {
      hideLoadingScreen();
      changePhase('phase1');
      alert('起動に時間がかかりました。ネットワーク環境をご確認ください。');
    }
  }, 10000);

  try {
    // 1. URLパラメータから管理者経由のアクセスかどうかを判定
    const params = new URLSearchParams(window.location.search);
    if (params.get('customerId')) {
      appState.userProfile.viaAdmin = true;
      appState.userProfile.firebaseUid = params.get('customerId');
      appState.userProfile.userId = params.get('customerId');
      appState.userProfile.displayName = decodeURIComponent(params.get('customerName') || '');
    }

    // 2. 統合されたLIFFとFirebaseの初期化処理を呼び出す
    console.log('[main.js] Calling centralized initializeLiffAndAuth...');
    const initResult = await initializeLiffAndAuth(appState.liffId);
    clearTimeout(loadTimeout);

    if (initResult && initResult.error) {
      // LIFFの初期化エラー時はアラートを出しつつ、UIブロックを解除して続行（デバッグ用）
      console.warn('[main.js] Initialization warning:', initResult.error);
      alert('システムの初期化に問題が発生しましたが、続行します。\n' + initResult.error);
    } else if (initResult) {
      if (!appState.userProfile.viaAdmin) {
        appState.userProfile.userId = initResult.profile?.userId || 'unknown';
        appState.userProfile.firebaseUid = initResult.user?.uid || 'unknown';
        appState.userProfile.displayName = initResult.profile?.displayName || 'お客様';
      }
      console.log(`[main.js] Init complete. User: ${appState.userProfile.displayName} (${appState.userProfile.firebaseUid})`);
    } else {
      // initResult が無い場合 (ログイン中などで中断された場合) はここで処理終了
      console.log('[main.js] Waiting for LIFF login redirect...');
      return;
    }

    // ★重要: グローバルの appState に Firebase インスタンスの参照を保存しておく
    appState.firebase.auth = auth;
    appState.firebase.firestore = db;
    appState.firebase.storage = storage;
    appState.firebase.functions = functions;

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

  // Gallery Selection Modal logic
  const galleryBtn = document.getElementById('inspiration-gallery-btn');
  const galleryModal = document.getElementById('gallery-selection-modal');
  const closeGalleryBtn = document.getElementById('close-gallery-modal-btn');

  if (galleryBtn) {
    galleryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openGalleryModal();
    });
  }
  if (closeGalleryBtn) {
    closeGalleryBtn.addEventListener('click', () => {
      galleryModal.style.display = 'none';
      galleryModal.classList.remove('active');
    });
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

  // File Selection (Photos/Videos) - New Logic for Phase 3
  document.querySelectorAll('.upload-item-p3').forEach((item) => {
    const input = item.querySelector('.p3-upload-input');
    if (input) {
      // Clicking the whole item triggers input
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        input.click();
      });
      // Handle file selection
      input.addEventListener('change', (e) => handleFileSelect(e, item.id));
    }
  });

  // Legacy/Other File Selection (if any)
  document.querySelectorAll('.upload-item').forEach((item) => {
    if (item.closest('#phase3')) return;
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
    console.log('[DEBUG] Phase 6 Entry - appState.aiProposal:', appState.aiProposal);
    console.log('[DEBUG] Phase 6 Entry - appState.aiDiagnosisResult:', appState.aiDiagnosisResult);
    renderGenerationConfigUI();
    changePhase('phase6');
  });

  // Generation (Integrated in Phase 6)
  document.getElementById('generate-image-btn')?.addEventListener('click', async () => {
    // We stay in Phase 6 now, the canvas is on the same screen
    await handleImageGenerationRequest();
  });

  // Adjustments (Integrated in Phase 6)
  document.getElementById('btn-back-style')?.addEventListener('click', () => {
    // This button might be removed or hidden, but keeping for compatibility
  });
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
    ?.addEventListener('click', () => captureAndSave('#phase4 .p4-layout', 'AI診断結果'));
  document
    .getElementById('save-phase5-btn')
    ?.addEventListener('click', () => captureAndSave('#phase5 .p5-layout-2col', 'AI提案内容1'));
  document
    .getElementById('save-phase5-2-btn')
    ?.addEventListener('click', () => captureAndSave('#phase5-2 .p5-layout-2col', 'AI提案内容2'));

  // Fader / Adjustment Listeners
  setupAdustmentListeners();
}

// --- Upload Logic Helpers ---

async function handleFileSelect(e, itemId, btn) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (btn) {
    btn.textContent = '処理中...';
    btn.disabled = true;
  }
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
  document.getElementById('inspiration-upload-status').textContent = 'タップして画像を選択、またはギャラリーから';
  document.getElementById('inspiration-image-input').value = null;
}

// --- Gallery Selection ---
async function openGalleryModal() {
  const modal = document.getElementById('gallery-selection-modal');
  const grid = document.getElementById('gallery-selection-grid');
  const emptyMsg = document.getElementById('gallery-selection-empty');

  if (!modal || !grid) return;

  modal.style.display = 'flex';
  modal.classList.add('active');
  grid.innerHTML = '';
  emptyMsg.style.display = 'none';

  toggleLoader(true, 'ギャラリーを読み込み中...');

  try {
    const images = await getGalleryImages(appState.userProfile.userId || appState.userProfile.firebaseUid);

    if (!images || images.length === 0) {
      emptyMsg.style.display = 'block';
      return;
    }

    images.forEach(imgData => {
      const imgContainer = document.createElement('div');
      imgContainer.style.position = 'relative';
      imgContainer.style.cursor = 'pointer';
      imgContainer.style.borderRadius = '8px';
      imgContainer.style.overflow = 'hidden';
      imgContainer.style.aspectRatio = '1/1';
      imgContainer.style.border = '2px solid transparent';

      const imgEl = document.createElement('img');
      imgEl.src = imgData.url;
      imgEl.style.width = '100%';
      imgEl.style.height = '100%';
      imgEl.style.objectFit = 'cover';

      imgContainer.appendChild(imgEl);

      imgContainer.addEventListener('click', () => {
        selectGalleryImage(imgData.url);
        modal.style.display = 'none';
        modal.classList.remove('active');
      });

      imgContainer.addEventListener('mouseover', () => {
        imgContainer.style.border = '2px solid var(--primary-color)';
      });
      imgContainer.addEventListener('mouseout', () => {
        imgContainer.style.border = '2px solid transparent';
      });

      grid.appendChild(imgContainer);
    });
  } catch (error) {
    console.error('ギャラリー読み込みエラー:', error);
    showModal('エラー', 'ギャラリーの読み込みに失敗しました。');
  } finally {
    toggleLoader(false);
  }
}

function selectGalleryImage(url) {
  const preview = document.getElementById('inspiration-image-preview');
  const container = document.getElementById('inspiration-upload-container');
  const title = document.getElementById('inspiration-upload-title');
  const status = document.getElementById('inspiration-upload-status');
  const deleteBtn = document.getElementById('inspiration-delete-btn');

  appState.inspirationImageUrl = url;
  appState.uploadedFileUrls['item-inspiration-photo'] = url;

  if (preview) {
    preview.src = url;
    preview.style.display = 'block';
  }
  if (container) container.classList.add('has-preview');
  if (title) title.textContent = '選択済み';
  if (status) status.textContent = 'ギャラリーから選択しました';
  if (deleteBtn) deleteBtn.style.display = 'inline-block';
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

    // バックアップの保存 (HMR・リロード対策)
    try {
      sessionStorage.setItem('yhd_backup_proposal', JSON.stringify(res.proposal));
      sessionStorage.setItem('yhd_backup_result', JSON.stringify(res.result));
      sessionStorage.setItem('yhd_backup_urls', JSON.stringify(appState.uploadedFileUrls));
    } catch (e) {
      console.warn('sessionStorageへのバックアップ保存に失敗しました:', e);
    }

    displayDiagnosisResult(res.result);
    changePhase('phase4');
  } catch (err) {
    showModal('診断エラー', err.message);
    changePhase('phase3');
  }
}

async function checkCloudUploads() {
  const uid = appState.userProfile.userId;
  if (!uid) {
    console.warn('[checkCloudUploads] No UID found. Skipping cloud check.');
    return;
  }

  const storage = appState.firebase.storage;
  if (!storage) {
    console.warn('[checkCloudUploads] Storage not initialized.');
    return;
  }

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

  try {
    // Step 1: List all files in the user's upload directory (1 request, no 404)
    const dirRef = ref(storage, `guest_uploads/${uid}`);
    const listResult = await listAll(dirRef);
    const existingFileNames = new Set(listResult.items.map(item => item.name));

    // Step 2: For each expected item, check if it exists in the listing
    for (const itemId of items) {
      const viewEl = document.getElementById(itemId);
      if (!viewEl) continue;

      if (existingFileNames.has(itemId)) {
        // File exists - safe to call getDownloadURL (no 404)
        try {
          const fileRef = ref(storage, `guest_uploads/${uid}/${itemId}`);
          const url = await getDownloadURL(fileRef);

          appState.uploadedFileUrls[itemId] = url;
          viewEl.classList.remove('pending');
          viewEl.classList.add('ready');
          const badge = viewEl.querySelector('.status-badge');
          if (badge) badge.textContent = 'OK';

          const thumb = viewEl.querySelector('.viewer-thumbnail');
          if (thumb) {
            thumb.innerHTML = '';
            if (itemId.includes('video')) {
              thumb.innerHTML = `<div style="position:absolute;z-index:1">▶️</div><video src="${url}" muted style="width:100%;height:100%;object-fit:cover"></video>`;
            } else {
              thumb.innerHTML = `<img src="${url}" alt="OK">`;
            }
          }
          loadedCount++;
        } catch (err) {
          console.warn(`[checkCloudUploads] getDownloadURL failed for ${itemId}:`, err.message);
        }
      } else {
        // File does NOT exist - just mark as pending, NO HTTP request
        viewEl.classList.remove('ready');
        viewEl.classList.add('pending');
        const badge = viewEl.querySelector('.status-badge');
        if (badge) badge.textContent = '未アップロード';
      }
    }
  } catch (err) {
    // listAll itself failed (e.g. auth issue, network down)
    console.warn('[checkCloudUploads] listAll failed:', err.message);
    items.forEach(itemId => {
      const viewEl = document.getElementById(itemId);
      if (viewEl) {
        viewEl.classList.remove('ready');
        viewEl.classList.add('pending');
        const badge = viewEl.querySelector('.status-badge');
        if (badge) badge.textContent = 'Pending';
      }
    });
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
  if (!appState.uploadedFileUrls['item-front-photo']) {
    alert('元画像が見つかりません。フェーズ1から画像をアップロードしてください。');
    return;
  }

  toggleLoader(true, 'AIが画像を生成しています...');

  // 画像エリア専用のローディングを表示
  const p6Overlay = document.getElementById('p6-generation-overlay');
  if (p6Overlay) p6Overlay.style.display = 'flex';

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

/**
 * ユーザーの日本語入力をAI用の構造化プロンプトに変換する
 */
function buildRefinementPrompt(userInput, currentState) {
  // 基本となる品質キーワード（ネガティブな変化を防ぐ）
  const qualityBase = "highly detailed, photorealistic, salon quality, maintaining face identity, keep the face strictly unchanged, maintain original facial features";
  const negativePrompt = "Avoid: cartoon, drawing, blurry, green skin, messy, changing facial features";

  // 頻出する日本語の要望を英語の最適化プロンプトにマッピング
  const promptMap = {
    "もう少し明るくして": "increase hair brightness by 2 tones, maintaining the current color, high-gloss finish",
    "明るく": "increase hair brightness by 1-2 tones",
    "赤みを消したい": "remove red and orange undertones, apply cool matte ash toner, neutralized color",
    "赤み": "remove red and orange undertones, apply cool matte ash toner",
    "前髪を少し短く": "slightly shorten the bangs to just above the eyebrows, keep the natural see-through texture",
    "前髪": "focus on adjusting the bangs while keeping the rest of the hair intact",
    "もっとツヤが欲しい": "add professional salon hair gloss, enhance specular highlights on hair surface, healthy texture",
    "ツヤ": "add professional salon hair gloss, healthy texture",
    "ボリュームを抑えて": "reduce hair volume, sleek and polished look, minimize frizz, straight-down silhouette",
    "ボリューム": "adjust hair volume"
  };

  let optimizedRequest = userInput;
  // より具体的なフレーズからマッチさせるため、キーの長さ順でソートしてチェック
  const sortedKeys = Object.keys(promptMap).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (userInput.includes(key)) {
      // ユーザーの元のテキストも一部残しつつ、最適化されたプロンプトを追加
      const mappedValue = promptMap[key];
      optimizedRequest = `${mappedValue} (User intent: ${userInput})`;
      break;
    }
  }

  // 現在の診断状態（currentStateから取得）をコンテキストとして追加
  const context = `current style: ${currentState.hairstyleName}, current color: ${currentState.haircolorName}`;

  // 最終的なプロンプトの組み立て
  return `[Action: Refine hair image] 
[Request: ${optimizedRequest}] 
[Context: ${context}] 
[Output Requirement: ${qualityBase}]
[Negative: ${negativePrompt}]`.replace(/\n/g, ' ');
}

async function handleImageRefinementRequest() {
  const input = document.getElementById('refinement-prompt-input');
  const rawValue = input?.value;
  if (!rawValue || !appState.generatedImageDataBase64) return;

  // 現在選択されているスタイルとカラーを取得
  const styleSelect = document.querySelector('input[name="style-select"]:checked')?.value;
  const colorSelect = document.querySelector('input[name="color-select"]:checked')?.value;

  let hName = "selected style";
  let cName = "selected color";

  if (styleSelect && appState.aiProposal?.hairstyles?.[styleSelect]) {
    hName = appState.aiProposal.hairstyles[styleSelect].name;
  } else if (styleSelect === 'keep_style') {
    hName = "current hair style";
  } else if (styleSelect === 'user_request') {
    hName = "user requested style";
  }

  if (colorSelect && appState.aiProposal?.haircolors?.[colorSelect]) {
    cName = appState.aiProposal.haircolors[colorSelect].name;
  } else if (colorSelect === 'keep_color') {
    cName = "current hair color";
  } else if (colorSelect === 'user_request') {
    cName = "user requested color";
  }

  // 構造化プロンプトに変換
  const optimizedPrompt = buildRefinementPrompt(rawValue, {
    hairstyleName: hName,
    haircolorName: cName
  });

  toggleLoader(true, 'AIが細部を調整中...');
  try {
    const dataUrl = `data:${appState.generatedImageMimeType};base64,${appState.generatedImageDataBase64}`;
    const res = await refineHairstyleImage(dataUrl, appState.userProfile.firebaseUid, optimizedPrompt);

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

    // CORS対策: DOM内の全video, img要素にcrossOrigin="anonymous"を強制付与
    const mediaElements = element.querySelectorAll('video, img');
    mediaElements.forEach(el => {
      if (!el.getAttribute('crossorigin')) {
        el.setAttribute('crossorigin', 'anonymous');
      }
    });

    // Brief delay to ensure layout updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    const canvas = await html2canvas(element, {
      useCORS: true,
      allowTaint: true,
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
