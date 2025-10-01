const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });

admin.initializeApp();

const getConfig = (key) => {
    try {
        const value = functions.config().line[key];
        if (!value) {
            console.warn(`Firebase environment variable 'line.${key}' is not set.`);
            return null;
        }
        return value;
    } catch (error) {
        console.error(`Error accessing environment variable 'line.${key}':`, error);
        return null;
    }
};

exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }
        
        if (req.method !== "POST") {
            return res.status(405).send("Method Not Allowed");
        }

        const loadedChannelId = getConfig("channel_id");
        if (!loadedChannelId) {
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

            if (verifyResponse.data.client_id !== loadedChannelId) {
                console.error("Channel ID mismatch", {
                    expected: loadedChannelId,
                    received: verifyResponse.data.client_id,
                });
                return res.status(401).send("Invalid LIFF app or Channel ID mismatch.");
            }
            
            // プロフィール情報を取得してユーザーIDを確実に得る
            const profileResponse = await axios.get("https://api.line.me/v2/profile", {
                headers: { "Authorization": `Bearer ${accessToken}` },
            });
            
            const lineUserId = profileResponse.data.userId;
            if (!lineUserId) {
                return res.status(400).send("LINE User ID could not be retrieved from profile.");
            }

            const customToken = await admin.auth().createCustomToken(lineUserId);
            
            return res.status(200).json({ customToken });

        } catch (error) {
            console.error("An error occurred in createFirebaseCustomToken function:", error.message);
            if (error.response) {
                 console.error("Error Response Data:", JSON.stringify(error.response.data));
                 console.error("Error Response Status:", error.response.status);
                 return res.status(error.response.status).send(error.response.data);
            }
            return res.status(500).send("Authentication failed due to an internal error.");
        }
    });
});

exports.sendBookingConfirmation = functions.region("asia-northeast1").firestore
  .document("reservations/{reservationId}")
  .onCreate(async (snap) => {
      const booking = snap.data();
      const { customerId, customerName, startTime, selectedMenus, userRequests } = booking;
      
      const LINE_CHANNEL_ACCESS_TOKEN = getConfig("channel_access_token");
      if (!LINE_CHANNEL_ACCESS_TOKEN) {
          console.error("LINE Channel Access Token is not configured. Cannot send messages.");
          return;
      }

      if (!customerName || !startTime || !Array.isArray(selectedMenus)) {
          console.log("Booking data is incomplete. Skipping all notifications.", { reservationId: snap.id });
          return;
      }
      
      const time = startTime.toDate();
      // JSTに変換
      const jstTime = new Date(time.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
      const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
      const dayOfWeek = weekdays[jstTime.getDay()];
      const formattedTime = `${jstTime.getFullYear()}年${String(jstTime.getMonth() + 1).padStart(2, "0")}月${String(jstTime.getDate()).padStart(2, "0")}日(${dayOfWeek}) ${String(jstTime.getHours()).padStart(2, "0")}:${String(jstTime.getMinutes()).padStart(2, "0")}`;
      const menuNames = selectedMenus.map((m) => m.name).join("＋");
      const requestsText = userRequests || 'なし';

      // お客様への確認メッセージ送信
      if (customerId) {
          const customerMessageText = `${customerName}様\nご予約ありがとうございます。\n以下の内容でご予約を承りました。\n\n【ご予約内容】\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}\n\nご来店心よりお待ちしております。`;
          const customerMessage = {
              to: customerId,
              messages: [{ type: "text", text: customerMessageText }],
          };
          try {
              await axios.post("https://api.line.me/v2/bot/message/push", customerMessage, {
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`},
              });
              console.log("Confirmation message sent successfully to customer:", customerId);
          } catch (error) {
              console.error("Error sending message to customer:", error.response ? JSON.stringify(error.response.data) : error.message);
          }
      }

      // 管理者への通知メッセージ送信
      const ADMIN_LINE_USER_IDS_STRING = getConfig("admin_user_ids");
      if (ADMIN_LINE_USER_IDS_STRING) {
          const adminIds = ADMIN_LINE_USER_IDS_STRING.split(',').map(id => id.trim()).filter(id => id);
          if(adminIds.length > 0) {
              const adminMessageText = `新規予約が入りました。\nお客様：${customerName} 様\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}`;
              const adminMessage = {
                  to: adminIds,
                  messages: [{ type: "text", text: adminMessageText }],
              };
              try {
                  await axios.post("https://api.line.me/v2/bot/message/multicast", adminMessage, {
                      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`},
                  });
                  console.log("Notification multicast successfully to admins.");
              } catch (error) {
                  console.error("FAILED to send multicast message to admins.", {
                      errorMessage: error.message,
                      errorDetails: error.response ? JSON.stringify(error.response.data) : "No response data",
                      sentToIds: adminIds
                  });
              }
          }
      }
  });

