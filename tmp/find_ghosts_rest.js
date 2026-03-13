const https = require('https');

const ghostIds = [
  "0ThgoIE29UX7zO6fMXnz", "2IP4HXmxzHaw3Ptt04Nc", "6ZDt3OmH6J8JQ4AuGB1N",
  "LHr2nkpthtQOKmj51YRi", "Qx49hQKyozfYkslaPjBx", "dBJ3kbh1A6KbORlwpJTo",
  "eXDhNNDnJIjhviaCf5mx", "jwE8Y98j9cmZNVykbhe6", "krZOtannIuI3WWqy1LNt",
  "ndulUjbHNbTiWha06anu", "qwB8Xe4hN2ZeG6PBS3Oi"
];

async function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ error: 'Parse error', raw: data });
                }
            });
        }).on('error', reject);
    });
}

async function deepScan() {
    const projectId = 'yhd-db';
    console.log('--- DEEP SCAN START ---');

    for (const id of ghostIds) {
        // 1. Check visitHistory subcollection
        const vhUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${id}/visitHistory`;
        const vhData = await fetchUrl(vhUrl);
        const hasHistory = !!(vhData.documents && vhData.documents.length > 0);

        // 2. Check sales collection (root)
        // Note: Filtering by customerId requires a POST with structuredQuery, but we check if ID is used elsewhere.
        // For simplicity in this script, we'll look for gallery or other identifiable info if possible.
        
        // 3. User basic fields
        const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${id}`;
        const userData = await fetchUrl(userUrl);
        const lineDisplayName = userData.fields && userData.fields.lineDisplayName ? userData.fields.lineDisplayName.stringValue : 'N/A';
        const notes = userData.fields && userData.fields.notes ? userData.fields.notes.stringValue : 'N/A';

        console.log(`ID: ${id}`);
        console.log(`  Name: ${userData.fields && userData.fields.name ? userData.fields.name.stringValue : 'undefined'}`);
        console.log(`  Line: ${lineDisplayName}`);
        console.log(`  Notes: ${notes}`);
        console.log(`  Has VisitHistory: ${hasHistory}`);
        console.log('------------------');
    }
}

deepScan();
