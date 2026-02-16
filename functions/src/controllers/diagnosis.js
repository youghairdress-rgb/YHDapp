/**
 * src/controllers/diagnosis.js
 *
 * 診断リクエスト (requestDiagnosis) のロジック
 */

const logger = require("firebase-functions/logger");
const { callGeminiApiWithRetry } = require("../services/gemini");
const { AI_RESPONSE_SCHEMA, getDiagnosisSystemPrompt } = require("../prompts/diagnosisPrompts");
const config = require("../config");
const { fetchAsBase64 } = require("../utils/fetchHelper");
const { sendSuccess, sendError } = require("../utils/responseHelper");
const { sanitizeObject } = require("../utils/sanitizer");

/**
 * 診断リクエストのメインコントローラー
 * @param {object} req
 * @param {object} res
 * @param {object} dependencies
 */
async function requestDiagnosisController(req, res, dependencies) {
  const { llmApiKey } = dependencies;

  // 1. メソッドとAPIキーのチェック
  if (req.method !== "POST") {
    return sendError(res, 405, "Method Not Allowed", `Method ${req.method} not allowed.`);
  }

  const apiKey = llmApiKey.value() ? llmApiKey.value().trim() : "";
  if (!apiKey) {
    return sendError(res, 500, "Configuration Error", "API Key not configured.");
  }

  // 2. リクエストデータの取得
  const { fileUrls, userProfile, gender, userRequestsText } = req.body;
  if (!fileUrls || !userProfile || !gender) {
    return sendError(res, 400, "Bad Request", "Missing required data (fileUrls, userProfile, gender).");
  }

  const requiredKeys = ["item-front-photo", "item-side-photo", "item-back-photo", "item-front-video", "item-back-video"];
  const missingKeys = requiredKeys.filter((key) => !fileUrls[key]);
  if (missingKeys.length > 0) {
    return sendError(res, 400, "Bad Request", `Missing required fileUrls: ${missingKeys.join(", ")}`);
  }

  logger.info(`[requestDiagnosis] Received request for user: ${userProfile.firebaseUid || userProfile.userId}`);

  // 3. ファイル取得 (並列処理)
  const parts = [
    { text: `この顧客（性別: ${gender}）を診断し、提案してください。` },
  ];

  try {
    const fetchPromises = requiredKeys.map(key => fetchAsBase64(fileUrls[key], key));

    // ご希望写真 (任意)
    if (fileUrls["item-inspiration-photo"]) {
      fetchPromises.push(
        fetchAsBase64(fileUrls["item-inspiration-photo"], "item-inspiration-photo")
          .then(res => {
            parts.push({ text: "添付の最後は、顧客が希望する参考スタイル写真です。" });
            return res;
          })
      );
    }

    const fetchedParts = await Promise.all(fetchPromises);
    parts.push(...fetchedParts);

  } catch (fetchError) {
    return sendError(res, 500, "File Fetch Error", `ファイル取得失敗: ${fetchError.message}`);
  }

  // 4. トレンド情報の取得 (Firestore)
  let trendInfo = "";
  try {
    const db = require("firebase-admin").firestore();
    const trendDoc = await db.collection("system").doc("trends").get();
    if (trendDoc.exists) {
      const data = trendDoc.data();
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      if (!data.updatedAt || data.updatedAt.toDate() > oneWeekAgo) {
        trendInfo = data.content || "";
      }
    }
  } catch (e) {
    logger.warn("[requestDiagnosis] Failed to fetch trend info (non-fatal):", e);
  }

  // 5. Gemini API 呼び出し
  const systemPrompt = getDiagnosisSystemPrompt(gender, userRequestsText, trendInfo);
  const apiUrl = `${config.api.baseUrl}/${config.models.diagnosis}:generateContent?key=${apiKey}`;

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: AI_RESPONSE_SCHEMA,
    },
  };

  try {
    const aiResponse = await callGeminiApiWithRetry(apiUrl, payload, config.api.retryLimit);

    const responseText = aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) throw new Error("AI response text is empty.");

    let parsedJson;
    try {
      parsedJson = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON from AI: ${e.message}`);
    }

    // 必須キーチェック
    if (!parsedJson.result?.hairCondition?.currentLevel || !parsedJson.proposal?.haircolors?.color1?.recommendedLevel) {
      throw new Error("Missing required keys in AI response.");
    }

    // サニタイズして返却
    const sanitizedJson = sanitizeObject(parsedJson);
    return sendSuccess(res, sanitizedJson);

  } catch (apiError) {
    return sendError(res, 500, "Gemini API Error", `AI診断失敗: ${apiError.message}`, {
      model: config.models.diagnosis
    });
  }
}

module.exports = {
  requestDiagnosisController,
};
