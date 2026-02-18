import { db, initializeLiffAndAuth, storage } from './admin/firebase-init.js';
import { doc, getDoc, setDoc, collection, query, where, orderBy, getDocs, serverTimestamp, updateDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, listAll, getMetadata } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { initEditor, openEditorModal } from './js/privacy_editor.js'; // New Import

// --- DOM Helper Functions ---
const loadingContainer = document.getElementById('loading-container');
const contentContainer = document.getElementById('content-container');
const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');
const mypageContainer = document.getElementById('mypage-container');
// ▼▼▼ 新規追加: アップロード関連DOM ▼▼▼
const uploadPhotoBtn = document.getElementById('upload-photo-btn');
const photoUploadInput = document.getElementById('photo-upload-input');
const uploadingOverlay = document.getElementById('uploading-overlay');
// ▲▲▲ 新規追加ここまで ▲▲▲

const showLoading = (text) => {
    loadingContainer.querySelector('p').textContent = text;
    loadingContainer.style.display = 'flex';
    contentContainer.style.display = 'none';
    errorContainer.style.display = 'none';
};
const showContent = () => {
    loadingContainer.style.display = 'none';
    contentContainer.style.display = 'block';
};
const showError = (text) => {
    errorMessage.textContent = text;
    loadingContainer.style.display = 'none';
    contentContainer.style.display = 'none';
    errorContainer.style.display = 'block';
};

// ▼▼▼ 新規追加: アップロードオーバーレイ表示/非表示 ▼▼▼
const showUploadingOverlay = (show) => {
    if (uploadingOverlay) {
        uploadingOverlay.style.display = show ? 'flex' : 'none';
    }
};
// ▲▲▲ 新規追加ここまで ▲▲▲

// ▼▼▼ 修正: currentUserId をグローバルで保持 ▼▼▼
let currentUserId = null;
// ▲▲▲ 修正ここまで ▲▲▲

// --- Main Application Logic ---
const main = async () => {
    try {
        showLoading("LIFFを初期化中...");
        const { user, profile } = await initializeLiffAndAuth("2008029428-VljQlRjZ");

        // ▼▼▼ 修正: currentUserId にセット ▼▼▼
        currentUserId = user.uid; // グローバル変数にセット

        // Initialize Privacy Editor (Imported storage used internally)
        initEditor();

        showLoading("顧客情報を確認中...");
        const userDocRef = doc(db, "users", profile.userId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            displayMyPage(userDocSnap.data());
            fetchReservationHistory(profile.userId);
            fetchGallery(profile.userId);
            showContent();
        } else {
            window.location.href = './entry.html';
        }
        setupTabEvents();
        // ▼▼▼ 新規追加: アップロードイベントリスナーをセットアップ ▼▼▼
        setupUploadEvents();
        // ▲▲▲ 新規追加ここまで ▲▲▲

    } catch (error) {
        console.error("メイン処理でエラー:", error);
        showError(error.message);
    }
};

const setupTabEvents = () => {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanels = document.querySelectorAll('.tab-content-panel');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanels.forEach(panel => panel.classList.remove('active'));

            button.classList.add('active');
            const targetPanelId = `${button.dataset.tab}-panel`;
            document.getElementById(targetPanelId).classList.add('active');
        });
    });
};

// ▼▼▼ 新規追加: アップロード関連のイベントリスナー ▼▼▼
const setupUploadEvents = () => {
    if (uploadPhotoBtn) {
        uploadPhotoBtn.addEventListener('click', () => {
            // "environment"（背面カメラ）より "user"（自撮り）の方が使う可能性が高いかも？
            // capture属性を外すと、ファイル選択（ギャラリー）も選べるようになります。
            // photoUploadInput.setAttribute('capture', 'user'); 
            photoUploadInput.removeAttribute('capture'); // ファイル選択を許可
            photoUploadInput.click();
        });
    }

    if (photoUploadInput) {
        photoUploadInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                uploadAndSavePhoto(e.target.files[0]);
            }
        });
    }
};
// ▲▲▲ 新規追加ここまで ▲▲▲

