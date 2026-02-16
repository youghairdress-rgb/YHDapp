/**
 * src/controllers/trendAnalysis.js
 *
 * 美容サイト（HotPepper Beauty, Ozmall等）を巡回し、
 * 最新のトレンド情報を収集・要約してFirestoreに保存する
 */

const config = require("../config");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const cheerio = require("cheerio");
const { callGeminiApiWithRetry } = require("../services/gemini");

// 監視対象のURLリスト
const TARGET_URLS = [
    { name: "HotPepperBeauty_Catalog", url: "https://beauty.hotpepper.jp/catalog/" },
    { name: "Ozmall_Catalog", url: "https://www.ozmall.co.jp/hairsalon/catalog/" }
];

/**
 * 指定されたURLからHTMLを取得し、テキストコンテンツを抽出する
 * @param {string} url
 * @return {Promise<string>}
 */
async function fetchPageContent(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }
        const html = await response.text();
        const $ = cheerio.load(html);

        // 不要な要素を削除
        $("script").remove();
        $("style").remove();
        $("noscript").remove();
        $("iframe").remove();

        // メインコンテンツと思われる部分からテキストを抽出（簡易的）
        // サイト構造に合わせて調整可能だが、汎用的に body 全体からテキストを取得して整形する
        const text = $("body").text().replace(/\s+/g, " ").trim();
        // 長すぎる場合は先頭から一定文字数でカット (Geminiのトークン節約)
        return text.substring(0, 15000);
    } catch (error) {
        logger.error(`[fetchPageContent] Error fetching ${url}:`, error);
        return null;
    }
}

/**
 * Geminiを使用して抽出したテキストからトレンド情報を要約する
 * @param {string} combinedText - 複数サイトから結合されたテキスト
 * @param {string} apiKey - Gemini API Key
 * @return {Promise<string>} - 要約されたトレンド情報
 */
async function summarizeTrendsWithGemini(combinedText, apiKey) {
    const apiUrl = `${config.api.baseUrl}/${config.models.diagnosis}:generateContent?key=${apiKey}`;

    const systemPrompt = `
You are a Professional Hair Trend Analyst.
Analyze the provided text content scraped from major Japanese hair salon catalogs (HotPepper Beauty, Ozmall).
Extract the current "Hair Style Trends" and "Hair Color Trends".

Output Format:
- Write in Japanese.
- Concise bullet points.
- Focus on keywords like "Sheer", "Layer", "Beige", "Short", etc.
- Ignore navigation menu text or ads.
  `;

    const payload = {
        contents: [
            {
                role: "user",
                parts: [{ text: `${systemPrompt}\n\n[Scraped Content]:\n${combinedText}` }],
            },
        ],
        generationConfig: {
            temperature: 0.2, // 事実に即した分析のため低めに
        },
    };

    try {
        const aiResponse = await callGeminiApiWithRetry(apiUrl, payload, 3);
        const content = aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) throw new Error("No response from Gemini.");
        return content;
    } catch (error) {
        logger.error("[summarizeTrendsWithGemini] Error calling Gemini:", error);
        throw error;
    }
}

/**
 * トレンド分析メイン関数
 * (HTTP Request Trigger / Scheduler Trigger)
 */
async function analyzeTrendsController(req, res, dependencies) {
    const { imageGenApiKey } = dependencies; // Gemini利用のためImageGen用のキーを流用、または専用キー
    const apiKey = imageGenApiKey.value() ? imageGenApiKey.value().trim() : "";

    if (!apiKey) {
        return res.status(500).json({ error: "Configuration Error", message: "API Key missing." });
    }

    logger.info("[analyzeTrends] Starting trend patrol...");

    try {
        // 1. 各サイトからコンテンツ収集
        const contents = await Promise.all(
            TARGET_URLS.map(async (target) => {
                const text = await fetchPageContent(target.url);
                return text ? `--- Site: ${target.name} ---\n${text}\n` : "";
            })
        );

        const combinedText = contents.join("\n");
        if (!combinedText.trim()) {
            return res.status(500).json({ error: "Analysis Error", message: "Could not fetch content from any site." });
        }

        // 2. Geminiで分析・要約
        const trendSummary = await summarizeTrendsWithGemini(combinedText, apiKey);
        logger.info("[analyzeTrends] Trend summary generated:", trendSummary);

        // 3. Firestoreに保存
        // system/trends ドキュメントを更新（なければ作成）
        const db = admin.firestore();
        const trendRef = db.collection("system").doc("trends");

        await trendRef.set({
            content: trendSummary,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            sourceUrls: TARGET_URLS.map(t => t.url)
        });

        return res.status(200).json({
            message: "Trend analysis completed successfully.",
            summary: trendSummary
        });

    } catch (error) {
        logger.error("[analyzeTrends] Fatal error:", error);
        return res.status(500).json({ error: "Internal Error", message: error.message });
    }
}

module.exports = {
    analyzeTrendsController
};
