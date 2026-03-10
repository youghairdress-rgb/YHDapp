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

// 画像をリサイズ・圧縮するユーティリティ関数
async function compressImage(file, maxWidth = 1280, quality = 0.8) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // アスペクト比を維持してリサイズ
                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxWidth) {
                        width *= maxWidth / height;
                        height = maxWidth;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // JPEG形式、指定品質で圧縮
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ファイル選択時のプレビュー表示
window.handleFileSelect = async (event, type) => {
    const file = event.target.files[0];
    if (!file) return;

    // UI状態: 処理中を表示（必要に応じて）
    const placeholder = document.getElementById(`placeholder-${type}`);
    const originalText = placeholder.innerHTML;
    placeholder.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 圧縮中...';

    try {
        // 画像を自動圧縮（1280px以内、品質0.8）
        const compressedDataUrl = await compressImage(file);
        appState.photos[type] = compressedDataUrl;

        placeholder.style.display = 'none';
        placeholder.innerHTML = originalText; // 元に戻す

        const previewDiv = document.getElementById(`preview-${type}`);
        previewDiv.style.display = 'flex';
        previewDiv.querySelector('img').src = compressedDataUrl;
    } catch (error) {
        console.error('Image compression failed:', error);
        alert('画像の処理に失敗しました。別の画像をお試しください。');
        placeholder.innerHTML = originalText;
    }
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
