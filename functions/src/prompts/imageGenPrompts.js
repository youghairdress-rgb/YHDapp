/**
 * src/prompts/imageGenPrompts.js
 *
 * 画像生成 (フェーズ6) のためのAIプロンプトを定義する
 * Phase 4-0 Update: "Ultimate Stylist" Edition
 * - 擬似LoRAアプローチによる髪質再現性の向上
 * - Chain-of-Thought (思考の連鎖) による顔・光・髪の完全な統合
 * - カメラレンズ仕様の指定による写実性の極限追求
 */

/**
 * 最初の画像生成（インペインティング）用プロンプトを生成する
 * @param {object} data - リクエストデータ
 * @param {string} data.hairstyleName - スタイル名
 * @param {string} data.hairstyleDesc - スタイル説明
 * @param {string} data.haircolorName - カラー名
 * @param {string} data.haircolorDesc - カラー説明
 * @param {string} data.recommendedLevel - 推奨JHCAレベル (または指定トーン)
 * @param {string} data.currentLevel - 現在のJHCAレベル
 * @param {string} data.userRequestsText - 顧客の要望 (任意)
 * @param {boolean} data.hasInspirationImage - ご希望写真の有無
 * @param {boolean} data.isUserStyle - ご希望スタイル優先フラグ
 * @param {boolean} data.isUserColor - ご希望カラー優先フラグ
 * @param {boolean} data.hasToneOverride - トーン指定上書きフラグ
 * @return {string} - Gemini API に渡すプロンプト
 */
