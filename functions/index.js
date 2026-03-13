const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const functionsV1 = require("firebase-functions/v1");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const axios = require("axios");
const corsLib = require("cors")({ origin: true });
const { defineString } = require("firebase-functions/params");

// --- YHD-DX Integrated Controllers & Services ---
const { requestDiagnosisController } = require("./src/controllers/diagnosis");
const { generateHairstyleImageController, refineHairstyleImageController } = require("./src/controllers/imageGen");
const { analyzeTrendsController } = require("./src/controllers/trendAnalysis");
const { createFirebaseCustomTokenController } = require("./src/services/line");
const { adminApp, auth, storage, defaultBucketName } = require("./src/services/firebase");
const { params: configParams } = require("./src/config");

// Note: admin.initializeApp() is now handled within src/services/firebase.js to avoid duplicate initialization errors.

// 環境変数を config.js から取得
const LINE_CHANNEL_IDS = configParams.lineChannelIds;
const LINE_CHANNEL_ACCESS_TOKEN = configParams.lineChannelAccessToken;
const ADMIN_LINE_USER_IDS = configParams.adminLineUserIds;
const GEMINI_API_KEY = configParams.geminiApiKey;

// --- Global Options for v2 ---
setGlobalOptions({
  region: "asia-northeast1",
  memory: "1GiB",
  timeoutSeconds: 300,
  concurrency: 10,
});

// Helper to wrap onRequest with CORS
const withCors = (handler) => (req, res) => {
  return corsLib(req, res, () => handler(req, res));
};

// --- 1. createFirebaseCustomToken (Original - Kept as v1 to avoid upgrade error) ---
exports.createFirebaseCustomToken = functionsV1.region("asia-northeast1").runWith({
  memory: "1GB",
  timeoutSeconds: 300,
}).https.onRequest(withCors(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  const channelIdsString = LINE_CHANNEL_IDS.value();
  if (!channelIdsString) {
    console.error("LINE_CHANNEL_IDS is not set.");
    return res.status(500).send("Server configuration error.");
  }
  const allowedChannelIds = channelIdsString.split(",").map(id => id.trim()).filter(id => id);
  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).send("Access token is required");

  try {
    const verifyUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
    verifyUrl.searchParams.append("access_token", accessToken);
    const verifyResponse = await axios.get(verifyUrl.toString());
    const requestChannelId = verifyResponse.data.client_id;
    if (!allowedChannelIds.includes(requestChannelId)) {
      return res.status(401).send("Invalid LIFF app.");
    }
    const profileResponse = await axios.get("https://api.line.me/v2/profile", {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    const lineUserId = profileResponse.data.userId;
    const adminIdsString = ADMIN_LINE_USER_IDS.value() || "";
    const adminIds = adminIdsString.split(",").map(id => id.trim());
    const isAdmin = adminIds.includes(lineUserId);
    const customClaims = {};
    if (isAdmin) customClaims.admin = true;
    const customToken = await admin.auth().createCustomToken(lineUserId, customClaims);
    return res.status(200).json({ customToken });
  } catch (error) {
    console.error("Error in createFirebaseCustomToken:", error.message);
    return res.status(500).send("Authentication failed.");
  }
}));

