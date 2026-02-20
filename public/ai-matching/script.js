// Firebase Imports
import { db, storage, functions } from '../admin/firebase-init.js';
import {
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  ref,
  uploadString,
  getDownloadURL,
  listAll,
  uploadBytes,
} from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import html2canvas from 'html2canvas';

// ... (省略) ...

// ヘルパー: 最新のBefore画像を取得 (予約時の写真)
async function fetchLatestBeforeImage(customerId) {
  if (!customerId) return null;
  try {
    const listRef = ref(storage, `uploads/${customerId}`);
    const res = await listAll(listRef);

    // ファイル名でフィルタリング & ソート
    // パターン: item-front-photo-{number}-image.jpg
    const frontPhotos = res.items.filter(
      (item) => item.name.startsWith('item-front-photo-') && item.name.endsWith('-image.jpg')
    );

    if (frontPhotos.length === 0) return null;

    // 数字部分で降順ソート (最新のもの)
    frontPhotos.sort((a, b) => {
      const numA = parseInt(a.name.match(/item-front-photo-(\d+)-image\.jpg/)?.[1] || 0);
      const numB = parseInt(b.name.match(/item-front-photo-(\d+)-image\.jpg/)?.[1] || 0);
      return numB - numA;
    });

    const latestRef = frontPhotos[0];
    return await getDownloadURL(latestRef);
  } catch (error) {
    console.error('Failed to fetch before image:', error);
    return null;
  }
}

// ヘルパー: 結果表示
async function displayResult(data) {
  inputScreen.classList.remove('active');

  // ボタン表示切り替え
  updateHeaderButtons('result');

  setTimeout(async () => {
    resultScreen.classList.add('active');

    const scoreElem = document.querySelector('.score-value');
    scoreElem.innerHTML = `${data.score}<span class="percent">%</span>`;
    document.querySelector('.reason-text').textContent = data.reason;

    // Before画像: Storageから最新の予約写真を取得
    const beforeImgElem = document.getElementById('result-before-img');
    const latestBookingPhotoUrl = await fetchLatestBeforeImage(appState.customerId);

    if (latestBookingPhotoUrl) {
      beforeImgElem.src = latestBookingPhotoUrl;
    } else {
      // 予約写真がない場合は、今回撮影(または取得)したFront写真を使う
      const fallbackSrc = appState.photos.front || appState.uploadedUrls.front;
      if (fallbackSrc) {
        beforeImgElem.src = fallbackSrc;
      }
    }

    // After画像: 今回撮影(または取得)したFront写真
    const afterImgElem = document.getElementById('result-after-img');
    const frontSrc = appState.photos.front || appState.uploadedUrls.front;

    if (frontSrc) {
      afterImgElem.src = frontSrc;
    } else {
      // Frontがない場合はSide等で代用
      const altSrc =
        appState.photos.side ||
        appState.photos.back ||
        appState.uploadedUrls.side ||
        appState.uploadedUrls.back;
      if (altSrc) afterImgElem.src = altSrc;
    }

    // ボタン状態リセット（戻ってきたとき用）
    const diagnoseBtn = document.getElementById('header-diagnose-btn');
    if (diagnoseBtn) {
      diagnoseBtn.disabled = false;
      diagnoseBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 診断開始';
    }
  }, 300);
}

// 画面遷移のロジック
const inputScreen = document.getElementById('input-screen');
const resultScreen = document.getElementById('result-screen');

// アプリの状態
const appState = {
  customerId: null, // 追加: 顧客ID
  customerName: null, // 追加: 顧客名
  photos: {
    front: null,
    side: null,
    back: null,
    // 実際のファイルデータではなく、DataURL (Base64) を保持
  },
  uploadedUrls: {
    front: null,
    side: null,
    back: null,
  },
};

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', async () => {
  // URLパラメータから情報を取得
  const params = new URLSearchParams(window.location.search);
  const customerId = params.get('customerId');
  const customerName = params.get('customerName');

  // 1. URLから名前が渡されていればそれを表示 (最速)
  if (customerName) {
    const decodedName = decodeURIComponent(customerName);
    appState.customerName = decodedName;
    updateTitleWithName(decodedName);
  }

  if (customerId) {
    appState.customerId = customerId;

    // 名前がまだない場合のみFirestoreに取りに行く
    if (!appState.customerName) {
      try {
        const userDoc = await getDoc(doc(db, 'users', customerId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          appState.customerName = userData.name;
          updateTitleWithName(userData.name);
        }
      } catch (error) {
        console.error('Error fetching customer:', error);
        // 認証エラーなどで取得できない場合は無視する
      }
    }
  }
});

