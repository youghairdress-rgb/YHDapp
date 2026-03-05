import { db, initializeLiffAndAuth, storage } from './admin/firebase-init.js';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  where,
  Timestamp,
  updateDoc,
  serverTimestamp,
  addDoc,
  setDoc,
  deleteDoc,
  limit,
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  listAll,
  getMetadata,
} from 'firebase/storage';
import { initEditor, openEditorModal } from './js/privacy_editor.js';

// --- DOM Helper Functions ---
const loadingContainer = document.getElementById('loading-container');
const contentContainer = document.getElementById('mypage-content');
const loadingText = document.getElementById('loading-text');

const showLoading = (text) => {
  if (loadingText) loadingText.textContent = text;
  if (loadingContainer) loadingContainer.style.display = 'flex';
  if (contentContainer) contentContainer.style.display = 'none';
};
const showContent = () => {
  if (loadingContainer) loadingContainer.style.display = 'none';
  if (contentContainer) contentContainer.style.display = 'block';
};

// --- Global State ---
let currentUserId = null;

// --- Main application logic ---
const main = async () => {
  try {
    showLoading('LIFFを初期化中...');
    const { user, profile } = await initializeLiffAndAuth('2008029428-VljQlRjZ');
    currentUserId = profile.userId;

    // Initialize Privacy Editor
    initEditor();

    showLoading('顧客情報を確認中...');
    const userDocRef = doc(db, 'users', profile.userId);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      document.getElementById('user-name').textContent = userData.name || profile.displayName;
    } else {
      document.getElementById('user-name').textContent = profile.displayName;
    }

    // タブの初期化
    initTabs();

    // データの読み込み
    await Promise.all([
      loadLatestReservation(profile.userId),
      loadReservationHistory(profile.userId),
      loadGallery(profile.userId),
    ]);

    showContent();

    // 画像ビューアの初期化
    initImageViewer();

    // ユーザー写真アップロード機能の初期化
    initUserPhotoUpload();

  } catch (error) {
    console.error('エラー:', error);
    alert('初期化中にエラーが発生しました: ' + error.message);
  }
};

const initTabs = () => {
  const tabs = document.querySelectorAll('.tab-button');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.tab-button').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content-panel').forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`${target}-panel`).classList.add('active');
    });
  });
};

const loadReservationHistory = async (userId) => {
  const listEl = document.getElementById('reservation-history-list');
  try {
    const q = query(
      collection(db, 'reservations'),
      where('customerId', '==', userId),
      orderBy('startTime', 'desc')
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      listEl.innerHTML = '<p class="empty-msg">予約履歴はありません。</p>';
      return;
    }

    let html = '';
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const start = data.startTime.toDate();
      const dateStr = start.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      });
      const timeStr = start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const menus = data.selectedMenus.map((m) => m.name).join(', ');

      html += `
                <div class="reservation-history-item">
                    <p><strong>日時:</strong> ${dateStr} ${timeStr}</p>
                    <p><strong>メニュー:</strong> ${menus}</p>
                    ${data.userRequests ? `<div class="note-section"><strong>ご要望:</strong><p>${data.userRequests}</p></div>` : ''}
                </div>
            `;
    });
    listEl.innerHTML = html;
  } catch (error) {
    console.error('履歴取得エラー:', error);
    listEl.innerHTML = '<p class="error-msg">履歴の取得に失敗しました。</p>';
  }
};

