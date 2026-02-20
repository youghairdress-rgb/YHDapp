# 🚨 エラー監視システム - 使い方ガイド

## **概要**

YHDapp に自動エラー監視システムを導入しました。  
バグやエラーが発生すると、以下の処理が自動実行されます：

```
1. エラー発生 (Cloud Functions)
   ↓
2. エラー内容をログに記録 (Firestore)
   ↓
3. 重要度に応じて LINE で管理者に通知
   ↓
4. 管理画面でダッシュボード確認
```

---

## **📱 LINE 通知について**

### **通知内容**

| 重要度 | アイコン | 意味 | LINE通知 |
|--------|---------|------|---------|
| 🚨 CRITICAL | 🚨 | 認証失敗・セキュリティ問題 | **即座に通知** |
| ⚠️ HIGH | ⚠️ | API失敗・接続エラー | **即座に通知** |
| ⚡ MEDIUM | ⚡ | バリデーション・入力エラー | **即座に通知** |
| ℹ️ LOW | ℹ️ | 軽微なエラー | **通知しない** |

### **通知例**

```
🚨 エラー検出【HIGH】

関数: requestDiagnosis
時刻: 2026/02/20 14:30:45
メッセージ: Gemini API returned HTTP 500
ユーザー: user_2026xyz

詳細はダッシュボードで確認してください。
```

---

## **📊 管理画面でのエラー監視**

### **アクセス方法**

1. **管理画面** → **Salon** (右上の⚙️ボタン or メニュー)
2. ページを開くと、自動的に **🚨 エラー監視ダッシュボード** が表示
3. 最新のエラーが自動更新される（5分ごと）

### **ダッシュボード構成**

#### **1️⃣ エラー統計（上部）**

```
🚨 Critical: 2     ⚠️ High: 5     ⚡ Medium: 12     ℹ️ Total: 19
```

各重要度別のエラー数を一目で確認。

#### **2️⃣ 関数別エラー統計（中部）**

```
requestDiagnosis       7件
generateHairstyleImage 5件
createFirebaseCustomToken 4件
...
```

どの機能が問題なのかを特定。

#### **3️⃣ 最近のエラーログ（下部）**

| 時刻 | 重要度 | 関数名 | メッセージ | ユーザー |
|------|--------|-----------|-----------|----------|
| 2026/02/20 14:30 | 🚨 CRITICAL | requestDiagnosis | Gemini API Error | user_xyz |
| 2026/02/20 13:15 | ⚠️ HIGH | ... | ... | ... |

---

## **🔧 活用シーン**

### **シーン 1: AI診断で「エラーが出ている」という報告を受けた**

1. LINE通知が来ている
2. **Salon** → エラーダッシュボード を開く
3. `requestDiagnosis` のエラーを確認
4. エラーメッセージから原因を特定
   - `Timeout` → 処理時間が長い、画像が大きい
   - `Gemini API Error` → API側の問題
   - `File Fetch Error` → ネットワーク問題

### **シーン 2: 予約の確認メッセージが送信されない**

1. LINE通知を確認
2. **Salon** → エラーダッシュボード
3. `sendBookingConfirmation` や `sendPushMessage` のエラーを確認
4. LINE Channel Access Token の有効期限をチェック

### **シーン 3: 定期的にヘルスチェック**

毎週月曜朝に、以下を確認：

```
□ エラーダッシュボードを開く
□ CRITICAL が 0 か確認
□ HIGH が 5 以下か確認
□ 過去7日間の傾向を確認
```

---

## **🔍 エラーログの詳細確認方法**

### **Firestore コンソールでの確認**

アドバンスユーザー向け：

```
Firebase Console
 → Firestore Database
 → Collections
 → error_logs
```

各エラーログに以下の情報を保有：

```json
{
  "timestamp": "2026-02-20T14:30:45Z",
  "severity": "HIGH",
  "functionName": "requestDiagnosis",
  "errorMessage": "Gemini API returned HTTP 500",
  "errorStack": "...",
  "status": 500,
  "userId": "user_2026xyz",
  "customerId": "cust_abc123",
  "context": {
    "stage": "GEMINI_API_CALL",
    "gender": "female",
    "model": "gemini-2.5-flash-preview"
  }
}
```

---

## **⚙️ 設定・カスタマイズ**

### **通知対象を追加**

複数の管理者に通知したい場合：

```
Firebase → Cloud Functions → 環境変数
ADMIN_LINE_USER_IDS = "U123abc,U456def,U789ghi"
                      (複数IDをカンマ区切り)
```

### **通知範囲を変更**

`errorMonitor.js` の `getErrorSeverity()` 関数を編集：

```javascript
// 例: LOW も通知したい場合
if (severity === 'LOW') {
    // return; // ← コメントアウト
    // 通知処理が実行される
}
```

### **自動更新の間隔**

settings.html 内：

```javascript
startAutoRefresh(300);  // 300秒 = 5分ごと
                        // 60に変更すれば1分ごと
```

---

## **📋 トラブルシューティング**

### **Q: LINE通知が来ない**

**A: 以下をチェック**

1. Cloud Functions のログを確認
   ```
   Firebase Console → Functions → Logs
   ```

2. LINE Messaging API の設定確認
   ```
   settings.html のレイアウトからLINE設定ページへ
   ```

3. 管理者LINE IDが正しいか確認
   ```
   Cloud Functions → 環境変数 → ADMIN_LINE_USER_IDS
   ```

### **Q: エラーログが増え続けている**

**A: 原因調査方法**

1. **責任関数を特定** → エラーダッシュボード → 関数別統計
2. **エラーメッセージを分析**
   - 同じメッセージが繰り返す→単一の大問題
   - バラバラ→複数の小問題

3. **Cloud Functions ログで詳細確認**
   ```
   詳細検索で functionName:"requestDiagnosis" など
   ```

### **Q: ダッシュボードが表示されない**

**A: 確認事項**

1. 管理者権限があるか確認
2. ブラウザのコンソール (F12) でエラー確認
3. Firebase Auth のトークン有効期限確認

---

## **🛡️ セキュリティ**

### **管理者のみアクセス可能**

- エラーダッシュボード API は **Firebase Auth** で保護
- 管理者フラグ（`admin: true`）を持つユーザーのみ表示

### **個人情報の保護**

エラーログには以下を含まない：
- ❌ パスワード
- ❌ APIキー
- ❌ 決済情報

---

## **📞 サポート**

### **ヘルプが必要な場合**

1. **LINE** で管理者に連絡
2. **エラーダッシュボード** のスクリーンショット共有
3. 発生時刻・ユーザー情報を記載

---

## **ロードマップ**

- ✅ 実装完了: 基本的なエラー検出 & LINE通知
- 📅 検討中: メール通知、Slack連携
- 📅 検討中: エラー自動修正（リトライ）
- 📅 検討中: AI による原因分析

---

**最終更新**: 2026年2月20日  
**バージョン**: 1.0
