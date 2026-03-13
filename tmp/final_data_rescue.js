const https = require('https');

const ghostIds = [
  "0ThgoIE29UX7zO6fMXnz", "2IP4HXmxzHaw3Ptt04Nc", "6ZDt3OmH6J8JQ4AuGB1N",
  "LHr2nkpthtQOKmj51YRi", "Qx49hQKyozfYkslaPjBx", "dBJ3kbh1A6KbORlwpJTo",
  "eXDhNNDnJIjhviaCf5mx", "jwE8Y98j9cmZNVykbhe6", "krZOtannIuI3WWqy1LNt",
  "ndulUjbHNbTiWha06anu", "qwB8Xe4hN2ZeG6PBS3Oi"
];

async function fetchUrl(url) {
    return new Promise((resolve) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
            });
        }).on('error', () => resolve({}));
    });
}

async function finalDeepAudit() {
    const projectId = 'yhd-db';
    console.log('=== FINAL COMPREHENSIVE DATA RESCUE AUDIT ===');
    
    // サポートデータの読み込み
    const [allSales, allUsers] = await Promise.all([
        fetchUrl(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales?pageSize=1000`),
        fetchUrl(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?pageSize=1000`)
    ]);

    const auditResults = [];

    for (const ghostId of ghostIds) {
        const result = {
            ghostId: ghostId,
            foundData: {
                sales: [],
                visitHistory: [],
                userFields: {}
            },
            potentialOwners: []
        };

        // 1. 売上履歴の抽出
        if (allSales.documents) {
            result.foundData.sales = allSales.documents
                .filter(d => d.fields.customerId && d.fields.customerId.stringValue === ghostId)
                .map(d => {
                    const f = d.fields;
                    return {
                        saleId: d.name.split('/').pop(),
                        date: f.createdAt ? f.createdAt.timestampValue : 'N/A',
                        staffNote: f.staffNote ? f.staffNote.stringValue : 'None',
                        customerName: f.customerName ? f.customerName.stringValue : 'None',
                        total: f.total ? f.total.integerValue : 0
                    };
                });
        }

        // 2. 来店履歴（サブコレクション）の抽出
        const vhData = await fetchUrl(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${ghostId}/visitHistory`);
        if (vhData.documents) {
            result.foundData.visitHistory = vhData.documents.map(d => {
                const f = d.fields;
                return {
                    historyId: d.name.split('/').pop(),
                    title: f.title ? f.title.stringValue : 'N/A',
                    kartePrompt: f.kartePrompt ? f.kartePrompt.stringValue : 'N/A'
                };
            });
        }

        // 3. ユーザー情報の抽出
        const userDoc = allUsers.documents ? allUsers.documents.find(u => u.name.endsWith(ghostId)) : null;
        if (userDoc) {
            const f = userDoc.fields;
            result.foundData.userFields = {
                name: f.name ? f.name.stringValue : 'undefined',
                memo: f.memo ? f.memo.stringValue : 'None',
                notes: f.notes ? f.notes.stringValue : 'None',
                phone: f.phone ? f.phone.stringValue : 'None'
            };
        }

        // 4. 救出したデータから「本来の持ち主（お客様）」を推測・特定
        // 名前があればそれで検索、なければ前回の名寄せの形跡（prevIds）を探す
        const salesNames = result.foundData.sales.map(s => s.customerName).filter(n => n !== 'None');
        const searchName = salesNames.length > 0 ? salesNames[0] : null;

        if (allUsers.documents) {
            result.potentialOwners = allUsers.documents
                .filter(u => {
                    const f = u.fields;
                    const id = u.name.split('/').pop();
                    if (id === ghostId) return false; // 自分以外
                    
                    // 名前での一致
                    const nameMatch = searchName && f.name && f.name.stringValue.includes(searchName.substring(0, 2));
                    // prevIdsでの一致
                    const prevIdMatch = f.prevIds && f.prevIds.arrayValue && f.prevIds.arrayValue.values && 
                                        f.prevIds.arrayValue.values.some(v => v.stringValue === ghostId);
                    
                    return nameMatch || prevIdMatch;
                })
                .map(u => ({
                    id: u.name.split('/').pop(),
                    name: u.fields.name ? u.fields.name.stringValue : 'N/A'
                }));
        }

        auditResults.push(result);
    }

    console.log(JSON.stringify(auditResults, null, 2));
}

finalDeepAudit();
