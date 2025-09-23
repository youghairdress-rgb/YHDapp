const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const { VertexAI } = require("@google-cloud/vertexai");
// CORSを処理するためのミドルウェアをインポート
const cors = require("cors")({ origin: true });

admin.initializeApp();

const LINE_CHANNEL_ACCESS_TOKEN = functions.config().line.channel_access_token;
const LINE_MESSAGING_API = "https://api.line.me/v2/bot/message/push";

// createFirebaseCustomToken: HTTPリクエストとして呼び出される関数
exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest((req, res) => {
    // CORSミドルウェアを実行して、リクエストが許可されたオリジンから来たものか確認
    cors(req, res, async () => {
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        const accessToken = req.body.accessToken;
        if (!accessToken) {
            res.status(400).send("Access token is required");
            return;
        }

        try {
            const response = await axios.get("https://api.line.me/oauth2/v2.1/verify", { params: { access_token: accessToken } });
            if (response.data.client_id !== functions.config().line.channel_id) {
                res.status(401).send("Invalid LIFF app");
                return;
            }

            const lineUserId = response.data.sub;
            const customToken = await admin.auth().createCustomToken(lineUserId);
            res.status(200).json({ customToken });
        } catch (error) {
            console.error("Error creating custom token:", error);
            res.status(500).send("Authentication failed");
        }
    });
});


// sendBookingConfirmation: Firestoreトリガーで実行されるためCORS設定は不要
exports.sendBookingConfirmation = functions.region("asia-northeast1").firestore
  .document("reservations/{reservationId}")
  .onCreate(async (snap, context) => {
      const booking = snap.data();
      const userId = booking.customerId;
      if (!userId) {
          console.log("Customer ID not found in reservation.");
          return;
      }

      const startTime = booking.startTime.toDate();
      const formattedTime = `${startTime.getFullYear()}年${startTime.getMonth() + 1}月${startTime.getDate()}日 ${startTime.getHours()}:${String(startTime.getMinutes()).padStart(2, "0")}`;
      const menuNames = booking.selectedMenus.map((m) => m.name).join(", ");

      const message = {
          to: userId,
          messages: [{
              type: "text",
              text: `ご予約ありがとうございます。\n\n【ご予約内容】\n日時: ${formattedTime}\nメニュー: ${menuNames}\n\nご来店を心よりお待ちしております。`,
          }],
      };

      try {
          await axios.post(LINE_MESSAGING_API, message, {
              headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
              },
          });
          console.log("Confirmation message sent successfully to:", userId);
      } catch (error) {
          console.error("Error sending message to LINE:", error.response ? error.response.data : error.message);
      }
  });


/**
 * AI診断を実行するメイン関数 (Vertex AI連携版)
 * こちらは呼び出し可能関数(onCall)なので、CORS設定は不要
 */
exports.runAiAnalysis = functions.region("asia-northeast1")
    .runWith({ timeoutSeconds: 540, memory: "2GB" })
    .https.onCall(async (data, context) => {
      if (!context.auth || !context.auth.token.admin) {
        throw new functions.https.HttpsError("permission-denied", "この操作には管理者権限が必要です。");
      }

      const { diagnosisId } = data;
      const db = admin.firestore();

      if (!diagnosisId) {
        throw new functions.https.HttpsError("invalid-argument", "診断IDが提供されていません。");
      }
      
      const diagnosisRef = db.collection("diagnoses").doc(diagnosisId);

      try {
        const diagnosisSnap = await diagnosisRef.get();
        if (!diagnosisSnap.exists) {
            throw new functions.https.HttpsError("not-found", "指定された診断IDが見つかりません。");
        }
        const diagnosisData = diagnosisSnap.data();

        const vertexAI = new VertexAI({ project: process.env.GCLOUD_PROJECT, location: "asia-northeast1" });
        const generativeModel = vertexAI.getGenerativeModel({ model: "gemini-2.5-pro" });

        await diagnosisRef.update({ analysisStatus: "AIが診断を開始しました..." });

        const frontPhotoUrl = diagnosisData.mediaUrls["front-photo"];
        if (!frontPhotoUrl) {
          throw new Error("正面写真が見つかりません。");
        }
        const photoResponse = await axios.get(frontPhotoUrl, { responseType: 'arraybuffer' });
        const imageBase64 = Buffer.from(photoResponse.data, 'binary').toString('base64');

        const prompt = createAnalysisPrompt(diagnosisData);
        const imagePart = { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } };
        const textPart = { text: prompt };

        await diagnosisRef.update({ analysisStatus: "顔、骨格、カラーを分析中..." });

        const resp = await generativeModel.generateContent({ contents: [{ role: "user", parts: [imagePart, textPart] }] });
        const analysisResultText = resp.response.candidates[0].content.parts[0].text;
        
        const cleanedJsonText = analysisResultText.replace(/^```json\s*|```$/g, "").trim();
        const analysisResultJson = JSON.parse(cleanedJsonText);
        
        await diagnosisRef.update({
            analysisStatus: "似合わせ画像を生成中...",
            results: analysisResultJson,
        });

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

        throw new functions.https.HttpsError("internal", "AI診断処理中に内部エラーが発生しました。", error.message);
      }
    });

/**
 * AI (Gemini) に渡すためのプロンプト文字列を生成する関数
 */
function createAnalysisPrompt(diagnosisData) {
    const userName = diagnosisData.userName;
    const gender = diagnosisData.gender === "female" ? "女性" : "男性";
    
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
- 性別: ${gender}

# 分析依頼
添付された顔写真を基に、最高の診断結果と提案を生成してください。
- **診断**: 顔の形、パーツバランス、肌のトーン、骨格タイプなどを客観的に分析してください。
- **提案**: ヘアスタイル、ヘアカラー、ファッション、メイクについて、診断結果に基づいた具体的な提案を複数生成してください。
- **コメント**: 「topStylistComment」には、全ての診断結果を統合し、顧客に語りかけるように、説得力のある文章で記述してください。
`;
}