// ▼▼▼ 新規追加: 写真アップロード処理 ▼▼▼
const uploadAndSavePhoto = async (file) => {
    if (!currentUserId) {
        alert("ログイン状態が確認できません。ページを再読み込みしてください。");
        return;
    }
    if (!file) return;

    // 1MB = 1048576 bytes
    if (file.size > 5 * 1048576) {
        alert("ファイルサイズが大きすぎます。5MB以下の画像を選択してください。");
        return;
    }

    showUploadingOverlay(true);

    // Androidでのアップロード詰まり対策: タイムアウトと名前の正規化
    try {
        const timestamp = Date.now();

        // ファイル名が空、または拡張子がない場合の対策
        let safeName = file.name || `image_${timestamp}`;
        if (!safeName.includes('.')) {
            // MIMEタイプから推測、またはjpgをデフォルトに
            if (file.type === 'image/png') safeName += '.png';
            else safeName += '.jpg';
        }

        const storageRef = ref(storage, `users/${currentUserId}/gallery/${timestamp}-${safeName}`);

        // メタデータを明示的に設定 (AndroidでcontentTypeが空になる問題対策)
        const metadata = {
            contentType: file.type || 'image/jpeg',
        };

        // タイムアウト設定 (30秒)
        const uploadTask = uploadBytes(storageRef, file, metadata);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("アップロードがタイムアウトしました。通信環境の良い場所で再度お試しください。")), 30000)
        );

        const snapshot = await Promise.race([uploadTask, timeoutPromise]);
        const downloadURL = await getDownloadURL(snapshot.ref);

        await addDoc(collection(db, `users/${currentUserId}/gallery`), {
            url: downloadURL,
            originalPath: snapshot.ref.fullPath, // 重複チェック用にパスを保存
            createdAt: serverTimestamp(),
            isUserUpload: true // 通知送信用フラグ
        });

        // ギャラリータブが現在アクティブでなくても、データを再読み込みする
        await fetchGallery(currentUserId);

        // ギャラリータブを強制的に開く
        document.querySelector('.tab-button[data-tab="gallery"]').click();
        alert("写真をアップロードしました。");

    } catch (error) {
        console.error("写真のアップロードに失敗:", error);
        // エラー詳細を表示（ユーザーが原因を特定しやすくするため）
        let msg = "写真のアップロードに失敗しました。";
        if (error.code === 'storage/unauthorized') {
            msg += "\n(権限がありません。管理者にお問い合わせください)";
        } else if (error.code === 'storage/canceled') {
            msg += "\n(アップロードがキャンセルされました)";
        } else if (error.message) {
            msg += `\n(${error.message})`;
        } else {
            msg += `\n(${JSON.stringify(error)})`;
        }
        alert(msg);
    } finally {
        showUploadingOverlay(false);
        // 同じファイルを連続でアップロードできるように入力値をリセット
        photoUploadInput.value = '';
    }
};
// ▲▲▲ 新規追加ここまで ▲▲▲

const displayMyPage = (userData) => {
    mypageContainer.style.display = 'block';
    document.getElementById('mypage-name').textContent = userData.name || 'ゲスト';
};

