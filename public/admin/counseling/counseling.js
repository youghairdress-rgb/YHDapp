// Firebase SDK と LIFF/Firebase初期化モジュールをインポート
import { db, storage, initializeLiffAndAuth } from '../admin/firebase-init.js';
// Cloud Functions SDKのimportは、モックを使用するため不要になります
// import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { doc, getDoc, setDoc, serverTimestamp, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const COUNSELING_LIFF_ID = "2008029428-DZNnAbNl";

// --- DOM Element References ---
const mainContainer = document.getElementById('main-container');
const screens = {
    loading: document.getElementById('loading-screen'),
    capture: document.getElementById('capture-screen'),
    analyzing: document.getElementById('analyzing-screen'),
    results: document.getElementById('results-screen'),
    error: document.getElementById('error-modal'),
};
const buttons = {
    submitDiagnosis: document.getElementById('submit-diagnosis-button'),
    save: document.getElementById('save-button'),
    restart: document.getElementById('restart-button'),
};
const captureItemsContainer = document.getElementById('capture-items');
const analyzingStatusText = document.getElementById('analyzing-status');
const resultsContent = document.getElementById('results-content');
const errorMessageText = document.getElementById('error-message-text');

// --- State Management ---
let customerId = null; // LINE User ID
let diagnosisResult = null; // To store AI results
const captureState = {
    'front-photo': { required: true, file: null, label: '正面の写真' },
    'side-photo': { required: true, file: null, label: '横顔の写真' },
    'back-photo': { required: true, file: null, label: '後ろ姿の写真' },
    'front-video': { required: false, file: null, label: '正面の動画' },
    'back-video': { required: false, file: null, label: '後ろ姿の動画' },
};

// --- UI Control Functions ---
const switchScreen = (targetScreenKey) => {
    Object.values(screens).forEach(screen => screen.classList.add('hidden'));
    if (screens[targetScreenKey]) {
        screens[targetScreenKey].classList.remove('hidden');
    }
};

const showError = (message) => {
    errorMessageText.textContent = message;
    screens.error.classList.remove('hidden');
};

// --- Core Logic ---

/**
 * Renders the file upload UI based on captureState
 */
const renderCaptureItems = () => {
    captureItemsContainer.innerHTML = '';
    for (const key in captureState) {
        const item = captureState[key];
        const isUploaded = item.file !== null;

        const itemDiv = document.createElement('div');
        itemDiv.className = `p-4 rounded-xl flex items-center justify-between transition-all duration-300 ${isUploaded ? 'bg-teal-100' : 'bg-gray-100'}`;
        itemDiv.innerHTML = `
            <div class="flex items-center">
                <ion-icon name="${isUploaded ? 'checkmark-circle' : 'cloud-upload-outline'}" class="text-2xl mr-3 ${isUploaded ? 'text-teal-500' : 'text-gray-500'}"></ion-icon>
                <div>
                    <p class="font-bold text-gray-800">${item.label} ${item.required ? '<span class="text-red-500">*</span>' : ''}</p>
                    <p class="text-xs text-gray-500" id="${key}-filename">${isUploaded ? item.file.name : '未選択'}</p>
                </div>
            </div>
            <label for="${key}-input" class="bg-white hover:bg-gray-50 text-gray-700 font-semibold py-2 px-4 border border-gray-300 rounded-lg cursor-pointer transition-all duration-200">
                選択
            </label>
            <input type="file" id="${key}-input" class="hidden" accept="${key.includes('video') ? 'video/*' : 'image/*'}">
        `;
        captureItemsContainer.appendChild(itemDiv);

        const inputEl = document.getElementById(`${key}-input`);
        inputEl.addEventListener('change', (e) => handleFileSelect(key, e.target.files[0]));
    }
};

/**
 * Handles file selection, updates state and UI
 * @param {string} key - The key from captureState (e.g., 'front-photo')
 * @param {File} file - The selected file object
 */
