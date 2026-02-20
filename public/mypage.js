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
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  listAll,
  getMetadata,
} from 'firebase/storage';
import { initEditor, openEditorModal } from './js/privacy_editor.js'; // New Import

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
    currentUserId = user.uid; // グローバル変数にセット

    // Initialize Privacy Editor (Imported storage used internally)
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
    await Promise.all([loadReservationHistory(profile.userId), loadGallery(profile.userId)]);

    showContent();
    
    // 画像ビューアの初期化
    initImageViewer();

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

const loadGallery = async (userId) => {
  const container = document.getElementById('gallery-container');
  try {
    const storageRef = ref(storage, `users/${userId}/gallery`);
    const res = await listAll(storageRef);

    if (res.items.length === 0) {
      container.innerHTML = '<p class="empty-msg">写真はまだありません。</p>';
      return;
    }

    // メタデータを取得して日付順にソートする準備
    const photoData = await Promise.all(
      res.items.map(async (itemRef) => {
        const url = await getDownloadURL(itemRef);
        const metadata = await getMetadata(itemRef);
        return { url, time: new Date(metadata.timeCreated) };
      })
    );

    photoData.sort((a, b) => b.time - a.time);

    let html = '';
    let lastDate = '';

    photoData.forEach((photo) => {
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
        initEditor(); // Lazy init or re-init
        openEditorModal(viewerImg.src);
      });
    }

    // Initialize Editor Helper
    initEditor();
};

document.addEventListener('DOMContentLoaded', main);