// --- Latest Reservation Logic ---
const loadLatestReservation = async (userId) => {
  const sectionEl = document.getElementById('latest-reservation-section');
  const detailsEl = document.getElementById('latest-reservation-details');
  const btnChange = document.getElementById('btn-change-reservation');
  const btnCancel = document.getElementById('btn-cancel-reservation');

  if (!sectionEl || !detailsEl) return;

  try {
    const now = Timestamp.now();
    const q = query(
      collection(db, 'reservations'),
      where('customerId', '==', userId),
      where('startTime', '>', now),
      orderBy('startTime', 'asc'),
      limit(1)
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      sectionEl.style.display = 'none';
      return;
    }

    const docSnap = querySnapshot.docs[0];
    const data = docSnap.data();
    const reservationId = docSnap.id;

    const start = data.startTime.toDate();
    const dateStr = start.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    });
    const timeStr = start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const menus = data.selectedMenus.map((m) => m.name).join(', ');

    detailsEl.innerHTML = `
      <p style="margin: 0 0 8px 0;"><strong>日時:</strong> ${dateStr} ${timeStr}</p>
      <p style="margin: 0;"><strong>メニュー:</strong> ${menus}</p>
    `;
    sectionEl.style.display = 'block';

    // Event Listeners for Buttons
    const handleReservationDelete = async (actionText, confirmText, successAlertText, redirectUrl) => {
      if (confirm(confirmText)) {
        try {
          btnChange.disabled = true;
          btnCancel.disabled = true;
          await deleteDoc(doc(db, 'reservations', reservationId));
          if (successAlertText) alert(successAlertText);
          if (redirectUrl) {
            window.location.href = redirectUrl;
          } else {
            // Cancel -> Just hide the section
            sectionEl.style.display = 'none';
          }
        } catch (err) {
          console.error(`${actionText}エラー:`, err);
          alert(`予約の${actionText}に失敗しました。`);
          btnChange.disabled = false;
          btnCancel.disabled = false;
        }
      }
    };

    btnChange.onclick = () => handleReservationDelete(
      '変更',
      '現在のご予約を削除しても、よろしいですか？\n再度ご予約をお願いいたします',
      null, // No alert configured for change
      './index.html'
    );

    btnCancel.onclick = () => handleReservationDelete(
      'キャンセル',
      '現在のご予約を削除してもよろしいですか？',
      'ご予約はキャンセルされました。\nまたのご予約をお待ちしております',
      null // No redirect for cancel
    );

  } catch (error) {
    console.error('最新予約取得エラー:', error);
    sectionEl.style.display = 'none';
  }
};

