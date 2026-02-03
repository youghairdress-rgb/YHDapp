// Firebase Imports
import { db, storage, functions } from '../admin/firebase-init.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadString, getDownloadURL, listAll } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// ... (省略) ...

// ヘルパー: 最新のBefore画像を取得 (予約時の写真)
async function fetchLatestBeforeImage(customerId) {
    if (!customerId) return null;
    try {
        const listRef = ref(storage, `uploads/${customerId}`);
        const res = await listAll(listRef);

        // ファイル名でフィルタリング & ソート
        // パターン: item-front-photo-{number}-image.jpg
        const frontPhotos = res.items.filter(item =>
            item.name.startsWith('item-front-photo-') && item.name.endsWith('-image.jpg')
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
        console.error("Failed to fetch before image:", error);
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
            // 予約写真がない場合は、今回撮影したFront写真(もしあれば)を使う、あるいはプレースホルダー
            if (appState.photos.front) {
                beforeImgElem.src = appState.photos.front;
            }
        }

        // After画像: 今回撮影したFront写真
        const afterImgElem = document.getElementById('result-after-img');
        if (appState.photos.front) {
            afterImgElem.src = appState.photos.front;
        } else {
            // Frontがない場合はSide等で代用 (通常ありえないが)
            const altSrc = appState.photos.side || appState.photos.back;
            if (altSrc) afterImgElem.src = altSrc;
        }

        // ボタン状態リセット（戻ってきたとき用）
        const analyzeBtn = document.getElementById('header-analyze-btn');
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 診断する';

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
        back: null
        // 実際のファイルデータではなく、DataURL (Base64) を保持
    },
    uploadedUrls: {
        front: null,
        side: null,
        back: null
    }
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
                const userDoc = await getDoc(doc(db, "users", customerId));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    appState.customerName = userData.name;
                    updateTitleWithName(userData.name);
                }
            } catch (error) {
                console.error("Error fetching customer:", error);
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
    document.getElementById(`input-${type}`).click();
};

window.handleFileSelect = (event, type) => {
    const file = event.target.files[0];
    if (!file) return;

    // ファイルサイズの簡易チェック (例: 5MB以下)
    if (file.size > 5 * 1024 * 1024) {
        alert("画像サイズが大きすぎます（5MB以下にしてください）。");
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
    const analyzeBtn = document.getElementById('header-analyze-btn');
    const resultActions = document.getElementById('header-result-actions');

    if (screen === 'input') {
        analyzeBtn.style.display = 'flex';
        resultActions.style.display = 'none';
    } else {
        analyzeBtn.style.display = 'none';
        resultActions.style.display = 'flex';
    }
}

// 診断開始
window.startAnalysis = async () => {
    // 少なくとも1枚の画像が必要
    if (!appState.photos.front && !appState.photos.side && !appState.photos.back) {
        alert("診断するには、少なくとも1枚の写真（正面推奨）を撮影または選択してください。");
        return;
    }

    const analyzeBtn = document.getElementById('header-analyze-btn');
    const originalBtnText = analyzeBtn.innerHTML;
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; // スペース節約のためテキスト削除

    try {
        // 1. 画像のアップロード & ギャラリー保存
        const uploadPromises = [];
        ['front', 'side', 'back'].forEach(type => {
            if (appState.photos[type]) {
                const promise = processImage(type, appState.photos[type]).then(url => {
                    appState.uploadedUrls[type] = url;
                });
                uploadPromises.push(promise);
            }
        });

        await Promise.all(uploadPromises);

        // 2. Cloud Functions呼び出し
        const analyzeHairstyle = httpsCallable(functions, 'analyzeHairstyle');

        // Before画像(=最新の予約写真)を取得
        const latestBookingPhotoUrl = await fetchLatestBeforeImage(appState.customerId);

        const result = await analyzeHairstyle({
            frontImage: appState.uploadedUrls.front,
            sideImage: appState.uploadedUrls.side,
            backImage: appState.uploadedUrls.back,
            beforeImage: latestBookingPhotoUrl // 追加: Before画像を渡す
        });

        const analysisData = result.data;
        displayResult(analysisData);

    } catch (error) {
        console.error("Analysis failed:", error);
        alert(`AI分析中にエラーが発生しました: ${error.message}`);
        analyzeBtn.innerHTML = originalBtnText;
        analyzeBtn.disabled = false;
    }
};

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
            await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").then(async ({ collection, addDoc, serverTimestamp }) => {
                await addDoc(collection(db, `users/${appState.customerId}/gallery`), {
                    url: downloadUrl,
                    createdAt: serverTimestamp(),
                    type: 'ai-matching',
                    viewType: type // front or back
                });
            });
            console.log(`Saved ${type} photo to gallery`);
        } catch (e) {
            console.error("Failed to sync to gallery:", e);
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
        await new Promise(r => setTimeout(r, 100));

        const targetElement = document.body; // ページ丸ごと保存
        const canvas = await html2canvas(targetElement, {
            useCORS: true,
            scale: 3, // 解像度をさらに上げる
            backgroundColor: '#f0f4f8', // 背景色を明示 (透明回避)
            logging: false
        });

        // スタイル戻す
        document.body.classList.remove('snapshot-mode');

        // Blobに変換
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));

        // Storageにアップロード
        const timestamp = Date.now();
        let storagePath;
        if (appState.customerId) {
            storagePath = `ai-matching-results/${appState.customerId}/result_${timestamp}.jpg`;
        } else {
            storagePath = `ai-analysis/temp_results/result_${timestamp}.jpg`;
        }

        const storageRef = ref(storage, storagePath);
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js").then(async ({ uploadBytes }) => {
            await uploadBytes(storageRef, blob);
        });
        const downloadUrl = await getDownloadURL(storageRef);

        // ギャラリーに追加 (認証ユーザーのみ)
        if (appState.customerId) {
            await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").then(async ({ collection, addDoc, serverTimestamp }) => {
                await addDoc(collection(db, `users/${appState.customerId}/gallery`), {
                    url: downloadUrl,
                    createdAt: serverTimestamp(),
                    type: 'ai-matching-result',
                    isResultImage: true
                });
            });
        }

        alert("画像を保存しました！");
        saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> 保存完了';

    } catch (error) {
        console.error("Save failed:", error);
        alert("画像の保存に失敗しました。");
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
