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
    getDownloadURL,
    listAll,
    uploadBytes,
} from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import html2canvas from 'html2canvas';

// 画面遷移のロジック (結果画面のみ)
const resultScreen = document.getElementById('result-screen');

// アプリの状態
const appState = {
    customerId: null,
    customerName: null,
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
    } else {
        // IDがない場合はエラー表示
        document.querySelector('.reason-text').textContent = '顧客IDが指定されていません。管理画面からアクセスし直してください。';
        document.getElementById('header-diagnose-btn').disabled = true;
    }
});

function updateTitleWithName(name) {
    const titleElem = document.querySelector('.app-title');
    if (titleElem) {
        titleElem.innerHTML = `AI Matching <small>for ${name}様</small>`;
    }
}

// ヘルパー: 各フォルダから最も新しい画像（タイムスタンプ比較）を取得する汎用関数
async function getLatestImageFromFolder(folderPath, filterCondition) {
    try {
        const folderRef = ref(storage, folderPath);
        const res = await listAll(folderRef);
        let items = res.items;

        if (filterCondition) {
            items = items.filter(filterCondition);
        }

        if (items.length === 0) return null;

        // メタデータを取得して作成日時(timeCreated)で比較するのが最も正確ですが、
        // 今回はファイル名に含まれる数字（タイムスタンプ）を抽出して比較します。
        const itemsWithMetadata = await Promise.all(
            items.map(async (item) => {
                const url = await getDownloadURL(item);
                // ファイル名から連続した数字（タイムスタンプらしきもの）を抽出
                const match = item.name.match(/(\d{13})/);
                let timestamp = 0;
                if (match) {
                    timestamp = parseInt(match[1], 10);
                } else {
                    // 13桁の数字が見つからない場合は、他の数字を探す (予約の写真など)
                    const fallbackMatch = item.name.match(/\d+/);
                    if (fallbackMatch) timestamp = parseInt(fallbackMatch[0], 10);
                }

                return { item, url, name: item.name, timestamp };
            })
        );

        // タイムスタンプで降順ソート (新しい順)
        itemsWithMetadata.sort((a, b) => b.timestamp - a.timestamp);

        return {
            url: itemsWithMetadata[0].url,
            timestamp: itemsWithMetadata[0].timestamp
        };
    } catch (e) {
        // フォルダが存在しない等のエラーはスキップ
        return null;
    }
}

// ヘルパー: 最新のBefore画像を取得 (優先度付き)
async function fetchLatestBeforeImage(customerId) {
    if (!customerId) return null;

    let candidate1 = null; // 画像素材 (guest_uploads/front)
    let candidate2 = null; // 髪色アプリ (hair_app_uploads)

    // 優先度 1 & 2: どちらかに存在するか確認
    try {
        // [画像素材] のパス: guest_uploads/{customerId}/front
        candidate1 = await getLatestImageFromFolder(`guest_uploads/${customerId}/front`);

        // [髪色アプリ] のパス: hair_app_uploads/{customerId}
        candidate2 = await getLatestImageFromFolder(`hair_app_uploads/${customerId}`);

        // 両方ある場合は新しい方 (timestamp) を比較して返す
        if (candidate1 && candidate2) {
            if (candidate1.timestamp > candidate2.timestamp) {
                return candidate1.url;
            } else {
                return candidate2.url;
            }
        }

        // 片方しかない場合
        if (candidate2) return candidate2.url;
        if (candidate1) return candidate1.url;

    } catch (e) {
        console.warn('Error fetching preferred before images:', e);
    }

    // 優先度 3: 事前の予約時の写真 (uploads/{customerId})
    try {
        const fallback = await getLatestImageFromFolder(`uploads/${customerId}`, (item) => {
            return item.name.startsWith('item-front-photo-') && item.name.endsWith('-image.jpg');
        });

        if (fallback) return fallback.url;
        return null;
    } catch (error) {
        console.error('Failed to fetch fallback before image:', error);
        return null;
    }
}

// ヘルパー: Storageからスマホでアップロードされた最新画像URLを取得
async function fetchLatestImages(customerId) {
    const folderPath = `ai-matching-uploads/${customerId}`;
    const folderRef = ref(storage, folderPath);

    try {
        const res = await listAll(folderRef);

        const sortedItems = res.items.sort((a, b) => {
            return b.name.localeCompare(a.name); // 降順
        });

        const latest = { front: null, side: null, back: null };

        for (const item of sortedItems) {
            if (!latest.front && item.name.startsWith('front')) {
                latest.front = await getDownloadURL(item);
            }
            if (!latest.side && item.name.startsWith('side')) {
                latest.side = await getDownloadURL(item);
            }
            if (!latest.back && item.name.startsWith('back')) {
                latest.back = await getDownloadURL(item);
            }
            if (latest.front && latest.side && latest.back) break;
        }

        return latest;
    } catch (e) {
        console.warn('Error fetching latest images:', e);
        return { front: null, side: null, back: null };
    }
}

