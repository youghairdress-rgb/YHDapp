/**
 * hair_app_pc.js
 * PC Logic: Fetch Image -> AI Generation (Tone) -> MediaPipe (Color)
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// Reusing existing API logic helper (simplified)
// Reusing existing API logic helper (simplified)
import { generateHairstyleImage } from '../diagnosis/js/api.js';
import { appState } from '../diagnosis/js/state.js';

// --- State ---
let currentCustomer = null;
let originalImageSrc = null;
let generatedImageSrc = null;
let imageSegmenter = null;
let hairMaskBitmap = null;
let currentImageBitmap = null; // Can be original or generated

// --- Initialize ---
const app = initializeApp(appState.firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

// Mock AppState for API usage
appState.firebase = { app, auth, storage, firestore: db };
// API Base URL needs to be set. Usually it's in state.js or hardcoded. 
// For now, we reuse the logic in main.js but we need to ensure appState.apiBaseUrl is set if api.js uses it.
// Checking api.js... it uses appState.apiBaseUrl. 
// We should check what main.js sets it to. usually '/api' or functions URL.
// Let's try to detect local vs prod.
if (window.location.hostname === "localhost") {
    // appState.apiBaseUrl = "http://127.0.0.1:5001/yhd-db/us-central1"; // Example
}
// actually in main.js it might default to relative path proxy.

document.addEventListener('DOMContentLoaded', async () => {
    await signInAnonymously(auth);

    const params = new URLSearchParams(window.location.search);
    const customerId = params.get('customerId');

    if (!customerId) {
        alert("顧客IDが指定されていません。");
        return;
    }

    await loadCustomer(customerId);
    setupEventListeners();
    setupColorPresets();
});

async function loadCustomer(id) {
    showLoading(true, "顧客データを取得中...");
    try {
        const docRef = doc(db, "users", id);
        const snapshot = await getDoc(docRef);

        if (snapshot.exists()) {
            currentCustomer = { id: snapshot.id, ...snapshot.data() };
            document.getElementById('customer-name-display').textContent =
                `${currentCustomer.name} 様 (ID: ${currentCustomer.id})`; // Use ID for now if name missing

            // Fetch Latest Image
            // Priority: 1. hair_app_latest (from metadata) 2. Recent upload in 'uploads' 3. Gallery
            let imageUrl = null;
            if (currentCustomer.hair_app_latest) {
                imageUrl = currentCustomer.hair_app_latest;
            } else {
                // Fallback: Check uploads collection
                // This might be tricky without specific knowledge of where mobile app uploads.
                // For now, let's assume the Mobile App WILL set hair_app_latest.
                // Or try to fetch from 'guest_uploads'
                const q = query(collection(db, `guest_uploads/${id}/item-front-photo`), limit(1));
                // Actually guest_uploads structure is file storage...
            }

            if (imageUrl) {
                originalImageSrc = imageUrl;
                showStep1(imageUrl);
            } else {
                alert("画像が見つかりません。モバイルアプリからアップロードしてください。");
            }

        } else {
            alert("顧客データが見つかりません。");
        }
    } catch (e) {
        console.error(e);
        alert("データ読み込みエラー: " + e.message);
    } finally {
        showLoading(false);
    }
}

// --- UI Logic ---

function showStep1(src) {
    document.getElementById('step1-controls').classList.add('active');
    document.getElementById('step2-controls').classList.remove('active');

    const img = document.getElementById('source-image');
    img.src = src;
    img.style.display = 'block';

    const canvas = document.getElementById('transform-canvas');
    canvas.style.display = 'none';
}

async function handleGenerateTone() {
    const toneVal = document.getElementById('tone-select').value;
    if (!toneVal) return;

    showLoading(true, "AIがトーンを変更中...");

    try {
        // Prepare Params imitating Phase 6
        // We need 'generateHairstyleImage' from api.js
        // Params: originalImageUrl, firebaseUid, recommendedLevel, hasToneOverride...

        const params = {
            originalImageUrl: originalImageSrc,
            firebaseUid: currentCustomer.id,
            hairstyleName: "現在の髪型", // Placeholder
            hairstyleDesc: "維持",
            haircolorName: "現在の髪色", // Placeholder
            haircolorDesc: "維持",
            recommendedLevel: toneVal,
            currentLevel: "Tone 7", // Default assumption
            userRequestsText: "",
            isUserStyle: false,
            isUserColor: false,
            hasToneOverride: true,
            keepStyle: true,
            keepColor: true // We want to keep color "family" but change tone? 
            // Actually if keepColor is true, the prompt usually says "keep hair color".
            // But recommendedLevel adds "Tone X".
        };

        const res = await generateHairstyleImage(params);

        // Success
        generatedImageSrc = `data:${res.mimeType};base64,${res.imageBase64}`;

        await showStep2(generatedImageSrc);

    } catch (e) {
        console.error(e);
        alert("生成エラー: " + e.message);
    } finally {
        showLoading(false);
    }
}

async function showStep2(src) {
    document.getElementById('step1-controls').classList.remove('active');
    document.getElementById('step2-controls').classList.add('active');

    const img = document.getElementById('source-image');
    img.style.display = 'none';

    const canvas = document.getElementById('transform-canvas');
    canvas.style.display = 'block';

    // Initialize MediaPipe
    if (!imageSegmenter) {
        showLoading(true, "AIモデルを準備中...");
        await initializeHairSegmenter();
        showLoading(false);
    }

    // Load Image onto Canvas & Run Segmentation
    await runSegmentationAndDraw(src);
}

// --- MediaPipe Logic (Simplified Adapter) ---

async function initializeHairSegmenter() {
    try {
        const { ImageSegmenter, FilesetResolver } = window.MediaPipeVision;
        const visionTasks = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        imageSegmenter = await ImageSegmenter.createFromOptions(visionTasks, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite",
                delegate: "GPU"
            },
            runningMode: "IMAGE",
            outputCategoryMask: true,
            outputConfidenceMasks: false
        });
    } catch (e) {
        console.error("MediaPipe Init Error:", e);
        alert("AI機能の初期化に失敗しました。");
    }
}

async function runSegmentationAndDraw(src) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await new Promise(r => img.onload = r);

    currentImageBitmap = img; // Store for redraws

    const canvas = document.getElementById('transform-canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Draw initial
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    if (imageSegmenter) {
        const result = imageSegmenter.segment(img);
        const categoryMask = result.categoryMask;

        // Create Alpha Mask
        const maskData = categoryMask.getAsUint8Array();
        const maskImgData = new ImageData(categoryMask.width, categoryMask.height);
        for (let i = 0; i < maskData.length; i++) {
            const idx = i * 4;
            const isHair = maskData[i] === 1; // 1 is hair
            maskImgData.data[idx] = 0;
            maskImgData.data[idx + 1] = 0;
            maskImgData.data[idx + 2] = 0;
            maskImgData.data[idx + 3] = isHair ? 255 : 0;
        }
        hairMaskBitmap = await createImageBitmap(maskImgData);

        // Initial Apply (Default sliders)
        applyColor();
    }
}

function applyColor() {
    if (!currentImageBitmap || !hairMaskBitmap) return;

    const canvas = document.getElementById('transform-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Get Values
    const hue = parseInt(document.getElementById('range-hue').value);
    const sat = parseInt(document.getElementById('range-sat').value);
    const opacity = parseInt(document.getElementById('range-opacity').value) / 100.0;

    // Draw Base
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(currentImageBitmap, 0, 0);

    if (opacity > 0) {
        // Create Color Layer (Offscreen)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w; tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');

        // Draw Color
        tempCtx.fillStyle = `hsl(${hue}, ${sat}%, 50%)`;
        tempCtx.fillRect(0, 0, w, h);

        // Mask it
        tempCtx.globalCompositeOperation = 'destination-in';
        tempCtx.drawImage(hairMaskBitmap, 0, 0, w, h);

        // Blend it
        ctx.save();
        ctx.globalCompositeOperation = 'overlay'; // or 'color' or 'soft-light'
        // 'color' mode preserves luma, changes hue/sat. 
        // 'overlay' adds contrast. 
        // Phase 7 uses 'color' inside the logic usually, but here let's try 'color' first as it's safer for tints.
        // Actually ui-features.js uses manual blending math sometimes, or 'color' blend mode.
        // Let's stick to 'color' blend mode for standard tinting.
        ctx.globalCompositeOperation = 'color';
        ctx.globalAlpha = opacity;
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();
    }
}


// --- Listeners ---
function setupEventListeners() {
    document.getElementById('btn-generate-tone').addEventListener('click', handleGenerateTone);

    document.getElementById('btn-back-step1').addEventListener('click', () => {
        document.getElementById('step2-controls').classList.remove('active');
        document.getElementById('step1-controls').classList.add('active');
        document.getElementById('source-image').style.display = 'block';
        document.getElementById('transform-canvas').style.display = 'none';

        // Restore original image as source for step 1
        const img = document.getElementById('source-image');
        img.src = originalImageSrc;
    });

    ['range-hue', 'range-sat', 'range-opacity'].forEach(id => {
        document.getElementById(id).addEventListener('input', (e) => {
            // Update label
            if (id === 'range-hue') document.getElementById('label-hue').textContent = e.target.value + '°';
            if (id === 'range-sat') document.getElementById('label-sat').textContent = e.target.value + '%';
            if (id === 'range-opacity') document.getElementById('label-opacity').textContent = e.target.value + '%';
            applyColor();
        });
    });

    document.getElementById('btn-save-image').addEventListener('click', () => {
        const canvas = document.getElementById('transform-canvas');
        const link = document.createElement('a');
        link.download = `hair-transform-${Date.now()}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

function setupColorPresets() {
    const presets = [
        { h: 0, s: 0, color: '#333' }, // Black/Dark
        { h: 30, s: 60, color: '#8B4513' }, // Brown
        { h: 45, s: 80, color: '#DAA520' }, // Gold/Blonde
        { h: 0, s: 60, color: '#CD5C5C' }, // Red
        { h: 300, s: 40, color: '#800080' }, // Purple
    ];

    const container = document.getElementById('color-presets');
    presets.forEach(p => {
        const btn = document.createElement('div');
        btn.className = 'color-preset-btn';
        btn.style.backgroundColor = p.color;
        btn.addEventListener('click', () => {
            document.getElementById('range-hue').value = p.h;
            document.getElementById('range-sat').value = p.s;
            // Trigger input events to update labels and canvas
            document.getElementById('range-hue').dispatchEvent(new Event('input'));
            document.getElementById('range-sat').dispatchEvent(new Event('input'));
        });
        container.appendChild(btn);
    });
}


function showLoading(show, text) {
    const el = document.getElementById('loading-overlay');
    const txt = document.getElementById('loading-text');
    if (show) {
        el.style.display = 'flex';
        txt.textContent = text;
    } else {
        el.style.display = 'none';
    }
}
