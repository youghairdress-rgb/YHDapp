/**
 * src/services/firebase.js
 *
 * Firebase Admin SDKの初期化と、共通サービス（auth, storage）のエクスポート
 */
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

let adminApp; let auth; let storage; let defaultBucketName;

try {
  adminApp = admin.initializeApp();
  logger.info("Firebase Admin SDK initialized.");
} catch (e) {
  adminApp = admin.app(); // 既に初期化されている場合は既存のappを取得
  logger.warn("Firebase Admin SDK already initialized.");
}

try {
  auth = admin.auth(adminApp);
  logger.info("Firebase Auth service retrieved.");
} catch (e) {
  logger.error("Failed to get Firebase Auth service:", e);
}

try {
  storage = admin.storage(adminApp);
  logger.info("Firebase Storage service retrieved.");
} catch (e) {
  logger.error("Failed to get Firebase Storage service:", e);
}

try {
  defaultBucketName = adminApp.options.storageBucket;
  if (!defaultBucketName) {
    const projectId = adminApp.options.projectId;
    if (projectId) {
      defaultBucketName = `${projectId}.appspot.com`;
      logger.warn(`Storage Bucket name was missing, inferred as: ${defaultBucketName}`);
    } else {
      throw new Error("Default Storage Bucket name not found and Project ID is missing.");
    }
  }
  logger.info(`Default Storage Bucket name: ${defaultBucketName}`);
} catch (e) {
  logger.error("Failed to get Default Storage Bucket name:", e);
  // エラーが発生しても、バケット名が不要な関数は動作する可能性がある
}

module.exports = {
  adminApp,
  auth,
  storage,
  defaultBucketName,
};
