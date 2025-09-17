import { runAdminPage } from './admin-auth.js';

const adminMain = (auth, user) => {
    // ★変更点: 正しいIDを参照するように修正
    const displayNameEl = document.getElementById('user-displayName');
    const pictureUrlEl = document.getElementById('user-pictureUrl');

    if (displayNameEl) {
        displayNameEl.textContent = `ようこそ、${user.displayName || 'ゲスト'} さん`;
    }
    if (pictureUrlEl && user.photoURL) {
        pictureUrlEl.src = user.photoURL;
    }
};

runAdminPage(adminMain);

