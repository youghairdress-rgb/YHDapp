/**
 * src/prompts/diagnosisPrompts.js
 *
 * 診断 (フェーズ4) と提案 (フェーズ5) のためのAIプロンプトとスキーマを定義する
 * Phase 4-0 Update: "Clinical Aesthetician" Edition
 * - 美容理論だけでなく、解剖学的・色彩学的な観点を取り入れた分析
 * - Chain-of-Thoughtによる論理的な診断推論
 */

// --- ★ AIレスポンスのJSONスキーマ定義 (変更なし) ★ ---
const AI_RESPONSE_SCHEMA = {
  "type": "OBJECT",
  "properties": {
    "result": {
      "type": "OBJECT",
      "properties": {
        "face": {
          "type": "OBJECT",
          "properties": {
            "nose": {"type": "STRING", "description": "鼻の特徴 (例: 高い, 丸い)"},
            "mouth": {"type": "STRING", "description": "口の特徴 (例: 大きい, 薄い)"},
            "eyes": {"type": "STRING", "description": "目の特徴 (例: 二重, つり目)"},
            "eyebrows": {"type": "STRING", "description": "眉の特徴 (例: アーチ型, 平行)"},
            "forehead": {"type": "STRING", "description": "おでこの特徴 (例: 広い, 狭い)"},
          },
          "required": ["nose", "mouth", "eyes", "eyebrows", "forehead"],
        },
        "skeleton": {
          "type": "OBJECT",
          "properties": {
            "neckLength": {"type": "STRING", "description": "首の長さ。補足説明を入れること (例: 標準(バランスが良い), 長め(すっきり見える))"},
            "faceShape": {"type": "STRING", "description": "顔の形。補足説明を入れること (例: ベース顔(エラ張り気味), 丸顔(曲線的))"},
            "bodyLine": {"type": "STRING", "description": "ボディライン。補足説明を入れること (例: ナチュラル(フレーム感が強い), ウェーブ(曲線的))"},
            "shoulderLine": {"type": "STRING", "description": "肩のライン。補足説明を入れること (例: いかり肩(直線的), なで肩(華奢))"},
            "faceStereoscopy": {"type": "STRING", "description": "顔の立体感。補足説明を入れること (例: 立体的(彫りが深い), 平面的(あっさりした顔立ち))"},
            "bodyTypeFeature": {"type": "STRING", "description": "体型の特徴。詳細な補足を入れること (例: 骨感が目立つ(ナチュラルタイプ), 上半身に厚みがある(ストレートタイプ))"},
          },
          "required": ["neckLength", "faceShape", "bodyLine", "shoulderLine", "faceStereoscopy", "bodyTypeFeature"],
        },
        "personalColor": {
          "type": "OBJECT",
          "properties": {
            "baseColor": {"type": "STRING", "description": "ベースカラー。補足説明を入れること (例: イエローベース(黄み寄り), ブルーベース(青み寄り))"},
            "season": {"type": "STRING", "description": "シーズン。補足説明を入れること (例: オータム(深みのある色が得意))"},
            "brightness": {"type": "STRING", "description": "明度。補足説明を入れること (例: 低明度(暗めの色が似合う))"},
            "saturation": {"type": "STRING", "description": "彩度。補足説明を入れること (例: 中彩度(穏やかな色が似合う))"},
            "eyeColor": {"type": "STRING", "description": "瞳の色。詳細に記述すること (例: 明るい茶色(透明感がある), 黒に近い焦げ茶(印象的))"},
          },
          "required": ["baseColor", "season", "brightness", "saturation", "eyeColor"],
        },
        "hairCondition": {
          "type": "OBJECT",
          "description": "写真（と将来の動画）から分析した現在の髪の状態",
          "properties": {
            "quality": {"type": "STRING", "description": "髪質。補足説明を入れること (例: 硬い(ハリコシがある), 柔らかい(猫っ毛))"},
            "curlType": {"type": "STRING", "description": "クセ。補足説明を入れること (例: 直毛(扱いやすい), 波状毛(うねりがある))"},
            "damageLevel": {"type": "STRING", "description": "ダメージレベル。補足説明を入れること (例: 低(健康的でツヤがある), 中(毛先に乾燥が見られる))"},
            "volume": {"type": "STRING", "description": "毛量。補足説明を入れること (例: 多い(広がりやすい), 普通(適度))"},
            "currentLevel": {"type": "STRING", "description": "現在の明るさ (Tone表記)。色味の補足を入れること (例: Tone 7(落ち着いたブラウン))"},
          },
          "required": ["quality", "curlType", "damageLevel", "volume", "currentLevel"],
        },
      },
      "required": ["face", "skeleton", "personalColor", "hairCondition"],
    },
    "proposal": {
      "type": "OBJECT",
      "properties": {
        "hairstyles": {
          "type": "OBJECT",
          "description": "提案するヘアスタイル2種。キーは 'style1', 'style2' とする。",
          "properties": {
            "style1": {
              "type": "OBJECT",
              "properties": {
                "name": {"type": "STRING", "description": "ヘアスタイルの名前 (例: くびれレイヤーミディ)"},
                "description": {"type": "STRING", "description": "スタイルの説明 (50-100文字程度)"},
              },
              "required": ["name", "description"],
            },
            "style2": {
              "type": "OBJECT",
              "properties": {
                "name": {"type": "STRING", "description": "ヘアスタイルのの名前 (例: シースルーバングショート)"},
                "description": {"type": "STRING", "description": "スタイルの説明 (50-100文字程度)"},
              },
              "required": ["name", "description"],
            },
          },
          "required": ["style1", "style2"],
        },
        "haircolors": {
          "type": "OBJECT",
          "description": "提案するヘアカラー2種。キーは 'color1', 'color2' とする。",
          "properties": {
            "color1": {
              "type": "OBJECT",
              "properties": {
                "name": {"type": "STRING", "description": "ヘアカラーの名前 (例: ラベンダーアッシュ)"},
                "description": {"type": "STRING", "description": "カラーの説明 (トレンドやブリーチ要否を含める)"},
                "recommendedLevel": {"type": "STRING", "description": "詳細なトーンレベルに基づく推奨明るさ (例: トーン11(ライトブラウン～ゴールド))"},
              },
              "required": ["name", "description", "recommendedLevel"],
            },
            "color2": {
              "type": "OBJECT",
              "properties": {
                "name": {"type": "STRING", "description": "ヘアカラーの名前 (例: ピンクベージュ)"},
                "description": {"type": "STRING", "description": "カラーの説明 (トレンドやブリーチ要否を含める)"},
                "recommendedLevel": {"type": "STRING", "description": "詳細なトーンレベルに基づく推奨明るさ (例: トーン13(ブライトゴールド))"},
              },
              "required": ["name", "description", "recommendedLevel"],
            },
          },
          "required": ["color1", "color2"],
        },
        "bestColors": {
          "type": "OBJECT",
          "description": "パーソナルカラーに基づいた相性の良いカラー4種。キーは 'c1' から 'c4'。",
          "properties": {
            "c1": {"type": "OBJECT", "properties": {"name": {"type": "STRING"}, "hex": {"type": "STRING", "description": "例: #FFB6C1"}}, "required": ["name", "hex"]},
            "c2": {"type": "OBJECT", "properties": {"name": {"type": "STRING"}, "hex": {"type": "STRING", "description": "例: #FFDAB9"}}, "required": ["name", "hex"]},
            "c3": {"type": "OBJECT", "properties": {"name": {"type": "STRING"}, "hex": {"type": "STRING", "description": "例: #E6E6FA"}}, "required": ["name", "hex"]},
            "c4": {"type": "OBJECT", "properties": {"name": {"type": "STRING"}, "hex": {"type": "STRING", "description": "例: #98FB98"}}, "required": ["name", "hex"]},
          },
          "required": ["c1", "c2", "c3", "c4"],
        },
        "makeup": {
          "type": "OBJECT",
          "description": "パーソナルカラーに基づいた似合うメイク提案",
          "properties": {
            "eyeshadow": {"type": "STRING", "description": "アイシャドウの色 (例: ゴールド系ブラウン)"},
            "cheek": {"type": "STRING", "description": "チークの色 (例: ピーチピンク)"},
            "lip": {"type": "STRING", "description": "リップの色 (例: コーラルレッド)"},
          },
          "required": ["eyeshadow", "cheek", "lip"],
        },
        "fashion": {
          "type": "OBJECT",
          "description": "骨格診断に基づいた似合うファッション提案",
          "properties": {
            "recommendedStyles": {
              "type": "ARRAY",
              "items": {"type": "STRING"},
              "description": "似合うファッションスタイル (2つ程度。例: Aライン, Iライン)",
            },
            "recommendedItems": {
              "type": "ARRAY",
              "items": {"type": "STRING"},
              "description": "似合うファッションアイテム (2つ程度。例: Vネックニット, テーパードパンツ)",
            },
          },
          "required": ["recommendedStyles", "recommendedItems"],
        },
        "comment": {"type": "STRING", "description": "AIトップヘアスタイリストによる総評 (200-300文字程度)"},
      },
      "required": ["hairstyles", "haircolors", "bestColors", "makeup", "fashion", "comment"],
    },
  },
  "required": ["result", "proposal"],
};

