/**
 * errorMonitor.js
 * エラー監視・通知システム
 *
 * 用途: Cloud Functions 内のエラーをキャッチ → ログ記録 → LINE通知
 */

const axios = require("axios");
const {getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs, limit, orderBy} = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

let db;

/**
 * Firestore インスタンスの取得（遅延初期化）
 */
function getDb() {
  if (!db) {
    db = getFirestore();
  }
  return db;
}

/**
 * エラー重要度の判定
 * @param {Error} error - エラーオブジェクト
 * @returns {string} 重要度: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
 */
function getErrorSeverity(error) {
  const message = (error.message || "").toLowerCase();
  const stack = (error.stack || "").toLowerCase();

  // CRITICAL: 認証失敗、認可違反、セキュリティ関連
  if (
    message.includes("auth") ||
        message.includes("permission denied") ||
        message.includes("unauthorized") ||
        message.includes("security")
  ) {
    return "CRITICAL";
  }

  // HIGH: API失敗、データベース接続エラー
  if (
    message.includes("timeout") ||
        message.includes("firestore") ||
        message.includes("http error 5") ||
        message.includes("unavailable") ||
        stack.includes("api.js")
  ) {
    return "HIGH";
  }

  // MEDIUM: バリデーション、入力エラー
  if (
    message.includes("validation") ||
        message.includes("invalid") ||
        message.includes("bad request") ||
        message.includes("400")
  ) {
    return "MEDIUM";
  }

  // LOW: 軽微なエラー
  return "LOW";
}

/**
 * エラーをログに記録
 * @param {Error} error - エラーオブジェクト
 * @param {string} functionName - 関数名
 * @param {object} context - 追加コンテキスト
 * @returns {Promise<string>} ログドキュメント ID
 */
async function logError(error, functionName, context = {}) {
  try {
    const severity = getErrorSeverity(error);

    const errorDoc = {
      timestamp: serverTimestamp(),
      severity,
      functionName,
      errorMessage: error.message || "Unknown error",
      errorStack: error.stack || "",
      status: error.status || 500,
      context,
      // ユーザー情報（あれば）
      userId: context.userId || null,
      customerId: context.customerId || null,
      // ネットワーク情報
      userAgent: context.userAgent || "N/A",
    };

    const docRef = await addDoc(collection(getDb(), "error_logs"), errorDoc);
    logger.info(`[ErrorMonitor] Error logged: ${docRef.id} (${severity})`);

    return {docId: docRef.id, severity};
  } catch (logError) {
    logger.error("[ErrorMonitor] Failed to log error:", logError);
    return {docId: null, severity: "UNKNOWN"};
  }
}

/**
 * LINE管理者にエラー通知を送信
 * @param {Error} error - エラーオブジェクト
 * @param {string} functionName - 関数名
 * @param {string} severity - 重要度
 * @param {object} context - 追加コンテキスト
 */
async function notifyAdminViaLine(error, functionName, severity, context = {}) {
  try {
    // LINE Channel Access Token を環境変数から取得
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const adminLineUserId = process.env.ADMIN_LINE_USER_IDS;

    if (!channelAccessToken || !adminLineUserId) {
      logger.warn("[ErrorMonitor] LINE credentials not configured");
      return;
    }

    // 重要度に応じた絵文字と通知抑制
    const severityEmoji = {
      "CRITICAL": "🚨",
      "HIGH": "⚠️ ",
      "MEDIUM": "⚡",
      "LOW": "ℹ️",
    };

    // LOW は通知しない（ノイズを避けるため）
    if (severity === "LOW") {
      logger.info("[ErrorMonitor] Skipping notification for LOW severity error");
      return;
    }

    const emoji = severityEmoji[severity] || "❓";
    const timestamp = new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"});

    // メッセージ作成
    const messageText = `${emoji} エラー検出【${severity}】

関数: ${functionName}
時刻: ${timestamp}
メッセージ: ${error.message || "Unknown"}
${context.userId ? `ユーザー: ${context.userId}` : ""}
${context.customerId ? `顧客: ${context.customerId}` : ""}

詳細はダッシュボードで確認してください。`;

    // 複数の管理者にも対応
    const adminIds = adminLineUserId.split(",").map(id => id.trim());

    for (const adminId of adminIds) {
      try {
        await axios.post("https://api.line.me/v2/bot/message/push", {
          to: adminId,
          messages: [
            {
              type: "text",
              text: messageText,
            },
          ],
        }, {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${channelAccessToken}`,
          },
        });
        logger.info(`[ErrorMonitor] Notification sent to ${adminId}`);
      } catch (pushError) {
        logger.error("[ErrorMonitor] Failed to send LINE notification:", pushError.message);
      }
    }
  } catch (err) {
    logger.error("[ErrorMonitor] Error in notifyAdminViaLine:", err);
  }
}

/**
 * 統合エラーハンドラー
 * @param {Error} error - エラーオブジェクト
 * @param {string} functionName - 関数名
 * @param {object} options - オプション
 *   - context: 追加モンテキスト
 *   - notifyLine: LINE通知するか (デフォルト: true)
 *   - throwError: エラーを再スロー するか (デフォルト: true)
 */
async function handleError(error, functionName, options = {}) {
  const {
    context = {},
    notifyLine = true,
    throwError = true,
  } = options;

  logger.error(`[${functionName}] Error:`, error);

  // ログに記録
  const {severity} = await logError(error, functionName, context);

  // LINE通知
  if (notifyLine) {
    await notifyAdminViaLine(error, functionName, severity, context);
  }

  // エラーを再スロー
  if (throwError) {
    throw error;
  }
}

/**
 * 最近のエラーログを取得
 * @param {number} days - 過去N日間
 * @returns {Promise<Array>} エラーログ配列
 */
async function getRecentErrors(days = 7) {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const q = query(
        collection(getDb(), "error_logs"),
        where("timestamp", ">=", since),
        orderBy("timestamp", "desc"),
        limit(50),
    );

    const snapshot = await getDocs(q);
    const errors = [];

    snapshot.forEach(doc => {
      errors.push({
        id: doc.id,
        ...doc.data(),
        // Timestamp オブジェクトを文字列に変換
        timestamp: doc.data().timestamp?.toDate?.()?.toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"}) || "N/A",
      });
    });

    return errors;
  } catch (err) {
    logger.error("[ErrorMonitor] Failed to get recent errors:", err);
    return [];
  }
}

/**
 * エラー統計を取得
 * @param {number} days - 過去N日間
 * @returns {Promise<object>} 統計情報
 */
async function getErrorStats(days = 7) {
  const errors = await getRecentErrors(days);

  const stats = {
    total: errors.length,
    bySeverity: {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    },
    byFunction: {},
  };

  errors.forEach(err => {
    // 重要度別集計
    if (stats.bySeverity[err.severity] !== undefined) {
      stats.bySeverity[err.severity]++;
    }

    // 関数別集計
    if (!stats.byFunction[err.functionName]) {
      stats.byFunction[err.functionName] = 0;
    }
    stats.byFunction[err.functionName]++;
  });

  return stats;
}

module.exports = {
  logError,
  notifyAdminViaLine,
  handleError,
  getRecentErrors,
  getErrorStats,
  getErrorSeverity,
};
