/**
 * src/services/gemini.js
 *
 * Gemini APIとの通信を行う共通サービス。
 * リトライロジック（指数バックオフ）を実装。
 */
const logger = require("firebase-functions/logger");

/**
 * 指数バックオフ（Exponential Backoff）リトライ付きでGemini APIを呼び出す
 * @param {string} url - APIエンドポイントURL
 * @param {object} payload - 送信するペイロード
 * @param {number} maxRetries - 最大リトライ回数
 * @return {Promise<object>} - APIからのレスポンス（JSONパース済み）
 */
async function callGeminiApiWithRetry(url, payload, maxRetries = 3) {
  let attempt = 0;
  let delay = 1000; // 1秒から開始

  while (attempt < maxRetries) {
    attempt++;
    logger.info(`[callGeminiApiWithRetry] Attempt ${attempt}/${maxRetries} to call: ${url.split("?")[0]}`);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        return data; // 応答オブジェクト全体をそのまま返す
      }

      // リトライ対象のエラー (429: レート制限, 500/503: サーバーエラー)
      if (response.status === 429 || response.status === 500 || response.status === 503) {
        logger.warn(`[callGeminiApiWithRetry] Received status ${response.status}. Retrying in ${delay}ms...`);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // バックオフ時間を2倍に
        } else {
          throw new Error(`Gemini API failed with status ${response.status} after ${maxRetries} attempts.`);
        }
      } else {
        // 400 (Bad Request) など、リトライしても無駄なエラー
        let errorBodyText = await response.text();
        let errorBody;
        try {
          errorBody = JSON.parse(errorBodyText);
          logger.error(`[callGeminiApiWithRetry] Received non-retriable status ${response.status}:`, errorBody);
        } catch (e) {
          logger.error(`[callGeminiApiWithRetry] Received non-retriable status ${response.status} (non-json response):`, errorBodyText);
          errorBody = {error: {message: errorBodyText}};
        }

        const errorMessage = errorBody?.error?.message || `Unknown API error (Status: ${response.status})`;
        throw new Error(`Gemini API Error: (Code: ${errorBody?.error?.code || response.status}) ${errorMessage}`);
      }
    } catch (fetchError) {
      logger.error(`[callGeminiApiWithRetry] Fetch attempt ${attempt} failed:`, fetchError);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw new Error(`Gemini API fetch failed after ${maxRetries} attempts: ${fetchError.message}`);
      }
    }
  }
  // ループが完了しても成功しなかった場合（理論上到達しないが）
  throw new Error(`Gemini API call failed exhaustively after ${maxRetries} retries.`);
}

module.exports = {
  callGeminiApiWithRetry,
};