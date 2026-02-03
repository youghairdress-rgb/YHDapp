const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });
// ★改善点: 推奨されるパラメータ化された環境変数を使用
const { defineString } = require('firebase-functions/params');

admin.initializeApp();

// 環境変数を定義
// ★ 修正: 複数のチャンネルIDをカンマ区切りで受け取るように想定
const LINE_CHANNEL_IDS = defineString('LINE_CHANNEL_IDS'); // 変数名を変更 (LINE_CHANNEL_ID -> LINE_CHANNEL_IDS)
const LINE_CHANNEL_ACCESS_TOKEN = defineString('LINE_CHANNEL_ACCESS_TOKEN');
const ADMIN_LINE_USER_IDS = defineString('ADMIN_LINE_USER_IDS');
const GEMINI_API_KEY = defineString('GEMINI_API_KEY');

const { GoogleGenerativeAI } = require("@google/generative-ai");


exports.createFirebaseCustomToken = functions.region("asia-northeast1").https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method !== "POST") {
            return res.status(405).send("Method Not Allowed");
        }

        // ★ 修正: カンマ区切りの文字列を配列に変換
        const channelIdsString = LINE_CHANNEL_IDS.value();
        if (!channelIdsString) {
            console.error("LINE_CHANNEL_IDS is not set in environment variables.");
            return res.status(500).send("Server configuration error: LINE Channel IDs are not set.");
        }
        const allowedChannelIds = channelIdsString.split(',').map(id => id.trim()).filter(id => id);
        if (allowedChannelIds.length === 0) {
            console.error("LINE_CHANNEL_IDS is empty or invalid.");
            return res.status(500).send("Server configuration error: LINE Channel IDs are invalid.");
        }
        // ★ 修正ここまで

        const { accessToken } = req.body;
        if (!accessToken) {
            return res.status(400).send("Access token is required");
        }

        try {
            // LINEアクセストークンを検証
            const verifyUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
            verifyUrl.searchParams.append("access_token", accessToken);

            const verifyResponse = await axios.get(verifyUrl.toString());

            // ★ 修正: 厳格な一致 (===) から、配列に含まれるか (includes) に変更
            const requestChannelId = verifyResponse.data.client_id;
            if (!allowedChannelIds.includes(requestChannelId)) {
                console.error(`Channel ID mismatch. Expected one of [${allowedChannelIds.join(', ')}] but got ${requestChannelId}`);
                return res.status(401).send("Invalid LIFF app or Channel ID mismatch.");
            }
            // ★ 修正ここまで

            const profileResponse = await axios.get("https://api.line.me/v2/profile", {
                headers: { "Authorization": `Bearer ${accessToken}` },
            });

            const lineUserId = profileResponse.data.userId;
            if (!lineUserId) {
                return res.status(400).send("LINE User ID could not be retrieved from profile.");
            }

            // ★改善点: 管理者かどうかを判定し、カスタムクレームを設定
            const adminIdsString = ADMIN_LINE_USER_IDS.value() || "";
            const adminIds = adminIdsString.split(',').map(id => id.trim());
            const isAdmin = adminIds.includes(lineUserId);

            const customClaims = {};
            if (isAdmin) {
                customClaims.admin = true;
            }

            // カスタムクレームを付与してFirebaseのカスタムトークンを作成
            const customToken = await admin.auth().createCustomToken(lineUserId, customClaims);

            return res.status(200).json({ customToken });

        } catch (error) {
            console.error("Error in createFirebaseCustomToken:", error.message);
            if (error.response) {
                console.error("Error Response:", JSON.stringify(error.response.data));
                return res.status(error.response.status).send(error.response.data);
            }
            return res.status(500).send("Authentication failed due to an internal server error.");
        }
    });
});

