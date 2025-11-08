const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });
// ★改善点: 推奨されるパラメータ化された環境変数を使用
const { defineString } = require('firebase-functions/params');

admin.initializeApp();

// 環境変数を定義
// ★ 修正: 複数のチャンネルIDをカンマ区切りで受け取るように想定
const LINE_CHANNEL_IDS = defineString('LINE_CHANNEL_IDS'); // 変数名を変更 (LINE_CHANNEL_ID -> LINE_CHANNEL_IDS)
const LINE_CHANNEL_ACCESS_TOKEN = defineString('LINE_CHANNEL_ACCESS_TOKEN');
const ADMIN_LINE_USER_IDS = defineString('ADMIN_LINE_USER_IDS');


exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method !== "POST") {
            return res.status(405).send("Method Not Allowed");
        }

        // ★ 修正: カンマ区切りの文字列を配列に変換
        const channelIdsString = LINE_CHANNEL_IDS.value();
        if (!channelIdsString) {
            console.error("LINE_CHANNEL_IDS is not set in environment variables.");
            return res.status(500).send("Server configuration error: LINE Channel IDs are not set.");
        }
        const allowedChannelIds = channelIdsString.split(',').map(id => id.trim()).filter(id => id);
        if (allowedChannelIds.length === 0) {
             console.error("LINE_CHANNEL_IDS is empty or invalid.");
             return res.status(500).send("Server configuration error: LINE Channel IDs are invalid.");
        }
        // ★ 修正ここまで

        const { accessToken } = req.body;
        if (!accessToken) {
            return res.status(400).send("Access token is required");
        }

        try {
            // LINEアクセストークンを検証
            const verifyUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
            verifyUrl.searchParams.append("access_token", accessToken);

            const verifyResponse = await axios.get(verifyUrl.toString());

            // ★ 修正: 厳格な一致 (===) から、配列に含まれるか (includes) に変更
            const requestChannelId = verifyResponse.data.client_id;
            if (!allowedChannelIds.includes(requestChannelId)) {
                console.error(`Channel ID mismatch. Expected one of [${allowedChannelIds.join(', ')}] but got ${requestChannelId}`);
                return res.status(401).send("Invalid LIFF app or Channel ID mismatch.");
            }
            // ★ 修正ここまで

            const profileResponse = await axios.get("https://api.line.me/v2/profile", {
                headers: { "Authorization": `Bearer ${accessToken}` },
            });

            const lineUserId = profileResponse.data.userId;
            if (!lineUserId) {
                return res.status(400).send("LINE User ID could not be retrieved from profile.");
            }

            // ★改善点: 管理者かどうかを判定し、カスタムクレームを設定
            const adminIdsString = ADMIN_LINE_USER_IDS.value() || "";
            const adminIds = adminIdsString.split(',').map(id => id.trim());
            const isAdmin = adminIds.includes(lineUserId);

            const customClaims = {};
            if (isAdmin) {
                customClaims.admin = true;
            }

            // カスタムクレームを付与してFirebaseのカスタムトークンを作成
            const customToken = await admin.auth().createCustomToken(lineUserId, customClaims);

            return res.status(200).json({ customToken });

        } catch (error) {
            console.error("Error in createFirebaseCustomToken:", error.message);
            if (error.response) {
                console.error("Error Response:", JSON.stringify(error.response.data));
                return res.status(error.response.status).send(error.response.data);
            }
            return res.status(500).send("Authentication failed due to an internal server error.");
        }
    });
});

