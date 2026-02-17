/**
 * src/controllers/imageGen.js
 *
 * ヘアスタイル画像生成コントローラー
 * Gemini API (v1beta) を使用して、
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
 */
async function generateHairstyleImageController(req, res, dependencies) {
  const { imageGenApiKey, storage } = dependencies;

  if (req.method !== "POST") {
    return sendError(res, 405, "Method Not Allowed", `Method ${req.method} not allowed.`);
  }

  if (!imageGenApiKey || !storage) {
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

  const modelId = config.models.imageGen; // e.g. "gemini-2.5-flash-image"
  const baseUrl = config.api.baseUrl; // "https://generativelanguage.googleapis.com/v1beta/models"

  // URL構築: generateContent (Gemini API Standard)
  const url = `${baseUrl}/${modelId}:generateContent?key=${imageGenApiKey.value()}`;

  logger.info(`[generateHairstyleImage] Calling Gemini API Model: ${modelId}`);

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

  // 3. 画像データの取得 & Payload構築
  const parts = [];

  // Prompt (Text)
  parts.push({ text: prompt });

  // Original Image
  try {
    const imgPart = await fetchAsBase64(originalImageUrl, "originalImage");
    parts.push(imgPart);
  } catch (error) {
    return sendError(res, 500, "Image Fetch Error", `画像の取得に失敗しました: ${error.message}`);
  }

  // Inspiration Image (Optional)
  if (inspirationImageUrl) {
    try {
      const inspPart = await fetchAsBase64(inspirationImageUrl, "inspirationImage");
      parts.push(inspPart);
    } catch (error) {
      logger.warn(`[generateHairstyleImage] Failed to fetch inspiration image: ${error.message}`);
      // Continue without it
    }
  }

  // Gemini Payload
  const payload = {
    contents: [
      {
        parts: parts
      }
    ],
    generationConfig: {
      temperature: 0.4,
      topK: 32,
      topP: 1,
      maxOutputTokens: 2048, // Gemini 2.x might use this for text, but keeping it safe
      // responseMimeType: "image/jpeg" // If supported by 2.5 flash image model directly
    }
  };

  // 5. API呼び出し
  try {
    const data = await callGeminiApiWithRetry(url, payload, 3);

    // Response Parsing for Gemini
    // Expecting: candidates[0].content.parts[].inlineData (if image is returned inline)
    // OR: candidates[0].content.parts[].text (if model insists on text)

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error("No candidates returned from API.");
    }

    // Check for blocking
    if (candidate.finishReason === "SAFETY") {
      throw new Error("画像生成が安全性の理由でブロックされました。");
    }

    // Try to find image part
    const imagePart = candidate.content?.parts?.find(p => p.inlineData);

    if (imagePart && imagePart.inlineData) {
      return sendSuccess(res, {
        imageBase64: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType,
      }, "Image generated successfully.");
    }

    // Fallback: Check for text output (error or link?)
    const textPart = candidate.content?.parts?.find(p => p.text);
    if (textPart) {
      // If we get text, it might mean the model refused to generate image or this model is text-only
      logger.warn(`[generateHairstyleImage] Model returned text instead of image: ${textPart.text.substring(0, 100)}...`);
      throw new Error(`モデルが画像を生成しませんでした (Text output received). Code 400 equivalent.`);
    }

    throw new Error("AIから有効な画像データが返されませんでした。");

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

  // 2. リクエストデータの取得
  const { generatedImageUrl, firebaseUid, refinementText } = req.body;

  if (!generatedImageUrl || !firebaseUid || !refinementText) {
    return sendError(res, 400, "Bad Request", "Missing required data.");
  }

  if (!imageGenApiKey) {
    return sendError(res, 500, "Configuration Error", "API Key not configured.");
  }

  logger.info(`[refineHairstyleImage] Processing refinement for user: ${firebaseUid}`);

  const modelId = config.models.imageGen;
  const baseUrl = config.api.baseUrl;
  const url = `${baseUrl}/${modelId}:generateContent?key=${imageGenApiKey.value()}`;

  const prompt = getRefinementPrompt(refinementText);

  // 3. 画像データの取得 (Generated Image is base64 data url)
  let imageBase64;
  let mimeType = "image/png";
  try {
    const match = generatedImageUrl.match(/^data:(image\/.+);base64,(.+)$/);
    if (!match) throw new Error("Invalid Data URL format.");
    mimeType = match[1];
    imageBase64 = match[2];
  } catch (e) {
    return sendError(res, 500, "Image Parse Error", `画像データの解析に失敗しました: ${e.message}`);
  }

  const parts = [
    { text: prompt },
    {
      inlineData: {
        mimeType: mimeType,
        data: imageBase64
      }
    }
  ];

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: {
      temperature: 0.4
    }
  };

  // 5. API Call
  try {
    const data = await callGeminiApiWithRetry(url, payload, 3);

    // Response Parsing
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error("No candidates returned.");

    const imagePart = candidate.content?.parts?.find(p => p.inlineData);

    if (imagePart && imagePart.inlineData) {
      return sendSuccess(res, {
        imageBase64: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType,
      }, "Image refined successfully.");
    }

    throw new Error("AIから画像データが返されませんでした。");

  } catch (apiError) {
    return sendError(res, 500, "Image Refinement Error", `画像修正に失敗しました: ${apiError.message}`);
  }
}

module.exports = {
  generateHairstyleImageController,
  refineHairstyleImageController,
};