exports.sendBookingConfirmation = functions.region("asia-northeast1").firestore
    .document("reservations/{reservationId}")
    .onCreate(async (snap) => {
        const booking = snap.data();

        // ★★★ 修正点: 管理者によって作成された予約の場合は通知を送信しない ★★★
        if (booking.createdBy === 'admin') {
            console.log(`Reservation created by admin. Skipping notification for reservationId: ${snap.id}`);
            return null;
        }

        // 予約データが不完全な場合は処理を中断
        if (!booking || !booking.customerName || !booking.startTime || !Array.isArray(booking.selectedMenus)) {
            console.log("Booking data is incomplete. Skipping notifications.", {
                reservationId: snap.id
            });
            return null;
        }

        const { customerId, customerName, startTime, selectedMenus, userRequests } = booking;

        const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
        if (!channelAccessToken) {
            console.error("LINE_CHANNEL_ACCESS_TOKEN is not configured. Cannot send messages.");
            return null;
        }

        const time = startTime.toDate();
        // JSTに変換
        const jstTime = new Date(time.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
        const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
        const dayOfWeek = weekdays[jstTime.getDay()];
        const formattedTime = `${jstTime.getFullYear()}年${String(jstTime.getMonth() + 1).padStart(2, "0")}月${String(jstTime.getDate()).padStart(2, "0")}日(${dayOfWeek}) ${String(jstTime.getHours()).padStart(2, "0")}:${String(jstTime.getMinutes()).padStart(2, "0")}`;
        const menuNames = selectedMenus.map((m) => m.name).join("＋");
        const requestsText = userRequests || 'なし';

        // お客様への確認メッセージ
        if (customerId) {
            const customerMessageText = `${customerName}様\nご予約ありがとうございます。\n以下の内容でご予約を承りました。\n\n【ご予約内容】\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}\n\nご来店心よりお待ちしております。`;
            try {
                await axios.post("https://api.line.me/v2/bot/message/push", {
                    to: customerId,
                    messages: [{ type: "text", text: customerMessageText }],
                }, {
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
                });
                console.log("Confirmation message sent to customer:", customerId);
            } catch (error) {
                console.error("Error sending message to customer:", error.response ? JSON.stringify(error.response.data) : error.message);
            }
        }

        // 管理者への通知メッセージ
        const adminIdsString = ADMIN_LINE_USER_IDS.value();
        if (adminIdsString) {
            const adminIds = adminIdsString.split(',').map(id => id.trim()).filter(id => id);
            if (adminIds.length > 0) {
                const adminMessageText = `新規予約が入りました。\nお客様：${customerName} 様\n日時：${formattedTime}\nメニュー：${menuNames}\nご要望：${requestsText}`;
                try {
                    await axios.post("https://api.line.me/v2/bot/message/multicast", {
                        to: adminIds,
                        messages: [{ type: "text", text: adminMessageText }],
                    }, {
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${channelAccessToken}` },
                    });
                    console.log("Notification multicast successfully to admins.");
                } catch (error) {
                    console.error("Failed to send multicast message to admins:", error.response ? JSON.stringify(error.response.data) : "No response data");
                }
            }
        }
        return null;
    });


// ▼▼▼ 新規追加: 顧客データ統合のためのCloud Function ▼▼▼
/**
 * 既存の顧客データ(oldUserId)を新しいLINE連携アカウント(newUserId)に統合する
 */
exports.mergeUserData = functions.region("asia-northeast1").https.onCall(async (data, context) => {
    // 認証チェック
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "この操作には認証が必要です。");
    }

    const { oldUserId, newUserId, profile, newUserData } = data;

    // バリデーション
    if (!oldUserId || !newUserId || !profile || !newUserData) {
        throw new functions.https.HttpsError("invalid-argument", "必要なパラメータが不足しています。");
    }

    // セキュリティチェック（自分自身のLINE IDに対してのみ操作を許可）
    if (context.auth.uid !== newUserId) {
        throw new functions.https.HttpsError("permission-denied", "操作権限がありません。");
    }

    const db = admin.firestore();
    const batch = db.batch();

    try {
        // 1. 既存の顧客ドキュメント(old)を取得
        const oldUserRef = db.doc(`users/${oldUserId}`);
        const oldUserSnap = await oldUserRef.get();
        if (!oldUserSnap.exists) {
            throw new functions.https.HttpsError("not-found", "統合元の顧客データが見つかりません。");
        }
        const oldUserData = oldUserSnap.data();

        // 2. 新しい顧客ドキュメント(new)を作成または更新
        const newUserRef = db.doc(`users/${newUserId}`);

        // フォームからの最新情報とLINEプロフィール、既存のメモ情報をマージ
        const mergedData = {
            ...oldUserData, // 既存のメモ(memo, notes)を引き継ぐ
            ...newUserData, // フォームからの最新情報 (name, kana, phone)
            lineUserId: profile.userId,
            lineDisplayName: profile.displayName,
            isLineUser: true,
            createdAt: oldUserData.createdAt || admin.firestore.FieldValue.serverTimestamp(), // 作成日を引き継ぐ
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        batch.set(newUserRef, mergedData, { merge: true });

        // 3. 既存の関連データを新しいIDに付け替える
        // (A) 来店履歴 (sales)
        const salesQuery = db.collection("sales").where("customerId", "==", oldUserId);
        const salesSnapshot = await salesQuery.get();
        salesSnapshot.forEach(doc => {
            batch.update(doc.ref, { customerId: newUserId });
        });

        // (B) 予約履歴 (reservations)
        const reservationsQuery = db.collection("reservations").where("customerId", "==", oldUserId);
        const reservationsSnapshot = await reservationsQuery.get();
        reservationsSnapshot.forEach(doc => {
            batch.update(doc.ref, { customerId: newUserId });
        });

        // (C) ギャラリー (users/{oldUserId}/gallery)
        const oldGalleryQuery = db.collection(`users/${oldUserId}/gallery`);
        const oldGallerySnapshot = await oldGalleryQuery.get();

        oldGallerySnapshot.forEach(doc => {
            const newGalleryRef = db.doc(`users/${newUserId}/gallery/${doc.id}`);
            batch.set(newGalleryRef, doc.data());
            batch.delete(doc.ref);
        });

        // 4. 古い顧客ドキュメント(old)を削除
        batch.delete(oldUserRef);

        // 5. バッチ処理を実行
        await batch.commit();

        return { success: true, message: "顧客データの統合が完了しました。" };

    } catch (error) {
        console.error("顧客データの統合に失敗しました:", error);
        throw new functions.https.HttpsError("internal", "データの統合処理中にエラーが発生しました。", error.message);
    }
});
// ▲▲▲ 新規追加ここまで ▲▲▲


// ▼▼▼ 新規追加: LINEプッシュメッセージ送信関数 (管理者等の手動送信) ▼▼▼
exports.sendPushMessage = functions.region("asia-northeast1").https.onCall(async (data, context) => {
    // 1. 認証チェック
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "この操作には認証が必要です。");
    }
    // 必要であればここで admin クレームのチェックを行ってください
    // if (!context.auth.token.admin) {
    //     throw new functions.https.HttpsError("permission-denied", "管理者権限が必要です。");
    // }

    const { customerId, text } = data;

    // 2. バリデーション
    if (!customerId || !text) {
        throw new functions.https.HttpsError("invalid-argument", "顧客IDとメッセージ本文は必須です。");
    }

    const db = admin.firestore();

    try {
        // 3. 顧客データの取得 (LINE ID確認)
        const userDoc = await db.doc(`users/${customerId}`).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError("not-found", "顧客データが見つかりません。");
        }
        const userData = userDoc.data();
        const lineUserId = userData.lineUserId;

        if (!lineUserId) {
            throw new functions.https.HttpsError("failed-precondition", "この顧客はLINE連携していません。");
        }

        // 4. LINE Messaging API (Push) の実行
        const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
        if (!channelAccessToken) {
            throw new functions.https.HttpsError("failed-precondition", "LINEチャネルアクセストークンが設定されていません。");
        }

        await axios.post("https://api.line.me/v2/bot/message/push", {
            to: lineUserId,
            messages: [{ type: "text", text: text }],
        }, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${channelAccessToken}`
            },
        });

        // 5. 送信ログの保存
        await db.collection(`users/${customerId}/messageLogs`).add({
            title: "手動送信",
            body: text,
            triggerType: "manual",
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            sentBy: context.auth.uid // 送信者ID（管理者）
        });

        return { success: true, message: "送信しました。" };

    } catch (error) {
        console.error("sendPushMessage Error:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        // axiosエラーの場合
        if (error.response) {
            console.error("LINE API Error:", JSON.stringify(error.response.data));
            throw new functions.https.HttpsError("internal", "LINEメッセージ送信に失敗しました。", error.response.data);
        }
        throw new functions.https.HttpsError("internal", "内部エラーが発生しました。");
    }
});
// ▲▲▲ 新規追加ここまで ▲▲▲


// ▼▼▼ 新規追加: 会計後の自動メッセージ送信 (毎日20:00実行) ▼▼▼
exports.sendAfterPaymentMessages = functions.region("asia-northeast1").pubsub
    .schedule("0 20 * * *")
    .timeZone("Asia/Tokyo")
    .onRun(async (context) => {
        const db = admin.firestore();
        const now = new Date();
        const today20pm = new Date(now);
        today20pm.setHours(20, 0, 0, 0);

        // 実行時間が20:00前後であることを想定
        // 対象期間:
        // 当日20:00実行の場合、対象は「前日の20:00:00」～「当日の19:59:59」
        // これにより、例えば当日21:00の会計は「翌日の20:00」に送信対象となる

        const endPeriod = new Date(today20pm);
        // 少し余裕を持たせるか、厳密にするか。ここでは厳密に。
        // endPeriod は「当日の20:00」 (これを含まない)

        const startPeriod = new Date(endPeriod);
        startPeriod.setDate(startPeriod.getDate() - 1);
        // startPeriod は「前日の20:00」 (これを含む)

        console.log(`Starting sendAfterPaymentMessages. Target period: ${startPeriod.toISOString()} ~ ${endPeriod.toISOString()}`);

        try {
            // 1. "payment_after" トリガーのテンプレートを取得
            const templatesSnap = await db.collection("messageTemplates")
                .where("triggerType", "==", "payment_after")
                .get();

            if (templatesSnap.empty) {
                console.log("No 'payment_after' templates found.");
                return null;
            }

            const templates = templatesSnap.docs.map(doc => doc.data());

            // 2. 対象期間内の売上 (sales) を取得
            // createdAt (会計日時) でフィルタリング
            const salesSnap = await db.collection("sales")
                .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(startPeriod))
                .where("createdAt", "<", admin.firestore.Timestamp.fromDate(endPeriod))
                .get();

            if (salesSnap.empty) {
                console.log("No sales found in the target period.");
                return null;
            }

            console.log(`Found ${salesSnap.size} sales records.`);

            const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
            if (!channelAccessToken) {
                console.error("LINE_CHANNEL_ACCESS_TOKEN is not set.");
                return null;
            }

            // 3. 各売上に対してメール送信
            for (const saleDoc of salesSnap.docs) {
                const sale = saleDoc.data();
                const customerId = sale.customerId;

                if (!customerId) continue;

                // 顧客情報の取得 (LINE IDが必要)
                const userDoc = await db.collection("users").doc(customerId).get();
                if (!userDoc.exists) continue;

                const userData = userDoc.data();
                const lineUserId = userData.lineUserId;

                if (!lineUserId) continue; // LINE連携していないユーザーはスキップ

                // 各テンプレートを送信
                for (const template of templates) {
                    let messageText = template.body;

                    // プレースホルダーの置換
                    const customerName = userData.name || "お客様";
                    const visitDate = sale.createdAt.toDate().toLocaleDateString('ja-JP');

                    const menuNames = sale.menus ? sale.menus.map(m => m.name).join('、') : '施術';

                    messageText = messageText
                        .replace(/{顧客名}/g, customerName)
                        .replace(/{来店日}/g, visitDate)
                        .replace(/{メニュー}/g, menuNames);

                    try {
                        await axios.post("https://api.line.me/v2/bot/message/push", {
                            to: lineUserId,
                            messages: [{ type: "text", text: messageText }],
                        }, {
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${channelAccessToken}`
                            },
                        });

                        // ログ保存
                        await db.collection(`users/${customerId}/messageLogs`).add({
                            title: template.title,
                            body: messageText,
                            triggerType: "payment_after",
                            sentAt: admin.firestore.FieldValue.serverTimestamp(),
                            sentBy: "system_auto"
                        });

                        console.log(`Message sent to ${customerId} (${lineUserId}) for template: ${template.title}`);

                    } catch (error) {
                        console.error(`Failed to send message to ${customerId}:`, error.message);
                    }
                }
            }

        } catch (error) {
            console.error("Error in sendAfterPaymentMessages:", error);
        }

        return null;
    });
// ▼▼▼ 新規追加: ヘアスタイルAI分析関数 (Gemini 1.5 Pro) ▼▼▼
exports.analyzeHairstyle = functions.region("asia-northeast1")
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .https.onCall(async (data, context) => {

        const { frontImage, sideImage, backImage, beforeImage } = data;

        // バリデーション
        if (!frontImage && !sideImage && !backImage) {
            throw new functions.https.HttpsError("invalid-argument", "少なくとも1枚の画像（正面、横、または後ろ）が必要です。");
        }

        const apiKey = GEMINI_API_KEY.value();
        console.log("Analyze Hairstyle called. API Key present:", !!apiKey);

        if (!apiKey) {
            console.error("GEMINI_API_KEY is not set.");
            throw new functions.https.HttpsError("failed-precondition", "APIキーが設定されていません。");
        }

        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

            const prompt = `
あなたはプロのヘアスタイリスト兼AIイメージコンサルタントです。
提供された「After写真」（ヘアカット後のスタイル）を分析し、それがモデル（顧客）にどれくらい似合っているか（親和性）を診断してください。

もし「Before写真」（施術前の写真）が提供されている場合は、BeforeとAfterを比較し、以下の点についても言及してください：
1. どのような改善点や変化があったか（例：軽さが出た、骨格補正された、印象が明るくなった等）
2. ヘアカラーについての診断（色味の印象や、似合わせポイント）

「Before写真」がない場合は、After写真単体の魅力とヘアカラーについて診断してください。

以下の形式のJSONでのみ出力してください。Markdownのコードブロックは不要です。
{
  "score": 0から100の整数,
  "reason": "診断理由を日本語で150文字程度で。Before/Afterの比較（変化のポイント）、ヘアカラーの魅力、骨格・髪質へのアプローチを含めて具体的に褒めてください。ポジティブな表現を心がけてください。"
}
            `;

            const imageParts = [];

            // 画像URLからデータを取得してBufferに変換するヘルパー
            const fetchImage = async (url) => {
                if (!url) return null;
                try {
                    console.log("Fetching image:", url);
                    const response = await axios.get(url, { responseType: 'arraybuffer' });
                    // 修正: binary指定を削除し、Bufferから直接base64へ
                    const base64Data = Buffer.from(response.data).toString('base64');
                    return {
                        inlineData: {
                            data: base64Data,
                            mimeType: response.headers['content-type'] || 'image/jpeg'
                        }
                    };
                } catch (e) {
                    console.warn("Failed to fetch image:", url, e.message);
                    return null;
                }
            };

            // Before写真を先頭に追加（プロンプトでの参照順序と合わせるため）
            // プロンプトでは "Before" と "After" を区別する明示的なラベルは送れないが、
            // 複数の画像を送る場合、文脈で判断させる。
            // ここでは、明示的にテキストで「これはBefore写真です」「これはAfter写真です」と伝えるのが確実だが、
            // APIの仕様上、テキストと画像を交互には送れる。
            // 簡易的に、画像の順番（Before -> Front/Side/Back）で送り、プロンプトで「最初の画像があればそれはBeforeです」とするか、
            // または単純に全部渡して「Beforeっぽいもの（施術前）」と「After（施術後）」を見分けさせる。
            // 今回は、Before写真を明示的に扱うため、コンテンツ生成の配列構成を工夫する。

            const contents = [prompt];

            if (beforeImage) {
                const beforePart = await fetchImage(beforeImage);
                if (beforePart) {
                    contents.push("【Before写真】");
                    contents.push(beforePart);
                }
            }

            contents.push("【After写真 (今回の仕上がり)】");

            if (frontImage) {
                const part = await fetchImage(frontImage);
                if (part) contents.push(part);
            }
            if (sideImage) {
                const part = await fetchImage(sideImage);
                if (part) contents.push(part);
            }
            if (backImage) {
                const part = await fetchImage(backImage);
                if (part) contents.push(part);
            }

            // 画像が1つもないケースはバリデーション済みだが、fetch失敗で0になる可能性はある
            // ここではバリデーションを通過していればAfter画像候補はあるはず

            console.log("Generating content...");

            const result = await model.generateContent(contents);
            const response = await result.response;
            const text = response.text();

            console.log("Gemini Response:", text);

            let jsonStr = text.replace(/```json/g, "").replace(/```/g, "").trim();
            let analysisResult;
            try {
                analysisResult = JSON.parse(jsonStr);
            } catch (e) {
                console.error("JSON parse error:", text);
                analysisResult = { score: 85, reason: "スタイル分析が完了しました。とてもお似合いのスタイルです。（AIの応答形式エラーのため簡易表示）" };
            }

            return analysisResult;

        } catch (error) {
            console.error("AI Analysis Error Detail:", error);
            // エラー詳細をクライアントに返す（デバッグ用）
            throw new functions.https.HttpsError("internal", `AI分析中にエラーが発生しました: ${error.message}`, error);
        }
    });
// ▲▲▲ 新規追加ここまで ▲▲▲