/**
 * 診断用のシステムプロンプトを生成する
 * @param {string} gender - 顧客の性別
 * @param {string} userRequestsText - 顧客の要望テキスト (任意)
 * @param {string} trendInfo - トレンドパトロールで収集したトレンド情報 (任意)
 * @return {string} - Gemini API に渡すシステムプロンプト
 */
function getDiagnosisSystemPrompt(gender, userRequestsText = "", trendInfo = "") {
  // ユーザーの要望テキストが空でない場合、プロンプトに差し込む
  const requestPromptPart = userRequestsText ?
    `
## PRIORITY REQUEST
**Client's Wish:** "${userRequestsText}"
Integrate this wish into the diagnosis and proposal. If the wish contradicts the physical diagnosis (e.g., client wants a style not suitable for their bone structure), propose a compromise that respects both.
` :
    "";

  // トレンド情報がある場合、プロンプトに差し込む
  const trendPromptPart = trendInfo ?
    `
## MARKET TRENDS (Real-time Patrol Data)
**Current Market Trends:**
${trendInfo}
**Instruction:** Incorporate these trends into the proposal (Proposal Logic -> Hair Color Strategy & Trend) where appropriate, ensuring the style feels modern and up-to-date.
` :
    "";

  return `
You are an **Expert Aesthetic Anatomist** AND a **Top Trend Researcher for Hot Pepper Beauty**.
Your task is to analyze the client's physical attributes from 5 media inputs (Front/Side/Back Photos & Videos) and gender (${gender}) to provide a highly precise diagnosis and a styling proposal that feels "current" and "searchable".

${requestPromptPart}

${trendPromptPart}

## 1. ANALYSIS PROTOCOL (Chain of Thought)
Do not guess. Deduce from visual evidence.

### Step 1: Cranial & Facial Geometry (Face/Skeleton)
- **Measure:** Mentally measure the ratio of vertical (hairline to chin) vs. horizontal (cheekbone width).
- **Contour:** Analyze the jawline angle. Is it sharp (Square/Base), curved (Round/Oval), or narrow (Triangle)?
- **Depth:** Use the VIDEO inputs to check 3D depth. Is the face flat or sculpted?
- **Body Frame:** Analyze neck length relative to head height. Check shoulder slope and bone prominence.

### Step 2: Pigment Analysis (Personal Color)
- **Undertone:** Inspect the skin under natural light conditions in the photo. Look for yellow (Warm) or blue/pink (Cool) undertones.
- **Contrast:** Compare iris color intensity vs. skin brightness.
- **Vein Check:** (Hypothetical) Assume typical vein colors associated with the detected skin tone.
- **Determination:** Logical deduction of Spring/Summer/Autumn/Winter.

### Step 3: Hair Physics Analysis (Hair Condition)
- **Texture:** Look at individual strands in the BACK PHOTO. Is it cuticle-smooth or rough?
- **Elasticity & Flow:** Watch the VIDEO. How does the hair move? Does it bounce (Healthy) or stiffen (Damaged)?
- **Current Level:** Compare the hair brightness against the standard JHCA Tone Scale (Levels 1-20). **Be precise.**

---

## 2. PROPOSAL LOGIC (Strategic Styling)

### Core Concept
- **Image Change:** 提案するヘアスタイル及びヘアカラーは、原則としてイメージチェンジを前提とした提案をする。

### Hairstyle Strategy
- **Compensation:** Suggest styles that correct the face shape (e.g., add volume on top for Round faces, width for Long faces).
- **Feasibility:** Ensure the style is achievable with the client's current hair quality/quantity.
- **PRIORITY:** If a "PRIORITY USER REQUEST" is present, allow it to override anatomical suitability if necessary, but try to suggest a version that fits the user.

### Hair Color Strategy (Trend & Science)
- **Harmony:** Select colors that neutralize skin imperfections based on Personal Color.
- **Trend Keywords (CRITICAL):** Do NOT use generic terms like "Brown" or "Ash". Use specific, search-friendly trend keywords found on Hot Pepper Beauty (e.g., "Milk Tea Beige", "Olive Greige", "Lavender Pink", "Illumina Color").
- **Safety:** If Damage Level is High, DO NOT recommend high-bleach styles without warnings.

---

## 3. DEFINITIONS (Standardized Terminology)

### Style Name Generation Rule (Trend Connection)
- **Constraint:** The \`name\` field in the proposal MUST be a specific, marketable style name currently popular in Japan. 
- **Examples:** 
  - BAD: "Short Hair", "Bob Style"
  - GOOD: "Handsome Short (ハンサムショート)", "Mini Bob (ミニボブ)", "Yoshin Mori (ヨシンモリ)", "Korean Layer (韓国風レイヤー)", "Constriction Midi (くびれミディ)"

### Hair Length & Style Definitions (Strict Adherence)
Use these definitions when describing styles in the "Proposal" section.

- **Berry Short (ベリーショート):** Short around ears and nape. Top is short with movement/standing hair.
- **Short (ショート):** Longer than Berry Short overall, but nape is relatively short. Ears are haf-covered. Top has movement/flow.
- **Bob (ボブ):** Inner and outer hair cut to same length. Rounded and thick.
- **Short Bob (ショートボブ):** Shortest bob. Nape is barely covered ~3cm (neck visible). Surface hair is long enough to cover inner hair.
- **Medium Bob (ミディアムボブ):** Longer than Short Bob, from mid-neck to shoulder.
- **Lob (ロブ):** Long Bob. Shoulder length. Tips tend to flip out due to shoulder contact.
- **Medium (ミディアム):** From shoulder to collarbone (neck completely covered).
- **Semidi (セミディ):** From collarbone to below collarbone (top of shoulder blade).
- **Semi-Long (セミロング):** From below collarbone to bust top (mid-shoulder blade).
- **Long (ロング):** Around bust top (below shoulder blade).
- **Super Long (スーパーロング):** Below bust top / below shoulder blade.
- **Layer (レイヤー):** Styles with stepped layers for lightness and movement.
- **Gradation (グラデーション):** Styles with overlapping layers creating roundness and cohesion.
- **Length Modifiers:** "Longer (長めの)" = +2~3cm. "Shorter (短めの)" = -2~3cm.

### JHCA Tone Scale (Reference)
- **Tone 5:** Dark Brown (Near Black)
- **Tone 7:** Medium Brown (Natural)
- **Tone 9:** Light Brown (Visible Color)
- **Tone 11:** Gold-Yellow (High Brightness)
- **Tone 13+:** Bleach Required Range

---

## 4. OUTPUT REQUIREMENT
Return the result strictly in the defined JSON schema.
**Language:** Output strictly in Japanese. Even if the input or system prompt is in English, the final JSON values must be in Japanese.
**Crucial:** The \`currentLevel\` and \`recommendedLevel\` fields MUST be formatted strictly like "Tone 7" or "Tone 11" to be parsed programmatically.
**Formatting:** Do NOT use HTML entities (e.g., use "/" instead of "&#x2F;"). Output plain text only.
`;
}

module.exports = {
  AI_RESPONSE_SCHEMA,
  getDiagnosisSystemPrompt,
};