function getGenerationPrompt(data) {
  const {
    hairstyleName, hairstyleDesc, haircolorName, haircolorDesc,
    recommendedLevel, currentLevel, userRequestsText, hasInspirationImage,
    isUserStyle, isUserColor, hasToneOverride,
    keepStyle, keepColor, // Patch for Phase 4 logic
  } = data;

  // ユーザーの要望テキストが空でない場合、プロンプトに差し込む
  const requestPromptPart = userRequestsText ?
    `
**PRIORITY USER REQUEST:**
"${userRequestsText}"
(This instruction overrides standard style defaults. Execute with precision.)
` :
    "";

  // 参考画像 (Inspiration) - 分析指示を強化
  const inspirationPromptPart = hasInspirationImage ?
    `
**REFERENCE IMAGE ANALYSIS (Image 2):**
- **Task:** Analyze the reference image (Image 2) for:
  1. Hair Texture (Smooth, Matte, Glossy, Frizzy?)
  2. Hair Density & Volume distribution
  3. Exact Color Nuance (Underlying pigments)
  4. Lighting condition matches.
- **Action:** TRANSFER these exact physical properties to the user in the Base Image (Image 1).
` :
    "";

  // --- スタイル指定ロジック (構造定義) ---
  let styleInstruction;
  if (keepStyle) {
    styleInstruction = `
- **Style Goal:** MAINTAIN CURRENT FORM
- **Structural Rules:**
  - Freeze the silhouette, length, and layering of the user's hair.
  - Do NOT alter the geometry of the hairstyle.
  - Only modify surface properties (color/texture) as requested.
`;
  } else if (isUserStyle && hasInspirationImage) {
    styleInstruction = `
- **Style Goal:** REPLICATE REFERENCE STYLE
- **Structural Rules:**
  - Clone the silhouette and form from Image 2.
  - Morph the reference style to fit the user's cranial structure naturally.
  - Ensure the hair falls physically correctly around the user's specific face shape.
`;
  } else {
    styleInstruction = `
- **Style Goal:** CREATE NEW STYLE (${hairstyleName})
- **Structural Rules:**
  - Design: ${hairstyleDesc}
  - Physique: Adjust volume and length to compliment the user's face shape.
`;
  }

  // --- カラー指定ロジック (色彩物理定義) ---
  let colorInstruction;

  // JHCA Level Scale Reference (derived from standard Japanese Hair Color Association scale)
  const toneDescriptions = {
    "Tone 5": "JHCA Level 5: Dark Brown. Value: 3/10. Pigment: Melanin rich. Visual: Almost black, but softer than distinct black. Visible only under strong light.",
    "Tone 7": "JHCA Level 7: Medium Brown. Value: 4/10. Pigment: Red-Brown dominant. Visual: Natural brown, standard office-safe brightness. Hints of warmth.",
    "Tone 9": "JHCA Level 9: Light Brown. Value: 5/10. Pigment: Orange-Brown. Visual: Visibly bright brown. Clearly dyed appearance. Lifts facial impression.",
    "Tone 11": "JHCA Level 11: Honey Blonde/Gold. Value: 7/10. Pigment: Orange-Yellow. Visual: High brightness, fashion color. Melanin largely suppressed.",
    "Tone 13": "JHCA Level 13: Bright Blonde. Value: 8/10. Pigment: Yellow dominant. Visual: Bleach territory. Clear yellow-gold. Transparent quality.",
    "Tone 15": "JHCA Level 15: High Bleach. Value: 9/10. Pigment: Pale Yellow. Visual: Very bright blonde. Melanin almost gone. Near platinum.",
    "Tone 18": "JHCA Level 18: White Bleach. Value: 10/10. Pigment: Faint Yellow. Visual: Platinum blonde. Translucent. Extreme brightness.",
  };

  const targetToneDesc = toneDescriptions[recommendedLevel] || recommendedLevel;

  // トーン指示の厳格化 (Strict Override Logic)
  const toneInstruction = hasToneOverride ?
    `
**MANDATORY BRIGHTNESS (CRITICAL):**
- **Target:** ${recommendedLevel} -> ${targetToneDesc}
- **Constraint:** IGNORE original hair brightness. FORCE the result to match this specific tone level exactly.
- **Action:** If Target is Tone 15+, apply extensive bleaching effects to remove dark pigments completely.
` :
    `**Luminance Target:** Transform from current ${currentLevel} to target ${recommendedLevel} naturally.`;

  if (keepColor) {
    if (hasToneOverride) {
      colorInstruction = `
- **Color Definition:** FORCE TONE CHANGE (IGNORE ORIGINAL COLOR)
- **Pigment Rules:** 
  - **CRITICAL:** DISREGARD the original hair color and hue. 
  - **Action:** Completely REPAINT the hair with the Target Tone: ${recommendedLevel} (${targetToneDesc}).
  - **Goal:** The final hair color must determination solely by the ${recommendedLevel} definition.
${toneInstruction}
`;
    } else {
      colorInstruction = `
- **Color Definition:** PRESERVE ORIGINAL COLOR
- **Pigment Rules:** Do NOT shift hue, saturation, or brightness. Keep the hair color exactly as seen in Base Image.
`;
    }
  } else if (isUserColor && hasInspirationImage && !hasToneOverride) {
    colorInstruction = `
- **Color Definition:** CLONE REFERENCE COLOR
- **Pigment Rules:** Extract RGB/CMYK profile from Image 2's hair and map it to the user's hair in Image 1.
`;
  } else if (isUserColor && hasInspirationImage && hasToneOverride) {
    colorInstruction = `
- **Color Definition:** REFERENCE HUE + TARGET LUMINANCE
- **Pigment Rules:** Extract the Hue/Saturation from Image 2, but force the Brightness to match Level ${recommendedLevel}.
`;
  } else {
    colorInstruction = `
- **Color Definition:** ${haircolorName}
- **Pigment Rules:**
  - **Hue:** ${haircolorDesc}
  - **Brightness:** Apply ${recommendedLevel} (${targetToneDesc}).
${toneInstruction}
`;
  }

  // Append Tone Instruction to Color Instruction (Redundant but reinforces usually)
  // For strict override modes, we already embedded it. For others, append.
  if (!keepColor && !isUserColor) {
    // standard proposal path - already embedded
  } else if (!hasToneOverride) {
    // no override path - append default
    colorInstruction += `\n${toneInstruction}`;
  }


  return `
You are the world's leading AI Hair Stylist and a VFX Artist specializing in Digital Human Compositing.
Your goal is to perform a **Seamless Hair Inpainting Operation**.

**INPUT DATA:**
- **Base Image (Image 1):** The Client. Treat their face and head shape as the immutable canvas.
- **Current State:** Hair Brightness Level ${currentLevel}.
${inspirationPromptPart}

**CHAIN OF THOUGHT (Step-by-Step Execution):**
1.  **ANALYZE:** Scan Image 1 to map the user's face, skin tone, head orientation, and the scene's lighting environment (HDR map).
2.  **MASK:** Mentally mask out the old hair region, strictly preserving the face (forehead, ears, jawline).
3.  **SIMULATE:** Generate the new hairstyle structure (${hairstyleName}) as a 3D volume that respects gravity and the user's head shape.
4.  **RENDER:** Apply the hair texture and color (${haircolorName}) with physically based rendering (PBR) to match the scene's lighting.
5.  **COMPOSITE:** Blend the new hair onto the head with sub-pixel accuracy at the hairline.

**STRICT CONSTRAINTS (The "Iron Rules"):**
1.  **IDENTITY PRESERVATION:** The face (eyes, nose, mouth, skin details, moles) MUST remain untouched. 0% alteration allowed.
2.  **PHYSICAL REALISM:** Hair must have weight, flow, and individual strands. No "helmet" hair.
3.  **LIGHTING CONSISTENCY:** If the face is lit from the right, the hair highlights MUST be on the right. Shadows must match.

**TARGET SPECIFICATIONS:**
${styleInstruction}
${colorInstruction}

${requestPromptPart}

**VISUAL DICTIONARY (Trend Translation & Strict Adherence):**
If the Request or Style Description mentions these terms, apply the visual rules exactly:
- **Yoshin Mori (ヨシンモリ):** Large S-shaped waves curving OUTWARD at face line (reverse curl). Constricted silhouette at the neck. Glamorous volume.
- **Tassel Cut (タッセルカット):** Blunt, straight cut at ends. Syllabus-like flat lines. Slight outward flip at tips. Wet texture.
- **Handsome Short (ハンサムショート):** Long bangs falling over eyes/cheeks. Short, tight nape. Masculine-feminine balance.
- **Mini Bob (ミニボブ):** Chin-length or shorter. Compact silhouette. Fits jawline tightly.
- **Constriction Midi (くびれミディ):** Diamond silhouette. Volume at ears, tight at neck, outward flip at shoulders.
- **Wolf Cut / Layer (ウルフ/レイヤー):** High layers on top (short). Long, thin ends. Artificially messy movement.
- **Milk Tea Beige:** Soft, creamy beige with reduced yellow/orange. Semi-matte transparency.
- **Greige (Beige + Grey):** Desaturated cool brown. Ashy undertone.
- **Lavender Pink:** Pink with slight purple tint. Reduces yellow tones. Translucent.

**PHOTOGRAPHY & TEXTURE SPECS (The "Look"):**
- **Camera:** 85mm Portrait Lens, f/1.8 aperture (creates natural bokeh in background, sharp focus on eyes/hair).
- **Texture:** 8K resolution, individual keratin strands visible, cuticle reflection (angel ring), subsurface scattering (light passing through hair tips).
- **Imperfection (REALISM BOOSTER):**
  - **Micro-Frizz:** Strictly ADD 3-5% loose/stray hairs (ahoge) on the surface to break the "CG look".
  - **Asymmetry:** Slight natural irregularity in wave patterns.
  - **Baby Hairs:** Fine, shorter hairs at the hairline.
- **Atmosphere:** Professional salon photography, soft box lighting, high dynamic range.

**NEGATIVE PROMPTS:**
(low resolution, blurry, jpeg artifacts), (painting, drawing, sketch, anime, 3d render, plastic), (distorted face, changing face, new makeup), unnatural gravity, solid block of hair, jagged hairline, floating hair.
`;
}

