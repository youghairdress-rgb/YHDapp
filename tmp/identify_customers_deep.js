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

async function identificationScan() {
    const projectId = 'yhd-db';
    console.log('--- CUSTOMER IDENTIFICATION SCAN START ---');

    // 1. Get all sales to avoid multiple requests
    const salesUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales?pageSize=1000`;
    const allSales = await fetchUrl(salesUrl);
    
    for (const id of ghostIds) {
        console.log(`\nTARGET: ${id}`);
        const matches = allSales.documents ? allSales.documents.filter(d => d.fields.customerId && d.fields.customerId.stringValue === id) : [];
        
        if (matches.length > 0) {
            matches.forEach(m => {
                const f = m.fields;
                console.log(`  [Sale Doc]: ${m.name.split('/').pop()}`);
                console.log(`    Date: ${f.createdAt ? f.createdAt.timestampValue : 'N/A'}`);
                console.log(`    Total: ${f.total ? f.total.integerValue : 'N/A'}`);
                console.log(`    Menus: ${f.menus ? JSON.stringify(f.menus.arrayValue) : 'N/A'}`);
                console.log(`    StaffNote: ${f.staffNote ? f.staffNote.stringValue : 'None'}`);
                // 売上ドキュメント自体に名前が残っていないか？
                console.log(`    RawFields: ${Object.keys(f).join(', ')}`);
            });
        } else {
            console.log('  No sales match found.');
        }
    }
}

identificationScan();
