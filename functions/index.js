const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });
const { defineString } = require('firebase-functions/params');


// --- YHD-DX Integrated Controllers & Services ---
const { requestDiagnosisController } = require("./src/controllers/diagnosis");
const { generateHairstyleImageController, refineHairstyleImageController } = require("./src/controllers/imageGen");
const { analyzeTrendsController } = require("./src/controllers/trendAnalysis");
const { createFirebaseCustomTokenController } = require("./src/services/line");
const { adminApp, auth, storage, defaultBucketName } = require("./src/services/firebase");
const { params: configParams } = require("./src/config");

// Note: admin.initializeApp() is now handled within src/services/firebase.js to avoid duplicate initialization errors.

// 環境変数を config.js から取得
const LINE_CHANNEL_IDS = configParams.lineChannelIds;
const LINE_CHANNEL_ACCESS_TOKEN = configParams.lineChannelAccessToken;
const ADMIN_LINE_USER_IDS = configParams.adminLineUserIds;
const GEMINI_API_KEY = configParams.geminiApiKey;




// --- 1. createFirebaseCustomToken (Original) ---
exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method !== "POST") {
            return res.status(405).send("Method Not Allowed");
        }
        const channelIdsString = LINE_CHANNEL_IDS.value();
        if (!channelIdsString) {
            console.error("LINE_CHANNEL_IDS is not set.");
            return res.status(500).send("Server configuration error.");
        }
        const allowedChannelIds = channelIdsString.split(',').map(id => id.trim()).filter(id => id);
        const { accessToken } = req.body;
        if (!accessToken) return res.status(400).send("Access token is required");

        try {
            const verifyUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
            verifyUrl.searchParams.append("access_token", accessToken);
            const verifyResponse = await axios.get(verifyUrl.toString());
            const requestChannelId = verifyResponse.data.client_id;
            if (!allowedChannelIds.includes(requestChannelId)) {
                return res.status(401).send("Invalid LIFF app.");
            }
            const profileResponse = await axios.get("https://api.line.me/v2/profile", {
                headers: { "Authorization": `Bearer ${accessToken}` },
            });
            const lineUserId = profileResponse.data.userId;
            const adminIdsString = ADMIN_LINE_USER_IDS.value() || "";
            const adminIds = adminIdsString.split(',').map(id => id.trim());
            const isAdmin = adminIds.includes(lineUserId);
            const customClaims = {};
            if (isAdmin) customClaims.admin = true;
            const customToken = await admin.auth().createCustomToken(lineUserId, customClaims);
            return res.status(200).json({ customToken });
        } catch (error) {
            console.error("Error in createFirebaseCustomToken:", error.message);
            return res.status(500).send("Authentication failed.");
        }
    });
});

// --- 2. sendBookingConfirmation ---
exports.sendBookingConfirmation = functions.region("asia-northeast1").firestore
    .document("reservations/{reservationId}")
    .onCreate(async (snap) => {
        const booking = snap.data();
        if (booking.createdBy === 'admin') return null;
        if (!booking || !booking.customerName || !booking.startTime) return null;

        const { customerId, customerName, startTime, selectedMenus, userRequests } = booking;
        const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
        if (!channelAccessToken) return null;

        const time = startTime.toDate();
        const jstTime = new Date(time.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
        const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
        const dayOfWeek = weekdays[jstTime.getDay()];
        const formattedTime = `${jstTime.getFullYear()}年${String(jstTime.getMonth() + 1).padStart(2, "0")}月${String(jstTime.getDate()).padStart(2, "0")}日(${dayOfWeek}) ${String(jstTime.getHours()).padStart(2, "0")}:${String(jstTime.getMinutes()).padStart(2, "0")}`;
        const menuNames = selectedMenus ? selectedMenus.map((m) => m.name).join("＋") : "";
        const requestsText = userRequests || 'なし';

        if (customerId) {
            const customerMessageText = `${customerName}様\nご予約ありがとうございます。\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}`;
            try {
                await axios.post("https://api.line.me/v2/bot/message/push", {
                    to: customerId,
                    messages: [{ type: "text", text: customerMessageText }],
                }, {
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
                });
            } catch (error) { console.error("Error sending message to customer:", error.message); }
        }

        const adminIdsString = ADMIN_LINE_USER_IDS.value();
        if (adminIdsString) {
            const adminIds = adminIdsString.split(',').map(id => id.trim()).filter(id => id);
            if (adminIds.length > 0) {
                const adminMessageText = `新規予約：${customerName} 様\n日時：${formattedTime}\nメニュー：${menuNames}`;
                try {
                    await axios.post("https://api.line.me/v2/bot/message/multicast", {
                        to: adminIds,
                        messages: [{ type: "text", text: adminMessageText }],
                    }, {
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
                    });
                } catch (error) { console.error("Failed to send admin notification:", error.message); }
            }
        }
        return null;
    });

// --- 3. mergeUserData ---
exports.mergeUserData = functions.region("asia-northeast1").https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { oldUserId, newUserId, profile, newUserData } = data;
    if (context.auth.uid !== newUserId) throw new functions.https.HttpsError("permission-denied", "Permission denied.");

    const db = admin.firestore();
    const batch = db.batch();
    const oldUserRef = db.doc(`users/${oldUserId}`);
    const oldUserSnap = await oldUserRef.get();
    if (!oldUserSnap.exists) throw new functions.https.HttpsError("not-found", "Not found.");

    const oldUserData = oldUserSnap.data();
    const newUserRef = db.doc(`users/${newUserId}`);
    const mergedData = {
        ...oldUserData,
        ...newUserData,
        lineUserId: profile.userId,
        lineDisplayName: profile.displayName,
        isLineUser: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    batch.set(newUserRef, mergedData, { merge: true });

    // Cleanup old data
    batch.delete(oldUserRef);
    await batch.commit();
    return { success: true };
});

