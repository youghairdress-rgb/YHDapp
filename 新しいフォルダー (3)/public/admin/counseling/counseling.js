import { runAdminPage } from '../auth/admin-auth.js'; // ★★★ パスを修正 ★★★
import { db, storage, functions } from '../firebase-init.js';
import { doc, getDoc, collection, addDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";


// このページのメイン処理
const counselingMain = async (auth, user) => {

    // --- Element References ---
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

    const inputs = {
        genderRadios: document.querySelectorAll('input[name="gender"]'),
    };

    const display = {
        customerName: document.getElementById('customer-name-display'),
        logo: document.getElementById('logo-image'),
    };

    const captureCardContainer = document.querySelector('#capture-screen .space-y-3');
    const analyzingStatusText = document.getElementById('analyzing-status');

    // --- State Management ---
    let currentDiagnosisData = {};
    let customerId = null;
    const captureItems = [
        { id: 'front-photo', type: 'photo', label: '写真：正面', description: '顔がはっきりと写るように' },
        { id: 'side-photo', type: 'photo', label: '写真：サイド', description: '横顔と髪の長さがわかるように' },
        { id: 'back-photo', type: 'photo', label: '写真：バック', description: '後ろ全体の髪型がわかるように' },
        { id: 'front-video', type: 'video', label: '動画：正面 (3秒)', description: 'ゆっくりと左右に顔を動かす' },
        { id: 'back-video', type: 'video', label: '動画：バック (3秒)', description: '髪全体の動きがわかるように' },
    ];
    let captureState = {};


    // --- Functions ---

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

        // Add event listeners after creation
        document.querySelectorAll('.file-input').forEach(input => {
            input.addEventListener('change', handleFileCapture);
        });
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
            customerId: customerId,
            userName: display.customerName.textContent,
            gender: selectedGender,
            createdAt: serverTimestamp(),
            mediaUrls: {},
            results: null,
            analysisStatus: 'リクエスト受付',
        };
        createCaptureCards(); // Create fresh cards for the new session
        buttons.submitDiagnosis.disabled = true;
        buttons.submitDiagnosis.classList.add('bg-gray-400', 'cursor-not-allowed');
        buttons.submitDiagnosis.classList.remove('bg-teal-500', 'hover:bg-teal-600');

    }

    async function uploadMedia(captureId, file) {
        if (!currentDiagnosisData.id) {
            console.error("Diagnosis ID is not initialized.");
            return;
        }

        const card = document.querySelector(`.capture-card[data-id="${captureId}"]`);
        const statusIconContainer = card.querySelector('.status-icon');
        const originalIcon = statusIconContainer.innerHTML; // Save original icon
        statusIconContainer.innerHTML = '<div class="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full spinner"></div>';

        try {
            const filePath = `diagnoses/${currentDiagnosisData.id}/${captureId}-${file.name}`;
            const fileRef = ref(storage, filePath);
            const snapshot = await uploadBytes(fileRef, file);
            const url = await getDownloadURL(snapshot.ref);

            currentDiagnosisData.mediaUrls[captureId] = url;
            const galleryRef = collection(db, `users/${customerId}/gallery`);
            await addDoc(galleryRef, {
                url: url,
                createdAt: serverTimestamp(),
                source: 'AI-Counseling',
                diagnosisId: currentDiagnosisData.id
            });

            console.log(`${captureId} upload successful: `, url);
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

        if (file.type.startsWith('video/')) {
            thumbnail.src = "https://placehold.co/96x96/E6FFFA/38B2AC?text=VIDEO";
        } else {
            thumbnail.src = URL.createObjectURL(file);
        }
        thumbnail.classList.remove('hidden');
        if(icon) icon.classList.add('hidden');

        card.querySelector('.button-text').textContent = '再撮影';
        captureState[captureId] = true;
        uploadMedia(captureId, file);

        const allCaptured = Object.values(captureState).every(status => status);
        if (allCaptured) {
            buttons.submitDiagnosis.disabled = false;
            buttons.submitDiagnosis.classList.remove('bg-gray-400', 'cursor-not-allowed');
            buttons.submitDiagnosis.classList.add('bg-teal-500', 'hover:bg-teal-600');
        }
    }

    async function requestAiAnalysis() {
        if (!currentDiagnosisData.id) {
            alert("診断セッションが初期化されていません。");
            return;
        }
        switchScreen(screens.analyzing);
        analyzingStatusText.textContent = '診断リクエストを送信中...';
        
        try {
            const diagnosisRef = doc(db, "diagnoses", currentDiagnosisData.id);
            await setDoc(diagnosisRef, currentDiagnosisData);

            alert("AI分析リクエスト機能は現在開発中です。");

        } catch (error) {
            console.error("AI analysis request failed:", error);
            alert("AI分析リクエストに失敗しました。");
            switchScreen(screens.capture);
        }
    }
    
    // --- Event Listeners Setup ---
    buttons.start.addEventListener('click', () => {
        const genderSelected = document.querySelector('input[name="gender"]:checked');
        if (genderSelected) {
            initializeDiagnosis();
            switchScreen(screens.capture);
        } else {
            alert("性別を選択してください。");
        }
    });
    
    inputs.genderRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            buttons.start.disabled = false;
            buttons.start.classList.remove('bg-gray-400', 'cursor-not-allowed');
            buttons.start.classList.add('bg-teal-500', 'hover:bg-teal-600');
        });
    });

    buttons.submitDiagnosis.addEventListener('click', () => {
        if (!buttons.submitDiagnosis.disabled) {
            requestAiAnalysis();
        }
    });
    
    // --- Initial Execution ---
    try {
        await setupCustomerInfo();
        switchScreen(screens.opening);
    } catch (error) {
        // Use the showError function from admin-auth.js
        showError(error.message);
    }
};

// --- App Entry Point ---
const COUNSELING_LIFF_ID = "2008029428-DZNnAbNl";
runAdminPage(counselingMain, COUNSELING_LIFF_ID);

