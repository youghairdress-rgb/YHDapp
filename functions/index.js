const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });
// ★改善点: 推奨されるパラメータ化された環境変数を使用
const { defineString } = require('firebase-functions/params');

admin.initializeApp();

// 環境変数を定義
const LINE_CHANNEL_ID = defineString('LINE_CHANNEL_ID');
const LINE_CHANNEL_ACCESS_TOKEN = defineString('LINE_CHANNEL_ACCESS_TOKEN');
const ADMIN_LINE_USER_IDS = defineString('ADMIN_LINE_USER_IDS');


exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method !== "POST") {
            return res.status(405).send("Method Not Allowed");
        }

        const channelId = LINE_CHANNEL_ID.value();
        if (!channelId) {
            console.error("LINE_CHANNEL_ID is not set in environment variables.");
            return res.status(500).send("Server configuration error: LINE Channel ID is not set.");
        }

        const { accessToken } = req.body;
        if (!accessToken) {
            return res.status(400).send("Access token is required");
        }

        try {
            // LINEアクセストークンを検証
            const verifyUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
            verifyUrl.searchParams.append("access_token", accessToken);

            const verifyResponse = await axios.get(verifyUrl.toString());

            if (verifyResponse.data.client_id !== channelId) {
                console.error("Channel ID mismatch");
                return res.status(401).send("Invalid LIFF app or Channel ID mismatch.");
            }

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

