/**
 * src/controllers/imageGen.js
 *
 * ヘアスタイル画像生成コントローラー
 * Vertex AI (Gemini 2.5 Flash Image Preview) を使用して、
 * ユーザーの顔写真を維持したまま、指定された髪型・髪色に合成する。
 */

const logger = require("firebase-functions/logger");
const { callGeminiApiWithRetry } = require("../services/gemini");
const { getGenerationPrompt, getRefinementPrompt } = require("../prompts/imageGenPrompts");
const config = require("../config");
const { fetchAsBase64 } = require("../utils/fetchHelper");
const { sendSuccess, sendError } = require("../utils/responseHelper");

/**
 * ヘアスタイル生成のリクエストを処理する
 * @param {object} req
 * @param {object} res
 * @param {object} dependencies
 */
async function generateHairstyleImageController(req, res, dependencies) {
  const { imageGenApiKey, storage } = dependencies;

  if (req.method !== "POST") {
    return sendError(res, 405, "Method Not Allowed", `Method ${req.method} not allowed.`);
  }

  const apiKey = imageGenApiKey.value() ? imageGenApiKey.value().trim() : "";
  if (!apiKey || !storage) {
    return sendError(res, 500, "Configuration Error", "API Key or Storage not configured.");
  }

  // 2. リクエストデータの取得
  const {
    originalImageUrl,
    firebaseUid,
    hairstyleName,
    hairstyleDesc,
    haircolorName,
    haircolorDesc,
    recommendedLevel,
    currentLevel,
    userRequestsText,
    inspirationImageUrl,
    isUserStyle,
    isUserColor,
    hasToneOverride
  } = req.body;

  if (!originalImageUrl || !firebaseUid || !hairstyleName || !haircolorName || !currentLevel) {
    return sendError(res, 400, "Bad Request", "Missing required data.");
  }

  logger.info(`[generateHairstyleImage] Received request for user: ${firebaseUid}`);

  const modelName = config.models.imageGen;
  const apiUrl = `${config.api.baseUrl}/${modelName}:generateContent?key=${apiKey}`;

  const prompt = getGenerationPrompt({
    hairstyleName, hairstyleDesc,
    haircolorName, haircolorDesc,
    recommendedLevel, currentLevel,
    userRequestsText: userRequestsText || "",
    hasInspirationImage: !!inspirationImageUrl,
    isUserStyle: !!isUserStyle,
    isUserColor: !!isUserColor,
    hasToneOverride: !!hasToneOverride
  });

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
    ]
  };

  // 3. 画像データの取得
  try {
    const imgPart = await fetchAsBase64(originalImageUrl, "originalImage");
    payload.contents[0].parts.push(imgPart);

    if (inspirationImageUrl) {
      const inspPart = await fetchAsBase64(inspirationImageUrl, "inspirationImage");
      payload.contents[0].parts.push(inspPart);
    }
  } catch (error) {
    return sendError(res, 500, "Image Fetch Error", `画像の取得に失敗しました: ${error.message}`);
  }

  // 5. API呼び出し
  try {
    const aiResponse = await callGeminiApiWithRetry(apiUrl, payload, 3);
    const imagePart = aiResponse?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);

    if (!imagePart?.inlineData?.data) {
      throw new Error("AIからの応答に画像データが含まれていませんでした。");
    }

    return sendSuccess(res, {
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || "image/png",
    }, "Image generated successfully.");

  } catch (apiError) {
    return sendError(res, 500, "Image Generation Error", `画像生成に失敗しました: ${apiError.message}`);
  }
}

/**
 * 生成された画像の微調整 (Refinement)
 */
async function refineHairstyleImageController(req, res, dependencies) {
  const { imageGenApiKey, storage } = dependencies;

  if (req.method !== "POST") {
    return sendError(res, 405, "Method Not Allowed", `Method ${req.method} not allowed.`);
  }

  const apiKey = imageGenApiKey.value() ? imageGenApiKey.value().trim() : "";
  if (!apiKey || !storage) {
    return sendError(res, 500, "Configuration Error", "API Key or Storage not configured.");
  }

  const { generatedImageUrl, firebaseUid, refinementText } = req.body;
  if (!generatedImageUrl || !firebaseUid || !refinementText) {
    return sendError(res, 400, "Bad Request", "Missing required data.");
  }

  // 3. Data URL Parsing
  let imageBase64, imageMimeType;
  try {
    const match = generatedImageUrl.match(/^data:(image\/.+);base64,(.+)$/);
    if (!match) throw new Error("Invalid Data URL format.");
    imageMimeType = match[1];
    imageBase64 = match[2];
  } catch (e) {
    return sendError(res, 500, "Image Parse Error", `画像データの解析に失敗しました: ${e.message}`);
  }

  // 4. Payload
  const modelName = config.models.imageGen;
  const apiUrl = `${config.api.baseUrl}/${modelName}:generateContent?key=${apiKey}`;
  const prompt = getRefinementPrompt(refinementText);

  const payload = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: imageMimeType, data: imageBase64 } }
      ]
    }],
    generationConfig: { responseModalities: ["IMAGE"] },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
    ]
  };

  // 5. API Call
  try {
    const aiResponse = await callGeminiApiWithRetry(apiUrl, payload, 3);
    const imagePart = aiResponse?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);

    if (!imagePart?.inlineData?.data) {
      throw new Error("AIから画像データが返されませんでした。");
    }

    return sendSuccess(res, {
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || "image/png",
    }, "Image refined successfully.");

  } catch (apiError) {
    return sendError(res, 500, "Image Generation Error", `画像修正に失敗しました: ${apiError.message}`);
  }
}

module.exports = {
  generateHairstyleImageController,
  refineHairstyleImageController,
};
