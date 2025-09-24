const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const { VertexAI } = require("@google-cloud/vertexai");
const cors = require("cors")({ origin: true });

admin.initializeApp();

const LINE_CHANNEL_ACCESS_TOKEN = functions.config().line.channel_access_token;
const LINE_MESSAGING_API_PUSH = "https://api.line.me/v2/bot/message/push";
const LINE_MESSAGING_API_MULTICAST = "https://api.line.me/v2/bot/message/multicast";


exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }
        const { accessToken } = req.body;
        if (!accessToken) {
            return res.status(400).send("Access token is required");
        }
        try {
            const response = await axios.get("https://api.line.me/oauth2/v2.1/verify", { params: { access_token: accessToken } });
            if (response.data.client_id !== functions.config().line.channel_id) {
                return res.status(401).send("Invalid LIFF app");
            }
            const lineUserId = response.data.sub;
            const customToken = await admin.auth().createCustomToken(lineUserId);
            return res.status(200).json({ customToken });
        } catch (error) {
            console.error("Error creating custom token:", error);
            return res.status(500).send("Authentication failed");
        }
    });
});

exports.sendBookingConfirmation = functions.region("asia-northeast1").firestore
  .document("reservations/{reservationId}")
  .onCreate(async (snap) => {
      const booking = snap.data();
      const { customerId, customerName, startTime, selectedMenus } = booking;
      
      // 予約データが不完全な場合は処理を終了
      if (!customerName || !startTime || !Array.isArray(selectedMenus)) {
          console.log("Booking data is incomplete. Skipping all notifications.", { reservationId: snap.id });
          return;
      }

      // --- 共通のメッセージパーツを先に生成 ---
      const time = startTime.toDate();
      const jstTime = new Date(time.getTime() + (9 * 60 * 60 * 1000));
      
      // お客様への通知
      if (customerId) {
          const formattedTime = `${jstTime.getUTCFullYear()}年${String(jstTime.getUTCMonth() + 1).padStart(2, "0")}月${String(jstTime.getUTCDate()).padStart(2, "0")}日 ${String(jstTime.getUTCHours()).padStart(2, "0")}:${String(jstTime.getUTCMinutes()).padStart(2, "0")}`;
          const menuNames = selectedMenus.map((m) => m.name).join("＋");

          const customerMessageText = `${customerName}様
ご予約ありがとうございます。
以下の内容でご予約を承りました。

【ご予約内容】
日時：${formattedTime}
メニュー：${menuNames}

ご来店心よりお待ちしております。`;

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
      } else {
          console.log("Customer ID not found. Skipping customer notification.");
      }

      // 管理者への通知
      const ADMIN_LINE_USER_IDS_STRING = functions.config().line.admin_user_ids;
      if (ADMIN_LINE_USER_IDS_STRING) {
          const adminIds = ADMIN_LINE_USER_IDS_STRING.split(',').map(id => id.trim()).filter(id => id);

          if(adminIds.length === 0) {
              console.error("Admin user IDs string was found, but it resulted in an empty list.", {configValue: ADMIN_LINE_USER_IDS_STRING});
              return;
          }
          
          console.log(`Attempting to send notification to the following admin IDs: ${adminIds.join(', ')}`);

          const formattedTime = `${jstTime.getUTCFullYear()}/${String(jstTime.getUTCMonth() + 1).padStart(2, "0")}/${String(jstTime.getUTCDate()).padStart(2, "0")} ${String(jstTime.getUTCHours()).padStart(2, "0")}:${String(jstTime.getUTCMinutes()).padStart(2, "0")}`;
          const menuNames = selectedMenus.map((m) => m.name).join(", ");
          
          const adminMessageText = `新規予約が入りました。

お客様：${customerName} 様
日時：${formattedTime}
メニュー：${menuNames}`;

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
      } else {
        console.log("Admin user IDs (line.admin_user_ids) are not configured. Skipping admin notification.");
      }
  });

/**
 * AI診断を実行するメイン関数 (Vertex AI連携版)
 * onCallトリガーを使用し、バックエンドで安全にAIを呼び出すプロキシとして機能します。
 */
