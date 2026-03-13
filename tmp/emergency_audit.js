const https = require('https');

const ghostIds = [
  "0ThgoIE29UX7zO6fMXnz", "2IP4HXmxzHaw3Ptt04Nc", "6ZDt3OmH6J8JQ4AuGB1N",
  "LHr2nkpthtQOKmj51YRi", "Qx49hQKyozfYkslaPjBx", "dBJ3kbh1A6KbORlwpJTo",
  "eXDhNNDnJIjhviaCf5mx", "jwE8Y98j9cmZNVykbhe6", "krZOtannIuI3WWqy1LNt",
  "ndulUjbHNbTiWha06anu", "qwB8Xe4hN2ZeG6PBS3Oi"
];

async function fetchUrl(url, method = 'GET', body = null) {
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

async function fullAudit() {
    const projectId = 'yhd-db';
    console.log('=== EMERGENCY FULL AUDIT START ===');

    for (const id of ghostIds) {
        console.log(`\nTARGET ID: ${id}`);

        // 1. VisitHistory subcollection (Detailed scan)
        const vhUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${id}/visitHistory`;
        const vhData = await fetchUrl(vhUrl);
        const vhCount = vhData.documents ? vhData.documents.length : 0;
        console.log(`  [VisitHistory Subcollection]: ${vhCount} documents`);
        if (vhCount > 0) {
            vhData.documents.forEach(d => console.log(`    - Found: ${d.name.split('/').pop()}`));
        }

        // 2. Sales collection (Search by customerId)
        // Note: structuredQuery would be better, but checking with simple list + filter for accuracy
        const salesUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales?pageSize=1000`;
        const allSales = await fetchUrl(salesUrl);
        let matchingSales = [];
        if (allSales.documents) {
            matchingSales = allSales.documents.filter(d => {
                const f = d.fields || {};
                return f.customerId && f.customerId.stringValue === id;
            });
        }
        console.log(`  [Sales Root Collection]: ${matchingSales.length} documents`);
        matchingSales.forEach(s => {
            const f = s.fields || {};
            console.log(`    - ID: ${s.name.split('/').pop()}`);
            console.log(`      StaffNote: ${f.staffNote ? f.staffNote.stringValue : 'None'}`);
            console.log(`      StaffPublic: ${f.staffPublicMessage ? f.staffPublicMessage.stringValue : 'None'}`);
        });

        // 3. User basic fields (Full dump)
        const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${id}`;
        const userData = await fetchUrl(userUrl);
        const f = userData.fields || {};
        console.log(`  [User Fields Data]:`);
        console.log(`    Name: ${f.name ? f.name.stringValue : 'undefined'}`);
        console.log(`    Kana: ${f.kana ? f.kana.stringValue : 'undefined'}`);
        console.log(`    Memo: ${f.memo ? f.memo.stringValue : 'None'}`);
        console.log(`    Notes: ${f.notes ? f.notes.stringValue : 'None'}`);
        console.log(`    LineDisplayName: ${f.lineDisplayName ? f.lineDisplayName.stringValue : 'None'}`);
        console.log(`    PrevIds: ${f.prevIds ? JSON.stringify(f.prevIds.arrayValue) : 'None'}`);

        console.log('------------------');
    }
}

fullAudit();