// --- 2. sendBookingConfirmation ---
exports.sendBookingConfirmation = functionsV1.region("asia-northeast1").firestore.document("reservations/{reservationId}").onCreate(async (snap, context) => {
  if (!snap) return null;
  const booking = snap.data();
  if (booking.createdBy === "admin") return null;
  if (!booking || !booking.customerName || !booking.startTime) return null;

  const { customerId, customerName, startTime, selectedMenus, userRequests } = booking;
  const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
  if (!channelAccessToken) return null;

  const time = startTime.toDate();
  const jstTime = new Date(time.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dayOfWeek = weekdays[jstTime.getDay()];
  const formattedTime = `${jstTime.getFullYear()}年${String(jstTime.getMonth() + 1).padStart(2, "0")}月${String(jstTime.getDate()).padStart(2, "0")}日(${dayOfWeek}) ${String(jstTime.getHours()).padStart(2, "0")}:${String(jstTime.getMinutes()).padStart(2, "0")}`;
  const menuNames = selectedMenus ? selectedMenus.map((m) => m.name).join("＋") : "";
  const requestsText = userRequests || "なし";

  if (customerId) {
    const customerMessageText = `${customerName}様\nご予約ありがとうございます。\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}`;
    try {
      await axios.post("https://api.line.me/v2/bot/message/push", {
        to: customerId,
        messages: [{ type: "text", text: customerMessageText }],
      }, {
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
      });
    } catch (error) {
      console.error("Error sending message to customer:", error.message);
    }
  }

  const adminIdsString = ADMIN_LINE_USER_IDS.value();
  if (adminIdsString) {
    const adminIds = adminIdsString.split(",").map(id => id.trim()).filter(id => id);
    if (adminIds.length > 0) {
      const adminMessageText = `新規予約：${customerName} 様\n日時：${formattedTime}\nメニュー：${menuNames}`;
      try {
        await axios.post("https://api.line.me/v2/bot/message/multicast", {
          to: adminIds,
          messages: [{ type: "text", text: adminMessageText }],
        }, {
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
        });
      } catch (error) {
        console.error("Failed to send admin notification:", error.message);
      }
    }
  }
  return null;
});

// --- 2.1 notifyAdminOnReservationDelete ---
exports.notifyAdminOnReservationDelete = functionsV1.region("asia-northeast1").firestore.document("reservations/{reservationId}").onDelete(async (snap, context) => {
  if (!snap) return null;
  const booking = snap.data();
  if (!booking || !booking.customerName || !booking.startTime) return null;

  // 管理画面からの削除(deletedBy === 'admin')の場合は通知をスキップ
  if (booking.deletedBy === 'admin') {
    console.log(`Reservation for ${booking.customerName} was deleted by admin. Skipping notification.`);
    return null;
  }

  const { customerName, startTime, selectedMenus } = booking;
  const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
  const adminIdsString = ADMIN_LINE_USER_IDS.value();

  if (!channelAccessToken || !adminIdsString) return null;

  const time = startTime.toDate();
  const jstTime = new Date(time.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dayOfWeek = weekdays[jstTime.getDay()];
  const formattedTime = `${jstTime.getFullYear()}年${String(jstTime.getMonth() + 1).padStart(2, "0")}月${String(jstTime.getDate()).padStart(2, "0")}日(${dayOfWeek}) ${String(jstTime.getHours()).padStart(2, "0")}:${String(jstTime.getMinutes()).padStart(2, "0")}`;
  const menuNames = selectedMenus ? selectedMenus.map((m) => m.name).join("＋") : "";

  const adminIds = adminIdsString.split(",").map(id => id.trim()).filter(id => id);
  if (adminIds.length > 0) {
    const adminMessageText = `予約キャンセル通知\nお客様：${customerName} 様\n日時：${formattedTime}\nメニュー：${menuNames}`;
    try {
      await axios.post("https://api.line.me/v2/bot/message/multicast", {
        to: adminIds,
        messages: [{ type: "text", text: adminMessageText }],
      }, {
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
      });
    } catch (error) {
      console.error("Failed to send admin cancel notification:", error.message);
    }
  }

  return null;
});

// --- 3. mergeUserData ---
exports.mergeUserData = functionsV1.region("asia-northeast1").https.onCall(async (data, context) => {
  if (!context.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Auth required.");
  const { oldUserId, newUserId, profile, newUserData } = data;
  if (context.auth.uid !== newUserId) throw new functionsV1.https.HttpsError("permission-denied", "Permission denied.");

  const db = admin.firestore();
  const batch = db.batch();
  const oldUserRef = db.doc(`users/${oldUserId}`);
  const oldUserSnap = await oldUserRef.get();
  if (!oldUserSnap.exists) throw new HttpsError("not-found", "Not found.");

  const oldUserData = oldUserSnap.data();
  const newUserRef = db.doc(`users/${newUserId}`);
  const newUserSnap = await newUserRef.get();
  const currentNewUserData = newUserSnap.exists ? newUserSnap.data() : {};

  // 過去のIDリストを管理（配列として保持・追加）
  let prevIds = currentNewUserData.prevIds || [];
  if (!prevIds.includes(oldUserId)) {
    prevIds.push(oldUserId);
  }

  const mergedData = {
    ...oldUserData,
    ...newUserData,
    lineUserId: profile.userId,
    lineDisplayName: profile.displayName,
    isLineUser: true,
    prevIds: prevIds, // 統合元のIDを記録
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  batch.set(newUserRef, mergedData, { merge: true });

  // --- サブコレクションの移行 ---
  const subCollections = ["visitHistory", "gallery", "messageLogs"];
  for (const subCollName of subCollections) {
    const subSnap = await oldUserRef.collection(subCollName).get();
    subSnap.forEach((doc) => {
      const newSubDocRef = newUserRef.collection(subCollName).doc(doc.id);
      batch.set(newSubDocRef, doc.data());
      batch.delete(doc.ref);
    });
  }

  // --- 関連コレクションの顧客ID更新 (予約・売上) ---
  const relatedCollections = ["reservations", "sales"];
  for (const collName of relatedCollections) {
    const q = await db.collection(collName).where("customerId", "==", oldUserId).get();
    q.forEach((doc) => {
      batch.update(doc.ref, {
        customerId: newUserId,
        isLineUser: true // 管理画面でのLINEアイコン表示のため
      });
    });
  }

  // Cleanup old data
  batch.delete(oldUserRef);
  await batch.commit();
  return { success: true };
});

// --- 4. sendPushMessage ---
exports.sendPushMessage = functionsV1.region("asia-northeast1").https.onCall(async (data, context) => {
  if (!context.auth) throw new functionsV1.https.HttpsError("unauthenticated", "Auth required.");
  const { customerId, text } = data;
  const db = admin.firestore();
  const userDoc = await db.doc(`users/${customerId}`).get();
  const lineUserId = userDoc.data()?.lineUserId;
  if (!lineUserId) throw new HttpsError("failed-precondition", "No LINE ID.");

  const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: lineUserId,
    messages: [{ type: "text", text: text }],
  }, {
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
  });
  return { success: true };
});

exports.analyzeHairstyle = functionsV1.region("asia-northeast1").runWith({ timeoutSeconds: 540, memory: "2GB" }).https.onRequest(withCors(async (req, res) => {
  // AI Matching Controller Import (Lazy load)
  const { analyzeHairstyleController } = require("./src/controllers/aiMatching");
  await analyzeHairstyleController(req, res, {
    apiKey: GEMINI_API_KEY,
  });
}));

// --- onCall Versions (for httpsCallable) ---

exports.analyzeHairstyleCall = onCall({ timeoutSeconds: 540, memory: "2GiB" }, async (request) => {
  const { analyzeHairstyleController } = require("./src/controllers/aiMatching");
  // Mock req/res for controller compatibility
  let result = null;
  const req = { body: request.data, method: "POST" };
  const res = {
    status: (code) => ({
      json: (data) => {
        result = { status: code, ...data }; return res;
      },
      send: (data) => {
        result = { status: code, body: data }; return res;
      },
    }),
  };
  await analyzeHairstyleController(req, res, { apiKey: GEMINI_API_KEY });
  if (result && result.status >= 400) {
    throw new HttpsError("internal", result.message || "AI Analysis failed", result);
  }
  return result;
});

exports.notifyAdminOnPhotoUpload = functionsV1.region("asia-northeast1").firestore.document("users/{userId}/gallery/{photoId}").onCreate(async (snap, context) => {
  if (!snap) return null;
  const newData = snap.data();

  // ユーザーの手動アップロード以外は通知しない（isUserUploadフラグがない場合は無視）
  if (!newData.isUserUpload) return null;

  // 管理者が同期した写真は通知しない(念のため既存ロジックも維持)
  if (newData.isSyncedPhoto) return null;

  const db = admin.firestore();
  const userDoc = await db.collection("users").doc(context.params.userId).get();
  const userName = userDoc.data()?.name || "お客様";
  const adminIds = (ADMIN_LINE_USER_IDS.value() || "").split(",").filter(id => id);
  const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();

  if (adminIds.length > 0 && channelAccessToken) {
    await axios.post("https://api.line.me/v2/bot/message/multicast", {
      to: adminIds,
      messages: [{ type: "text", text: `${userName}様から画像アップロードがありました` }],
    }, {
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
    });
  }
  return null;
});

exports.createFirebaseCustomTokenV2 = functionsV1.region("asia-northeast1").runWith({ timeoutSeconds: 300, memory: "1GB" }).https.onRequest(withCors(async (req, res) => {
  await createFirebaseCustomTokenController(req, res, { auth: auth });
}));

// onCall versions for integrated AI functions
exports.requestDiagnosisCall = functionsV1.region("asia-northeast1").runWith({ timeoutSeconds: 540, memory: "4GB" }).https.onCall(async (data, context) => {
  let result = null;
  const req = { body: data, method: "POST" };
  const res = {
    status: (code) => ({
      json: (data) => {
        result = { status: code, ...data }; return res;
      },
      send: (data) => {
        result = { status: code, body: data }; return res;
      },
    }),
  };
  await requestDiagnosisController(req, res, { llmApiKey: GEMINI_API_KEY });
  if (result && result.status >= 400) throw new HttpsError("internal", result.message || "Diagnosis failed", result);
  return result;
});

exports.generateHairstyleImageCall = functionsV1.region("asia-northeast1").runWith({ timeoutSeconds: 540, memory: "2GB" }).https.onCall(async (data, context) => {
  let result = null;
  const req = { body: data, method: "POST" };
  const res = {
    status: (code) => ({
      json: (data) => {
        result = { status: code, ...data }; return res;
      },
      send: (data) => {
        result = { status: code, body: data }; return res;
      },
    }),
  };
  await generateHairstyleImageController(req, res, {
    imageGenApiKey: GEMINI_API_KEY,
    storage: storage,
    defaultBucketName: defaultBucketName,
  });
  if (result && result.status >= 400) throw new HttpsError("internal", result.message || "Generation failed", result);
  return result;
});

exports.refineHairstyleImageCall = functionsV1.region("asia-northeast1").runWith({ timeoutSeconds: 540, memory: "2GB" }).https.onCall(async (data, context) => {
  let result = null;
  const req = { body: data, method: "POST" };
  const res = {
    status: (code) => ({
      json: (data) => {
        result = { status: code, ...data }; return res;
      },
      send: (data) => {
        result = { status: code, body: data }; return res;
      },
    }),
  };
  await refineHairstyleImageController(req, res, {
    imageGenApiKey: GEMINI_API_KEY,
    storage: storage,
    defaultBucketName: defaultBucketName,
  });
  if (result && result.status >= 400) throw new HttpsError("internal", result.message || "Refinement failed", result);
  return result;
});

exports.createFirebaseCustomTokenCall = functionsV1.region("asia-northeast1").https.onCall(async (data, context) => {
  let result = null;
  const req = { body: data, method: "POST" };
  const res = {
    status: (code) => ({
      json: (data) => {
        result = { status: code, ...data }; return res;
      },
      send: (data) => {
        result = { status: code, body: data }; return res;
      },
    }),
  };
  await createFirebaseCustomTokenController(req, res, { auth: auth });
  if (result && result.status >= 400) throw new HttpsError("unauthenticated", result.message || "Auth failed", result);
  return result;
});

exports.analyzeTrendsCall = functionsV1.region("asia-northeast1").runWith({ timeoutSeconds: 540, memory: "2GB" }).https.onCall(async (data, context) => {
  let result = null;
  const req = { body: data, method: "POST" };
  const res = {
    status: (code) => ({
      json: (data) => {
        result = { status: code, ...data }; return res;
      },
      send: (data) => {
        result = { status: code, body: data }; return res;
      },
    }),
  };
  await analyzeTrendsController(req, res, { imageGenApiKey: GEMINI_API_KEY });
  if (result && result.status >= 400) throw new HttpsError("internal", result.message || "Trend analysis failed", result);
  return result;
});

// --- Error Monitoring & Dashboard ---
const { getRecentErrors, getErrorStats } = require("./src/utils/errorMonitor");

/**
 * 最近のエラーログを取得（管理者のみ）
 */
exports.getErrorLogs = functionsV1.region("asia-northeast1").https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.token.admin) {
    throw new functionsV1.https.HttpsError("permission-denied", "Admin only.");
  }
  const days = data.days || 7;
  const errors = await getRecentErrors(days);
  return { success: true, count: errors.length, errors: errors };
});