const fetchReservationHistory = async (userId) => {
    const historyContainer = document.getElementById('reservation-history');
    historyContainer.innerHTML = '<div class="spinner"></div>';
    try {
        const q = query(collection(db, "sales"), where("customerId", "==", userId), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            historyContainer.innerHTML = '<p>まだ来店履歴はありません。</p>';
            return;
        }
        let html = '';
        querySnapshot.forEach(doc => {
            const sale = { id: doc.id, ...doc.data() };
            const date = sale.createdAt.toDate().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
            const menus = sale.menus.map(m => m.name).join(', ');

            html += `
                <div class="reservation-history-item">
                    <p><strong>来店日:</strong> ${date}</p>
                    <p><strong>メニュー:</strong> ${menus}</p>
                    <p><strong>合計金額:</strong> ¥${sale.total.toLocaleString()}</p>
                    <div class="note-section">
                        <strong>担当スタッフより:</strong>
                        <!-- ▼▼▼ 修正: staffNote から staffPublicMessage に変更 ▼▼▼ -->
                        <p>${sale.staffPublicMessage || 'メッセージはまだありません。'}</p>
                        <!-- ▲▲▲ 修正ここまで ▲▲▲ -->
                    </div>
                    <div class="note-section">
                        <strong>お客様コメント:</strong>
                        <textarea id="customer-note-${sale.id}" rows="3" class="input-field">${sale.customerNote || ''}</textarea>
                        <button class="button-secondary save-note-btn" data-sale-id="${sale.id}">コメントを保存</button>
                    </div>
                </div>`;
        });
        historyContainer.innerHTML = html;

        historyContainer.querySelectorAll('.save-note-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const saleId = e.target.dataset.saleId;
                const note = document.getElementById(`customer-note-${saleId}`).value;
                btn.textContent = "保存中...";
                btn.disabled = true;
                try {
                    await updateDoc(doc(db, "sales", saleId), { customerNote: note });
                    alert('コメントを保存しました。');
                } catch (error) {
                    console.error("コメントの保存エラー:", error);
                    alert('コメントの保存に失敗しました。');
                } finally {
                    btn.textContent = "コメントを保存";
                    btn.disabled = false;
                }
            });
        });

    } catch (error) {
        console.error("来店履歴の取得エラー:", error);
        historyContainer.innerHTML = '<p>来店履歴の読み込みに失敗しました。</p>';
    }
};

// ▼▼▼ 追加: ストレージの予約写真を同期する関数 ▼▼▼
const syncBookingPhotos = async (userId) => {
    try {
        const listRef = ref(storage, `uploads/${userId}`);
        const res = await listAll(listRef);

        // ターゲットとなる画像ファイルをフィルタリング
        const targetItems = res.items.filter(itemRef =>
            itemRef.name.startsWith('item-front-photo-') && itemRef.name.endsWith('-image.jpg')
        );

        if (targetItems.length === 0) return;

        // 既存のギャラリー情報を取得して重複チェック
        const galleryRef = collection(db, `users/${userId}/gallery`);
        const snapshot = await getDocs(galleryRef);
        const existingPaths = new Set();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.originalPath) existingPaths.add(data.originalPath);
        });

        // 未登録のファイルをFirestoreに追加
        for (const itemRef of targetItems) {
            const fullPath = itemRef.fullPath;
            if (!existingPaths.has(fullPath)) {
                // ダウンロードURLとメタデータを取得
                const url = await getDownloadURL(itemRef);
                const metadata = await getMetadata(itemRef);

                await addDoc(galleryRef, {
                    url: url,
                    createdAt: metadata.timeCreated ? new Date(metadata.timeCreated) : serverTimestamp(),
                    originalPath: fullPath,
                    isBookingPhoto: true
                });
                // console.log(`Synced photo: ${fullPath}`);
            }
        }
    } catch (error) {
        console.error("予約写真の同期中にエラー:", error);
    }
};

// ▼▼▼ 追加: AI診断用写真(Uploads)の同期 ▼▼▼
const syncAiMatchingPhotos = async (userId) => {
    try {
        const listRef = ref(storage, `ai-matching-uploads/${userId}`);
        const res = await listAll(listRef);
        // AI診断画像は {type}_{timestamp}.jpg 形式
        const targetItems = res.items.filter(itemRef => itemRef.name.match(/^(front|side|back)_\d+\.jpg$/));

        if (targetItems.length === 0) return;

        const galleryRef = collection(db, `users/${userId}/gallery`);
        const snapshot = await getDocs(galleryRef);
        const existingPaths = new Set();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.originalPath) existingPaths.add(data.originalPath);
        });

        for (const itemRef of targetItems) {
            if (!existingPaths.has(itemRef.fullPath)) {
                const url = await getDownloadURL(itemRef);
                const metadata = await getMetadata(itemRef);
                await addDoc(galleryRef, {
                    url: url,
                    createdAt: metadata.timeCreated ? new Date(metadata.timeCreated) : serverTimestamp(),
                    originalPath: itemRef.fullPath, // 重複チェック用
                    type: 'ai-matching_upload' // 区別用
                });
            }
        }
    } catch (error) {
        console.error("AI診断写真の同期エラー:", error);
    }
};

