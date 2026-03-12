
const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'yhd-db'
    });
}

const db = admin.firestore();

async function inspectHiejima() {
    console.log('--- Inspecting Hiejima Data ---');

    // 1. 名前で検索
    const usersSnap = await db.collection('users').where('name', '>=', '比恵島').where('name', '<=', '比恵島\uf8ff').get();
    console.log(`Found ${usersSnap.size} users:`);
    usersSnap.forEach(doc => {
        console.log(`ID: ${doc.id}, Data:`, JSON.stringify(doc.data(), null, 2));
    });

    // 2. 本日の予約を確認
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const resvSnap = await db.collection('reservations')
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(today))
        .where('startTime', '<', admin.firestore.Timestamp.fromDate(tomorrow))
        .get();

    console.log(`\nFound ${resvSnap.size} reservations today:`);
    resvSnap.forEach(doc => {
        const data = doc.data();
        if (data.customerName && data.customerName.includes('比恵島')) {
            console.log(`Resv ID: ${doc.id}, customerId: ${data.customerId}, Name: ${data.customerName}, isLineUser: ${data.isLineUser}`);
        }
    });

    // 3. 来店履歴の合計数を確認
    for (const userDoc of usersSnap.docs) {
        const histSnap = await userDoc.ref.collection('visitHistory').get();
        console.log(`\nUser ${userDoc.id} has ${histSnap.size} visit history records.`);
    }
}

inspectHiejima().catch(console.error);