const handleFileSelect = (key, file) => {
    if (!file) return;
    captureState[key].file = file;
    document.getElementById(`${key}-filename`).textContent = file.name;
    const itemDiv = document.getElementById(`${key}-input`).parentElement;
    itemDiv.classList.remove('bg-gray-100');
    itemDiv.classList.add('bg-teal-100');
    itemDiv.querySelector('ion-icon').setAttribute('name', 'checkmark-circle');
    itemDiv.querySelector('ion-icon').classList.remove('text-gray-500');
    itemDiv.querySelector('ion-icon').classList.add('text-teal-500');

    const allRequiredUploaded = Object.keys(captureState).every(k => !captureState[k].required || captureState[k].file);
    buttons.submitDiagnosis.disabled = !allRequiredUploaded;
};

/**
 * Uploads all selected files to Firebase Storage
 * @returns {Promise<object>} - An object with keys and their corresponding download URLs
 */
const uploadFiles = async () => {
    const uploadPromises = [];
    const fileUrls = {};

    for (const key in captureState) {
        const item = captureState[key];
        if (item.file) {
            analyzingStatusText.textContent = `${item.label}をアップロード中...`;
            const filePath = `diagnoses/${customerId}/${Date.now()}-${item.file.name}`;
            const fileRef = ref(storage, filePath);

            const promise = uploadBytes(fileRef, item.file).then(snapshot => {
                return getDownloadURL(snapshot.ref).then(url => {
                    fileUrls[key] = url;
                });
            });
            uploadPromises.push(promise);
        }
    }
    await Promise.all(uploadPromises);
    return fileUrls;
};

// ▼▼▼【新規追加】バックエンドのAI応答をシミュレートするダミー関数 ▼▼▼
/**
 * Simulates an AI analysis by returning mock data after a delay.
 * @param {object} fileUrls - The URLs of the uploaded files (unused in mock)
 * @returns {Promise<object>} - The mock analysis results
 */
const mockAiFunction = async (fileUrls) => {
    console.log("Mock AI function called with URLs:", fileUrls);
    analyzingStatusText.textContent = `AIがあなたの特徴を分析しています...`;

    // 実際のAI処理時間をシミュレート
    await new Promise(resolve => setTimeout(resolve, 5000));

    // functions/index.js にあるものと同じ構造のダミーデータを返却
    return {
        faceShape: {
            title: "顔診断",
            result: "卵型",
            description: "理想的な卵型の輪郭です。あらゆるヘアスタイルが似合いますが、特に顔周りに動きのあるスタイルで、より魅力が引き立ちます。",
            icon: "happy-outline"
        },
        personalColor: {
            title: "パーソナルカラー診断",
            result: "イエローベース（春）",
            description: "明るくクリアな色が得意です。コーラルピンクやオレンジベージュなど、暖かみのあるヘアカラーが肌の透明感をアップさせます。",
            icon: "sunny-outline"
        },
        recommendedStyle: {
            title: "似合うヘアスタイル",
            result: "レイヤーボブ",
            description: "顔周りのレイヤーが卵型の美しさを強調し、軽やかで洗練された印象を与えます。スタイリングも簡単でおすすめです。",
            icon: "cut-outline"
        },
        recommendedColor: {
            title: "似合うヘアカラー",
            result: "ミルクティーベージュ",
            description: "イエベ春の肌色に完璧にマッチし、柔らかく透明感のある印象を与えます。ブリーチありでもなしでも楽しめる万能カラーです。",
            icon: "color-palette-outline"
        },
        makeupAdvice: {
            title: "メイク・服装アドバイス",
            result: "コーラルメイク＆明るいトップス",
            description: "ヘアカラーに合わせ、コーラル系のチークやリップを取り入れると、全体の統一感がアップします。服装はアイボリーやベージュなど、明るい色のトップスを選ぶと顔色がより明るく見えます。",
            icon: "shirt-outline"
        },
        stylistComment: {
            title: "AI美容師からの一言",
            result: "あなたの魅力を最大限に！",
            description: "診断結果を元に、あなたの魅力を最大限に引き出すスタイルを提案しました。サロンでのカウンセリングで、さらに細かいニュアンスを一緒に決めていきましょう！",
            icon: "chatbubble-ellipses-outline"
        },
        generatedImageUrl: "https://placehold.co/600x600/FFF4E6/FF8C3A?text=Generated+Style", // NanoBananaによるダミー画像
    };
};

/**
 * Renders the AI diagnosis results on the screen
 * @param {object} results - The AI analysis results
 */
