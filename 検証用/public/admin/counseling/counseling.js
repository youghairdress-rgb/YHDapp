import { runAdminPage, showError } from '../admin-auth.js';
import { db, storage, functions } from '../firebase-init.js';
import { doc, getDoc, collection, addDoc, serverTimestamp, setDoc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const counselingMain = async (auth, user) => {

    const screens = {
        opening: document.getElementById('opening-screen'),
        capture: document.getElementById('capture-screen'),
        analyzing: document.getElementById('analyzing-screen'),
        results: document.getElementById('results-screen'),
    };
    const buttons = {
        start: document.getElementById('start-button'),
        submitDiagnosis: document.getElementById('submit-diagnosis-button'),
    };
    const display = {
        customerName: document.getElementById('customer-name-display'),
        logo: document.getElementById('logo-image'),
    };
    const captureCardContainer = document.querySelector('#capture-screen .space-y-3');
    const analyzingStatusText = document.getElementById('analyzing-status');
    let currentDiagnosisData = {};
    let customerId = null;
    let unsubscribeDiagnosisListener = null;
    const captureItems = [
        { id: 'front-photo', type: 'photo', label: '写真：正面', description: '顔がはっきりと写るように' },
        { id: 'side-photo', type: 'photo', label: '写真：サイド', description: '横顔と髪の長さがわかるように' },
        { id: 'back-photo', type: 'photo', label: '写真：バック', description: '後ろ全体の髪型がわかるように' },
        { id: 'front-video', type: 'video', label: '動画：正面 (3秒)', description: 'ゆっくりと左右に顔を動かす' },
        { id: 'back-video', type: 'video', label: '動画：バック (3秒)', description: '髪全体の動きがわかるように' },
    ];
    let captureState = {};

    function switchScreen(screenElement) {
        Object.values(screens).forEach(screen => screen.classList.add('hidden'));
        screenElement.classList.remove('hidden');
    }

    function createCaptureCards() {
        captureCardContainer.innerHTML = '';
        captureItems.forEach(item => {
            captureState[item.id] = false;
            const card = document.createElement('div');
            card.className = 'capture-card flex items-center bg-white p-4 rounded-lg border border-gray-200 shadow-sm';
            card.dataset.id = item.id;
            card.innerHTML = `
                <div class="status-icon mr-4">
                    <ion-icon name="${item.type === 'video' ? 'videocam-outline' : 'camera-outline'}" class="text-3xl text-gray-400 icon"></ion-icon>
                    <img class="thumbnail w-10 h-10 rounded-full object-cover hidden" src="" alt="Thumbnail">
                </div>
                <div class="flex-grow">
                    <p class="font-bold text-gray-800">${item.label}</p>
                    <p class="text-xs text-gray-500">${item.description}</p>
                </div>
                <label class="button-secondary cursor-pointer">
                    <span class="button-text">${item.type === 'video' ? '撮影する' : '撮影する'}</span>
                    <input type="file" accept="${item.type}/*" class="file-input hidden" capture="environment">
                </label>
            `;
            captureCardContainer.appendChild(card);
        });
        document.querySelectorAll('.file-input').forEach(input => input.addEventListener('change', handleFileCapture));
    }

    async function setupCustomerInfo() {
        const params = new URLSearchParams(window.location.search);
        customerId = params.get('customerId');
        if (!customerId) throw new Error("顧客IDが指定されていません。");
        const userDocRef = doc(db, "users", customerId);
        const userDocSnap = await getDoc(userDocRef);
        if (!userDocSnap.exists()) throw new Error("指定された顧客情報が見つかりません。");
        const customerData = userDocSnap.data();
        display.customerName.textContent = customerData.name || 'お客様';
        display.logo.src = "../../img/YHDlogo2.png";
    }

    function initializeDiagnosis() {
        const timestamp = Date.now();
        const selectedGender = document.querySelector('input[name="gender"]:checked').value;
        currentDiagnosisData = {
            id: `${customerId}-${timestamp}`,
            customerId,
            userName: display.customerName.textContent,
            gender: selectedGender,
            createdAt: serverTimestamp(),
            mediaUrls: {},
            results: null,
            analysisStatus: 'リクエスト受付',
        };
        createCaptureCards();
        buttons.submitDiagnosis.disabled = true;
        buttons.submitDiagnosis.classList.add('bg-gray-400', 'cursor-not-allowed');
        buttons.submitDiagnosis.classList.remove('bg-teal-500', 'hover:bg-teal-600');
    }

    async function uploadMedia(captureId, file) {
        if (!currentDiagnosisData.id) return;
        const card = document.querySelector(`.capture-card[data-id="${captureId}"]`);
        const statusIconContainer = card.querySelector('.status-icon');
        statusIconContainer.innerHTML = '<div class="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full spinner"></div>';
        try {
            const filePath = `diagnoses/${currentDiagnosisData.id}/${captureId}-${file.name}`;
            const fileRef = ref(storage, filePath);
            const snapshot = await uploadBytes(fileRef, file);
            const url = await getDownloadURL(snapshot.ref);
            currentDiagnosisData.mediaUrls[captureId] = url;
            const galleryRef = collection(db, `users/${customerId}/gallery`);
            await addDoc(galleryRef, { url, createdAt: serverTimestamp(), source: 'AI-Counseling', diagnosisId: currentDiagnosisData.id });
            statusIconContainer.innerHTML = '<ion-icon name="checkmark-circle" class="text-3xl text-teal-500"></ion-icon>';
        } catch (error) {
            console.error("Upload failed:", error);
            statusIconContainer.innerHTML = '<ion-icon name="alert-circle" class="text-3xl text-red-500"></ion-icon>';
            alert(`「${captureId}」のアップロードに失敗しました。`);
        }
    }

    function handleFileCapture(event) {
        const file = event.target.files[0];
        if (!file) return;
        const card = event.target.closest('.capture-card');
        const captureId = card.dataset.id;
        const thumbnail = card.querySelector('.thumbnail');
        const icon = card.querySelector('.icon');
        thumbnail.src = file.type.startsWith('video/') ? "https://placehold.co/96x96/E6FFFA/38B2AC?text=VIDEO" : URL.createObjectURL(file);
        thumbnail.classList.remove('hidden');
        if (icon) icon.classList.add('hidden');
        card.querySelector('.button-text').textContent = '再撮影';
        captureState[captureId] = true;
        uploadMedia(captureId, file);
        if (Object.values(captureState).every(status => status)) {
            buttons.submitDiagnosis.disabled = false;
            buttons.submitDiagnosis.classList.remove('bg-gray-400', 'cursor-not-allowed');
            buttons.submitDiagnosis.classList.add('bg-teal-500', 'hover:bg-teal-600');
        }
    }

    async function requestAiAnalysis() {
        if (!currentDiagnosisData.id) return alert("診断セッションが初期化されていません。");
        switchScreen(screens.analyzing);
        analyzingStatusText.textContent = '診断情報を保存中...';
        try {
            const diagnosisRef = doc(db, "diagnoses", currentDiagnosisData.id);
            await setDoc(diagnosisRef, currentDiagnosisData);
            listenToDiagnosisStatus(currentDiagnosisData.id);
            const runAiAnalysis = httpsCallable(functions, 'runAiAnalysis');
            await runAiAnalysis({ diagnosisId: currentDiagnosisData.id });
        } catch (error) {
            console.error("AI analysis request failed:", error);
            const errorMessage = error.details?.message || error.message;
            showError(`AI分析リクエストに失敗しました: ${errorMessage}`);
            switchScreen(screens.capture);
        }
    }

    function listenToDiagnosisStatus(diagnosisId) {
        if (unsubscribeDiagnosisListener) unsubscribeDiagnosisListener();
        const diagnosisRef = doc(db, "diagnoses", diagnosisId);
        unsubscribeDiagnosisListener = onSnapshot(diagnosisRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                analyzingStatusText.textContent = data.analysisStatus || 'ステータス確認中...';
                if (data.analysisStatus.includes("エラー")) {
                    showError(data.analysisStatus);
                    unsubscribeDiagnosisListener();
                    switchScreen(screens.capture);
                } else if (data.analysisStatus === "診断が完了しました！") {
                    unsubscribeDiagnosisListener();
                    displayResults(data.results);
                }
            }
        });
    }

    function displayResults(results) {
        screens.results.innerHTML = '';
        if (!results) {
            screens.results.innerHTML = '<div class="result-card"><p>診断結果を取得できませんでした。</p></div>';
            switchScreen(screens.results);
            return;
        }
        screens.results.innerHTML += `<div class="result-card"><h2>トップスタイリストAIより</h2><p>${results.topStylistComment || ''}</p></div>`;
        if (results.generatedImageUrl) {
            screens.results.innerHTML += `<div class="result-card"><h2>AIによるヘアスタイル生成</h2><img src="${results.generatedImageUrl}" alt="AI Generated Hairstyle" class="generated-image"></div>`;
        }
        const createDiagnosisCard = (data) => {
            if (!data || !data.items) return '';
            let itemsHtml = Object.entries(data.items).map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`).join('');
            return `<div class="result-card"><h3><ion-icon name="${data.icon}"></ion-icon> ${data.title}</h3><ul>${itemsHtml}</ul></div>`;
        };
        screens.results.innerHTML += createDiagnosisCard(results.facial);
        screens.results.innerHTML += createDiagnosisCard(results.skeletal);
        screens.results.innerHTML += createDiagnosisCard(results.personalColor);
        const createSuggestionCard = (title, suggestions) => {
            if (!suggestions) return '';
            let itemsHtml = suggestions.map(item => `<li><h4>${item.name}</h4><p>${item.desc}</p></li>`).join('');
            return `<div class="result-card"><h3>${title}</h3><ul>${itemsHtml}</ul></div>`;
        };
        screens.results.innerHTML += createSuggestionCard("ヘアスタイル提案", results.hairstyleSuggestions);
        screens.results.innerHTML += createSuggestionCard("ヘアカラー提案", results.haircolorSuggestions);
        screens.results.innerHTML += createSuggestionCard("ファッション提案", results.fashionSuggestions);
        screens.results.innerHTML += createSuggestionCard("メイク提案", results.makeupSuggestions);
        switchScreen(screens.results);
    }

    buttons.start.addEventListener('click', () => {
        if (document.querySelector('input[name="gender"]:checked')) {
            initializeDiagnosis();
            switchScreen(screens.capture);
        } else {
            alert("性別を選択してください。");
        }
    });
    document.querySelectorAll('input[name="gender"]').forEach(radio => {
        radio.addEventListener('change', () => {
            buttons.start.disabled = false;
            buttons.start.classList.remove('bg-gray-400', 'cursor-not-allowed');
            buttons.start.classList.add('bg-teal-500', 'hover:bg-teal-600');
        });
    });
    buttons.submitDiagnosis.addEventListener('click', () => {
        if (!buttons.submitDiagnosis.disabled) requestAiAnalysis();
    });

    try {
        await setupCustomerInfo();
        switchScreen(screens.opening);
    } catch (error) {
        showError(error.message);
    }
};

const COUNSELING_LIFF_ID = "2008029428-DZNnAbNl";
runAdminPage(counselingMain, COUNSELING_LIFF_ID);

function createAnalysisPrompt(diagnosisData) {
    const { userName, gender } = diagnosisData;
    return `
あなたは、トップクラスの美容師、ファッションコンサルタント、メイクアップアーティストを兼ね備えたAIアシスタントです。
顧客の顔写真から特徴を詳細に分析し、以下の項目についてプロフェッショナルな診断と具体的な提案を日本語のJSON形式で出力してください。

# 出力フォーマット (必ずこのJSON形式に従い、すべての項目を埋めてください)
\`\`\`json
{
    "facial": { "title": "顔診断", "icon": "happy-outline", "items": { "顔の形": "...", "パーツバランス": "...", "肌のトーン": "..." } },
    "skeletal": { "title": "骨格診断", "icon": "body-outline", "items": { "骨格タイプ": "...", "首の長さ": "...", "肩のライン": "..." } },
    "personalColor": { "title": "パーソナルカラー", "icon": "color-palette-outline", "items": { "診断結果": "...", "似合うトーン": "..." } },
    "hairstyleSuggestions": [ { "name": "...", "desc": "..." }, { "name": "...", "desc": "..." } ],
    "haircolorSuggestions": [ { "name": "...", "desc": "..." } ],
    "fashionSuggestions": [ { "name": "...", "desc": "..." } ],
    "makeupSuggestions": [ { "name": "...", "desc": "..." } ],
    "topStylistComment": "..."
}
\`\`\`

# 顧客情報
- 名前: ${userName}
- 性別: ${gender}

# 分析依頼
添付された顔写真を基に、最高の診断結果と提案を生成してください。
- **診断**: 顔の形、パーツバランス、肌のトーン、骨格タイプなどを客観的に分析してください。
- **提案**: ヘアスタイル、ヘアカラー、ファッション、メイクについて、診断結果に基づいた具体的な提案を複数生成してください。
- **コメント**: 「topStylistComment」には、全ての診断結果を統合し、顧客に語りかけるように、説得力のある文章で記述してください。
`;
}

