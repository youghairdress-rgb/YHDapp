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

async function findOwners() {
    const projectId = 'yhd-db';
    console.log('--- REVERSE SEARCH FOR OWNERS START ---');

    const usersUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?pageSize=1000`;
    const allUsers = await fetchUrl(usersUrl);
    
    if (!allUsers.documents) {
        console.log('No users found.');
        return;
    }

    ghostIds.forEach(ghostId => {
        const owner = allUsers.documents.find(u => {
            const f = u.fields;
            if (f.prevIds && f.prevIds.arrayValue && f.prevIds.arrayValue.values) {
                return f.prevIds.arrayValue.values.some(v => v.stringValue === ghostId);
            }
            return false;
        });

        if (owner) {
            const f = owner.fields;
            console.log(`GHOST [${ghostId}] belongs to OWNER [${owner.name.split('/').pop()}]: ${f.name ? f.name.stringValue : 'N/A'}`);
        } else {
            // もし名前が undefined でも prevIds がない場合、他の手がかり
            console.log(`GHOST [${ghostId}]: No owner found via prevIds.`);
        }
    });

    // その他、売上データ内に名前の手がかりがないか再確認
    console.log('\n--- SALES DATA NAME CHECK ---');
    const salesUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sales?pageSize=1000`;
    const allSales = await fetchUrl(salesUrl);
    ghostIds.forEach(ghostId => {
        const matches = allSales.documents ? allSales.documents.filter(d => d.fields.customerId && d.fields.customerId.stringValue === ghostId) : [];
        matches.forEach(m => {
            const f = m.fields;
            if (f.customerName) {
                console.log(`GHOST [${ghostId}] has Sale with CustomerName: ${f.customerName.stringValue}`);
            }
        });
    });
}

findOwners();
