/**
 * src/controllers/aiMatching.js
 *
 * AIマッチング（仕上がり診断）コントローラー
 * Before画像とAfter画像（Front/Side/Back）を比較し、
 * 髪型の変化、似合わせ度などをスコアリングする。
 */

const logger = require("firebase-functions/logger");
const { callGeminiApiWithRetry } = require("../services/gemini");
const config = require("../config");
const { fetchAsBase64 } = require("../utils/fetchHelper");
const { sendSuccess, sendError } = require("../utils/responseHelper");

/**
 * AIマッチング診断処理
 */
async function analyzeHairstyleController(req, res, dependencies) {
    const { apiKey } = dependencies;

    if (req.method !== "POST") {
        return sendError(res, 405, "Method Not Allowed", `Method ${req.method} not allowed.`);
    }

    if (!apiKey) {
        return sendError(res, 500, "Configuration Error", "API Key not configured.");
    }

    // 1. データ取得
    const { frontImage, sideImage, backImage, beforeImage } = req.body;

    // After画像は最低一つ必要 (通常はFront)
    if (!frontImage && !sideImage && !backImage) {
        return sendError(res, 400, "Bad Request", "At least one After image is required.");
    }

    logger.info("analyzeHairstyle request received.");

    // 2. Gemini API 準備
    const modelId = config.models.diagnosis; // 診断用モデル (gemini-2.0-flash-exp assumed)
    const baseUrl = config.api.baseUrl;
    const url = `${baseUrl}/${modelId}:generateContent?key=${apiKey.value()}`;

    // 3. Prompt & Parts 構築
    // システムプロンプト
    const systemPrompt = `
あなたはプロのヘアスタイリスト兼AI審査員です。
ユーザーの「施術前（Before）」と「施術後（After）」の写真を見て、
その髪型の変化、技術的な仕上がり、似合わせ度を総合的に評価し、スコア（0〜100）と理由を提示してください。

# 評価基準:
- 変化のわかりやすさ（イメチェン度）
- 髪のツヤ、質感の向上
- 骨格や顔立ちへの似合わせ
- 全体的なバランスの良さ

# 出力フォーマット (JSON):
{
  "score": number, // 0-100の整数
  "reason": "string" // 300〜400文字程度の評価コメント（日本語・丁寧語）
}
  `;

    const parts = [
        { text: systemPrompt }
    ];

    try {
        // Before Image
        if (beforeImage) {
            parts.push({ text: "【施術前 (Before)】" });
            parts.push(await fetchAsBase64(beforeImage, "before"));
        }

        // After Images
        parts.push({ text: "【施術後 (After)】" });
        if (frontImage) {
            parts.push({ text: "(Front)" });
            parts.push(await fetchAsBase64(frontImage, "after_front"));
        }
        if (sideImage) {
            parts.push({ text: "(Side)" });
            parts.push(await fetchAsBase64(sideImage, "after_side"));
        }
        if (backImage) {
            parts.push({ text: "(Back)" });
            parts.push(await fetchAsBase64(backImage, "after_back"));
        }

    } catch (e) {
        return sendError(res, 500, "Image Fetch Error", `Failed to fetch images: ${e.message}`);
    }

    const payload = {
        contents: [{ role: "user", parts: parts }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    score: { type: "NUMBER" },
                    reason: { type: "STRING" }
                },
                required: ["score", "reason"]
            }
        }
    };

    // 4. API Call
    try {
        const data = await callGeminiApiWithRetry(url, payload, 3);
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) throw new Error("Empty response from AI.");

        const result = JSON.parse(text);
        return sendSuccess(res, result);

    } catch (error) {
        logger.error("AI Analysis failed:", error);
        return sendError(res, 500, "Analysis Error", error.message);
    }
}

module.exports = { analyzeHairstyleController };