// ヘルパー: 結果表示
async function displayResult(data) {
    const scoreElem = document.querySelector('.score-value');
    scoreElem.innerHTML = `${data.score}<span class="percent">%</span>`;
    document.querySelector('.reason-text').textContent = data.reason;

    const beforeImgElem = document.getElementById('result-before-img');
    const latestBookingPhotoUrl = await fetchLatestBeforeImage(appState.customerId);

    if (latestBookingPhotoUrl) {
        beforeImgElem.src = latestBookingPhotoUrl;
    } else if (appState.uploadedUrls.front) {
        beforeImgElem.src = appState.uploadedUrls.front;
    }

    const afterImgElem = document.getElementById('result-after-img');
    const frontSrc = appState.uploadedUrls.front;

    if (frontSrc) {
        afterImgElem.src = frontSrc;
    } else {
        const altSrc = appState.uploadedUrls.side || appState.uploadedUrls.back;
        if (altSrc) afterImgElem.src = altSrc;
    }

    // 「画像で保存」ボタンを表示、「診断開始」を非表示
    document.getElementById('header-save-btn').style.display = 'inline-flex';
    document.getElementById('header-diagnose-btn').style.display = 'none';
}


// 診断開始 (スマホで撮影された画像を読み込んで分析)
window.startDiagnosis = async () => {
    if (!appState.customerId) {
        alert('顧客IDが見つかりません。管理画面からアクセスし直してください。');
        return;
    }

    const diagnoseBtn = document.getElementById('header-diagnose-btn');
    const originalBtnText = diagnoseBtn.innerHTML;
    diagnoseBtn.disabled = true;
    diagnoseBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> カメラ画像の取得中...';

    // UI初期化
    document.querySelector('.reason-text').textContent = 'スマホで撮影・保存された画像を取得しています...';
    document.getElementById('result-after-img').src = 'https://placehold.jp/800x1000.png?text=Loading%20Images...';

    try {
        // Storageから最新画像を探す
        const latestImages = await fetchLatestImages(appState.customerId);

        if (!latestImages.front && !latestImages.side && !latestImages.back) {
            throw new Error('スマホ側から保存された画像が見つかりません。先にスマホ側で写真を「保存」してください。');
        }

        appState.uploadedUrls = latestImages;

        // 分析開始
        diagnoseBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI分析中...';
        document.querySelector('.reason-text').textContent = '最新のAIモデルで骨格・髪質分析を実行中です。しばらくお待ちください...';
        document.getElementById('result-after-img').src = 'https://placehold.jp/800x1000.png?text=AI%20Analyzing...';

        // Before画像(=最新の予約写真)を取得
        const latestBookingPhotoUrl = await fetchLatestBeforeImage(appState.customerId);

        const inputData = {
            frontImage: latestImages.front,
            sideImage: latestImages.side,
            backImage: latestImages.back,
            beforeImage: latestBookingPhotoUrl,
        };

        console.log('Sending to AI:', inputData);

        const analyzeCall = httpsCallable(functions, 'analyzeHairstyleCall');
        const result = await analyzeCall(inputData);
        const analysisData = result.data;

        await displayResult(analysisData);

    } catch (error) {
        console.error('Diagnosis failed:', error);
        alert(`診断中にエラーが発生しました: ${error.message}`);
        document.querySelector('.reason-text').textContent = '診断に失敗しました。「診断開始」ボタンからもう一度お試しください。';
        document.getElementById('result-after-img').src = 'https://placehold.jp/800x1000.png?text=Error';
    } finally {
        diagnoseBtn.innerHTML = originalBtnText;
        diagnoseBtn.disabled = false;
    }
};

// 保存機能 ("画像を保存"ボタン)
window.saveResultImage = async () => {
    const saveBtn = document.getElementById('header-save-btn');
    const originalText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中';

    try {
        document.body.classList.add('snapshot-mode');
        await new Promise((r) => setTimeout(r, 100));

        const targetElement = document.body;
        const canvas = await html2canvas(targetElement, {
            useCORS: true,
            scale: 3,
            backgroundColor: '#f0f4f8',
            logging: false,
        });

        document.body.classList.remove('snapshot-mode');

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));

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

        alert('結果画像を保存してギャラリーへ追加しました！');
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
