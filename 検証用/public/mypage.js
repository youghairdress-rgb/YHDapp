import { db, initializeLiffAndAuth } from './admin/firebase-init.js';
import { doc, getDoc, setDoc, collection, query, where, orderBy, getDocs, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- DOM Helper Functions ---
const loadingContainer = document.getElementById('loading-container');
const contentContainer = document.getElementById('content-container');
const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');
const mypageContainer = document.getElementById('mypage-container');

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


// --- Main Application Logic ---
const main = async () => {
    try {
        showLoading("LIFFを初期化中...");
        const { user, profile } = await initializeLiffAndAuth("2008029428-VljQlRjZ");
        
        showLoading("顧客情報を確認中...");
        const userDocRef = doc(db, "users", profile.userId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            displayMyPage(userDocSnap.data());
            fetchReservationHistory(profile.userId);
            fetchGallery(profile.userId);
            showContent();
        } else {
            // 未登録の場合は初回登録ページへリダイレクト
            window.location.href = './entry.html';
        }
        setupTabEvents();

    } catch (error) {
        console.error("メイン処理でエラー:", error);
        showError(error.message);
    }
};

// --- Tab Switching Logic ---
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

// --- Display MyPage ---
const displayMyPage = (userData) => {
    mypageContainer.style.display = 'block';
    document.getElementById('mypage-name').textContent = userData.name || 'ゲスト';
};


// --- Data Fetching & Rendering ---
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
                        <p>${sale.staffNote || 'メッセージはまだありません。'}</p>
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

const fetchGallery = async (userId) => {
    const galleryContainer = document.getElementById('gallery-container');
    galleryContainer.innerHTML = '<div class="spinner"></div>';
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
        galleryContainer.querySelectorAll('.gallery-thumbnail').forEach(img => {
            img.addEventListener('click', () => {
                viewerImg.src = img.src;
                viewer.style.display = 'flex';
            });
        });
        viewer.querySelector('.close-viewer').addEventListener('click', () => {
            viewer.style.display = 'none';
        });

    } catch (error) {
        console.error("ギャラリーの読み込みエラー:", error);
        galleryContainer.innerHTML = '<p>ギャラリーの読み込みに失敗しました。</p>';
    }
};

// --- Application Execution ---
document.addEventListener('DOMContentLoaded', main);
