/**
 * ui-features.js
 * Advanced UI features: MediaPipe Segmentation, Canvas Manipulation
 */

import { logger } from './helpers.js';

import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';

// --- MediaPipe Hair Segmentation ---

let imageSegmenter = null;
let runningMode = 'IMAGE';

export async function initializeHairSegmenter() {
  if (imageSegmenter) return; // Already initialized

  try {
    // 診断アプリのNPMパッケージ（^0.10.32）と互換性があるバージョンのWASMを指定
    const visionTasks = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm'
    );

    // WebGL(GPU)由来のエラーを根本的に防ぎ、全デバイスで安定させるためにCPUを指定
    imageSegmenter = await ImageSegmenter.createFromOptions(visionTasks, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite',
        delegate: 'CPU',
      },
      runningMode: runningMode,
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    logger.log('Hair Segmenter Initialized (CPU Mode)');
  } catch (e) {
    logger.error('Failed to initialize Hair Segmenter:', e);
    // Do not re-throw, just log. App can continue without segmentation.
  }
}

let originalImageBitmap = null;
let hairMaskBitmap = null;

export async function runHairSegmentation(imgElementOrSrc) {
  if (!imageSegmenter) await initializeHairSegmenter();
  if (!imageSegmenter) return;

  try {
    const src = typeof imgElementOrSrc === 'string' ? imgElementOrSrc : imgElementOrSrc.src;
    if (!src) return;

    // Load image into a fresh Image object to ensure it's strictly valid for MP
    // and independent of DOM styling (display: none, etc.)
    const offscreenImg = new Image();
    offscreenImg.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      offscreenImg.onload = resolve;
      offscreenImg.onerror = reject;
      offscreenImg.src = src;
    });

    logger.log(
      `Segmentation Image Loaded: ${offscreenImg.naturalWidth}x${offscreenImg.naturalHeight}, Src: ${src.substring(0, 50)}...`
    );

    const canvas = document.getElementById('phase6-canvas');
    if (!canvas) return;

    canvas.width = offscreenImg.naturalWidth;
    canvas.height = offscreenImg.naturalHeight;

    // 1. Original Image (Use the loaded image, not the DOM element)
    originalImageBitmap = offscreenImg;

    // IMMEDIATE DRAW: Show the image before segmentation finishes
    // (applyImageAdjustments handles missing mask by drawing original only)
    applyImageAdjustments();

    const ctx = canvas.getContext('2d');

    // Run segmentation on the clean image object
    const result = imageSegmenter.segment(offscreenImg);
    const categoryMask = result.categoryMask; // Uint8Array

    // Check mask dimensions
    const maskWidth = categoryMask.width;
    const maskHeight = categoryMask.height;

    logger.log(
      `Mask Dimensions: ${maskWidth}x${maskHeight}, Image Dimensions: ${canvas.width}x${canvas.height}`
    );

    // 2. Hair Mask (Alpha mask) - Create at MASK dimensions
    const maskImageData = new ImageData(maskWidth, maskHeight);
    const maskArray = categoryMask.getAsUint8Array();

    for (let i = 0; i < maskArray.length; ++i) {
      const val = maskArray[i];
      // Hair (index 1) -> 255 (Opaque)
      const alpha = val === 1 ? 255 : 0;
      const idx = i * 4;
      maskImageData.data[idx] = 0; // R
      maskImageData.data[idx + 1] = 0; // G
      maskImageData.data[idx + 2] = 0; // B
      maskImageData.data[idx + 3] = alpha; // Alpha
    }

    // Convert ImageData to ImageBitmap for performance
    // Safety Check: Calculate Hair Ratio
    let hairPixelCount = 0;
    const totalPixels = maskArray.length;

    // Check every pixel to be accurate for ratio, or sample for speed.
    // Since we are iterating anyway, let's count.
    for (let i = 0; i < totalPixels; i++) {
      if (maskArray[i] === 1) hairPixelCount++;
    }

    const hairRatio = hairPixelCount / totalPixels;
    logger.log(`Hair Ratio: ${(hairRatio * 100).toFixed(2)}%`);

    // If > 80% of image is detected as hair, it's likely a segmentation failure (garbage output)
    hairMaskBitmap = await createImageBitmap(maskImageData);

    // Initial Draw (Update with mask if valid, or keep original if null)
    applyImageAdjustments();

    logger.log('Hair Segmentation Complete (Offscreen)');
  } catch (e) {
    logger.error('Segmentation Failed:', e);
  }
}

// --- Canvas Manipulation (Brightness, Hue, Saturation) ---

