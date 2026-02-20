/**
 * src/services/line.js
 *
 * 認証 (createFirebaseCustomToken) のロジック
 */

const logger = require("firebase-functions/logger");

/**
 * カスタムトークン生成コントローラー
 * @param {object} req - Expressリクエストオブジェクト
 * @param {object} res - Expressレスポンスオブジェクト
 * @param {object} dependencies - 依存関係
 * @param {object} dependencies.auth - Firebase Auth サービス
 */
async function createFirebaseCustomTokenController(req, res, dependencies) {
  const { auth } = dependencies;

  if (req.method !== "POST") {
    logger.warn(`[createFirebaseCustomToken] Method Not Allowed: ${req.method}`);
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!auth) {
    logger.error("[createFirebaseCustomToken] Firebase Auth service is not initialized.");
    return res.status(500).json({ error: "Internal Server Error", message: "Auth service not available." });
  }

  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      logger.error("[createFirebaseCustomToken] Access token is missing.");
      return res.status(400).json({ error: "Access token is missing." });
    }

    // LINE Profile API v2.1 を使ってアクセストークンを検証し、LINE User IDを取得
    const lineResponse = await fetch("https://api.line.me/v2/profile", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    if (!lineResponse.ok) {
      if (lineResponse.status === 401) {
        logger.warn("[createFirebaseCustomToken] Invalid LINE access token.");
        return res.status(401).json({ error: "Invalid access token." });
      }
      logger.error(`[createFirebaseCustomToken] LINE API error: ${lineResponse.status}`);
      return res.status(lineResponse.status).json({ error: "Failed to verify access token." });
    }

    const profile = await lineResponse.json();
    const lineUserId = profile.userId;
    if (!lineUserId) {
      logger.error("[createFirebaseCustomToken] LINE User ID not found in profile.");
      return res.status(500).json({ error: "LINE User ID not found." });
    }

    // (重要) 取得した LINE User ID をそのまま Firebase の UID として使用する
    let firebaseUid = lineUserId;
    let customClaims = {};

    // ★★★ ローカル開発環境(エミュレータ)でのセキュアなバイパス ★★★
    // 特定のデバッグ用トークンが送られてきた場合、管理者権限を付与する
    if (process.env.FUNCTIONS_EMULATOR === 'true' && accessToken === 'local-admin-dev-token') {
      logger.info("[createFirebaseCustomToken] Local admin dev bypass activated.");
      firebaseUid = 'local-admin-uid';
      customClaims = { admin: true };
    } else {
      // 通常時（本番または通常ログイン）
      const adminIds = (process.env.ADMIN_LINE_USER_IDS || "").split(',').map(id => id.trim());
      if (adminIds.includes(lineUserId)) {
        customClaims = { admin: true };
      }
    }

    // Firebase Admin SDK を使ってカスタムトークンを生成
    // (この時点で firebaseUid のユーザーがAuthに存在しない場合、自動的に作成される)
    const customToken = await auth.createCustomToken(firebaseUid, customClaims);

    logger.info(`[createFirebaseCustomToken] Custom token created successfully for UID: ${firebaseUid}`);
    return res.status(200).json({ customToken: customToken });
  } catch (error) {
    logger.error("[createFirebaseCustomToken] Error creating custom token:", error);
    // ★ 重要: 権限エラー(iam.serviceAccounts.signBlob) もここに含まれる
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message || "Unknown error during token creation.",
    });
  }
}

module.exports = {
  createFirebaseCustomTokenController,
};
