const https = require('https');

// 私が勝手に行ったマッピング（これを逆転させる）
const reversalMap = [
    { ghostId: "ndulUjbHNbTiWha06anu", targetId: "U598b57b3a85a5d2e722d560b01ac6456", label: "加賀山千佳" },
    { ghostId: "0ThgoIE29UX7zO6fMXnz", targetId: "U598b57b3a85a5d2e722d560b01ac6456", label: "加賀山千佳 (追加)" },
    { ghostId: "2IP4HXmxzHaw3Ptt04Nc", targetId: "Na0kd4SgYESa3rSTHXlG", label: "田中尚子 -> 田中里美" },
    { ghostId: "6ZDt3OmH6J8JQ4AuGB1N", targetId: "Ud6cda7e28cd382e50483480ec952a3ad", label: "山中美恵子" },
    { ghostId: "LHr2nkpthtQOKmj51YRi", targetId: "rFvFdtJ3TBEoFXGdbxZy", label: "有島昭智" },
    { ghostId: "Qx49hQKyozfYkslaPjBx", targetId: "Ue1774ec114fb152f2d9269252fd10782", label: "榎屋" },
    { ghostId: "jwE8Y98j9cmZNVykbhe6", targetId: "U6253c469c0a13c2a5f66a6a7d2772625", label: "水脇涼" },
    { ghostId: "krZOtannIuI3WWqy1LNt", targetId: "U0d3a641a5e7822fad959800f0eeef1c4", label: "岩切小夜里" },
    { ghostId: "qwB8Xe4hN2ZeG6PBS3Oi", targetId: "U23e7e49ab5c3ddb247bcb446163d388e", label: "上床次男 -> 上床直子" },
    { ghostId: "dBJ3kbh1A6KbORlwpJTo", targetId: "aZHzmcxBg3OXzGFUZolh", label: "ナナ母 -> 野崎七海" },
    { ghostId: "eXDhNNDnJIjhviaCf5mx", targetId: "aZHzmcxBg3OXzGFUZolh", label: "なな姉 -> 野崎七海" }
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
                try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function executeRevert() {
    const projectId = 'yhd-db';
    console.log('=== EMERGENCY REVERT START ===');

    // 1. 売上履歴 (sales) の差し戻し
    const salesUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales?pageSize=1000`;
    const allSales = await request(salesUrl);
    
    if (allSales.documents) {
        for (const saleDoc of allSales.documents) {
            const f = saleDoc.fields;
            const currentCustomerId = f.customerId ? f.customerId.stringValue : null;
            const docId = saleDoc.name.split('/').pop();

            // この売上が、差し戻し対象のターゲットIDに紐付いているか確認
            for (const map of reversalMap) {
                if (currentCustomerId === map.targetId) {
                    // 売上データ内のcustomerNameやstaffNoteを見て、本来のゴーストIDに戻すべきか判定
                    // (安易な判定は避け、私が統合時に使った「元ID」を特定する必要がある)
                    // しかし、統合時に元IDをメタデータに残していなかったため、
                    // 統合ログ(`tmp/execute_rescue_merge.js`等)で、どのSaleを動かしたか再確認が必要。
                    
                    // 今回は、対象のGhostIDに関連する名前の売上を「元に戻す」
                    const cName = f.customerName ? f.customerName.stringValue : '';
                    if ( (map.label.includes('加賀山') && cName.includes('加賀山')) ||
                         (map.label.includes('田中尚子') && (cName.includes('田中尚子') || cName.includes('田中尚'))) ||
                         (map.label.includes('上床次男') && cName.includes('上床次男')) ||
                         (map.label.includes('水脇') && cName.includes('水脇')) ||
                         (map.label.includes('山中') && cName.includes('山中')) ||
                         (map.label.includes('有島') && cName.includes('有島')) ||
                         (map.label.includes('榎屋') && cName.includes('榎屋')) ||
                         (map.label.includes('岩切') && cName.includes('岩切')) ||
                         (map.label.includes('ナナ母') && cName.includes('ナナ母')) ||
                         (map.label.includes('なな姉') && cName.includes('なな姉'))
                    ) {
                        console.log(`  Reverting Sale [${docId}] (${cName}) back to CustomerID: ${map.ghostId}`);
                        const patchUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales/${docId}?updateMask.fieldPaths=customerId`;
                        await request(patchUrl, 'PATCH', {
                            fields: { customerId: { stringValue: map.ghostId } }
                        });
                    }
                }
            }
        }
    }

    // 2. 正規顧客の prevIds の差し戻し
    const targetIds = [...new Set(reversalMap.map(m => m.targetId))];
    for (const targetId of targetIds) {
        const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${targetId}`;
        const userData = await request(userUrl);
        if (userData.fields && userData.fields.prevIds) {
            const currentValues = userData.fields.prevIds.arrayValue.values || [];
            const filteredValues = currentValues.filter(v => !reversalMap.some(m => m.ghostId === v.stringValue));
            
            if (currentValues.length !== filteredValues.length) {
                console.log(`  Clearing prevIds on User: ${targetId}`);
                const patchUserUrl = `${userUrl}?updateMask.fieldPaths=prevIds`;
                await request(patchUserUrl, 'PATCH', {
                    fields: { prevIds: { arrayValue: { values: filteredValues } } }
                });
            }
        }
    }

    // 3. ゴーストIDの名前を「undefined」に戻す
    for (const map of reversalMap) {
        const ghostUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${map.ghostId}?updateMask.fieldPaths=name`;
        await request(ghostUrl, 'PATCH', {
            fields: { name: { stringValue: `undefined` } }
        });
    }

    console.log('=== EMERGENCY REVERT COMPLETED ===');
}

executeRevert().catch(console.error);
