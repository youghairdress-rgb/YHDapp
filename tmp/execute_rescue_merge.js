const https = require('https');

// 最終マッピング定義
const mergeMap = [
    { from: "ndulUjbHNbTiWha06anu", to: "U598b57b3a85a5d2e722d560b01ac6456", name: "加賀山千佳" },
    { from: "0ThgoIE29UX7zO6fMXnz", to: "U598b57b3a85a5d2e722d560b01ac6456", name: "加賀山千佳 (追加)" },
    { from: "2IP4HXmxzHaw3Ptt04Nc", to: "Na0kd4SgYESa3rSTHXlG", name: "田中尚子 -> 田中里美(家計統合)" },
    { from: "6ZDt3OmH6J8JQ4AuGB1N", to: "Ud6cda7e28cd382e50483480ec952a3ad", name: "山中美恵子" },
    { from: "LHr2nkpthtQOKmj51YRi", to: "rFvFdtJ3TBEoFXGdbxZy", name: "有島昭智" },
    { from: "Qx49hQKyozfYkslaPjBx", to: "Ue1774ec114fb152f2d9269252fd10782", name: "榎屋" },
    { from: "jwE8Y98j9cmZNVykbhe6", to: "U6253c469c0a13c2a5f66a6a7d2772625", name: "水脇涼" },
    { from: "krZOtannIuI3WWqy1LNt", to: "U0d3a641a5e7822fad959800f0eeef1c4", name: "岩切小夜里" },
    { from: "qwB8Xe4hN2ZeG6PBS3Oi", to: "U23e7e49ab5c3ddb247bcb446163d388e", name: "上床次男 -> 上床直子(家計統合)" }
    // 残りの ID はニックネーム（なな姉等）のため本案にて保留または検討
];

async function request(url, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ error: 'Parse error', raw: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function executeRescue() {
    const projectId = 'yhd-db';
    console.log('--- RESCUE MERGE START ---');

    for (const task of mergeMap) {
        console.log(`\nProcessing: ${task.name} (${task.from} -> ${task.to})`);

        // 1. Update Sales Document
        const salesUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales?pageSize=1000`;
        const allSales = await request(salesUrl);
        if (allSales.documents) {
            for (const doc of allSales.documents) {
                const f = doc.fields || {};
                if (f.customerId && f.customerId.stringValue === task.from) {
                    const docId = doc.name.split('/').pop();
                    console.log(`  Updating Sale ID: ${docId}`);
                    // REST patch: only update customerId
                    const patchUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales/${docId}?updateMask.fieldPaths=customerId`;
                    const res = await request(patchUrl, 'PATCH', {
                        fields: { customerId: { stringValue: task.to } }
                    });
                    if (res.error) console.error(`    Error updating sale: ${res.error}`);
                    else console.log(`    Success.`);
                }
            }
        }

        // 2. Add to prevIds of Target User
        const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${task.to}`;
        const userData = await request(userUrl);
        if (userData.fields) {
            const currentPrevIds = userData.fields.prevIds ? userData.fields.prevIds.arrayValue.values || [] : [];
            const idsSet = new Set(currentPrevIds.map(v => v.stringValue));
            if (!idsSet.has(task.from)) {
                console.log(`  Adding ${task.from} to prevIds of ${task.to}`);
                const updatedPrevIds = [...currentPrevIds, { stringValue: task.from }];
                const patchUserUrl = `${userUrl}?updateMask.fieldPaths=prevIds`;
                await request(patchUserUrl, 'PATCH', {
                    fields: { prevIds: { arrayValue: { values: updatedPrevIds } } }
                });
            }
        }

        // 3. Mark Ghost as Merged
        const ghostUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${task.from}?updateMask.fieldPaths=name`;
        await request(ghostUrl, 'PATCH', {
            fields: { name: { stringValue: `[統合・救出済み] ${task.name}` } }
        });
        console.log(`  Ghost ID marked as merged.`);
    }

    console.log('\n--- ALL RESCUE OPERATIONS COMPLETED ---');
}

executeRescue().catch(console.error);
