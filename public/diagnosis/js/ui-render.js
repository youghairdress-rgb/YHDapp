/**
 * ui-render.js
 * Rendering logic for Diagnosis Results, Proposals, and Gallery
 */

import { escapeHtml, setTextContent } from './helpers.js';
import { appState } from './state.js';

// --- Result Display (Phase 4) ---

export function displayDiagnosisResult(result) {
  if (!result) return;

  // Helper to create list items
  const createResultItem = (label, value) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.innerHTML = `<div class="result-item-label">${escapeHtml(label)}</div><div class="result-item-value">${escapeHtml(value || 'N/A')}</div>`;
    return div;
  };

  // Label mappings for Japanese display
  const faceLabels = {
    nose: '鼻',
    mouth: '口',
    eyes: '目',
    eyebrows: '眉',
    forehead: 'おでこ',
    partsBalance: 'パーツのバランス'
  };
  const skeletonLabels = {
    neckLength: '首',
    faceShape: '顔型',
    bodyLine: 'ボディライン',
    shoulderLine: '肩',
    faceStereoscopy: '立体感',
    bodyTypeFeature: '体型',
  };
  const pcLabels = {
    baseColor: 'ベースカラー',
    season: 'シーズン',
    brightness: '明度',
    saturation: '彩度',
    eyeColor: '瞳の色',
  };
  const hcLabels = {
    quality: '髪質',
    curlType: 'クセ',
    damageLevel: 'ダメージ',
    volume: '毛量',
    currentLevel: '現在のレベル',
  };

  // Helper to render a section
  const renderSection = (containerId, data, labels) => {
    const container = document.getElementById(containerId);
    if (!container || !data) return;
    container.innerHTML = '';
    Object.entries(labels).forEach(([key, label]) => {
      if (data[key] && data[key] !== 'N/A') {
        container.appendChild(createResultItem(label, data[key]));
      }
    });
  };

  // 1. Face (お顔の特徴)
  renderSection('face-results', result.face, faceLabels);

  // 2. Skeleton (骨格・ボディ)
  renderSection('skeleton-results', result.skeleton, skeletonLabels);

  // 3. Hair Condition (現在の髪の状態)
  renderSection('hair-condition-results', result.hairCondition, hcLabels);

  // 4. Personal Color (パーソナルカラー)
  renderSection('personal-color-results', result.personalColor, pcLabels);
}

// --- Proposal Display (Phase 5) ---

