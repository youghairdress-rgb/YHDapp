const https = require('https');

// 救出すべき本来の紐付け（個別化のためのマッピング）
const revertTasks = [
    { ghostId: "ndulUjbHNbTiWha06anu", originalName: "加賀山千佳" },
    { ghostId: "0ThgoIE29UX7zO6fMXnz", originalName: "上床妃華" },
    { ghostId: "2IP4HXmxzHaw3Ptt04Nc", originalName: "田中尚子" },
    { ghostId: "6ZDt3OmH6J8JQ4AuGB1N", originalName: "山中美惠子" },
    { ghostId: "LHr2nkpthtQOKmj51YRi", originalName: "有島昭智" },
    { ghostId: "Qx49hQKyozfYkslaPjBx", originalName: "榎屋隆喜" },
    { ghostId: "jwE8Y98j9cmZNVykbhe6", originalName: "水脇涼" },
    { ghostId: "krZOtannIuI3WWqy1LNt", originalName: "岩切小夜里" },
    { ghostId: "qwB8Xe4hN2ZeG6PBS3Oi", originalName: "上床次男" },
    { ghostId: "dBJ3kbh1A6KbORlwpJTo", originalName: "ナナ母" },
    { ghostId: "eXDhNNDnJIjhviaCf5mx", originalName: "なな姉" }
];

async function request(url, method = 'GET', body = null) {
    return new Promise((resolve) => {
        const req = https.request(url, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({}); } });
        });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function verifyAndRevert() {
    const projectId = 'yhd-db';
    console.log('--- DEFINITIVE REVERT START ---');

    // 1. 全売上を取得
    const salesRes = await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales?pageSize=1000`);
    if (salesRes.documents) {
        for (const doc of salesRes.documents) {
            const f = doc.fields || {};
            const docId = doc.name.split('/').pop();
            const cName = f.customerName ? f.customerName.stringValue : '';
            
            // 各売上の名前をチェックし、タスクにある本来のIDに戻す
            for (const task of revertTasks) {
                // 名前が一致または包含されている場合（漢字の揺れ含む）
                if (cName.includes(task.originalName) || task.originalName.includes(cName)) {
                    console.log(`  Matching Sale: ${cName} [${docId}] -> Reverting to Ghost ID: ${task.ghostId}`);
                    await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales/${docId}?updateMask.fieldPaths=customerId`, 'PATCH', {
                        fields: { customerId: { stringValue: task.ghostId } }
                    });
                }
            }
        }
    }

    // 2. 正規顧客の prevIds の完全消去
    const usersRes = await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?pageSize=1000`);
    if (usersRes.documents) {
        for (const user of usersRes.documents) {
            const f = user.fields || {};
            const uid = user.name.split('/').pop();
            if (f.prevIds && f.prevIds.arrayValue && f.prevIds.arrayValue.values) {
                // 私が今回使ったゴーストIDが含まれているかチェック
                const currentIds = f.prevIds.arrayValue.values;
                const filtered = currentIds.filter(v => !revertTasks.some(t => t.ghostId === v.stringValue));
                if (currentIds.length !== filtered.length) {
                    console.log(`  Cleaning prevIds for Official User: ${uid}`);
                    await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=prevIds`, 'PATCH', {
                        fields: { prevIds: { arrayValue: { values: filtered } } }
                    });
                }
            }
        }
    }

    // 3. ゴーストデータの名前を undefined に戻す
    for (const task of revertTasks) {
        await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${task.ghostId}?updateMask.fieldPaths=name`, 'PATCH', {
            fields: { name: { stringValue: 'undefined' } }
        });
    }

    console.log('--- REVERT COMPLETED ---');
}

verifyAndRevert().catch(console.error);
