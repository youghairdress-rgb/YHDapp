/**
 * privacy_editor.js
 * 画像のプライバシー加工（顔隠し・ぼかし）機能を提供するモジュール
 * Refactored: Object-based rendering (Layers), Drag & Drop, Firebase Storage Upload
 */

import {
  ref,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import { storage } from '../admin/firebase-init.js'; // Import storage directly

let canvas, ctx;
// let storage = null; // Removed local variable
let originalImage = null; // Image Object
let history = []; // Undo用 (Base Layer Only)
let currentTool = 'stamp'; // 'stamp' or 'blur'
let currentStamp = '🙂'; // Emoji or Text
let isImageStamp = false;
let currentStampImageSrc = null; // Image Source URL for new stamps

// Stae for Stamp Objects
let stamps = []; // Array of {id, type, src, x, y, size, rotation}
let selectedStampId = null;
let isDragging = false;
let dragStartX, dragStartY;

// ぼかしの強度
const BLUR_RADIUS = 10;
const DEFAULT_STAMP_SIZE = 60;

// --- ツール関数定義 ---

function closeEditor() {
  document.getElementById('privacy-editor-modal').classList.remove('active');
}

function closeReviewModal() {
  document.getElementById('review-guide-modal').classList.remove('active');
}

function selectTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active'));
  const btn = document.getElementById(`tool-${tool}`);
  if (btn) btn.classList.add('active');

  // UI表示制御
  const stampOptions = document.getElementById('stamp-options');
  const sizeControl = document.getElementById('stamp-size-control');

  if (tool === 'stamp') {
    if (stampOptions) stampOptions.style.display = 'flex';
    if (sizeControl) sizeControl.style.display = 'flex';
  } else {
    if (stampOptions) stampOptions.style.display = 'none';
    if (sizeControl) sizeControl.style.display = 'none';
    selectedStampId = null; // ツール切り替えで選択解除
    render();
  }
}

function selectStamp(stamp) {
  isImageStamp = false;
  currentStamp = stamp;
  selectTool('stamp');
}

function selectImageStamp(src) {
  isImageStamp = true;
  currentTool = 'stamp';
  currentStampImageSrc = src;
  selectTool('stamp');
}

function handleCustomStamp(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      selectImageStamp(e.target.result);
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function updateStampSize(val) {
  if (selectedStampId) {
    const s = stamps.find((s) => s.id === selectedStampId);
    if (s) {
      s.scale = parseFloat(val);
      render();
    }
  }
}

function undoCanvas() {
  // スタンプのUndo
  if (stamps.length > 0) {
    stamps.pop();
    selectedStampId = null;
    render();
    return;
  }

  // ぼかしのUndo
  if (history.length > 0) {
    const lastState = history.pop();
    baseLayerImage.src = lastState;
    // baseLayerImage.onload で再描画される
  }
}

function openReviewGuide() {
  document.getElementById('review-guide-modal').classList.add('active');
}

function copyComment() {
  const input = document.getElementById('review-comment-input');
  if (!input) return;
  input.select();
  input.setSelectionRange(0, 99999);
  navigator.clipboard
    .writeText(input.value)
    .then(() => {
      alert('コメントをコピーしました！');
    })
    .catch((err) => {
      console.error(err);
      alert('コピーに失敗しました。手動でコピーしてください。');
    });
}

function goToGoogleMaps() {
  const url = 'https://share.google/mncHYcWcXR98gDdJT';
  window.open(url, '_blank');
}

// グローバル公開
window.selectTool = selectTool;
window.selectStamp = selectStamp;
window.selectImageStamp = selectImageStamp;
window.handleCustomStamp = handleCustomStamp;
window.updateStampSize = updateStampSize;
window.undoCanvas = undoCanvas;
window.closeEditor = closeEditor;
window.closeReviewModal = closeReviewModal;
window.copyComment = copyComment;
window.goToGoogleMaps = goToGoogleMaps;

export const initEditor = () => {
  canvas = document.getElementById('privacy-canvas');
  if (!canvas) return; // Guard for non-editor pages
  ctx = canvas.getContext('2d', { willReadFrequently: true });

  // イベントリスナーの設定
  canvas.addEventListener('mousedown', handleStart);
  canvas.addEventListener('mousemove', handleMove);
  canvas.addEventListener('mouseup', handleEnd);
  canvas.addEventListener('touchstart', handleStart, { passive: false });
  canvas.addEventListener('touchmove', handleMove, { passive: false });
  canvas.addEventListener('touchend', handleEnd);

  // UI初期化
  selectTool('stamp');
};

let baseLayerImage = new Image();
baseLayerImage.onload = () => {
  render();
};

export const openEditorModal = (imageSrc) => {
  const modal = document.getElementById('privacy-editor-modal');
  modal.classList.add('active');

  stamps = [];
  history = [];
  selectedStampId = null;

  originalImage = new Image();
  originalImage.crossOrigin = 'anonymous';
  originalImage.src = imageSrc;
  originalImage.onload = () => {
    const MAX_SIDE = 1000;
    let w = originalImage.width;
    let h = originalImage.height;
    if (w > MAX_SIDE || h > MAX_SIDE) {
      const r = Math.min(MAX_SIDE / w, MAX_SIDE / h);
      w *= r;
      h *= r;
    }
    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(originalImage, 0, 0, w, h);
    baseLayerImage.src = canvas.toDataURL();
  };
};

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  let cx, cy;
  if (e.touches && e.touches.length > 0) {
    cx = e.touches[0].clientX;
    cy = e.touches[0].clientY;
  } else {
    cx = e.clientX;
    cy = e.clientY;
  }
  return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
}

