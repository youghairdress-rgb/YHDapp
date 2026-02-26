// Firebase Imports
import { db, storage } from '../admin/firebase-init.js';
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
    getDownloadURL
} from 'firebase/storage';

// 画面遷移のロジック (カメラ画面のみ)
const inputScreen = document.getElementById('input-screen');

// アプリの状態
const appState = {
    customerId: null,
    customerName: null,
    photos: {
        front: null,
        side: null,
        back: null,
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

    if (customerName) {
        const decodedName = decodeURIComponent(customerName);
        appState.customerName = decodedName;
        updateTitleWithName(decodedName);
    }

    if (customerId) {
        appState.customerId = customerId;

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
            }
        }
    }
});

function updateTitleWithName(name) {
    const titleElem = document.querySelector('.app-title');
    if (titleElem) {
        titleElem.innerHTML = `AI Matching <small>for ${name}様</small>`;
    }
}

// カメラ起動
window.triggerCamera = (type) => {
    const input = document.getElementById(`input-${type}`);
    if (input) {
        input.click();
    }
};

// ファイル選択時のプレビュー表示
window.handleFileSelect = (event, type) => {
    const file = event.target.files[0];
    if (!file) return;

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

// ヘルパー: 画像アップロード & ギャラリー同期
async function processImage(type, dataUrl) {
    const timestamp = Date.now();
    let storagePath;

    if (appState.customerId) {
        storagePath = `ai-matching-uploads/${appState.customerId}/${type}_${timestamp}.jpg`;
    } else {
        const tempId = `temp_${Math.random().toString(36).substring(7)}`;
        storagePath = `ai-analysis/${tempId}/${type}_${timestamp}.jpg`;
    }

    const storageRef = ref(storage, storagePath);
    await uploadString(storageRef, dataUrl, 'data_url');
    const downloadUrl = await getDownloadURL(storageRef);

    if (appState.customerId && (type === 'front' || type === 'back')) {
        try {
            await addDoc(collection(db, `users/${appState.customerId}/gallery`), {
                url: downloadUrl,
                createdAt: serverTimestamp(),
                type: 'ai-matching',
                viewType: type,
            });
            console.log(`Saved ${type} photo to gallery`);
        } catch (e) {
            console.error('Failed to sync to gallery:', e);
        }
    }

    return downloadUrl;
}

// 写真保存のみ実行
window.savePhotos = async () => {
    if (!appState.photos.front && !appState.photos.side && !appState.photos.back) {
        alert('保存するには、少なくとも1枚の写真（正面推奨）を撮影または選択してください。');
        return;
    }

    const saveBtn = document.getElementById('header-save-photo-btn');
    const originalBtnText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> アップロード中...';

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

        alert('写真の保存が完了しました。\n別の端末（PC/iPad等）から「診断開始」を行ってください。');
    } catch (error) {
        console.error('Upload failed:', error);
        alert(`保存中にエラーが発生しました: ${error.message}`);
    } finally {
        saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> 保存完了';

        // 3秒後に元のボタンに戻す
        setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnText;
        }, 3000);
    }
};