function updateTitleWithName(name) {
  const titleElem = document.querySelector('.app-title');
  if (titleElem) {
    titleElem.innerHTML = `YHD AI Matching <small>for ${name}様</small>`;
  }
}
// moduleとして読み込まれるため、グローバル関数をwindowに割り当てる
window.triggerCamera = (type) => {
  console.log('Triggering camera for:', type);
  const input = document.getElementById(`input-${type}`);
  if (input) {
    input.click();
  } else {
    console.error('Input element not found for:', type);
  }
};

window.handleFileSelect = (event, type) => {
  const file = event.target.files[0];
  if (!file) return;

  // ファイルサイズの簡易チェック (例: 5MB以下)
  if (file.size > 5 * 1024 * 1024) {
    alert('画像サイズが大きすぎます（5MB以下にしてください）。');
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    const result = e.target.result;
    appState.photos[type] = result;

    document.getElementById(`placeholder-${type}`).style.display = 'none';
    const previewDiv = document.getElementById(`preview-${type}`);
    previewDiv.style.display = 'flex';
    previewDiv.querySelector('img').src = result;
  };
  reader.readAsDataURL(file);
};

// ヘッダーボタン切り替えヘルパー
function updateHeaderButtons(screen) {
  const inputActions = document.getElementById('header-input-actions');
  const resultActions = document.getElementById('header-result-actions');

  if (screen === 'input') {
    inputActions.style.display = 'flex';
    resultActions.style.display = 'none';
  } else {
    inputActions.style.display = 'none';
    resultActions.style.display = 'flex';
  }
}

// 1. 写真保存のみ実行
window.savePhotos = async () => {
  // 少なくとも1枚の画像が必要
  if (!appState.photos.front && !appState.photos.side && !appState.photos.back) {
    alert('保存するには、少なくとも1枚の写真（正面推奨）を撮影または選択してください。');
    return;
  }

  const saveBtn = document.getElementById('header-save-photo-btn');
  const originalBtnText = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> アップロード中';

  try {
    const uploadPromises = [];
    ['front', 'side', 'back'].forEach((type) => {
      if (appState.photos[type]) {
        const promise = processImage(type, appState.photos[type]).then((url) => {
          appState.uploadedUrls[type] = url;
        });
        uploadPromises.push(promise);
      }
    });

    await Promise.all(uploadPromises);

    alert('写真の保存が完了しました。\n続けて「診断開始」ボタンを押すとAI分析を行えます。');
  } catch (error) {
    console.error('Upload failed:', error);
    alert(`保存中にエラーが発生しました: ${error.message}`);
  } finally {
    saveBtn.innerHTML = originalBtnText;
    saveBtn.disabled = false;
  }
};

// 2. 診断開始 (最新の保存画像を読み込んで分析)
window.startDiagnosis = async () => {
  if (!appState.customerId) {
    alert('顧客IDが見つかりません。管理画面からアクセスし直してください。');
    return;
  }

  const diagnoseBtn = document.getElementById('header-diagnose-btn');
  const originalBtnText = diagnoseBtn.innerHTML;
  diagnoseBtn.disabled = true;
  diagnoseBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 準備中...';

  try {
    // Storageから最新画像を探す
    const latestImages = await fetchLatestImages(appState.customerId);

    if (!latestImages.front && !latestImages.side && !latestImages.back) {
      throw new Error('保存された画像が見つかりません。先に「保存する」を実行してください。');
    }

    // 分析開始
    // 分析開始
    diagnoseBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 分析中...';

    // Before画像(=最新の予約写真)を取得
    const latestBookingPhotoUrl = await fetchLatestBeforeImage(appState.customerId);

    const inputData = {
      frontImage: latestImages.front,
      sideImage: latestImages.side,
      backImage: latestImages.back,
      beforeImage: latestBookingPhotoUrl,
    };
    console.log('Sending to AI:', inputData); // デバッグ用ログ

    // httpsCallable -> fetch に変更 (onRequest利用のため)
    // Hosting rewriteが不安定なため、絶対パス（Cloud Function URL）を直接指定
    const response = await fetch(
      'https://asia-northeast1-yhd-db.cloudfunctions.net/analyzeHairstyle',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputData),
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `Server Error: ${response.status}`);
    }

    const analysisData = await response.json();

    // 結果表示用ステート更新 (再利用のため)
    appState.uploadedUrls = latestImages;

    // const analysisData = result.data; // 不要
    displayResult(analysisData);
  } catch (error) {
    console.error('Diagnosis failed:', error);
    alert(`診断中にエラーが発生しました: ${error.message}`);
  } finally {
    diagnoseBtn.innerHTML = originalBtnText;
    diagnoseBtn.disabled = false;
  }
};