export function displayProposalResult(proposal) {
  const containers = {
    hairstyle: document.getElementById('hairstyle-proposal'),
    haircolor: document.getElementById('haircolor-proposal'),
    bestColors: document.getElementById('best-colors-proposal'),
    makeup: document.getElementById('makeup-proposal'),
    fashion: document.getElementById('fashion-proposal'),
  };

  // Clear previous
  Object.values(containers).forEach((c) => {
    if (c) c.innerHTML = '';
  });
  setTextContent('top-stylist-comment-text', '');

  if (!proposal) return;

  // Helper for cards
  const createInfoCard = (title, desc, recLevel) => {
    const card = document.createElement('div');
    card.className = 'proposal-card';
    const levelHtml = recLevel ? `<br><small>推奨: ${escapeHtml(recLevel)}</small>` : '';
    card.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(desc)}${levelHtml}</p>`;
    return card;
  };

  // 1. Hairstyle
  if (proposal.hairstyles && containers.hairstyle) {
    Object.values(proposal.hairstyles).forEach((style) => {
      containers.hairstyle.appendChild(createInfoCard(style.name, style.description));
    });
  }

  // 2. Haircolor
  if (proposal.haircolors && containers.haircolor) {
    Object.values(proposal.haircolors).forEach((color) => {
      containers.haircolor.appendChild(
        createInfoCard(color.name, color.description, color.recommendedLevel)
      );
    });
  }

  // 3. Best Colors (Visual Swatches)
  if (proposal.bestColors && containers.bestColors) {
    Object.values(proposal.bestColors).forEach((color) => {
      if (!color.hex) return;
      const item = document.createElement('div');
      item.className = 'color-swatch-item';
      item.innerHTML = `<div class="color-swatch-circle" style="background-color:${color.hex}"></div><span class="color-swatch-name">${escapeHtml(color.name)}</span>`;
      containers.bestColors.appendChild(item);
    });
  }

  // 4. Makeup
  if (proposal.makeup && containers.makeup) {
    const map = { eyeshadow: 'アイシャドウ', cheek: 'チーク', lip: 'リップ' };
    Object.entries(proposal.makeup).forEach(([key, value]) => {
      const div = document.createElement('div');
      div.className = 'makeup-item-row';
      div.innerHTML = `<div class="makeup-label">${escapeHtml(map[key] || key)}</div><div class="makeup-value">${escapeHtml(value)}</div>`;
      containers.makeup.appendChild(div);
    });
  }

  // 5. Fashion
  if (proposal.fashion && containers.fashion) {
    const renderFashionItem = (label, val) => {
      const text = Array.isArray(val) ? val.join(' / ') : val;
      const div = document.createElement('div');
      div.className = 'makeup-item-row';
      div.innerHTML = `<div class="makeup-label">${label}</div><div class="makeup-value">${escapeHtml(text)}</div>`;
      containers.fashion.appendChild(div);
    };
    if (proposal.fashion.recommendedStyles)
      renderFashionItem('似合うスタイル', proposal.fashion.recommendedStyles);
    if (proposal.fashion.recommendedItems)
      renderFashionItem('似合うアイテム', proposal.fashion.recommendedItems);
  }

  // 6. Comment
  if (proposal.comment) setTextContent('top-stylist-comment-text', proposal.comment);
}

export function renderGenerationConfigUI() {
  const styleContainer = document.getElementById('style-selection-group');
  const colorContainer = document.getElementById('color-selection-group');

  // --- 堅牢な状態復旧ロジック (sessionStorageを利用) ---
  if (!appState.aiProposal || !appState.aiProposal.hairstyles) {
    try {
      const backupProposal = sessionStorage.getItem('yhd_backup_proposal');
      const backupResult = sessionStorage.getItem('yhd_backup_result');
      const backupUrls = sessionStorage.getItem('yhd_backup_urls');

      if (backupProposal && backupResult && backupUrls) {
        appState.aiProposal = JSON.parse(backupProposal);
        appState.aiDiagnosisResult = JSON.parse(backupResult);
        appState.uploadedFileUrls = JSON.parse(backupUrls);
        console.log('[DEBUG] 状態を sessionStorage から完全に復旧しました');
      }
    } catch (e) {
      console.warn('状態の復旧に失敗しました:', e);
    }
  }

  let proposal = appState.aiProposal;
  const hasInspiration = !!appState.inspirationImageUrl || !!appState.uploadedFileUrls['item-inspiration-photo'];

  // 1. HTMLの枠が見つからない場合のエラーチェック
  if (!styleContainer || !colorContainer) {
    console.error('HTMLエラー: style-selection-group または color-selection-group が見つかりません。');
    return;
  }

  // 2. 厳格なエラーハンドリング (リロード後にデータが復旧できなかった場合)
  // ダミーデータは絶対に使用せず、ユーザーを安全に前の画面へ戻す
  if (!proposal || !proposal.hairstyles || !proposal.haircolors || Object.keys(proposal.hairstyles).length === 0) {
    console.error('AIの提案データが見つかりません。データ欠落。');
    alert('AIの提案データの読み込みに失敗しました。お手数ですがもう一度お試しください。');
    // UI-coreを動的に読み込んで遷移
    import('./ui-core.js').then(m => m.changePhase('phase5-2'));
    return;
  }

  // 3. ラジオボタンの生成 (ネイティブの丸ポチを隠し、ラベルを美しいボタンとして描画)
  const createRadioOption = (groupName, value, labelText, isChecked = false) => {
    const id = `${groupName}-${value}`;
    const formattedLabel = labelText.replace(/：/g, '：<br>');
    return `
        <div class="radio-option">
            <input type="radio" name="${groupName}" id="${id}" value="${value}" ${isChecked ? 'checked' : ''} style="display:none;">
            <label for="${id}" class="radio-button-label">${formattedLabel}</label>
        </div>
    `;
  };

  // Style Options
  let styleHtml = '';
  Object.values(proposal.hairstyles).forEach((style, index) => {
    const val = `style${index + 1}`;
    styleHtml += createRadioOption('style-select', val, `提案Style${index + 1}: ${style.name || 'AIおすすめ'}`, index === 0);
  });
  if (hasInspiration) styleHtml += createRadioOption('style-select', 'user_request', '★ ご希望のStyle (写真から再現)');
  styleHtml += createRadioOption('style-select', 'keep_style', 'スタイルは変えない (現在の髪型のまま)');
  styleContainer.innerHTML = styleHtml;

  // Color Options
  let colorHtml = '';
  Object.values(proposal.haircolors).forEach((color, index) => {
    const val = `color${index + 1}`;
    colorHtml += createRadioOption('color-select', val, `提案Color${index + 1}: ${color.name || 'AIおすすめ'}`, index === 0);
  });
  if (hasInspiration) colorHtml += createRadioOption('color-select', 'user_request', '★ ご希望のColor (写真から再現)');
  colorHtml += createRadioOption('color-select', 'keep_color', '明るさを選択');
  colorContainer.innerHTML = colorHtml;
}


// --- Phase 6: Generated Image Display ---

import { runHairSegmentation } from './ui-features.js';

export function displayGeneratedImage(base64Data, mimeType, styleName, colorName, toneLevel) {
  const mainDiagnosisImage = document.getElementById('main-diagnosis-image');
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  if (mainDiagnosisImage) {
    // 1. 画像をセット
    mainDiagnosisImage.src = dataUrl;

    // 2. 画像のロード完了を待ってから全てを開始（これが最も確実）
    mainDiagnosisImage.onload = async () => {
      console.log("[Phase6] Image Loaded. Initializing adjustments...");

      // キャンバスとスライダーの初期化
      initializePhase6Adjustments();
      resetSliders();

      // セグメンテーション実行 (内部で applyImageAdjustments が呼ばれる)
      await runHairSegmentation(mainDiagnosisImage);

      // ★重要: 動的に生成された要素があるため、リスナーをここで「再結合」する
      import('./ui-features.js').then(m => m.setupAdustmentListeners());

      // ローディングを消す
      const p6Overlay = document.getElementById('p6-generation-overlay');
      if (p6Overlay) p6Overlay.style.display = 'none';
    };
  }
}

function initializePhase6Adjustments() {
  const imgElement = document.getElementById('main-diagnosis-image');
  if (imgElement) {
    imgElement.crossOrigin = 'anonymous';
  }

  let phase6Canvas = document.getElementById('phase6-canvas');
  if (!phase6Canvas) {
    phase6Canvas = document.createElement('canvas');
    phase6Canvas.id = 'phase6-canvas';

    if (imgElement && imgElement.parentNode) {
      imgElement.parentNode.appendChild(phase6Canvas);
    }
  }
}

function resetSliders() {
  const rBrightness = document.getElementById('range-brightness');
  const rHue = document.getElementById('range-hue');
  const rSaturate = document.getElementById('range-saturate');
  const lBrightness = document.getElementById('label-brightness-val');
  const lHue = document.getElementById('label-hue-val');
  const lSaturate = document.getElementById('label-saturate-val');

  if (rBrightness) rBrightness.value = 10;
  if (rHue) rHue.value = 180;
  if (rSaturate) rSaturate.value = 0;

  if (lBrightness) lBrightness.textContent = '(10tone)';
  if (lHue) lHue.textContent = '(180°)';
  if (lSaturate) lSaturate.textContent = '(0%)';
}