/**
 * 画像微調整（Edit）用プロンプトを生成する
 * Chain-of-Thoughtを簡易的に適用し、指示の解像度を上げる
 */
function getRefinementPrompt(refinementText) {
  return `
      ** TASK:** High - End Photo Retouching(Hair Specific)
        ** INPUT:** [Base Image] A generated hairstyle image.
** USER INSTRUCTION:** "${refinementText}"

    ** PROCESS:**
      1. ** Identify:** Locate the specific hair region relevant to the instruction(e.g., "bangs", "tips", "overall volume").
2. ** Modify:** Apply the change "${refinementText}" while maintaining the photorealistic texture established in the Base Image.
3. ** Blend:** Ensure the modified area integrates seamlessly with the rest of the hair and the background.

** INTERPRETATION LOGIC:**
- ** "Brighter":** Increase exposure on hair strands, boost specular highlights.
- ** "Darker":** Deepen shadows, reduce exposure, add richness to pigment.
- ** "Shorter":** Retract hair length, ensuring ends look natural(not chopped).
- ** "Volume Up":** Increase hair density and lift at the roots.

** CONSTRAINTS:**
- ** FACE IS OFF - LIMITS:** Do not touch the face.
- ** KEEP REALISM:** Maintain 8K texture quality.No blurring.

** NEGATIVE PROMPTS:**
    (face change), (blur), (loss of detail), (artificial look), (painting).
`;
}

module.exports = {
  getGenerationPrompt,
  getRefinementPrompt,
};
