const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });

admin.initializeApp();

// 環境変数を取得
const LINE_CHANNEL_ACCESS_TOKEN = functions.config().line.channel_access_token;
const LINE_CHANNEL_ID = functions.config().line.channel_id; // LIFFアプリのチャネルID
const LINE_MESSAGING_API_PUSH = "https://api.line.me/v2/bot/message/push";
const LINE_MESSAGING_API_MULTICAST = "https://api.line.me/v2/bot/message/multicast";


exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest((req, res) => {
    cors(req, res, async () => {
        // Log the start of the function execution
        console.log("createFirebaseCustomToken function started.");

        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        // Log the environment variable to ensure it's loaded
        const loadedChannelId = functions.config().line.channel_id;
        console.log("Loaded LINE Channel ID from config:", loadedChannelId);
        if (!loadedChannelId) {
            console.error("Firebase environment variable 'line.channel_id' is not set!");
            return res.status(500).send("Server configuration error.");
        }

        const { accessToken } = req.body;
        if (!accessToken) {
            console.log("Access token was not found in the request body.");
            return res.status(400).send("Access token is required");
        }

        try {
            console.log("Verifying LINE access token...");
            const response = await axios.get("https://api.line.me/oauth2/v2.1/verify", { params: { access_token: accessToken } });
            console.log("Successfully verified token with LINE. Received client_id:", response.data.client_id);
            
            if (response.data.client_id !== loadedChannelId) {
                console.error("Channel ID mismatch", { expected: loadedChannelId, received: response.data.client_id });
                return res.status(401).send("Invalid LIFF app");
            }
            
            const lineUserId = response.data.sub;
             if (!lineUserId) {
                console.error("LINE User ID (sub) is missing from the verification response.");
                return res.status(400).send("LINE User ID could not be retrieved.");
            }
            console.log("LINE User ID:", lineUserId);

            console.log("Creating Firebase custom token...");
            const customToken = await admin.auth().createCustomToken(lineUserId);
            console.log("Successfully created Firebase custom token.");
            
            return res.status(200).json({ customToken });
        } catch (error) {
            // Log the full error object for detailed debugging
            console.error("An error occurred in createFirebaseCustomToken function:", error);
            if (error.response) {
                 console.error("Error response data:", error.response.data);
                 console.error("Error response status:", error.response.status);
                 console.error("Error response headers:", error.response.headers);
            }
            return res.status(500).send("Authentication failed");
        }
    });
});

exports.sendBookingConfirmation = functions.region("asia-northeast1").firestore
  .document("reservations/{reservationId}")
  .onCreate(async (snap) => {
      const booking = snap.data();
      const { customerId, customerName, startTime, selectedMenus, userRequests } = booking;
      
      if (!customerName || !startTime || !Array.isArray(selectedMenus)) {
          console.log("Booking data is incomplete. Skipping all notifications.", { reservationId: snap.id });
          return;
      }
      
      const time = startTime.toDate();
      const jstTime = new Date(time.getTime() + (9 * 60 * 60 * 1000));
      const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
      const dayOfWeek = weekdays[jstTime.getUTCDay()];

      if (customerId) {
          const formattedTime = `${jstTime.getUTCFullYear()}年${String(jstTime.getUTCMonth() + 1).padStart(2, "0")}月${String(jstTime.getUTCDate()).padStart(2, "0")}日(${dayOfWeek}) ${String(jstTime.getUTCHours()).padStart(2, "0")}:${String(jstTime.getUTCMinutes()).padStart(2, "0")}`;
          const menuNames = selectedMenus.map((m) => m.name).join("＋");
          const requestsText = userRequests || '';

          const customerMessageText = `${customerName}様\nご予約ありがとうございます。\n以下の内容でご予約を承りました。\n\n【ご予約内容】\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}\n\nご来店心よりお待ちしております。`;

          const customerMessage = {
              to: customerId,
              messages: [{ type: "text", text: customerMessageText }],
          };

          try {
              await axios.post(LINE_MESSAGING_API_PUSH, customerMessage, {
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`},
              });
              console.log("Confirmation message sent successfully to customer:", customerId);
          } catch (error) {
              console.error("Error sending message to customer:", error.response ? error.response.data : error.message);
          }
      }

      const ADMIN_LINE_USER_IDS_STRING = functions.config().line.admin_user_ids;
      if (ADMIN_LINE_USER_IDS_STRING) {
          const adminIds = ADMIN_LINE_USER_IDS_STRING.split(',').map(id => id.trim()).filter(id => id);

          if(adminIds.length > 0) {
              const formattedTime = `${jstTime.getUTCFullYear()}/${String(jstTime.getUTCMonth() + 1).padStart(2, "0")}/${String(jstTime.getUTCDate()).padStart(2, "0")}(${dayOfWeek}) ${String(jstTime.getUTCHours()).padStart(2, "0")}:${String(jstTime.getUTCMinutes()).padStart(2, "0")}`;
              const menuNames = selectedMenus.map((m) => m.name).join(", ");
              const requestsText = userRequests || '';
              
              const adminMessageText = `新規予約が入りました。\nお客様：${customerName} 様\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}`;

              const adminMessage = {
                  to: adminIds,
                  messages: [{ type: "text", text: adminMessageText }],
              };

              try {
                  await axios.post(LINE_MESSAGING_API_MULTICAST, adminMessage, {
                      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`},
                  });
                  console.log("Notification multicast successfully to admins.");
              } catch (error) {
                  console.error("FAILED to send multicast message to admins.", {
                      errorMessage: error.message,
                      errorDetails: error.response ? error.response.data : "No response data",
                      sentToIds: adminIds
                  });
              }
          }
      }
  });