const loadGallery = async (userId) => {
  const container = document.getElementById('gallery-container');
  try {
    const paths = [
      `ai-matching-results/${userId}`,
      `ai-matching-uploads/${userId}`,
      `galleries/${userId}`,
      `guest_uploads/${userId}`,
      `hair_app_uploads/${userId}`,
      `pc_generated/${userId}`,
      `uploads/${userId}`,
      `users/${userId}/gallery`
    ];

    let allItemsRefs = [];

    // 並列で全パスからアイテムリストを取得
    const lists = await Promise.all(paths.map(async (path) => {
      try {
        const directoryRef = ref(storage, path);
        const res = await listAll(directoryRef);
        // パス情報を持たせて返す
        return res.items.map(item => ({ ref: item, parentPath: path }));
      } catch (e) {
        console.warn(`[loadGallery] Could not list ${path}:`, e.message);
        return [];
      }
    }));

    allItemsRefs = lists.flat();

    if (allItemsRefs.length === 0) {
      container.innerHTML = '<p class="empty-msg">写真はまだありません。</p>';
      return;
    }

    // メタデータを取得して日付順にソート、およびフィルタリング
    const photoData = await Promise.all(
      allItemsRefs.map(async (itemObj) => {
        try {
          const itemRef = itemObj.ref;
          const parentPath = itemObj.parentPath;
          const metadata = await getMetadata(itemRef);
          const contentType = metadata.contentType || '';

          // フィルタリング設定:
          // guest_uploads の場合は image/jpeg のみ表示
          if (parentPath.includes('guest_uploads')) {
            if (contentType !== 'image/jpeg') return null;
          } else {
            // 他のフォルダは画像全般を表示
            if (!contentType.startsWith('image/')) return null;
          }

          const url = await getDownloadURL(itemRef);
          return { url, time: new Date(metadata.timeCreated) };
        } catch (e) {
          console.warn(`[loadGallery] Failed to process ${itemObj.ref.fullPath}:`, e.message);
          return null;
        }
      })
    );

    // null（フィルタされた、またはエラー分）を除去してソート
    const validPhotoData = photoData.filter(p => p !== null);
    validPhotoData.sort((a, b) => b.time - a.time);

    if (validPhotoData.length === 0) {
      container.innerHTML = '<p class="empty-msg">写真はまだありません。</p>';
      return;
    }

    let html = '';
    let lastDate = '';

    validPhotoData.forEach((photo) => {
      const dateStr = photo.time.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });
      if (dateStr !== lastDate) {
        if (lastDate !== '') html += '</div>'; // close previous grid
        html += `<div class="gallery-date-header">${dateStr}</div><div class="gallery-grid-group">`;
        lastDate = dateStr;
      }
      html += `<img src="${photo.url}" onclick="openViewer('${photo.url}')" loading="lazy">`;
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (error) {
    console.error('ギャラリー取得エラー:', error);
    container.innerHTML = '<p class="error-msg">写真の取得に失敗しました。</p>';
  }
};

// --- Viewer & Editor Helpers ---
const viewer = document.getElementById('image-viewer');
const viewerImg = document.getElementById('viewer-img');

window.openViewer = (url) => {
  viewerImg.src = url;
  viewer.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

const closeViewer = () => {
  viewer.style.display = 'none';
  document.body.style.overflow = '';
};

document.querySelector('.close-viewer').addEventListener('click', closeViewer);
viewer.addEventListener('click', (e) => {
  if (e.target === viewer) closeViewer();
});

const initImageViewer = () => {
  const btnOpenEditor = document.getElementById('btn-open-editor');
  if (btnOpenEditor) {
    btnOpenEditor.addEventListener('click', () => {
      // Open Editor
      openEditorModal(viewerImg.src);
    });
  }

  // Initialize Editor Helper
  initEditor();
};

// --- User Photo Upload Logic (Senior Engineer Implementation) ---
const initUserPhotoUpload = () => {
  const triggerBtn = document.getElementById('trigger-upload-btn');
  const fileInput = document.getElementById('user-image-upload');
  const statusArea = document.getElementById('upload-status-area');

  if (!triggerBtn || !fileInput) return;

  // ボタンクリックでファイル選択を発火
  triggerBtn.addEventListener('click', () => {
    fileInput.click();
  });

  // ファイル選択時のイベント
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // UI状態: 送信中
    triggerBtn.disabled = true;
    triggerBtn.classList.add('opacity-50', 'cursor-not-allowed');
    if (statusArea) {
      statusArea.classList.remove('hidden');
      statusArea.style.display = 'block';
    }

    try {
      if (!currentUserId) throw new Error('ユーザー情報の取得に失敗しました。再読み込みしてください。');

      // 1. Storageへのアップロードパス作成
      const timestamp = Date.now();
      const fileName = `user_upload_${timestamp}.jpg`;
      const storagePath = `users/${currentUserId}/gallery/${fileName}`;
      const storageRef = ref(storage, storagePath);

      // 2. アップロード実行
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);

      // 3. Firestoreへ記録 (管理者に通知を飛ばすためのフラグ isUserUpload: true)
      const galleryRef = collection(db, 'users', currentUserId, 'gallery');
      await addDoc(galleryRef, {
        url: downloadURL,
        originalPath: storagePath,
        createdAt: serverTimestamp(),
        isUserUpload: true, // 管理者通知のトリガー
        type: 'user_style_submit',
        fileName: fileName
      });

      // ユーザー情報の更新 (存在しない場合は作成)
      await setDoc(doc(db, 'users', currentUserId), {
        lastActiveAt: serverTimestamp()
      }, { merge: true });

      alert('写真をアップロードしました！\nゆうじさん（管理者）に通知が届きます。');

      // 4. ギャラリーを即座に再描画
      await loadGallery(currentUserId);

    } catch (error) {
      console.error('[Upload] Failed:', error);
      alert('アップロードに失敗しました: ' + error.message);
    } finally {
      // UI状態の復帰
      triggerBtn.disabled = false;
      triggerBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      if (statusArea) {
        statusArea.classList.add('hidden');
        statusArea.style.display = 'none';
      }
      fileInput.value = ''; // 選択解除
    }
  });
};

document.addEventListener('DOMContentLoaded', main);
