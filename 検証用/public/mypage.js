import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, orderBy, getDocs, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- Firebaseの初期化 ---
const firebaseConfig = {
    apiKey: "AIzaSyCjZcF8GFC4CJMYmpucjJ_yShsn74wDLVw",
    authDomain: "yhd-db.firebaseapp.com",
    projectId: "yhd-db",
    storageBucket: "yhd-db.appspot.com",
    messagingSenderId: "940208179982",
    appId: "1:940208179982:web:92abb326fa1dc8ee0b655f",
    measurementId: "G-RSYFJW3TN6"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- Cloud Functions URL ---
const CLOUD_FUNCTIONS_URL = "https://asia-northeast1-yhd-db.cloudfunctions.net";

// --- DOM操作ヘルパー関数 ---
const loadingContainer = document.getElementById('loading-container');
const contentContainer = document.getElementById('content-container');
const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');
const registrationContainer = document.getElementById('registration-container');
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

// --- Firebase/LIFF認証 ---
const liffLoginAndAuth = async (liff) => {
    if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
        return new Promise(() => {});
    }
    const accessToken = liff.getAccessToken();
    if (!accessToken) throw new Error("LIFFアクセストークンが取得できませんでした。");
    try {
        const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createFirebaseCustomToken`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`カスタムトークンの取得に失敗: ${response.status} ${errorText}`);
        }
        const { customToken } = await response.json();
        const userCredential = await signInWithCustomToken(auth, customToken);
        return userCredential.user;
    } catch (error) {
        console.error("Firebaseへの認証中にエラー:", error);
        throw new Error("サーバーとの接続に失敗しました。時間をおいて再度お試しください。");
    }
};

// --- メイン処理 ---
const main = async () => {
    try {
        showLoading("LIFFを初期化中...");
        await liff.init({ liffId: "2008029428-VljQlRjZ" });

        showLoading("ユーザー情報を認証中...");
        const user = await liffLoginAndAuth(liff);
        if (!user) throw new Error("ユーザー認証に失敗しました。");

        const profile = await liff.getProfile();
        
        showLoading("顧客情報を確認中...");
        const userDocRef = doc(db, "users", profile.userId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            displayMyPage(userDocSnap.data());
            fetchReservationHistory(profile.userId);
            fetchGallery(profile.userId);
        } else {
            displayRegistrationForm(profile);
        }
        setupTabEvents(); // タブ切り替えイベントを設定
        showContent();

    } catch (error) {
        console.error("メイン処理でエラー:", error);
        showError(error.message);
    }
};

// --- タブ切り替え処理 ---
const setupTabEvents = () => {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanels = document.querySelectorAll('.tab-content-panel');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons and panels
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanels.forEach(panel => panel.classList.remove('active'));

            // Add active class to the clicked button and corresponding panel
            button.classList.add('active');
            const targetPanelId = `${button.dataset.tab}-panel`;
            document.getElementById(targetPanelId).classList.add('active');
        });
    });
};

// --- 表示切り替え ---
const displayMyPage = (userData) => {
    registrationContainer.style.display = 'none';
    mypageContainer.style.display = 'block';
    document.getElementById('mypage-name').textContent = userData.name || 'ゲスト';
};

const displayRegistrationForm = (profile) => {
    registrationContainer.style.display = 'block';
    mypageContainer.style.display = 'none';
    document.getElementById('customer-name').value = '';
    
    const form = document.getElementById('registration-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const userData = {
            name: formData.get('name').trim(),
            kana: formData.get('kana').trim(),
            phone: formData.get('phone').trim(),
            lineUserId: profile.userId,
            lineDisplayName: profile.displayName,
            createdAt: serverTimestamp(),
        };
        if (!userData.name || !userData.kana) return alert('お名前とふりがなは必須です。');
        
        showLoading("顧客情報を登録中...");
        try {
            await setDoc(doc(db, "users", profile.userId), userData);
            displayMyPage(userData);
            fetchReservationHistory(profile.userId);
            fetchGallery(profile.userId);
            showContent();
        } catch (error) {
            showError("登録に失敗しました: " + error.message);
        }
    };
};

// --- データ取得 & 表示 ---
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
                        <textarea id="customer-note-${sale.id}">${sale.customerNote || ''}</textarea>
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

// --- アプリケーション実行 ---
document.addEventListener('DOMContentLoaded', main);