// ▼▼▼ 追加: AI診断結果(Results)の同期 ▼▼▼
const syncAiMatchingResults = async (userId) => {
    try {
        const listRef = ref(storage, `ai-matching-results/${userId}`);
        const res = await listAll(listRef);
        // 結果画像は result_{timestamp}.jpg 形式
        const targetItems = res.items.filter(itemRef => itemRef.name.startsWith('result_'));

        if (targetItems.length === 0) return;

        const galleryRef = collection(db, `users/${userId}/gallery`);
        const snapshot = await getDocs(galleryRef);
        const existingPaths = new Set();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.originalPath) existingPaths.add(data.originalPath);
        });

        for (const itemRef of targetItems) {
            if (!existingPaths.has(itemRef.fullPath)) {
                const url = await getDownloadURL(itemRef);
                const metadata = await getMetadata(itemRef);
                await addDoc(galleryRef, {
                    url: url,
                    createdAt: metadata.timeCreated ? new Date(metadata.timeCreated) : serverTimestamp(),
                    originalPath: itemRef.fullPath,
                    type: 'ai-matching_result',
                    isResultImage: true
                });
            }
        }
    } catch (error) {
        console.error("AI診断結果の同期エラー:", error);
    }
};
// ▲▲▲ 追加ここまで ▲▲▲

const fetchGallery = async (userId) => {
    const galleryContainer = document.getElementById('gallery-container');
    galleryContainer.innerHTML = '<div class="spinner"></div>';

    // ▼▼▼ 同期処理を実行 ▼▼▼
    // ▼▼▼ 同期処理を実行 ▼▼▼
    await Promise.all([
        syncBookingPhotos(userId),
        syncAiMatchingPhotos(userId),
        syncAiMatchingResults(userId)
    ]);
    // ▲▲▲ 追加ここまで ▲▲▲

    try {
        const q = query(collection(db, `users/${userId}/gallery`), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            galleryContainer.innerHTML = '<p>まだ写真がありません。</p>';
            return;
        }

        const photosByDate = {};
        snapshot.forEach(doc => {
            const photo = { id: doc.id, ...doc.data() };
            const date = photo.createdAt.toDate().toLocaleDateString('ja-JP');
            if (!photosByDate[date]) {
                photosByDate[date] = [];
            }
            photosByDate[date].push(photo);
        });

        let html = '';
        for (const date in photosByDate) {
            html += `<h3 class="gallery-date-header">${date}</h3>`;
            html += '<div class="gallery-grid-group">';
            photosByDate[date].forEach(photo => {
                html += `<img src="${photo.url}" alt="ギャラリー写真" class="gallery-thumbnail">`;
            });
            html += '</div>';
        }
        galleryContainer.innerHTML = html;

        const viewer = document.getElementById('image-viewer');
        const viewerImg = document.getElementById('viewer-img');
        const btnOpenEditor = document.getElementById('btn-open-editor'); // New Button

        galleryContainer.querySelectorAll('.gallery-thumbnail').forEach(img => {
            img.addEventListener('click', () => {
                viewerImg.src = img.src;
                // ★★★ 修正点: bodyに専用クラスを追加 ★★★
                document.body.classList.add('user-modal-open');
                viewer.style.display = 'flex';

                // Show/Hide Review Button based on image type (optional, but let's show for all)
                // btnOpenEditor.style.display = 'block';
            });
        });
        viewer.querySelector('.close-viewer').addEventListener('click', () => {
            // ★★★ 修正点: bodyから専用クラスを削除 ★★★
            document.body.classList.remove('user-modal-open');
            viewer.style.display = 'none';
        });

        // Review Button Event
        if (btnOpenEditor) {
            btnOpenEditor.addEventListener('click', () => {
                // Open Editor
                initEditor(); // Lazy init or re-init
                openEditorModal(viewerImg.src);
                // Close Viewer to avoid overlap? Or keep it open?
                // Better to keep viewer open in background or close it. 
                // Let's keep it but maybe hide it if it conflicts. 
                // For now, the modal overlay sits on top.
            });
        }

        // Initialize Editor Helper
        initEditor();

    } catch (error) {
        console.error("ギャラリーの読み込みエラー:", error);
        galleryContainer.innerHTML = '<p>ギャラリーの読み込みに失敗しました。</p>';
    }
};

document.addEventListener('DOMContentLoaded', main);