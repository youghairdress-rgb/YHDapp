import { db, initializeLiffAndAuth } from './admin/firebase-init.js';
import { doc, getDoc, setDoc, collection, query, where, getDocs, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";


// --- DOM Helper Functions ---
const showLoading = (text) => {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-container').style.display = 'flex';
    document.getElementById('content-container').style.display = 'none';
    // ★★★ 追加: 背景スクロールを無効化 ★★★
    document.body.classList.add('user-modal-open');
};
const showContent = () => {
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('content-container').style.display = 'block';
    // ★★★ 追加: 背景スクロールを有効化 ★★★
    document.body.classList.remove('user-modal-open');
};
const showError = (text) => {
    document.getElementById('error-message').textContent = text;
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('error-container').style.display = 'block';
    // ★★★ 追加: 背景スクロールを有効化 ★★★
    document.body.classList.remove('user-modal-open');
};

// --- Main Application Logic ---
const main = async () => {
    try {
        showLoading("LIFFを初期化中...");
        const { user, profile } = await initializeLiffAndAuth("2008029428-bjdA0Ddp");

        showLoading("顧客情報を確認中...");
        const userDocRef = doc(db, "users", profile.userId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            // 登録済みの場合はマイページへリダイレクト
            window.location.href = './mypage.html';
        } else {
            // 未登録の場合は登録フォームを表示
            setupRegistrationForm(profile);
            showContent();
        }

    } catch (error) {
        console.error("メイン処理でエラー:", error);
        showError(error.message);
    }
};

const setupRegistrationForm = (profile) => {
    const form = document.getElementById('registration-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        showLoading("顧客情報を登録中...");
        
        const formData = new FormData(form);
        const name = formData.get('name').trim();
        const kana = formData.get('kana').trim();
        const phone = formData.get('phone').trim();

        if (!name || !kana) {
            alert('お名前とふりがなは必須です。');
            showContent();
            return;
        }

        try {
            const existingUserQuery = query(
                collection(db, "users"),
                where("kana", "==", kana),
                where("phone", "==", phone),
                where("isLineUser", "==", false)
            );

            const querySnapshot = await getDocs(existingUserQuery);
            
            if (!querySnapshot.empty) {
                const existingUserDoc = querySnapshot.docs[0];
                const oldUserId = existingUserDoc.id;

                const mergeUserData = httpsCallable(functions, 'mergeUserData');
                await mergeUserData({ oldUserId: oldUserId, newUserId: profile.userId, profile: profile });
                
                alert("既存の顧客情報とLINEアカウントを統合しました。");

            } else {
                const newUserDocRef = doc(db, "users", profile.userId);
                await setDoc(newUserDocRef, {
                    name: name,
                    kana: kana,
                    phone: phone,
                    lineUserId: profile.userId,
                    lineDisplayName: profile.displayName,
                    isLineUser: true,
                    createdAt: serverTimestamp(),
                });
            }

            window.location.href = './mypage.html';

        } catch (error) {
            console.error("登録または統合処理に失敗しました:", error);
            showError(`登録に失敗しました: ${error.message}`);
        }
    };
};

document.addEventListener('DOMContentLoaded', main);