// ... (runAiAnalysis と createAnalysisPrompt 関数は変更なし) ...
exports.runAiAnalysis = functions.region("asia-northeast1")
    .runWith({ timeoutSeconds: 540, memory: "1GB" })
    .https.onCall(async (data, context) => {
        // 1. 管理者認証
        if (!context.auth || !context.auth.token.admin) {
            throw new functions.https.HttpsError("permission-denied", "この操作には管理者権限が必要です。");
        }

        const { diagnosisId } = data;
        if (!diagnosisId) {
            throw new functions.https.HttpsError("invalid-argument", "診断IDが提供されていません。");
        }
        
        const db = admin.firestore();
        const diagnosisRef = db.collection("diagnoses").doc(diagnosisId);

        try {
            // 2. 診断ドキュメントの存在確認
            const diagnosisSnap = await diagnosisRef.get();
            if (!diagnosisSnap.exists) {
                throw new functions.https.HttpsError("not-found", "指定された診断IDが見つかりません。");
            }
            const diagnosisData = diagnosisSnap.data();

            // 3. Vertex AIの初期化とモデルの準備
            const vertexAI = new VertexAI({ project: "yhd-db", location: "asia-northeast1" });
            const generativeModel = vertexAI.getGenerativeModel({ model: "gemini-pro-vision" });

            await diagnosisRef.update({ analysisStatus: "AIが診断を開始しました..." });

            // 4. 画像データの取得とBase64エンコード
            const frontPhotoUrl = diagnosisData.mediaUrls["front-photo"];
            if (!frontPhotoUrl) {
                throw new functions.https.HttpsError("not-found", "診断に必要な正面写真が見つかりません。");
            }
            const photoResponse = await axios.get(frontPhotoUrl, { responseType: 'arraybuffer' });
            const imageBase64 = Buffer.from(photoResponse.data, 'binary').toString('base64');

            // 5. プロンプトの生成とAIへのリクエスト
            const prompt = createAnalysisPrompt(diagnosisData);
            const request = {
                contents: [{ role: "user", parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, { text: prompt }] }],
            };
            
            await diagnosisRef.update({ analysisStatus: "顔、骨格、カラーを分析中..." });
            const resp = await generativeModel.generateContent(request);

            // 6. AIからのレスポンス処理
            if (!resp.response.candidates || resp.response.candidates.length === 0 || !resp.response.candidates[0].content.parts[0].text) {
                throw new Error("AIからの有効な応答がありませんでした。");
            }
            const analysisResultText = resp.response.candidates[0].content.parts[0].text;
            
            const cleanedJsonText = analysisResultText.replace(/^```json\s*|```$/g, "").trim();
            const analysisResultJson = JSON.parse(cleanedJsonText);
            
            await diagnosisRef.update({
                analysisStatus: "似合わせ画像を生成中...",
                results: analysisResultJson,
            });

            // 7. ダミーの生成画像URLを追加して完了
            const generatedImageUrl = `https://placehold.co/600x400/E6FFFA/38B2AC?text=AI+Generated+Style`;
            await diagnosisRef.update({
              "results.generatedImageUrl": generatedImageUrl,
              analysisStatus: "診断が完了しました！",
            });

            return { success: true, message: "AI診断が正常に完了しました。" };

        } catch (error) {
            console.error("AI診断処理中にエラーが発生しました:", error);
            await diagnosisRef.update({
              analysisStatus: `エラーが発生しました: ${error.message}`,
            }).catch((e) => console.error("エラー状態の更新に失敗:", e));

            throw new functions.https.HttpsError("internal", error.message || "AI診断処理中に内部エラーが発生しました。");
        }
    });

function createAnalysisPrompt(diagnosisData) {
    const { userName, gender } = diagnosisData;
    return `
あなたは、トップクラスの美容師、ファッションコンサルタント、メイクアップアーティストを兼ね備えたAIアシスタントです。
顧客の顔写真から特徴を詳細に分析し、以下の項目についてプロフェッショナルな診断と具体的な提案を日本語のJSON形式で出力してください。

# 出力フォーマット (必ずこのJSON形式に従い、すべての項目を埋めてください)
\`\`\`json
{
    "facial": { "title": "顔診断", "icon": "happy-outline", "items": { "顔の形": "...", "パーツバランス": "...", "肌のトーン": "..." } },
    "skeletal": { "title": "骨格診断", "icon": "body-outline", "items": { "骨格タイプ": "...", "首の長さ": "...", "肩のライン": "..." } },
    "personalColor": { "title": "パーソナルカラー", "icon": "color-palette-outline", "items": { "診断結果": "...", "似合うトーン": "..." } },
    "hairstyleSuggestions": [ { "name": "...", "desc": "..." }, { "name": "...", "desc": "..." } ],
    "haircolorSuggestions": [ { "name": "...", "desc": "..." } ],
    "fashionSuggestions": [ { "name": "...", "desc": "..." } ],
    "makeupSuggestions": [ { "name": "...", "desc": "..." } ],
    "topStylistComment": "..."
}
\`\`\`

# 顧客情報
- 名前: ${userName}
- 性別: ${gender === "female" ? "女性" : "男性"}

# 分析依頼
添付された顔写真を基に、最高の診断結果と提案を生成してください。
- **診断**: 顔の形、パーツバランス、肌のトーン、骨格タイプなどを客観的に分析してください。
- **提案**: ヘアスタイル、ヘアカラー、ファッション、メイクについて、診断結果に基づいた具体的な提案を複数生成してください。
- **コメント**: 「topStylistComment」には、全ての診断結果を統合し、顧客に語りかけるように、説得力のある文章で記述してください。
`;
}