/**
 * エラー統計を取得（管理者のみ）
 */
exports.getErrorStats = functionsV1.region("asia-northeast1").https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.token.admin) {
    throw new functionsV1.https.HttpsError("permission-denied", "Admin only.");
  }
  const days = data.days || 7;
  const stats = await getErrorStats(days);
  return { success: true, stats: stats };
});

// --- 5. Scheduled Tasks ---
const {
  sendScheduledPaymentMessages,
  sendScheduledBirthdayMessages,
  sendScheduledCycleAlerts
} = require("./src/controllers/scheduledMessages");

/**
 * 毎日 20:00 に実行 (会計後のサンクスメッセージ)
 */
exports.scheduledPaymentThanks = functionsV1.region("asia-northeast1").pubsub
  .schedule("0 20 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async (context) => {
    const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
    await sendScheduledPaymentMessages(context, {
      lineChannelAccessToken: channelAccessToken
    });
    return null;
  });

/**
 * 毎月 1日 09:00 に実行 (誕生月メッセージ)
 */
exports.scheduledBirthday = functionsV1.region("asia-northeast1").pubsub
  .schedule("0 9 1 * *")
  .timeZone("Asia/Tokyo")
  .onRun(async (context) => {
    const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
    await sendScheduledBirthdayMessages(context, {
      lineChannelAccessToken: channelAccessToken
    });
    return null;
  });

/**
 * 毎日 10:00 に実行 (来店周期リマインド)
 */
exports.scheduledCycleAlert = functionsV1.region("asia-northeast1").pubsub
  .schedule("0 10 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async (context) => {
    const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
    await sendScheduledCycleAlerts(context, {
      lineChannelAccessToken: channelAccessToken
    });
    return null;
  });

