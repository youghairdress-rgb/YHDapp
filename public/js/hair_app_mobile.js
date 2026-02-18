/**
 * hair_app_mobile.js
 * Mobile Logic: File Input (Camera) -> Upload to Storage -> Update Firestore
 * Refactored to match `diagnosis/mobile_upload.html` style (simple file input)
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { appState } from '../diagnosis/js/state.js';

const app = initializeApp(appState.firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

let currentCustomerId = null;

document.addEventListener('DOMContentLoaded', async () => {
    await signInAnonymously(auth);

    const params = new URLSearchParams(window.location.search);
    currentCustomerId = params.get('customerId');

    if (!currentCustomerId) {
        alert("顧客IDが指定されていません。");
        return;
    }

    // Load Customer Name
    loadCustomerName(currentCustomerId);

    // Setup Event Listener
    document.getElementById('camera-input').addEventListener('change', handleFileSelect);
});

async function loadCustomerName(id) {
    try {
        const docRef = doc(db, "users", id);
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
            document.getElementById('customer-name-display').textContent = snapshot.data().name + " 様";
        }
    } catch (e) {
        console.error("Name Load Error", e);
    }
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Show Preview
    const previewContainer = document.getElementById('preview-container');
    const previewImage = document.getElementById('preview-image');
    previewImage.src = URL.createObjectURL(file);
    previewContainer.style.display = 'block';

    // Start Upload
    const overlay = document.getElementById('uploading-overlay');
    const statusMsg = document.getElementById('status-message');

    overlay.style.display = 'flex';
    statusMsg.style.display = 'none';

    try {
        // Upload
        const filename = `hair_app_uploads/${currentCustomerId}/${Date.now()}.jpg`;
        const storageRef = ref(storage, filename);

        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        // Update Firestore Metadata (so PC app knows what to fetch)
        await updateDoc(doc(db, "users", currentCustomerId), {
            hair_app_latest: url,
            hair_app_updatedAt: serverTimestamp()
        });

        // Success UI
        statusMsg.style.display = 'block';
        statusMsg.textContent = "アップロード完了！PCアプリで確認してください。";
        // alert("アップロード完了！");

    } catch (e) {
        console.error("Upload Error", e);
        alert("アップロード失敗: " + e.message);
        statusMsg.style.display = 'block';
        statusMsg.textContent = "アップロードに失敗しました。";
        statusMsg.style.color = "red";
    } finally {
        overlay.style.display = 'none';
    }
}
