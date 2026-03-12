
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'yhd-db'
    });
}

const db = admin.firestore();

async function testMerge() {
    const oldId = 'test-old-user-' + Date.now();
    const newId = 'test-new-user-line-' + Date.now();

    console.log(`Testing merge: ${oldId} -> ${newId}`);

    // 1. テストデータの作成
    await db.doc(`users/${oldId}`).set({
        name: 'テスト太郎',
        kana: 'てすとたろう',
        phone: '09012345678',
        isLineUser: false
    });

    await db.doc(`users/${oldId}/visitHistory/hist1`).set({
        date: '2025-01-01',
        menu: 'カット'
    });

    await db.collection('reservations').add({
        customerId: oldId,
        customerName: 'テスト太郎',
        startTime: admin.firestore.Timestamp.now()
    });

    console.log('Test data created.');

    // 2. 本来は Functions を呼ぶが、ここではロジックを模倣して確認、
    // または firebase-functions-test を使うべきだが、
    // 今回は Functions をデプロイして本番で確認する前に
    // エミュレータの Functions に修正が反映されているか、
    // 手動で entry.js フローを（ブラウザで）試すのが確実。

    console.log('Please run the verification on the browser or deploy to functions emulator.');
}

// testMerge();
