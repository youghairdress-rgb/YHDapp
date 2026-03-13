import { db, initializeLiffAndAuth, functions, isLocalhost } from './admin/firebase-init.js';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

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
    showLoading('LIFFを初期化中...');
    const { user, profile } = await initializeLiffAndAuth('2008029428-bjdA0Ddp');

    showLoading('顧客情報を確認中...');
    const userDocRef = doc(db, 'users', profile.userId);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      // 登録済みの場合はマイページへリダイレクト
      window.location.href = '/mypage.html';
    } else {
      // 未登録の場合は登録フォームを表示
      setupRegistrationForm(profile);
      showContent();
    }
  } catch (error) {
    console.error('メイン処理でエラー:', error);
    showError(error.message);
  }
};

const setupRegistrationForm = (profile) => {
  const form = document.getElementById('registration-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    showLoading('顧客情報を登録中...');

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
      // ▼▼▼ 修正: 既存顧客の検索ロジックを強化（スペース除去などの正規化 ＆ 欠落フィールド対応） ▼▼▼
      let existingUserDoc = null;

      // 検索用文字列のサニタイズ（スペース除去 ＆ ひらがな・カタカナ統一：DBに合わせて「ひらがな」に統一）
      const kataToHira = (str) => {
        return str.replace(/[\u30a1-\u30f6]/g, (match) => {
          const chr = match.charCodeAt(0) - 0x60;
          return String.fromCharCode(chr);
        });
      };

      const sanitize = (str) => kataToHira(str.replace(/[\s\u3000]/g, ''));
      const sName = sanitize(name); // 名前も一応正規化
      const sKana = sanitize(kana); // かなを「ひらがな」に統一
      const sPhone = phone ? phone.replace(/[^\d]/g, '') : ''; // 数字のみ抽出

      // 1. 電話番号が入力されている場合、電話番号で検索
      if (sPhone) {
        const phoneQuery = query(
          collection(db, 'users'),
          where('phone', '==', sPhone)
        );
        const phoneSnapshot = await getDocs(phoneQuery);
        // LINE連携されていない全てのユーザーを取得して、お名前（かな）が一致するか確認
        // 電話番号が一致し、かつ入力された「かな」が含まれている、あるいは一致する場合に同一人物とみなす
        existingUserDoc = phoneSnapshot.docs.find(doc => {
          const d = doc.data();
          if (d.isLineUser === true) return false;
          const targetKana = sanitize(d.kana || ''); // DB側のかなも「ひらがな」に正規化して比較
          // 電話番号が一致しているため、名前（かな）は部分一致または空文字でないことを確認
          return targetKana && (sKana.includes(targetKana) || targetKana.includes(sKana));
        });
      }

      // 2. 電話番号で見つからない場合、カナのみで検索（より慎重な一致）
      if (!existingUserDoc) {
        const allUsersSnapshot = await getDocs(collection(db, 'users'));
        existingUserDoc = allUsersSnapshot.docs.find(doc => {
          const d = doc.data();
          if (d.isLineUser === true) return false;
          return sanitize(d.kana || '') === sKana; // 両方を「ひらがな」に変換して完全一致チェック
        });
      }
      // ▲▲▲ 修正ここまで ▲▲▲

      if (existingUserDoc) {
        const oldUserId = existingUserDoc.id;
        const oldData = existingUserDoc.data();

        // 顧客に統合を確認する
        if (!confirm(`以前のご来店履歴（${oldData.name}様）が見つかりました。LINEと連携してよろしいですか？`)) {
          showContent();
          return;
        }

        const mergeUserData = httpsCallable(functions, 'mergeUserData');
        await mergeUserData({
          oldUserId: oldUserId,
          newUserId: profile.userId,
          profile: profile,
          newUserData: {
            // フォームから入力された最新情報
            name: name,
            kana: kana,
            phone: phone,
          },
        });

        alert('既存の顧客情報とLINEアカウントを統合しました。');
      } else {
        const newUserDocRef = doc(db, 'users', profile.userId);
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

      window.location.href = '/mypage.html';
    } catch (error) {
      console.error('登録または統合処理に失敗しました:', error);
      showError(`登録に失敗しました: ${error.message}`);
    }
  };
};

document.addEventListener('DOMContentLoaded', main);
