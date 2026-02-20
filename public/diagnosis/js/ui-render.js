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
  const faceLabels = { nose: '鼻', mouth: '口', eyes: '目', eyebrows: '眉', forehead: 'おでこ' };
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
  const proposal = appState.aiProposal;
  const hasInspiration = !!appState.inspirationImageUrl;

  if (!styleContainer || !colorContainer || !proposal) return;

  const createRadioOption = (groupName, value, labelText, isChecked = false) => {
    const id = `${groupName}-${value}`;
    const formattedLabel = labelText.replace(/：/g, '：<br>');
    return `
            <div class="radio-option" style="margin-bottom: 10px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #fff;">
                <input type="radio" name="${groupName}" id="${id}" value="${value}" ${isChecked ? 'checked' : ''}>
                <label for="${id}" style="font-size: 11px; font-weight: bold; margin-left: 5px; display: inline-block; vertical-align: top; line-height: 1.4;">${formattedLabel}</label>
            </div>
        `;
  };

  // Style Options
  let styleHtml = '';
  if (proposal.hairstyles) {
    Object.values(proposal.hairstyles).forEach((style, index) => {
      const val = `style${index + 1}`;
      styleHtml += createRadioOption(
        'style-select',
        val,
        `提案Style${index + 1}: ${style.name}`,
        index === 0
      );
    });
  }
  if (hasInspiration)
    styleHtml += createRadioOption(
      'style-select',
      'user_request',
      '★ ご希望のStyle (写真から再現)'
    );
  styleHtml += createRadioOption(
    'style-select',
    'keep_style',
    'スタイルは変えない (現在の髪型のまま)'
  );
  styleContainer.innerHTML = styleHtml;

  // Color Options
  let colorHtml = '';
  if (proposal.haircolors) {
    Object.values(proposal.haircolors).forEach((color, index) => {
      const val = `color${index + 1}`;
      // If styles exist, don't auto-check color to avoid confusion? Or just check first one.
      // Let's check first one consistent with styles.
      colorHtml += createRadioOption(
        'color-select',
        val,
        `提案Color${index + 1}: ${color.name}`,
        index === 0
      );
    });
  }
  if (hasInspiration)
    colorHtml += createRadioOption(
      'color-select',
      'user_request',
      '★ ご希望のColor (写真から再現)'
    );
  colorHtml += createRadioOption('color-select', 'keep_color', '明るさを選択');
  colorContainer.innerHTML = colorHtml;
}

// --- Phase 6: Generated Image Display ---

import { runHairSegmentation } from './ui-features.js';

export function displayGeneratedImage(base64Data, mimeType, styleName, colorName, toneLevel) {
  // New UI Elements
  const adjustmentContainer = document.getElementById('phase7-adjustment-container');
  const mainDiagnosisImage = document.getElementById('main-diagnosis-image');

  // Old UI Elements (Hidden or Removed)
  const generatedImageContainer = document.querySelector('.generated-image-container');
  const postActions = document.getElementById('post-generation-actions');

  // 1. Setup Phase 6 UI (Canvas etc.)
  initializePhase6Adjustments();

  // Reset State (Show Button, Hide Faders)
  if (window.resetPhase6State) window.resetPhase6State();

  if (mainDiagnosisImage) {
    // Wait for image load
    mainDiagnosisImage.onload = () => {
      // Delay slightly to ensure layout is stable
      setTimeout(() => {
        // Auto-run segmentation
        runHairSegmentation(mainDiagnosisImage);
      }, 300);
    };
    // Set crossOrigin explicitly
    mainDiagnosisImage.crossOrigin = 'anonymous';

    const dataUrl = `data:${mimeType};base64,${base64Data}`;
    mainDiagnosisImage.src = dataUrl;

    // Reset filters when a new image is loaded
    mainDiagnosisImage.style.filter = 'none';

    // Reset sliders visually
    resetSliders();

    // Also clear canvas if exists
    const canvas = document.getElementById('phase6-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (adjustmentContainer) {
      adjustmentContainer.style.display = 'block';
    }
  }

  // Ensure old elements are hidden if they still exist
  if (generatedImageContainer) generatedImageContainer.style.display = 'none';
  // RESTORED: Do not hide postActions (Save features)
  if (postActions) postActions.style.display = 'block';
}

function initializePhase6Adjustments() {
  // 1. Setup Canvas & Image
  const imgElement = document.getElementById('main-diagnosis-image');
  if (imgElement) {
    imgElement.crossOrigin = 'anonymous';
    // imgElement.style.display = 'block'; // Do not show source image
  }

  // Create or Get Canvas
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
  const lBrightness = document.getElementById('label-brightness');
  const lHue = document.getElementById('label-hue');
  const lSaturate = document.getElementById('label-saturate');

  if (rBrightness) rBrightness.value = 10;
  if (rHue) rHue.value = 180;
  if (rSaturate) rSaturate.value = 0;
  if (lBrightness) lBrightness.textContent = '10';

  if (lSaturate) lSaturate.textContent = '0%';
}
