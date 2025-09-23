const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
// Vertex AIのライブラリをインポート
const { VertexAI } = require("@google-cloud/vertexai");

admin.initializeApp();

// --- 既存の関数 (変更なし) ---
const LINE_CHANNEL_ACCESS_TOKEN = functions.config().line.channel_access_token;
const LINE_MESSAGING_API = "https://api.line.me/v2/bot/message/push";
exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest(async (req, res) => {
    // (省略... 既存のコードは変更ありません)
});
exports.sendBookingConfirmation = functions.region("asia-northeast1").firestore
  .document("reservations/{reservationId}")
  .onCreate(async (snap, context) => {
      // (省略... 既存のコードは変更ありません)
  });
// --- 既存の関数ここまで ---


/**
 * ★★★ AI診断を実行するメイン関数 (Vertex AI連携版) ★★★
 */
exports.runAiAnalysis = functions.region("asia-northeast1")
    // タイムアウトを5分に延長し、メモリを増強
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .https.onCall(async (data, context) => {
      // 認証チェック
      if (!context.auth || !context.auth.token.admin) {
        throw new functions.https.HttpsError(
            "permission-denied", "この操作には管理者権限が必要です。",
        );
      }

      const { diagnosisId } = data;
      const db = admin.firestore();

      if (!diagnosisId) {
        throw new functions.https.HttpsError(
            "invalid-argument", "診断IDが提供されていません。",
        );
      }
      
      try {
        const diagnosisRef = db.collection("diagnoses").doc(diagnosisId);
        const diagnosisSnap = await diagnosisRef.get();
        if (!diagnosisSnap.exists) {
            throw new functions.https.HttpsError("not-found", "指定された診断IDが見つかりません。");
        }
        const diagnosisData = diagnosisSnap.data();

        // 1. Vertex AIの初期化
        const vertexAI = new VertexAI({
            project: process.env.GCLOUD_PROJECT, // FirebaseプロジェクトのIDを自動的に使用
            location: "asia-northeast1", // 東京リージョン
        });
        
        // Gemini 2.5 Pro モデルを指定
        const generativeModel = vertexAI.getGenerativeModel({
            model: "gemini-2.5-pro",
        });

        await diagnosisRef.update({ analysisStatus: "AIが診断を開始しました..." });

        // 2. AIに渡すためのプロンプトを組み立てる
        //    (長くなるので別の関数に切り出します)
        const prompt = createAnalysisPrompt(diagnosisData);
        
        // 3. AIに画像とプロンプトを渡して、分析をリクエスト
        const request = {
            contents: [
                {
                    role: "user",
                    parts: [
                        // TODO: ここでお客様の正面写真をFirebase Storageから読み込み、Base64エンコードして渡します。
                        // (今回は実装をシンプルにするため、テキストのみでリクエストします)
                        { text: prompt },
                    ],
                },
            ],
        };
        
        await diagnosisRef.update({ analysisStatus: "顔、骨格、カラーを分析中..." });

        const resp = await generativeModel.generateContent(request);
        const analysisResultText = resp.response.candidates[0].content.parts[0].text;
        
        // 4. AIの応答 (JSON形式のテキスト) をパースしてオブジェクトに変換
        const analysisResultJson = JSON.parse(analysisResultText);
        
        // TODO: ここでanalysisResultJsonを使ってImagenのプロンプトを生成し、
        //       Imagenを呼び出して画像を生成する処理が入ります。
        //       今回はダミーの画像URLを使用します。
        const generatedImageUrl = "https://placehold.co/600x400/E6FFFA/38B2AC?text=Generated+by+AI";
        
        await diagnosisRef.update({
            analysisStatus: "似合わせ画像を生成中...",
            results: analysisResultJson, // Geminiからの分析結果を保存
        });

        // 5. 最終的な結果をFirestoreに保存
        await diagnosisRef.update({
          "results.generatedImageUrl": generatedImageUrl, // Imagenからの画像URLを追記
          analysisStatus: "診断が完了しました！",
        });

        return { success: true, message: "AI診断が正常に完了しました。" };
      } catch (error) {
        console.error("AI診断処理中にエラーが発生しました:", error);
        await db.collection("diagnoses").doc(diagnosisId).update({
          analysisStatus: `エラーが発生しました: ${error.message}`,
        }).catch((e) => console.error("エラー状態の更新に失敗:", e));

        throw new functions.https.HttpsError(
            "internal", "AI診断処理中に内部エラーが発生しました。", error,
        );
      }
    });

/**
 * AI (Gemini) に渡すためのプロンプト文字列を生成する関数
 * @param {object} diagnosisData - 診断対象のデータ
 * @returns {string} - 生成されたプロンプト
 */
function createAnalysisPrompt(diagnosisData) {
    // 顧客の基本情報
    const userName = diagnosisData.userName;
    const gender = diagnosisData.gender === "female" ? "女性" : "男性";
    
    // TODO: ここで実際にアップロードされた画像の情報をプロンプトに含める
    const imageUrls = diagnosisData.mediaUrls;

    // AIへの指示 (役割定義)
    const systemInstruction = `
あなたは、トップクラスの美容師であり、ファッションコンサルタント、メイクアップアーティストでもあるAIアシスタントです。
顧客の写真（今回はテキスト情報で代用）を分析し、以下の項目についてプロフェッショナルな診断と提案をJSON形式で出力してください。

# 出力フォーマット (必ずこのJSON形式に従ってください)
\`\`\`json
{
    "facial": {
        "title": "顔診断", "icon": "happy-outline",
        "items": { "顔の形": "...", "パーツバランス": "...", "肌のトーン": "..." }
    },
    "skeletal": {
        "title": "骨格診断", "icon": "body-outline",
        "items": { "骨格タイプ": "...", "首の長さ": "...", "肩のライン": "..." }
    },
    "personalColor": {
        "title": "パーソナルカラー", "icon": "color-palette-outline",
        "items": { "診断結果": "...", "似合うトーン": "..." }
    },
    "hairstyleSuggestions": [
        { "name": "...", "desc": "...", "img": "https://placehold.co/300x200/..." },
        { "name": "...", "desc": "...", "img": "https://placehold.co/300x200/..." }
    ],
    "haircolorSuggestions": [
        { "name": "...", "desc": "...", "img": "https://placehold.co/300x200/..." }
    ],
    "fashionSuggestions": [
        { "name": "...", "desc": "...", "img": "https://placehold.co/300x200/..." }
    ],
    "makeupSuggestions": [
        { "name": "...", "desc": "...", "img": "https://placehold.co/300x200/..." }
    ],
    "topStylistComment": "..."
}
\`\`\`
`;
    
    // 顧客情報と分析依頼
    const userPrompt = `
# 顧客情報
- 名前: ${userName}
- 性別: ${gender}

# 分析依頼
上記の顧客情報を基に、最高の診断結果と提案を生成してください。
特に「トップスタイリストAIより」のコメントは、全ての診断結果を統合し、顧客に語りかけるように、説得力のある文章で記述してください。
`;

    return systemInstruction + userPrompt;
}

