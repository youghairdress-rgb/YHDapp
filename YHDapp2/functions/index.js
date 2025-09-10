const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({origin: true});
const axios = require("axios");
// .envファイルを読み込むための設定
require("dotenv").config({path: `.env.${process.env.GCLOUD_PROJECT}`});

// Firebase Admin SDKを一度だけ初期化
admin.initializeApp();
const db = admin.firestore();

/**
 * LINE IDトークンを検証し、LINEユーザーIDを返すヘルパー関数
 * @param {string} idToken - クライアントから受け取ったLINE IDトークン
 * @param {string} liffId - 検証に使用するLIFFチャネルID
 * @returns {Promise<string>} - LINEユーザーID (sub)
 */
const verifyLineToken = async (idToken, liffId) => {
    const cleanLiffId = String(liffId).replace(/"/g, "").trim();
    functions.logger.log(`Attempting token verification with sanitized LIFF ID: [${cleanLiffId}]`);

    if (!idToken) {
        functions.logger.error("ID token provided was null or empty.");
        throw new functions.https.HttpsError("unauthenticated", "ID token is missing.");
    }

    try {
        // ★★★ 修正点: URLSearchParamsを使わず、直接文字列としてリクエストボディを構築 ★★★
        const body = `id_token=${idToken}&client_id=${cleanLiffId}`;
        
        functions.logger.info("Sending verification request to LINE with body:", body);

        const response = await axios.post(
            "https://api.line.me/oauth2/v2.1/verify",
            body, // 文字列のボディを直接渡す
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        functions.logger.log("Token verification successful. LINE User ID (sub):", response.data.sub);
        return response.data.sub;
    } catch (error) {
        functions.logger.error("CRITICAL: LINE token verification API returned an error.", {
            status: error.response?.status,
            headers: error.response?.headers,
            data: error.response?.data,
            message: error.message,
        });
        const errorDescription = error.response?.data?.error_description || "LINE APIとの通信に失敗しました。";
        throw new functions.https.HttpsError("unauthenticated", `認証に失敗しました: ${errorDescription}`);
    }
};


// Express.jsのルーターのように動作するメインのAPI関数
const app = functions.region("asia-northeast1").https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        const path = req.path.split("/api")[1];
        functions.logger.info(`Request received for path: ${path}`);

        // --- 公開エンドポイント (認証不要) ---
        if (path === "/public/config") {
            try {
                res.status(200).json({
                    userLiffId: process.env.LIFF_USER_ID.replace(/"/g, ""),
                    adminLiffId: process.env.LIFF_ADMIN_ID.replace(/"/g, ""),
                });
            } catch (error) {
                functions.logger.error("Error fetching public config:", error);
                res.status(500).send({message: "設定の取得に失敗しました。"});
            }
            return;
        }

        // --- 認証が必要なエンドポイント ---
        if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer ")) {
            return res.status(401).send({message: "認証トークンがありません。"});
        }
        const idToken = req.headers.authorization.split("Bearer ")[1];
        let lineUserId;

        try {
            // --- ユーザー向けエンドポイント ---
            if (path.startsWith("/user")) {
                const liffId = process.env.LIFF_USER_ID;
                lineUserId = await verifyLineToken(idToken, liffId);
                
                if (path === "/user/initialData") {
                    functions.logger.info("Fetching initial data for user...");
                    const menuDoc = await db.collection('artifacts/yhddatebase/public/data/menuData').doc('menus').get();
                    const categoriesDoc = await db.collection('artifacts/yhddatebase/public/data/menuData').doc('categories').get();
                    const settingsDoc = await db.collection('artifacts/yhddatebase/public/data/salonSettings').doc('config').get();
                    const bookingsSnapshot = await db.collection('artifacts/yhddatebase/public/data/bookings').get();
                    const adminBookingData = {};
                    bookingsSnapshot.forEach(doc => {
                        const data = doc.data();
                        const dateStr = data.date;
                        if (!adminBookingData[dateStr]) adminBookingData[dateStr] = [];
                        adminBookingData[dateStr].push(data);
                    });
                    functions.logger.info("Successfully fetched initial data.");
                    return res.status(200).json({
                        menuData: menuDoc.exists() ? menuDoc.data().items : [],
                        menuCategories: categoriesDoc.exists() ? categoriesDoc.data().items : [],
                        salonSettings: settingsDoc.exists() ? settingsDoc.data() : {},
                        adminBookingData: adminBookingData,
                    });
                }
            }

            // --- 管理者向けエンドポイント ---
            else if (path.startsWith("/admin")) {
                const liffId = process.env.LIFF_ADMIN_ID;
                lineUserId = await verifyLineToken(idToken, liffId);
                const adminDoc = await db.collection("admins").doc(lineUserId).get();
                if (!adminDoc.exists) {
                    return res.status(403).send({message: "管理者権限がありません。"});
                }
                // 管理者向けAPIの処理はここに実装
                return res.status(200).send({message: `Welcome Admin User ${lineUserId}`});
            }

            // どのエンドポイントにも一致しなかった場合
            return res.status(404).send({message: `Route ${path} not found.`});

        } catch (error) {
            if (error.code === 'unauthenticated') {
                return res.status(401).send({message: error.message});
            }
            functions.logger.error(`Unhandled error for path: ${path}`, error);
            return res.status(500).send({message: "サーバー内部でエラーが発生しました。"});
        }
    });
});

exports.api = app;

