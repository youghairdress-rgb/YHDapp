const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");

/**
 * 毎日 20:00 に実行される会計後の自動送信処理
 */
async function sendScheduledPaymentMessages(event, dependencies) {
    const { lineChannelAccessToken } = dependencies;
    const db = admin.firestore();

    // 1. 今日の日付範囲を取得 (JST)
    const now = new Date();
    const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const startOfDay = new Date(jstNow);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(jstNow);
    endOfDay.setHours(23, 59, 59, 999);

    // 2. 本日の会計データを取得
    const salesSnapshot = await db.collection("sales")
        .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(new Date(startOfDay.getTime() - (9 * 60 * 60 * 1000))))
        .where("createdAt", "<=", admin.firestore.Timestamp.fromDate(new Date(endOfDay.getTime() - (9 * 60 * 60 * 1000))))
        .get();

    if (salesSnapshot.empty) {
        logger.info("No sales found today.");
        return null;
    }

    // 3. メッセージテンプレートを取得
    const templatesSnap = await db.collection("messageTemplates")
        .where("triggerType", "==", "payment_after")
        .limit(1)
        .get();

    if (templatesSnap.empty) {
        logger.warn("No 'payment_after' template found.");
        return null;
    }
    const template = templatesSnap.docs[0].data();

    // 4. 各会計データに対して送信判定
    for (const saleDoc of salesSnapshot.docs) {
        const sale = saleDoc.data();
        const customerId = sale.customerId;
        if (!customerId) continue;

        // 顧客設定を確認
        const userDoc = await db.doc(`users/${customerId}`).get();
        const userData = userDoc.data();

        if (userData?.triggerSettings?.payment_after_enabled && userData.lineUserId) {
            // 送信済みチェック (二重送信防止)
            const logId = `payment_after_${saleDoc.id}`;
            const logRef = db.doc(`users/${customerId}/messageLogs/${logId}`);
            const logSnap = await logRef.get();
            if (logSnap.exists) continue;

            // 文言作成
            let body = template.body;
            body = body.replace(/{顧客名}/g, userData.name || "お客様");
            const visitDateStr = sale.createdAt.toDate().toLocaleDateString("ja-JP");
            body = body.replace(/{来店日}/g, visitDateStr);
            const menuNames = sale.menus ? sale.menus.map(m => m.name).join("＋") : "";
            body = body.replace(/{メニュー}/g, menuNames);

            // LINE送信
            try {
                await axios.post("https://api.line.me/v2/bot/message/push", {
                    to: userData.lineUserId,
                    messages: [{ type: "text", text: body }],
                }, {
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${lineChannelAccessToken}`
                    },
                });

                // ログ保存
                await logRef.set({
                    sentAt: admin.firestore.FieldValue.serverTimestamp(),
                    title: template.title,
                    body: body,
                    triggerType: "payment_after",
                    saleId: saleDoc.id
                });
                logger.info(`Sent payment_after message to ${userData.name}`);
            } catch (err) {
                logger.error(`Failed to send message to ${customerId}:`, err.message);
            }
        }
    }
    return null;
}

/**
 * 毎月 1日 09:00 に実行される誕生月メッセージ
 */
async function sendScheduledBirthdayMessages(event, dependencies) {
    const { lineChannelAccessToken } = dependencies;
    const db = admin.firestore();

    // 今月 (1-12)
    const nowJst = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
    const currentMonth = nowJst.getMonth() + 1;

    // 1. テンプレート取得
    const templatesSnap = await db.collection("messageTemplates")
        .where("triggerType", "==", "birthday_month")
        .limit(1)
        .get();

    if (templatesSnap.empty) return null;
    const template = templatesSnap.docs[0].data();

    // 2. 今月が誕生月のユーザーを取得
    // ※ ユーザーデータに birthdayMonth (数値) が保存されている前提
    const usersSnapshot = await db.collection("users")
        .where("triggerSettings.birthday_enabled", "==", true)
        .where("birthdayMonth", "==", currentMonth)
        .get();

    for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        if (!userData.lineUserId) continue;

        // 今月の送信済みチェック
        const yearMonth = `${nowJst.getFullYear()}-${currentMonth}`;
        const logId = `birthday_${yearMonth}`;
        const logRef = db.doc(`users/${userDoc.id}/messageLogs/${logId}`);
        const logSnap = await logRef.get();
        if (logSnap.exists) continue;

        let body = template.body.replace(/{顧客名}/g, userData.name || "お客様");

        try {
            await axios.post("https://api.line.me/v2/bot/message/push", {
                to: userData.lineUserId,
                messages: [{ type: "text", text: body }],
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${lineChannelAccessToken}`
                },
            });

            await logRef.set({
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                title: template.title,
                body: body,
                triggerType: "birthday_month"
            });
        } catch (err) {
            logger.error(`Birthday message failed for ${userDoc.id}:`, err.message);
        }
    }
    return null;
}

/**
 * 毎日 10:00 に実行される来店周期リマインド
 */
async function sendScheduledCycleAlerts(event, dependencies) {
    const { lineChannelAccessToken } = dependencies;
    const db = admin.firestore();

    // 1. テンプレート取得 (トリガー設定日数が異なる可能性もあるが、まずは一意のテンプレートを想定)
    const templatesSnap = await db.collection("messageTemplates")
        .where("triggerType", "==", "visit_cycle")
        .get();

    if (templatesSnap.empty) return null;
    const templates = templatesSnap.docs.map(d => d.data());

    // 2. 来店周期リマインドが有効なユーザーを取得
    const usersSnapshot = await db.collection("users")
        .where("triggerSettings.cycle_alert_enabled", "==", true)
        .get();

    const nowJst = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
    nowJst.setHours(0, 0, 0, 0);

    for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        if (!userData.lineUserId || !userData.lastVisit) continue;

        const lastVisitDate = userData.lastVisit.toDate();
        const jstLastVisit = new Date(lastVisitDate.getTime() + (9 * 60 * 60 * 1000));
        jstLastVisit.setHours(0, 0, 0, 0);

        const diffTime = nowJst - jstLastVisit;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        // 3. ユーザーの条件に合致するテンプレートを探す
        // 各テンプレートには triggerValue (日数) が入っている
        const targetTemplate = templates.find(t => t.triggerValue === diffDays);

        if (targetTemplate) {
            // 当該日数の送信済みチェック
            const logId = `cycle_${diffDays}_${jstLastVisit.getTime()}`;
            const logRef = db.doc(`users/${userDoc.id}/messageLogs/${logId}`);
            const logSnap = await logRef.get();
            if (logSnap.exists) continue;

            let body = targetTemplate.body;
            body = body.replace(/{顧客名}/g, userData.name || "お客様");
            body = body.replace(/{前回来店日}/g, jstLastVisit.toLocaleDateString("ja-JP"));

            try {
                await axios.post("https://api.line.me/v2/bot/message/push", {
                    to: userData.lineUserId,
                    messages: [{ type: "text", text: body }],
                }, {
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${lineChannelAccessToken}`
                    },
                });

                await logRef.set({
                    sentAt: admin.firestore.FieldValue.serverTimestamp(),
                    title: targetTemplate.title,
                    body: body,
                    triggerValue: diffDays,
                    triggerType: "visit_cycle"
                });
            } catch (err) {
                logger.error(`Cycle alert failed for ${userDoc.id}:`, err.message);
            }
        }
    }
    return null;
}

module.exports = {
    sendScheduledPaymentMessages,
    sendScheduledBirthdayMessages,
    sendScheduledCycleAlerts
};
