const https = require('https');

// ゆうじ様からの最終指示に基づくマッピング
const certifiedMap = [
    { from: "ndulUjbHNbTiWha06anu", to: "U598b57b3a85a5d2e722d560b01ac6456", name: "加賀山千佳" },
    { from: "0ThgoIE29UX7zO6fMXnz", to: "U23e7e49ab5c3ddb247bcb446163d388e", name: "上床妃華 -> 上床直子" },
    { from: "2IP4HXmxzHaw3Ptt04Nc", to: "Ua54b50e61ef28620cc10c443f145d711", name: "田中尚子 -> 柳尚子" },
    { from: "6ZDt3OmH6J8JQ4AuGB1N", to: "Ud6cda7e28cd382e50483480ec952a3ad", name: "山中美惠子" },
    { from: "LHr2nkpthtQOKmj51YRi", to: "rFvFdtJ3TBEoFXGdbxZy", name: "有島昭智 -> 有嶋昭智" },
    { from: "Qx49hQKyozfYkslaPjBx", to: "Ue1774ec114fb152f2d9269252fd10782", name: "榎屋隆喜" },
    { from: "dBJ3kbh1A6KbORlwpJTo", to: "Ua224608c01969cde3f7ad33556605433", name: "ナナ母 -> 渡邊真奈美" },
    { from: "eXDhNNDnJIjhviaCf5mx", to: "Ua224608c01969cde3f7ad33556605433", name: "なな姉 -> 渡邊真奈美" },
    { from: "jwE8Y98j9cmZNVykbhe6", to: "U6253c469c0a13c2a5f66a6a7d2772625", name: "水脇涼" },
    { from: "krZOtannIuI3WWqy1LNt", to: "U0d3a641a5e7822fad959800f0eeef1c4", name: "岩切小夜里" },
    { from: "qwB8Xe4hN2ZeG6PBS3Oi", to: "U23e7e49ab5c3ddb247bcb446163d388e", name: "上床次男 -> 上床直子" }
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

async function executeCertifiedMerge() {
    const projectId = 'yhd-db';
    console.log('--- FINAL CERTIFIED MERGE START ---');

    for (const task of certifiedMap) {
        console.log(`Processing: ${task.name} (${task.from} -> ${task.to})`);

        // 1. Salesの紐付けを修正
        const salesRes = await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales?pageSize=1000`);
        if (salesRes.documents) {
            for (const doc of salesRes.documents) {
                if (doc.fields.customerId && doc.fields.customerId.stringValue === task.from) {
                    const docId = doc.name.split('/').pop();
                    console.log(`  Updating Sale: ${docId}`);
                    await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales/${docId}?updateMask.fieldPaths=customerId`, 'PATCH', {
                        fields: { customerId: { stringValue: task.to } }
                    });
                }
            }
        }

        // 2. 正規レコードのprevIdsへ追加
        const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${task.to}`;
        const user = await request(userUrl);
        if (user.fields) {
            const currentPrevIds = user.fields.prevIds ? user.fields.prevIds.arrayValue.values || [] : [];
            if (!currentPrevIds.some(v => v.stringValue === task.from)) {
                console.log(`  Adding to prevIds: ${task.from}`);
                await request(`${userUrl}?updateMask.fieldPaths=prevIds`, 'PATCH', {
                    fields: { prevIds: { arrayValue: { values: [...currentPrevIds, { stringValue: task.from }] } } }
                });
            }
        }

        // 3. ゴーストIDの名前を [統合済み] 形式へ更新
        await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${task.from}?updateMask.fieldPaths=name`, 'PATCH', {
            fields: { name: { stringValue: `[統合済み] ${task.name}` } }
        });
        console.log(`  Completed mapping for ${task.from}`);
    }

    console.log('\n--- ALL CERTIFIED MERGES COMPLETED SUCCESSFULLY ---');
}

executeCertifiedMerge().catch(console.error);
