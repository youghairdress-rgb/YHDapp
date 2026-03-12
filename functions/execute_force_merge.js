
const axios = require('axios');

async function forceMerge() {
    const token = process.argv[2];
    const oldId = 'CHpoicGSlTyxZ0etbQNa';
    const newId = 'Ua25b500a472e8ab4df1cac450e72b8ef';
    
    const baseUrl = 'https://firestore.googleapis.com/v1/projects/yhd-db/databases/(default)/documents';
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    console.log(`Starting merge from ${oldId} to ${newId}`);

    // 1. Get visit history from old
    const vhUrl = `${baseUrl}/users/${oldId}/visitHistory`;
    try {
        const vhRes = await axios.get(vhUrl, { headers });
        if (vhRes.data && vhRes.data.documents) {
            for (const doc of vhRes.data.documents) {
                const subDocId = doc.name.split('/').pop();
                const targetUrl = `${baseUrl}/users/${newId}/visitHistory/${subDocId}`;
                await axios.patch(targetUrl, { fields: doc.fields }, { headers });
                console.log(`Migrated visitHistory: ${subDocId}`);
            }
        }
    } catch (e) {
        console.log('No visit history or error:', e.message);
    }

    // 2. Update reservations
    const queryResvUrl = `${baseUrl}:runQuery`;
    const resvQuery = {
        structuredQuery: {
            from: [{ collectionId: 'reservations' }],
            where: {
                fieldFilter: { field: { fieldPath: 'customerId' }, op: 'EQUAL', value: { stringValue: oldId } }
            }
        }
    };
    const resvRes = await axios.post(queryResvUrl, resvQuery, { headers });
    if (Array.isArray(resvRes.data)) {
        for (const r of resvRes.data) {
            if (r.document) {
                const docId = r.document.name.split('/').pop();
                const patchUrl = `${baseUrl}/reservations/${docId}?updateMask.fieldPaths=customerId&updateMask.fieldPaths=isLineUser`;
                await axios.patch(patchUrl, {
                    fields: { ...r.document.fields, customerId: { stringValue: newId }, isLineUser: { booleanValue: true } }
                }, { headers });
                console.log(`Updated reservation: ${docId}`);
            }
        }
    }

    // 3. Update Sales
    const salesQuery = {
        structuredQuery: {
            from: [{ collectionId: 'sales' }],
            where: {
                fieldFilter: { field: { fieldPath: 'customerId' }, op: 'EQUAL', value: { stringValue: oldId } }
            }
        }
    };
    const salesRes = await axios.post(queryResvUrl, salesQuery, { headers });
    if (Array.isArray(salesRes.data)) {
        for (const s of salesRes.data) {
            if (s.document) {
                const docId = s.document.name.split('/').pop();
                const patchUrl = `${baseUrl}/sales/${docId}?updateMask.fieldPaths=customerId`;
                await axios.patch(patchUrl, {
                    fields: { ...s.document.fields, customerId: { stringValue: newId } }
                }, { headers });
                console.log(`Updated sale: ${docId}`);
            }
        }
    }

    // 4. Update final visitCount to 3
    const finalUserUrl = `${baseUrl}/users/${newId}?updateMask.fieldPaths=visitCount`;
    await axios.patch(finalUserUrl, {
        fields: { visitCount: { integerValue: "3" } }
    }, { headers });
    console.log('Final visitCount updated to 3');

    // 5. Cleanup old doc
    const cleanupUrl = `${baseUrl}/users/${oldId}?updateMask.fieldPaths=name`;
    await axios.patch(cleanupUrl, {
        fields: { name: { stringValue: `[統合済み] 比恵島帆華` } }
    }, { headers });

    console.log('--- ALL TASKS COMPLETED ---');
}

forceMerge().catch(console.error);
