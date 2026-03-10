
const admin = require('firebase-admin');

// 本物のFirebase環境にアクセスするために、firebase-adminを正しく初期化
// GCP環境（サービスアカウント）が利用できない場合はエラーになるが、
// functionsディレクトリ内で実行されるなら、何らかの認証情報が使える可能性がある。
try {
    admin.initializeApp();
} catch (e) {
    // すでに初期化されている場合
}

const db = admin.firestore();

async function run() {
    const lineId = "U61beab92daeba6ed31cd545e3ce54bab";
    const bookingId = "V2aAc73ANWtlaOT3VOAD";

    const targets = [
        { col: 'users', id: lineId },
        { col: 'users', id: bookingId },
        { col: 'reservations', id: bookingId }
    ];

    for (const t of targets) {
        const doc = await db.collection(t.col).doc(t.id).get();
        if (doc.exists) {
            console.log(`[FOUND] ${t.col}/${t.id}:`, JSON.stringify(doc.data(), null, 2));
        } else {
            console.log(`[NOT FOUND] ${t.col}/${t.id}`);
        }
    }

    // 予約コレクションをIDで全件舐める（もしIDが前方一致や一部不一致なら）
    const resvs = await db.collection('reservations').where('customerId', '==', bookingId).get();
    console.log(`Reservations found for customerId ${bookingId}: ${resvs.size}`);
}

run().catch(console.error);