export function applyImageAdjustments() {
  const canvas = document.getElementById('phase6-canvas');
  if (!canvas || !originalImageBitmap) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Get Slider Values
  // Brightness: 5 (Dark) to 20 (Light) - Simulating Hair Level
  const bInput = document.getElementById('range-brightness');
  const bVal = parseInt(bInput?.value || '10');

  // Hue: 0 to 360
  const hInput = document.getElementById('range-hue');
  const hVal = parseInt(hInput?.value || '180');

  // Saturation: 0 to 100 (Opacity of Color Overlay)
  const sInput = document.getElementById('range-saturate');
  const sVal = parseInt(sInput?.value || '0');

  // Logic:
  // 1. Brightness: Lift or Darken the hair level.
  //    Level 10 (Standard) -> Brightness 1.0 (No Change)
  //    Level 5 (Dark) -> Brightness 0.5
  //    Level 20 (High Lift) -> Brightness 2.0
  //    Formula: 1.0 + (Value - 10) / 10.0
  const brightnessScale = 1.0 + (bVal - 10) / 10.0;

  // 2. Saturation (Opacity): 0.0 to 1.0
  const colorOpacity = sVal / 100.0;

  // 3. Hue: HSL Color
  // We use HSL(h, 50%, 50%) as the base tint color.
  const colorString = `hsl(${hVal}, 50%, 50%)`;

  ctx.save();

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // 1. 背景の描画（オリジナル画像）
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.drawImage(originalImageBitmap, 0, 0, width, height);

  if (!hairMaskBitmap) {
    ctx.restore();
    return;
  }

  // 2. 処理用レイヤー（髪の毛専用）の準備
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');

  // A. Brightness (Filter)
  tempCtx.filter = `brightness(${brightnessScale})`;
  tempCtx.drawImage(originalImageBitmap, 0, 0, width, height);
  tempCtx.filter = 'none';

  // B. Mask Hair
  tempCtx.globalCompositeOperation = 'destination-in';
  tempCtx.drawImage(hairMaskBitmap, 0, 0, width, height);

  // C. Color Tint (髪色アプリと完全互換のロジック)
  if (colorOpacity > 0) {
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = width;
    colorCanvas.height = height;
    const colorCtx = colorCanvas.getContext('2d');

    // 色を全体に塗る
    colorCtx.fillStyle = colorString;
    colorCtx.fillRect(0, 0, width, height);

    // 塗った色をマスクで切り抜く
    colorCtx.globalCompositeOperation = 'destination-in';
    colorCtx.drawImage(hairMaskBitmap, 0, 0, width, height);

    // 切り抜いた色を髪の毛に重ねる
    tempCtx.globalCompositeOperation = 'color';
    tempCtx.globalAlpha = colorOpacity;
    tempCtx.drawImage(colorCanvas, 0, 0);
  }

  // 3. 処理済みの髪の毛をメインキャンバスに合成
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0;
  ctx.drawImage(tempCanvas, 0, 0);

  ctx.restore();
}

let areAdjustmentListenersBound = false;

/**
 * Setup Listeners for Sliders and Buttons
 */
export function setupAdustmentListeners() {
  if (areAdjustmentListenersBound) return;
  areAdjustmentListenersBound = true;

  const update = () => {
    applyImageAdjustments();
    // Update labels
    updateLabel('range-brightness', 'label-brightness-val', 'tone');
    updateLabel('range-hue', 'label-hue-val', '°');
    updateLabel('range-saturate', 'label-saturate-val', '%');
  };

  const updateLabel = (rangeId, labelId, suffix) => {
    const r = document.getElementById(rangeId);
    const l = document.getElementById(labelId);
    if (r && l) l.textContent = `(${r.value}${suffix})`;
  };

  ['range-brightness', 'range-hue', 'range-saturate'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', update);
  });

  // Reset Button
  const resetBtn = document.getElementById('btn-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
          el.value = val;
          el.dispatchEvent(new Event('input'));
        }
      };
      setVal('range-brightness', 10);
      setVal('range-hue', 180);
      setVal('range-saturate', 0);
    });
  }

  // Fader Buttons (Up/Down)
  document.querySelectorAll('.fader-btn-down, .fader-btn-up').forEach((btn) => {
    // Clone to start fresh
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = newBtn.getAttribute('data-target');
      const step = parseInt(newBtn.getAttribute('data-step') || '0');
      const input = document.getElementById(targetId);

      if (input) {
        let val = parseInt(input.value);
        val += step;
        const min = parseInt(input.min);
        const max = parseInt(input.max);
        if (!isNaN(min) && val < min) val = min;
        if (!isNaN(max) && val > max) val = max;
        input.value = val;
        input.dispatchEvent(new Event('input'));
      }
    });
  });
}