// --- 4. sendPushMessage ---
exports.sendPushMessage = functions.region("asia-northeast1").https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { customerId, text } = data;
    const db = admin.firestore();
    const userDoc = await db.doc(`users/${customerId}`).get();
    const lineUserId = userDoc.data()?.lineUserId;
    if (!lineUserId) throw new functions.https.HttpsError("failed-precondition", "No LINE ID.");

    const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
    await axios.post("https://api.line.me/v2/bot/message/push", {
        to: lineUserId,
        messages: [{ type: "text", text: text }],
    }, {
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
    });
    return { success: true };
});

// --- 5. analyzeHairstyle --- (未実装のため削除済み)

// --- 6. notifyAdminOnPhotoUpload ---
exports.notifyAdminOnPhotoUpload = functions.region("asia-northeast1").firestore
    .document("users/{userId}/gallery/{photoId}")
    .onCreate(async (snap, context) => {
        const newData = snap.data();

        // ユーザーの手動アップロード以外は通知しない（isUserUploadフラグがない場合は無視）
        if (!newData.isUserUpload) return null;

        // 管理者が同期した写真は通知しない(念のため既存ロジックも維持)
        if (newData.isSyncedPhoto) return null;

        const db = admin.firestore();
        const userDoc = await db.collection("users").doc(context.params.userId).get();
        const userName = userDoc.data()?.name || "お客様";
        const adminIds = (ADMIN_LINE_USER_IDS.value() || "").split(',').filter(id => id);
        const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();

        if (adminIds.length > 0 && channelAccessToken) {
            await axios.post("https://api.line.me/v2/bot/message/multicast", {
                to: adminIds,
                messages: [{ type: "text", text: `${userName}様から画像アップロードがありました` }],
            }, {
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
            });
        }
        return null;
    });

// --- YHD-DX Integrated Functions (Gen 1 for URL consistency) ---

exports.requestDiagnosis = functions.region("asia-northeast1")
    .runWith({ timeoutSeconds: 540, memory: "4GB" })
    .https.onRequest((req, res) => {
        cors(req, res, async () => {
            await requestDiagnosisController(req, res, { llmApiKey: GEMINI_API_KEY });
        });
    });

exports.generateHairstyleImage = functions.region("asia-northeast1").runWith({ timeoutSeconds: 300 }).https.onRequest((req, res) => {
    cors(req, res, async () => {
        await generateHairstyleImageController(req, res, {
            imageGenApiKey: GEMINI_API_KEY,
            storage: storage,
            defaultBucketName: defaultBucketName,
        });
    });
});

exports.refineHairstyleImage = functions.region("asia-northeast1").runWith({ timeoutSeconds: 300 }).https.onRequest((req, res) => {
    cors(req, res, async () => {
        await refineHairstyleImageController(req, res, {
            imageGenApiKey: GEMINI_API_KEY,
            storage: storage,
            defaultBucketName: defaultBucketName,
        });
    });
});

exports.createFirebaseCustomTokenV2 = functions.region("asia-northeast1").https.onRequest((req, res) => {
    cors(req, res, async () => {
        await createFirebaseCustomTokenController(req, res, { auth: auth });
    });
});

exports.analyzeTrends = functions.region("asia-northeast1").runWith({ timeoutSeconds: 300 }).https.onRequest((req, res) => {
    cors(req, res, async () => {
        await analyzeTrendsController(req, res, { imageGenApiKey: GEMINI_API_KEY });
    });
});