// ヘルパー: Storageから最新画像URLを取得
async function fetchLatestImages(customerId) {
  // const storage = getStorage(); // storage is already imported globally
  const folderPath = `ai-matching-uploads/${customerId}`; // 顧客の専用フォルダ
  const folderRef = ref(storage, folderPath);

  try {
    const res = await listAll(folderRef);
    // 名前でソート (timestampが含まれているので降順にすれば最新が先頭に来るはず)
    // 形式: {type}_{timestamp}.jpg

    const sortedItems = res.items.sort((a, b) => {
      return b.name.localeCompare(a.name); // 降順
    });

    const latest = { front: null, side: null, back: null };

    for (const item of sortedItems) {
      // それぞれのタイプで最新が見つかったらセット
      if (!latest.front && item.name.startsWith('front')) {
        latest.front = await getDownloadURL(item);
      }
      if (!latest.side && item.name.startsWith('side')) {
        latest.side = await getDownloadURL(item);
      }
      if (!latest.back && item.name.startsWith('back')) {
        latest.back = await getDownloadURL(item);
      }

      // 全て見つかったら終了
      if (latest.front && latest.side && latest.back) break;
    }

    return latest;
  } catch (e) {
    console.warn('Error fetching latest images:', e);
    return { front: null, side: null, back: null };
  }
}

// ヘルパー: 画像アップロード & ギャラリー同期
async function processImage(type, dataUrl) {
  const timestamp = Date.now();
  let storagePath;

  // 顧客IDがある場合は専用フォルダ、なければ一時フォルダ
  if (appState.customerId) {
    storagePath = `ai-matching-uploads/${appState.customerId}/${type}_${timestamp}.jpg`;
  } else {
    const tempId = `temp_${Math.random().toString(36).substring(7)}`;
    storagePath = `ai-analysis/${tempId}/${type}_${timestamp}.jpg`;
  }

  const storageRef = ref(storage, storagePath);
  await uploadString(storageRef, dataUrl, 'data_url');
  const downloadUrl = await getDownloadURL(storageRef);

  // 顧客IDがあり、かつ Front または Back の場合はギャラリー(Firestore)に追加
  if (appState.customerId && (type === 'front' || type === 'back')) {
    try {
      await addDoc(collection(db, `users/${appState.customerId}/gallery`), {
        url: downloadUrl,
        createdAt: serverTimestamp(),
        type: 'ai-matching',
        viewType: type, // front or back
      });
      console.log(`Saved ${type} photo to gallery`);
    } catch (e) {
      console.error('Failed to sync to gallery:', e);
      // ギャラリー保存失敗は分析を止めない
    }
  }

  return downloadUrl;
}

// 保存機能 ("画像を保存"ボタン)
window.saveResultImage = async () => {
  const saveBtn = document.getElementById('header-save-btn');
  const originalText = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中';

  try {
    // スナップショット用スタイル適用 (不透明化・装飾削除)
    document.body.classList.add('snapshot-mode');

    // 描画完了を待つために少し待機 (念のため)
    await new Promise((r) => setTimeout(r, 100));

    const targetElement = document.body; // ページ丸ごと保存
    const canvas = await html2canvas(targetElement, {
      useCORS: true,
      scale: 3, // 解像度をさらに上げる
      backgroundColor: '#f0f4f8', // 背景色を明示 (透明回避)
      logging: false,
    });

    // スタイル戻す
    document.body.classList.remove('snapshot-mode');

    // Blobに変換
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));

    // Storageにアップロード
    const timestamp = Date.now();
    let storagePath;
    if (appState.customerId) {
      storagePath = `ai-matching-results/${appState.customerId}/result_${timestamp}.jpg`;
    } else {
      storagePath = `ai-analysis/temp_results/result_${timestamp}.jpg`;
    }

    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, blob);
    const downloadUrl = await getDownloadURL(storageRef);

    // ギャラリーに追加 (認証ユーザーのみ)
    if (appState.customerId) {
      try {
        await addDoc(collection(db, `users/${appState.customerId}/gallery`), {
          url: downloadUrl,
          createdAt: serverTimestamp(),
          type: 'ai-matching-result',
          isResultImage: true,
        });
      } catch (e) {
        console.error('Gallery sync failed:', e);
      }
    }

    alert('画像を保存しました！');
    saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> 保存完了';
  } catch (error) {
    console.error('Save failed:', error);
    alert('画像の保存に失敗しました。');
    saveBtn.innerHTML = originalText;
  } finally {
    setTimeout(() => {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
    }, 3000);
  }
};

window.retryAnalysis = () => {
  resultScreen.classList.remove('active');
  updateHeaderButtons('input');

  // 入力画面に戻すアニメーション待ち
  setTimeout(() => {
    inputScreen.classList.add('active');
  }, 300);
};
