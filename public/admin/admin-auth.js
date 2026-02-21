import { initializeLiffAndAuth } from './firebase-init.js';

// --- DOM操作ヘルパー関数 (エクスポート) ---
export const showLoading = (text) => {
  const container = document.getElementById('loading-container');
  if (container) {
    const p = container.querySelector('p');
    if (p) p.textContent = text;
    container.style.display = 'flex';
  }
  const content = document.getElementById('content-container');
  if (content) content.style.display = 'none';
  const errorContainer = document.getElementById('error-container');
  if (errorContainer) errorContainer.style.display = 'none';
};

export const showContent = () => {
  const container = document.getElementById('loading-container');
  if (container) container.style.display = 'none';
  const content = document.getElementById('content-container');
  if (content) content.style.display = 'block';
};

export const showError = (text) => {
  console.error('エラーが発生しました:', text);
  const errorContainer = document.getElementById('error-container');
  if (errorContainer) {
    const p = errorContainer.querySelector('p');
    if (p) p.textContent = text;
    errorContainer.style.display = 'block';

    const retryButton = document.getElementById('retry-button');
    if (retryButton) {
      retryButton.addEventListener('click', () => window.location.reload());
    }
  }
  const container = document.getElementById('loading-container');
  if (container) container.style.display = 'none';
  const content = document.getElementById('content-container');
  if (content) content.style.display = 'none';
};

// --- ページ実行のメイン関数 ---
const ADMIN_DEFAULT_LIFF_ID = '2008029428-Go8VM98w';

export const runAdminPage = (mainFunction, pageLiffId = null) => {
  const start = async () => {
    try {
      const liffId = pageLiffId || ADMIN_DEFAULT_LIFF_ID;
      
      // --- 超・強制スキップモード (localhost時は認証・権限チェックを一切無視) ---
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.log('認証バイパスモード起動');
        const { user } = await initializeLiffAndAuth(liffId);
        showLoading('ページを構成中...');
        await mainFunction(user);
        showContent();
        return;
      }

      showLoading('LIFFを初期化中...');
      const { user } = await initializeLiffAndAuth(liffId);
      
      showLoading('管理者権限を確認中...');
      if (!user) {
        throw new Error('ユーザー情報の取得に失敗しました。');
      }

      // --- Firebaseトークン（管理者権限）の確認 ---
      let idTokenResult = await user.getIdTokenResult();
      if (!idTokenResult.claims.admin) {
        console.log('Admin claim missing in cached token, forcing refresh...');
        idTokenResult = await user.getIdTokenResult(true);
      }

      if (!idTokenResult.claims.admin) {
        throw new Error('管理者権限がありません。');
      }
      console.log('管理者権限を確認しました。');

      showLoading('ページを読み込み中...');
      await mainFunction(user);
      showContent();
    } catch (error) {
      showError(error.message);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
};