function handleMove(e) {
  if (e.cancelable) e.preventDefault();
  if (!isDragging) return;
  const pos = getPos(e);

  if (currentTool === 'stamp') {
    if (selectedStampId) {
      const s = stamps.find((s) => s.id === selectedStampId);
      if (s) {
        s.x = pos.x;
        s.y = pos.y;
        render();
      }
    }
  } else if (currentTool === 'blur') {
    applyBlur(pos.x, pos.y);
  }
}

function handleEnd() {
  if (currentTool === 'blur' && isDragging) {
    updateBaseLayer();
  }
  isDragging = false;
}

function updateBaseLayer() {
  baseLayerImage.src = canvas.toDataURL();
}

function addStamp(x, y) {
  const id = Date.now().toString();

  if (isImageStamp && currentStampImageSrc) {
    const img = new Image();
    img.src = currentStampImageSrc;
    img.onload = () => {
      render();
    };

    stamps.push({
      id: id,
      type: 'image',
      imgObj: img,
      x: x,
      y: y,
      scale: 1.0,
      ratio: 1.0,
    });
    selectedStampId = id;
  } else {
    stamps.push({
      id: id,
      type: 'text',
      text: currentStamp,
      x: x,
      y: y,
      scale: 1.0,
    });
    selectedStampId = id;
  }
}

function render(drawStamps = true) {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (baseLayerImage.src) {
    ctx.drawImage(baseLayerImage, 0, 0);
  }

  if (!drawStamps) return;

  stamps.forEach((s) => {
    ctx.save();
    ctx.translate(s.x, s.y);
    const size = DEFAULT_STAMP_SIZE * s.scale;

    if (s.type === 'image') {
      if (s.imgObj && s.imgObj.complete) {
        if (s.ratio === 1.0 && s.imgObj.height > 0) {
          s.ratio = s.imgObj.width / s.imgObj.height;
        }
        const w = size * 2;
        const h = w / s.ratio;
        ctx.drawImage(s.imgObj, -w / 2, -h / 2, w, h);
      }
    } else {
      ctx.font = `${size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (s.text === 'YHD') {
        ctx.fillStyle = '#0ABAB5';
        ctx.font = `bold ${size}px sans-serif`;
        ctx.fillText('YHD', 0, 0);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.strokeText('YHD', 0, 0);
      } else {
        ctx.fillText(s.text, 0, 0);
      }
    }

    if (s.id === selectedStampId) {
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  });
}

function applyBlur(x, y) {
  if (isDragging) {
    const size = 30;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.clip();

    try {
      ctx.filter = 'blur(5px)';
      ctx.drawImage(canvas, 0, 0);
    } catch (e) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.restore();
    ctx.filter = 'none';
  }
}

let handleStart = (e) => {
  if (e.cancelable) e.preventDefault();
  const pos = getPos(e);
  isDragging = true;
  dragStartX = pos.x;
  dragStartY = pos.y;

  if (currentTool === 'stamp') {
    let hit = false;
    for (let i = stamps.length - 1; i >= 0; i--) {
      const s = stamps[i];
      const halfSize = ((DEFAULT_STAMP_SIZE * s.scale) / 2) * (s.ratio || 1) * 1.5;
      if (Math.abs(pos.x - s.x) < halfSize && Math.abs(pos.y - s.y) < halfSize) {
        selectedStampId = s.id;
        hit = true;
        const slider = document.getElementById('stamp-size-slider');
        if (slider) slider.value = s.scale;
        render();
        break;
      }
    }

    if (!hit) {
      addStamp(pos.x, pos.y);
      render();
    }
  } else if (currentTool === 'blur') {
    history.push(baseLayerImage.src);
    if (history.length > 5) history.shift();
    applyBlur(pos.x, pos.y);
  }
};

const baseHandleStart = handleStart;
handleStart = (e) => {
  if (currentTool === 'blur') {
    render(false);
  }
  baseHandleStart(e);
};

window.saveEditedImage = async () => {
  selectedStampId = null;
  render();

  const saveBtn = document.querySelector('.editor-actions .btn-save');
  const originalBtnText = saveBtn ? saveBtn.textContent : '保存して次へ';
  if (saveBtn) {
    saveBtn.textContent = '保存中...';
    saveBtn.disabled = true;
  }

  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Canvas to Blob conversion failed'));
        },
        'image/jpeg',
        0.9
      );
    });

    if (!blob) throw new Error('画像生成エラー: Blob is null');

    if (!storage) throw new Error('Firebase Storageが初期化されていません。');

    const filename = `temp_reviews/${Date.now()}.jpg`;
    const storageRef = ref(storage, filename);

    await uploadBytes(storageRef, blob);
    const downloadURL = await getDownloadURL(storageRef);

    const previewImg = document.getElementById('review-generated-image');
    if (previewImg) previewImg.src = downloadURL;

    document.getElementById('download-image-btn')?.addEventListener('click', () => {
      window.open(downloadURL, '_blank');
    });

    closeEditor();
    openReviewGuide();

    if (saveBtn) {
      saveBtn.textContent = '完了';
      saveBtn.disabled = false;
    }
  } catch (e) {
    console.error('Save Error:', e);
    alert('画像の保存に失敗しました。\n' + (e.message || '通信エラー等の可能性があります'));

    if (saveBtn) {
      saveBtn.textContent = originalBtnText;
      saveBtn.disabled = false;
    }
  }
};