exports.sendBookingConfirmation = functions.region("asia-northeast1").firestore
    .document("reservations/{reservationId}")
    .onCreate(async (snap) => {
        const booking = snap.data();

        // ★★★ 修正点: 管理者によって作成された予約の場合は通知を送信しない ★★★
        if (booking.createdBy === 'admin') {
            console.log(`Reservation created by admin. Skipping notification for reservationId: ${snap.id}`);
            return null;
        }

        // 予約データが不完全な場合は処理を中断
        if (!booking || !booking.customerName || !booking.startTime || !Array.isArray(booking.selectedMenus)) {
            console.log("Booking data is incomplete. Skipping notifications.", {
                reservationId: snap.id
            });
            return null;
        }

        const { customerId, customerName, startTime, selectedMenus, userRequests } = booking;

        const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
        if (!channelAccessToken) {
            console.error("LINE_CHANNEL_ACCESS_TOKEN is not configured. Cannot send messages.");
            return null;
        }

        const time = startTime.toDate();
        // JSTに変換
        const jstTime = new Date(time.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
        const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
        const dayOfWeek = weekdays[jstTime.getDay()];
        const formattedTime = `${jstTime.getFullYear()}年${String(jstTime.getMonth() + 1).padStart(2, "0")}月${String(jstTime.getDate()).padStart(2, "0")}日(${dayOfWeek}) ${String(jstTime.getHours()).padStart(2, "0")}:${String(jstTime.getMinutes()).padStart(2, "0")}`;
        const menuNames = selectedMenus.map((m) => m.name).join("＋");
        const requestsText = userRequests || 'なし';

        // お客様への確認メッセージ
        if (customerId) {
            const customerMessageText = `${customerName}様\nご予約ありがとうございます。\n以下の内容でご予約を承りました。\n\n【ご予約内容】\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}\n\nご来店心よりお待ちしております。`;
            try {
                await axios.post("https://api.line.me/v2/bot/message/push", {
                    to: customerId,
                    messages: [{ type: "text", text: customerMessageText }],
                }, {
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
                });
                console.log("Confirmation message sent to customer:", customerId);
            } catch (error) {
                console.error("Error sending message to customer:", error.response ? JSON.stringify(error.response.data) : error.message);
            }
        }

        // 管理者への通知メッセージ
        const adminIdsString = ADMIN_LINE_USER_IDS.value();
        if (adminIdsString) {
            const adminIds = adminIdsString.split(',').map(id => id.trim()).filter(id => id);
            if (adminIds.length > 0) {
                const adminMessageText = `新規予約が入りました。\nお客様：${customerName} 様\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}`;
                try {
                    await axios.post("https://api.line.me/v2/bot/message/multicast", {
                        to: adminIds,
                        messages: [{ type: "text", text: adminMessageText }],
                    }, {
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
                    });
                    console.log("Notification multicast successfully to admins.");
                } catch (error) {
                    console.error("Failed to send multicast message to admins:", error.response ? JSON.stringify(error.response.data) : "No response data");
                }
            }
        }
        return null;
    });


// ▼▼▼ 新規追加: 顧客データ統合のためのCloud Function ▼▼▼
/**
 * 既存の顧客データ(oldUserId)を新しいLINE連携アカウント(newUserId)に統合する
 */
exports.mergeUserData = functions.region("asia-northeast1").https.onCall(async (data, context) => {
    // 認証チェック
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "この操作には認証が必要です。");
    }

    const { oldUserId, newUserId, profile, newUserData } = data;

    // バリデーション
    if (!oldUserId || !newUserId || !profile || !newUserData) {
        throw new functions.https.HttpsError("invalid-argument", "必要なパラメータが不足しています。");
    }

    // セキュリティチェック（自分自身のLINE IDに対してのみ操作を許可）
    if (context.auth.uid !== newUserId) {
        throw new functions.https.HttpsError("permission-denied", "操作権限がありません。");
    }

    const db = admin.firestore();
    const batch = db.batch();

    try {
        // 1. 既存の顧客ドキュメント(old)を取得
        const oldUserRef = db.doc(`users/${oldUserId}`);
        const oldUserSnap = await oldUserRef.get();
        if (!oldUserSnap.exists) {
            throw new functions.https.HttpsError("not-found", "統合元の顧客データが見つかりません。");
        }
        const oldUserData = oldUserSnap.data();

        // 2. 新しい顧客ドキュメント(new)を作成または更新
        const newUserRef = db.doc(`users/${newUserId}`);
        
        // フォームからの最新情報とLINEプロフィール、既存のメモ情報をマージ
        const mergedData = {
            ...oldUserData, // 既存のメモ(memo, notes)を引き継ぐ
            ...newUserData, // フォームからの最新情報 (name, kana, phone)
            lineUserId: profile.userId,
            lineDisplayName: profile.displayName,
            isLineUser: true,
            createdAt: oldUserData.createdAt || admin.firestore.FieldValue.serverTimestamp(), // 作成日を引き継ぐ
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        
        batch.set(newUserRef, mergedData, { merge: true });

        // 3. 既存の関連データを新しいIDに付け替える
        // (A) 来店履歴 (sales)
        const salesQuery = db.collection("sales").where("customerId", "==", oldUserId);
        const salesSnapshot = await salesQuery.get();
        salesSnapshot.forEach(doc => {
            batch.update(doc.ref, { customerId: newUserId });
        });

        // (B) 予約履歴 (reservations)
        const reservationsQuery = db.collection("reservations").where("customerId", "==", oldUserId);
        const reservationsSnapshot = await reservationsQuery.get();
        reservationsSnapshot.forEach(doc => {
            batch.update(doc.ref, { customerId: newUserId });
        });
        
        // (C) ギャラリー (users/{oldUserId}/gallery)
        const oldGalleryQuery = db.collection(`users/${oldUserId}/gallery`);
        const oldGallerySnapshot = await oldGalleryQuery.get();
        
        oldGallerySnapshot.forEach(doc => {
            const newGalleryRef = db.doc(`users/${newUserId}/gallery/${doc.id}`);
            batch.set(newGalleryRef, doc.data());
            batch.delete(doc.ref);
        });

        // 4. 古い顧客ドキュメント(old)を削除
        batch.delete(oldUserRef);

        // 5. バッチ処理を実行
        await batch.commit();

        return { success: true, message: "顧客データの統合が完了しました。" };

    } catch (error) {
        console.error("顧客データの統合に失敗しました:", error);
        throw new functions.https.HttpsError("internal", "データの統合処理中にエラーが発生しました。", error.message);
    }
});
// ▲▲▲ 新規追加ここまで ▲▲▲