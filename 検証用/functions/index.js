const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });
const { defineString } = require('firebase-functions/params');

admin.initializeApp();

const LINE_CHANNEL_ID = defineString('LINE_CHANNEL_ID');
const LINE_CHANNEL_ACCESS_TOKEN = defineString('LINE_CHANNEL_ACCESS_TOKEN');
const ADMIN_LINE_USER_IDS = defineString('ADMIN_LINE_USER_IDS');


exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }
        
        if (req.method !== "POST") {
            return res.status(405).send("Method Not Allowed");
        }

        const channelId = LINE_CHANNEL_ID.value();
        if (!channelId) {
            return res.status(500).send("Server configuration error: LINE Channel ID is not set.");
        }

        const { accessToken } = req.body;
        if (!accessToken) {
            return res.status(400).send("Access token is required");
        }

        try {
            const verifyUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
            verifyUrl.searchParams.append("access_token", accessToken);
            
            const verifyResponse = await axios.get(verifyUrl.toString());

            if (verifyResponse.data.client_id !== channelId) {
                console.error("Channel ID mismatch", {
                    expected: channelId,
                    received: verifyResponse.data.client_id,
                });
                return res.status(401).send("Invalid LIFF app or Channel ID mismatch.");
            }
            
            const profileResponse = await axios.get("https://api.line.me/v2/profile", {
                headers: { "Authorization": `Bearer ${accessToken}` },
            });
            
            const lineUserId = profileResponse.data.userId;
            if (!lineUserId) {
                return res.status(400).send("LINE User ID could not be retrieved from profile.");
            }

            // ★★★ 修正点: 管理者かどうかを判定し、カスタムクレームを設定 ★★★
            const adminIdsString = ADMIN_LINE_USER_IDS.value() || "";
            const adminIds = adminIdsString.split(',').map(id => id.trim());
            const isAdmin = adminIds.includes(lineUserId);

            const customClaims = {};
            if (isAdmin) {
                customClaims.admin = true;
            }

            // カスタムクレームを付与してトークンを作成
            const customToken = await admin.auth().createCustomToken(lineUserId, customClaims);
            
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

// (sendBookingConfirmation と mergeUserData 関数は変更なしのため省略)
// ...
exports.sendBookingConfirmation = functions.region("asia-northeast1").firestore
  .document("reservations/{reservationId}")
  .onCreate(async (snap) => {
      const booking = snap.data();

      if (!booking || !booking.customerName || !booking.startTime || !Array.isArray(booking.selectedMenus)) {
          console.log("Booking data is incomplete. Skipping all notifications.", { 
              reservationId: snap.id,
              hasCustomerName: !!booking.customerName,
              hasStartTime: !!booking.startTime,
              hasSelectedMenus: Array.isArray(booking.selectedMenus)
          });
          return;
      }
      
      const { customerId, customerName, startTime, selectedMenus, userRequests } = booking;
      
      const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
      if (!channelAccessToken) {
          console.error("LINE Channel Access Token is not configured. Cannot send messages.");
          return;
      }
      
      const time = startTime.toDate();
      const jstTime = new Date(time.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
      const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
      const dayOfWeek = weekdays[jstTime.getDay()];
      const formattedTime = `${jstTime.getFullYear()}年${String(jstTime.getMonth() + 1).padStart(2, "0")}月${String(jstTime.getDate()).padStart(2, "0")}日(${dayOfWeek}) ${String(jstTime.getHours()).padStart(2, "0")}:${String(jstTime.getMinutes()).padStart(2, "0")}`;
      const menuNames = selectedMenus.map((m) => m.name).join("＋");
      const requestsText = userRequests || 'なし';

      if (customerId) {
          const customerMessageText = `${customerName}様\nご予約ありがとうございます。\n以下の内容でご予約を承りました。\n\n【ご予約内容】\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}\n\nご来店心よりお待ちしております。`;
          const customerMessage = {
              to: customerId,
              messages: [{ type: "text", text: customerMessageText }],
          };
          try {
              await axios.post("https://api.line.me/v2/bot/message/push", customerMessage, {
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}`},
              });
              console.log("Confirmation message sent successfully to customer:", customerId);
          } catch (error) {
              console.error("Error sending message to customer:", error.response ? JSON.stringify(error.response.data) : error.message);
          }
      }

      const adminIdsString = ADMIN_LINE_USER_IDS.value();
      if (adminIdsString) {
          const adminIds = adminIdsString.split(',').map(id => id.trim()).filter(id => id);
          if(adminIds.length > 0) {
              const adminMessageText = `新規予約が入りました。\nお客様：${customerName} 様\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}`;
              const adminMessage = {
                  to: adminIds,
                  messages: [{ type: "text", text: adminMessageText }],
              };
              try {
                  await axios.post("https://api.line.me/v2/bot/message/multicast", adminMessage, {
                      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}`},
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

exports.mergeUserData = functions.region("asia-northeast1").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'この操作には認証が必要です。');
    }

    const { oldUserId, newUserId, profile } = data;
    if (!oldUserId || !newUserId || !profile) {
        throw new functions.https.HttpsError('invalid-argument', '必要なパラメータが不足しています。');
    }

    const db = admin.firestore();
    const batch = db.batch();

    try {
        const oldUserRef = db.collection('users').doc(oldUserId);
        const oldUserDoc = await oldUserRef.get();
        if (!oldUserDoc.exists) {
            throw new functions.https.HttpsError('not-found', '統合元の顧客データが見つかりません。');
        }
        const oldUserData = oldUserDoc.data();

        const newUserRef = db.collection('users').doc(newUserId);
        batch.set(newUserRef, {
            ...oldUserData,
            lineUserId: profile.userId,
            lineDisplayName: profile.displayName,
            isLineUser: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        batch.delete(oldUserRef);

        const reservationsQuery = db.collection('reservations').where('customerId', '==', oldUserId);
        const salesQuery = db.collection('sales').where('customerId', '==', oldUserId);
        
        const [reservationsSnapshot, salesSnapshot] = await Promise.all([
            reservationsQuery.get(),
            salesQuery.get()
        ]);

        reservationsSnapshot.forEach(doc => {
            batch.update(doc.ref, { customerId: newUserId });
        });
        salesSnapshot.forEach(doc => {
            batch.update(doc.ref, { customerId: newUserId });
        });
        
        await batch.commit();

        return { success: true, message: '顧客データの統合が完了しました。' };

    } catch (error) {
        console.error("顧客データの統合中にエラーが発生しました:", error);
        throw new functions.https.HttpsError('internal', 'サーバー内部でエラーが発生しました。', error.message);
    }
});

