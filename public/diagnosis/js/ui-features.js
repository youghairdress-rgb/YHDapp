/**
 * ui-features.js
 * Advanced UI features: MediaPipe Segmentation, Canvas Manipulation
 */

import { logger } from './helpers.js';

// --- MediaPipe Hair Segmentation ---

// This relies on the global `hairSegmentation` object from CDN script
let imageSegmenter = null;
let runningMode = "IMAGE";

export async function initializeHairSegmenter() {
    if (imageSegmenter) return; // Already initialized

    try {
        const { ImageSegmenter, FilesetResolver } = window.hairSegmentation || {};
        if (!ImageSegmenter || !FilesetResolver) {
            logger.error("MediaPipe libraries not loaded from CDN.");
            return;
        }

        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );

        imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite",
                delegate: "GPU"
            },
            runningMode: runningMode,
            outputCategoryMask: true,
            outputConfidenceMasks: false
        });
        logger.log("Hair Segmenter Initialized");
    } catch (e) {
        logger.error("Failed to initialize Hair Segmenter:", e);
    }
}

let originalImageBitmap = null;
let hairMaskBitmap = null;

export async function runHairSegmentation(imgElement) {
    if (!imageSegmenter) await initializeHairSegmenter();
    if (!imageSegmenter) return;

    try {
        const canvas = document.getElementById('phase6-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        canvas.width = imgElement.naturalWidth;
        canvas.height = imgElement.naturalHeight;

        // Run segmentation
        const result = imageSegmenter.segment(imgElement);
        const categoryMask = result.categoryMask; // Uint8Array

        // Prepare Offscreen Bitmaps for fast Compositing
        // 1. Original Image
        originalImageBitmap = imgElement;

        // 2. Hair Mask (Alpha mask)
        const maskImageData = ctx.createImageData(canvas.width, canvas.height);
        for (let i = 0; i < categoryMask.getAsUint8().length; ++i) {
            const val = categoryMask.getAsUint8()[i];
            // Hair (index 1) -> 255 (Opaque), Background -> 0 (Transparent)
            maskImageData.data[i * 4] = 0;     // R
            maskImageData.data[i * 4 + 1] = 0; // G
            maskImageData.data[i * 4 + 2] = 0; // B
            maskImageData.data[i * 4 + 3] = (val === 1) ? 255 : 0; // Alpha
        }

        // Convert ImageData to ImageBitmap for performance
        hairMaskBitmap = await createImageBitmap(maskImageData);

        // Initial Draw
        applyImageAdjustments();

        logger.log("Hair Segmentation Complete");
    } catch (e) {
        logger.error("Segmentation Failed:", e);
    }
}

// --- Canvas Manipulation (Brightness, Hue, Saturation) ---

export function applyImageAdjustments() {
    const canvas = document.getElementById('phase6-canvas');
    if (!canvas || !originalImageBitmap || !hairMaskBitmap) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Get Slider Values
    const bVal = parseInt(document.getElementById('range-brightness')?.value || "10"); // scaled -100 to 100, default 10
    const hVal = parseInt(document.getElementById('range-hue')?.value || "180");      // 0 to 360, default 180 (no shift)
    const sVal = parseInt(document.getElementById('range-saturate')?.value || "0");   // -100 to 100, default 0

    // Filters
    const brightness = 1 + (bVal / 100); // 0.0 to 2.0 (1.0 is neutral)
    const saturate = 1 + (sVal / 100);   // 0.0 to 2.0 (1.0 is neutral)
    const hueRotate = hVal - 180;        // -180 to +180 (0 is neutral)

    ctx.globalCompositeOperation = 'source-over';

    // 1. Draw Original Image first
    ctx.filter = 'none';
    ctx.drawImage(originalImageBitmap, 0, 0, width, height);

    // 2. Draw Hair Layer with Filters
    // To apply filters ONLY to hair, we:
    // a. Draw Original Image again
    // b. Apply mask using destination-in (keeps overlapping part)
    // But filters apply to the source (new drawing).
    // Better Approach:
    // a. Draw Filtered Original Image (Entirely) to an offscreen canvas
    // b. Composite that offscreen canvas onto the main canvas using the mask

    // Simplified In-Place (Might require offscreen for strict masking, but let's try standard Composite)
    // Step: Cut out hair from background?

    // Re-approach: 
    // Layer 1 (Bottom): Original Image
    // Layer 2 (Top): Original Image (Filtered) -> Masked by HairMask

    // Save context
    ctx.save();

    // Create temporary "Filtered Hair" layer
    // Since we can't easily filter strictly inside drawImage without affecting rect, 
    // we use a clip or composite.

    // Draw Hair Mask into a separate buffer or use logic
    // Actually, easy way:
    // 1. Draw Original fully.
    // 2. Set filter.
    // 3. Draw Original again.
    // 4. Set globalCompositeOperation = 'destination-in' -> Draw Hair Mask. 
    //    (This would leave ONLY the filtered hair, but delete the bottom original layer where mask is empty)
    //    So this needs an intermediate canvas.

    // --- Intermediate approach using Offscreen Canvas (simulated) ---
    // Create a new canvas element in memory
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw Original with Filters to Temp
    tempCtx.filter = `brightness(${brightness}) saturate(${saturate}) hue-rotate(${hueRotate}deg)`;
    tempCtx.drawImage(originalImageBitmap, 0, 0, width, height);

    // Mask Temp with HairMask
    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.drawImage(hairMaskBitmap, 0, 0, width, height);

    // Composite Temp (Filtered Hair) onto Main Canvas (Original Background)
    ctx.filter = 'none'; // Reset main ctx filter
    ctx.drawImage(tempCanvas, 0, 0);

    ctx.restore();
}

/**
 * Setup Listeners for Sliders and Buttons
 */
export function setupAdustmentListeners() {
    const update = () => {
        applyImageAdjustments();
        // Update labels
        updateLabel('range-brightness', 'label-brightness', '');
        updateLabel('range-hue', 'label-hue', '°');
        updateLabel('range-saturate', 'label-saturate', '%');
    };

    const updateLabel = (rangeId, labelId, suffix) => {
        const r = document.getElementById(rangeId);
        const l = document.getElementById(labelId);
        if (r && l) l.textContent = r.value + suffix;
    };

    ['range-brightness', 'range-hue', 'range-saturate'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', update);
    });

    // Reset Button
    const resetBtn = document.getElementById('btn-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) { el.value = val; el.dispatchEvent(new Event('input')); }
            };
            setVal('range-brightness', 10);
            setVal('range-hue', 180);
            setVal('range-saturate', 0);
        });
    }

    // Fader Buttons (Up/Down)
    document.querySelectorAll('.fader-btn-down, .fader-btn-up').forEach(btn => {
        // Clone to start fresh
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = newBtn.getAttribute('data-target');
            const step = parseInt(newBtn.getAttribute('data-step') || "0");
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