const renderResults = (results) => {
    resultsContent.innerHTML = '';
    diagnosisResult = results;

    const createResultCard = (item) => {
        return `
            <div class="bg-white/80 p-5 rounded-xl shadow-md border border-gray-200/50 fade-in-up">
                <div class="flex items-center mb-2">
                    <ion-icon name="${item.icon}" class="text-xl text-teal-500 mr-3"></ion-icon>
                    <h3 class="font-poppins text-lg font-semibold text-teal-700">${item.title}</h3>
                </div>
                <p class="font-bold text-gray-800 text-lg mb-2">${item.result}</p>
                <p class="text-gray-600 text-sm leading-relaxed">${item.description}</p>
            </div>
        `;
    };

    resultsContent.innerHTML += createResultCard(results.faceShape);
    resultsContent.innerHTML += createResultCard(results.personalColor);
    resultsContent.innerHTML += createResultCard(results.recommendedStyle);
    resultsContent.innerHTML += createResultCard(results.recommendedColor);
    resultsContent.innerHTML += createResultCard(results.makeupAdvice);

    resultsContent.innerHTML += `
        <div class="bg-white/80 p-5 rounded-xl shadow-md border border-gray-200/50 fade-in-up">
            <div class="flex items-center mb-3">
                <ion-icon name="image-outline" class="text-xl text-teal-500 mr-3"></ion-icon>
                <h3 class="font-poppins text-lg font-semibold text-teal-700">AIによるスタイル合成イメージ</h3>
            </div>
            <img src="${results.generatedImageUrl}" alt="AI Generated Hairstyle" class="rounded-lg w-full">
        </div>`;

    resultsContent.innerHTML += createResultCard(results.stylistComment);

    resultsContent.querySelectorAll('.fade-in-up').forEach((el, index) => {
        el.style.animationDelay = `${index * 0.1}s`;
    });
};

/**
 * Saves the diagnosis result to Firestore
 */
const saveResults = async () => {
    if (!customerId || !diagnosisResult) {
        showError("保存する診断結果がありません。");
        return;
    }
    buttons.save.disabled = true;
    buttons.save.innerHTML = '<div class="spinner-small"></div> 保存中...';
    try {
        const diagnosisRef = doc(collection(db, `users/${customerId}/diagnoses`));
        await setDoc(diagnosisRef, {
            ...diagnosisResult,
            createdAt: serverTimestamp(),
        });
        alert("診断結果をマイページに保存しました！");
        // liff.closeWindow(); 
    } catch (error) {
        console.error("Failed to save results:", error);
        showError("結果の保存に失敗しました。");
    } finally {
        buttons.save.disabled = false;
        buttons.save.innerHTML = '<ion-icon name="cloud-download-outline" class="mr-2"></ion-icon> 結果を保存';
    }
};

// --- Event Listeners ---
buttons.submitDiagnosis.addEventListener('click', async () => {
    switchScreen('analyzing');
    try {
        const urls = await uploadFiles();
        // ▼▼▼【変更点】実際のCloud Functionsの代わりに、モック関数を呼び出す ▼▼▼
        const results = await mockAiFunction(urls);
        renderResults(results);
        switchScreen('results');
    } catch (error) {
        showError(error.message);
        switchScreen('capture');
    }
});

buttons.restart.addEventListener('click', () => {
    Object.keys(captureState).forEach(key => captureState[key].file = null);
    diagnosisResult = null;
    renderCaptureItems();
    switchScreen('capture');
});

buttons.save.addEventListener('click', saveResults);

// --- Main Initialization Function ---
const main = async () => {
    switchScreen('loading');
    try {
        await liff.init({ liffId: COUNSELING_LIFF_ID });

        if (!liff.isLoggedIn()) {
            liff.login({ redirectUri: window.location.href });
            return;
        }

        const profile = await liff.getProfile();
        customerId = profile.userId;

        if (!customerId) {
            throw new Error("顧客IDが取得できませんでした。");
        }

        renderCaptureItems();
        switchScreen('capture');

    } catch (err) {
        console.error("Initialization failed", err);
        showError(`初期化に失敗しました: ${err.message}`);
    }
};

document.addEventListener('DOMContentLoaded', main);

