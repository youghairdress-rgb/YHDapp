/**
 * helpers.js
 * 汎用ヘルパー関数
 */

export const logger = {
  log: (...args) => console.log('[YHD App]', ...args),
  warn: (...args) => console.warn('[YHD App]', ...args),
  error: (...args) => console.error('[YHD App]', ...args),
};

// --- UI Helpers ---

export function hideElement(elementOrId) {
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (el) el.style.display = 'none';
}

export function showElement(elementOrId, displayType = 'block') {
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (el) el.style.display = displayType;
}

export function initializeAppFailure(errorMessage) {
  console.error('[initializeAppFailure]', errorMessage);
  hideLoadingScreen();
  if (window.initializeAppFailureFallback) {
    window.initializeAppFailureFallback(errorMessage);
  } else {
    alert(`アプリケーションエラー:\n${errorMessage}`);
  }
}

export function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) loadingScreen.style.display = 'none';
}

export const escapeHtml = function (unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\//g, '&#x2F;');
};

export function setTextContent(elementId, text) {
  const element = document.getElementById(elementId);
  if (element) {
    if (
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT'
    ) {
      element.value = text || '';
    } else {
      element.textContent = text || '';
    }
  }
}

export function createResultItem(label, value) {
  const labelDiv = document.createElement('div');
  labelDiv.className = 'result-item-label';
  labelDiv.textContent = label;

  const valueDiv = document.createElement('div');
  valueDiv.className = 'result-item-value';
  valueDiv.textContent = escapeHtml(value || 'N/A');

  return [labelDiv, valueDiv];
}

export function base64ToBlob(base64, mimeType) {
  try {
    const bin = atob(base64.replace(/^.*,/, ''));
    const buffer = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      buffer[i] = bin.charCodeAt(i);
    }
    return new Blob([buffer], { type: mimeType });
  } catch (e) {
    console.error('[base64ToBlob] Error:', e);
    return null;
  }
}

// --- Image Processing (Optimized for AI) ---

/**
 * 画像をAI認識に最適なサイズ・品質に圧縮する
 * 目標: 長辺2048px以内, ファイルサイズ2MB以下
 * @param {File} file - 元画像ファイル
 * @param {number} maxWidth - 最大幅 (デフォルト2048)
 * @param {number} quality - 画質 (0.0 - 1.0, デフォルト0.92)
 * @return {Promise<File>}
 */
export function compressImage(file, maxWidth = 2048, quality = 0.92) {
  return new Promise((resolve, reject) => {
    if (!file.type.match(/image.*/)) return reject(new Error('Not an image file'));
    // HEIC/HEIFの変換はブラウザ標準機能に依存するか、ライブラリが必要だが
    // 簡易的にそのまま通す（サーバー側で弾かれる可能性はあるが、主要ブラウザはJPEG変換してアップロードすることが多い）
    if (file.type === 'image/heic' || file.type === 'image/heif') {
      // TODO: heic2any などのライブラリ導入を検討
      return resolve(file);
    }

    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target.result;
    };
    reader.onerror = (e) => reject(e);

    reader.readAsDataURL(file);

    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // アスペクト比を維持してリサイズ
      if (width > maxWidth || height > maxWidth) {
        if (width > height) {
          height = Math.round((maxWidth / width) * height);
          width = maxWidth;
        } else {
          width = Math.round((maxWidth / height) * width);
          height = maxWidth;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // 高品質リサンプリングのための設定（ブラウザ依存）
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(img, 0, 0, width, height);

      // Blobに変換
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Compression failed'));

          // サイズチェック (2MBを超える場合は画質を落として再圧縮する簡易ロジック)
          if (blob.size > 2 * 1024 * 1024) {
            canvas.toBlob(
              (blob2) => {
                if (!blob2) return reject(new Error('Re-compression failed'));
                const newName = file.name.replace(/\.[^.]+$/, '.jpg');
                resolve(
                  new File([blob2], newName, { type: 'image/jpeg', lastModified: Date.now() })
                );
              },
              'image/jpeg',
              0.8
            ); // 画質を落とす
          } else {
            const newName = file.name.replace(/\.[^.]+$/, '.jpg');
            resolve(new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() }));
          }
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = (e) => reject(e);
  });
}
