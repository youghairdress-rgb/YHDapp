/**
 * privacy_editor.js
 * 画像のプライバシー加工（顔隠し・ぼかし）機能を提供するモジュール
 * Refactored: Object-based rendering (Layers), Drag & Drop, Firebase Storage Upload
 */

import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
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

export const initEditor = () => { // Removed storage arg
    // storage = firebaseStorage; // Removed assignment
    console.log("initEditor called. Storage:", storage); // Debug log
    canvas = document.getElementById('privacy-canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    // イベントリスナーの設定
    // マウス/タッチ両対応
    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('touchend', handleEnd);

    // グローバル関数公開
    window.selectTool = (tool) => {
        currentTool = tool;
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tool-${tool}`).classList.add('active');

        // UI表示制御
        const stampOptions = document.getElementById('stamp-options');
        const sizeControl = document.getElementById('stamp-size-control');

        if (tool === 'stamp') {
            stampOptions.style.display = 'flex';
            sizeControl.style.display = 'flex';
        } else {
            stampOptions.style.display = 'none';
            sizeControl.style.display = 'none';
            selectedStampId = null; // ツール切り替えで選択解除
            render();
        }
    };

    window.selectImageStamp = (src) => {
        isImageStamp = true;
        currentTool = 'stamp';
        currentStampImageSrc = src;

        window.selectTool('stamp');
        updateStampSelectionUI(event ? event.currentTarget : null);
    };

    window.handleCustomStamp = (input) => {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                window.selectImageStamp(e.target.result);
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    window.selectStamp = (stamp) => {
        isImageStamp = false;
        currentStamp = stamp;

        window.selectTool('stamp');
        updateStampSelectionUI(event ? event.currentTarget : null);
    };

    window.updateStampSize = (val) => {
        if (selectedStampId) {
            const s = stamps.find(s => s.id === selectedStampId);
            if (s) {
                s.scale = parseFloat(val);
                render();
            }
        }
    };

    window.undoCanvas = () => {
        // スタンプのUndo: 最後に追加したスタンプを削除
        if (stamps.length > 0) {
            stamps.pop();
            selectedStampId = null;
            render();
            return;
        }

        // ぼかしのUndo: Base Layerを戻す
        if (history.length > 0) {
            const lastState = history.pop();
            const img = new Image();
            img.src = lastState;
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0); // Base Layer描画 (これだとrenderloopと競合するので要調整)
                // 本来はBaseLayer用の別Canvasを持つべきだが、簡易的に
                // historyには "Base Layer Only" の画像が入っている前提
                // render関数内で drawImage(baseLayerImage) を呼ぶ形にする
                // ここでは簡易的に「Undoしたらその画像をBaseとして再セット」
                baseLayerImage.src = lastState;
            };
        }
    };

    window.closeEditor = () => {
        document.getElementById('privacy-editor-modal').classList.remove('active');
    };

    window.closeReviewModal = () => {
        document.getElementById('review-guide-modal').classList.remove('active');
    };

    // UI初期化
    window.selectTool('stamp');
};

const updateStampSelectionUI = (target) => {
    document.querySelectorAll('.stamp-option').forEach(o => o.classList.remove('selected'));
    if (target) target.classList.add('selected');
};

let baseLayerImage = new Image(); // ぼかし加工後のベース画像

export const openEditorModal = (imageSrc) => {
    const modal = document.getElementById('privacy-editor-modal');
    modal.classList.add('active');

    stamps = []; // スタンプリセット
    history = [];
    selectedStampId = null;

    originalImage = new Image();
    originalImage.crossOrigin = "anonymous";
    originalImage.src = imageSrc;
    originalImage.onload = () => {
        // Init Canvas Size
        const wrapper = document.querySelector('.editor-canvas-wrapper');
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

        // Draw Base
        ctx.drawImage(originalImage, 0, 0, w, h);

        // Save to Base Layer Image
        baseLayerImage.src = canvas.toDataURL();
    };
};

// --- Input Handling ---

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

function handleStart(e) {
    e.preventDefault();
    const pos = getPos(e);
    isDragging = true;
    dragStartX = pos.x;
    dragStartY = pos.y;

    if (currentTool === 'stamp') {
        // スタンプ選択判定 (最前面から走査)
        let hit = false;
        for (let i = stamps.length - 1; i >= 0; i--) {
            const s = stamps[i];
            // 簡易ヒットテスト (中心から一定距離)
            // 画像サイズなどはscaleを考慮
            const halfSize = (DEFAULT_STAMP_SIZE * s.scale) / 2 * (s.ratio || 1) * 1.5; // 少し広めに
            if (Math.abs(pos.x - s.x) < halfSize && Math.abs(pos.y - s.y) < halfSize) {
                selectedStampId = s.id;
                hit = true;
                // スライダーの値を同期
                document.getElementById('stamp-size-slider').value = s.scale;
                render();
                return; // ドラッグ開始
            }
        }

        // ヒットしなければ新規スタンプ追加
        if (!hit) {
            addStamp(pos.x, pos.y);
            render();
        }
    } else if (currentTool === 'blur') {
        // Blur Mode: Save History first
        history.push(baseLayerImage.src);
        if (history.length > 5) history.shift();

        // Draw Blur directly to context (visual feedback)
        applyBlur(pos.x, pos.y);
    }
}

function handleMove(e) {
    e.preventDefault();
    if (!isDragging) return;
    const pos = getPos(e);

    if (currentTool === 'stamp') {
        // 選択中スタンプを移動
        if (selectedStampId) {
            const s = stamps.find(s => s.id === selectedStampId);
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

function handleEnd(e) {
    if (currentTool === 'blur' && isDragging) {
        // Blur操作終了時、現在のCanvasの状態をBaseLayerImageに焼き付ける
        // (スタンプは一時的に非表示にしてBaseだけ保存する必要があるが、
        //  BlurはCanvas直接描画なので、今のCanvasには「Base + Blur + Stamps」が描かれてしまっている)
        // Correct approach:
        // 1. Draw Base 2. Apply Blur -> Save to Base 3. Draw Stamps
        // 今回の簡易実装では: Blur描画はCanvasに直接行われる。
        // End時に再度BaseLayerImageを更新する。
        // ただし、スタンプが上にあるとそれもBaseに含まれてしまう問題がある。

        // 解決策: Blurモード中はスタンプを描画しない？いや、見ながらやりたい。
        // 結論: Blurは「BaseLayerImage」に対して適用すべき。
        // -> 複雑になるので、「Blurモード中はスタンプを非表示」にして、
        //    操作終了後にBaseLayerを更新し、スタンプを再表示するフローにする。
        updateBaseLayer();
    }
    isDragging = false;
}

function updateBaseLayer() {
    // 現在のCanvas（Blurが描画されている）から、スタンプを除外して保存したいが...
    // レイヤー分けしていないのでCanvas直接描画のBlurは取り消せない。
    // 「Blurモード」のときは render() を呼ばず、ctx.draw... で直接描いている。
    // なので、現在のCanvas状態 ＝ 新しいBaseLayer になる（スタンプが描画されていなければ）。

    // Blurモード開始時に render(false) // false = no stamps を呼んでから描画開始すべき。
    // (handleStartで修正が必要だが、今回は簡易的に)

    baseLayerImage.src = canvas.toDataURL();
}

function addStamp(x, y) {
    const id = Date.now().toString();

    if (isImageStamp && currentStampImageSrc) {
        const img = new Image();
        img.src = currentStampImageSrc;
        img.onload = () => { render(); }; // 読み込み完了後に再描画

        stamps.push({
            id: id,
            type: 'image',
            imgObj: img,
            x: x,
            y: y,
            scale: 1.0,
            ratio: 1.0 // 読み込み後に更新
        });
        selectedStampId = id;
    } else {
        stamps.push({
            id: id,
            type: 'text',
            text: currentStamp,
            x: x,
            y: y,
            scale: 1.0
        });
        selectedStampId = id;
    }
}

function render(drawStamps = true) {
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Base Layer
    if (baseLayerImage.complete && baseLayerImage.src) {
        ctx.drawImage(baseLayerImage, 0, 0);
    }

    if (!drawStamps) return;

    // 2. Stamps
    stamps.forEach(s => {
        ctx.save();
        ctx.translate(s.x, s.y);
        const size = DEFAULT_STAMP_SIZE * s.scale;

        if (s.type === 'image') {
            if (s.imgObj && s.imgObj.complete) {
                // アスペクト比計算
                if (s.ratio === 1.0 && s.imgObj.height > 0) {
                    s.ratio = s.imgObj.width / s.imgObj.height;
                }
                const w = size * 2; // 少し大きめ
                const h = w / s.ratio;
                ctx.drawImage(s.imgObj, -w / 2, -h / 2, w, h);
            }
        } else {
            // Text
            ctx.font = `${size}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (s.text === 'YHD') {
                ctx.fillStyle = '#0ABAB5';
                ctx.font = `bold ${size}px sans-serif`;
                ctx.fillText("YHD", 0, 0);
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 3;
                ctx.strokeText("YHD", 0, 0);
            } else {
                ctx.fillText(s.text, 0, 0);
            }
        }

        // Selection Highlight
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
    // BlurはCanvasに直接描画（不可逆） -> UndoはHistoryで対応
    // スタンプが邪魔なので、Blur開始時にスタンプを非表示にする制御が必要
    // 今回はBlurモード中はスタンプを描画しないように render(false) する
    if (isDragging) { // Move中
        // 毎回Baseを描画しなおすと重いので、
        // 「現在のCanvas」に上書きしていく。
        // ただし、スタンプが描画されているとそれがぼかされてしまう。
        // -> handleStartで render(false) 済みとする。

        const size = 30;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.clip();

        // 簡易ぼかし: 縮小拡大描画
        // 重ね掛けすることで濃くなる
        try {
            ctx.filter = 'blur(5px)';
            ctx.drawImage(canvas, 0, 0); // 自分自身を描画
        } catch (e) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
        ctx.restore();
        ctx.filter = 'none';
    }
}

// Override handleStart specific for Blur handling logic
const _originalHandleStart = handleStart;
handleStart = (e) => {
    if (currentTool === 'blur') {
        // Blur開始時: スタンプを消してBaseLayerのみにする
        render(false);
        // その後、通常処理（History保存など）
    }
    _originalHandleStart(e);
};


// --- Save & Upload ---

window.saveEditedImage = async () => {
    // 選択枠を消すために再描画
    selectedStampId = null;
    render();

    // UI Feedback
    const saveBtn = document.querySelector('.editor-actions .btn-save');
    const originalBtnText = saveBtn ? saveBtn.textContent : '保存して次へ';
    if (saveBtn) {
        saveBtn.textContent = '保存中...';
        saveBtn.disabled = true;
    }

    try {
        // Wrap canvas.toBlob in a Promise to await it properly
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
                if (b) resolve(b);
                else reject(new Error("Canvas to Blob conversion failed"));
            }, 'image/jpeg', 0.9);
        });

        if (!blob) throw new Error("画像生成エラー: Blob is null");

        // 2. Upload to Firebase Storage
        if (!storage) throw new Error("Firebase Storageが初期化されていません。");

        const filename = `temp_reviews/${Date.now()}.jpg`;
        const storageRef = ref(storage, filename);

        await uploadBytes(storageRef, blob);
        const downloadURL = await getDownloadURL(storageRef);

        // 3. Show in Modal
        const previewImg = document.getElementById('review-generated-image');
        previewImg.src = downloadURL;

        const dlBtn = document.getElementById('download-image-btn');
        if (dlBtn) {
            // ボタンの動作: 新しいタブで画像を開く
            dlBtn.onclick = () => {
                window.open(downloadURL, '_blank');
            };
        }

        closeEditor();
        openReviewGuide();

        if (saveBtn) {
            saveBtn.textContent = '完了';
            saveBtn.disabled = false;
        }

    } catch (e) {
        console.error("Save Error:", e);
        alert("画像の保存に失敗しました。\n" + (e.message || "通信エラー等の可能性があります"));

        if (saveBtn) {
            saveBtn.textContent = originalBtnText;
            saveBtn.disabled = false;
        }
    }
};

// 画像の保存と次へ
// 画像の保存と次へ
// window.saveEditedImage = () => {
//     // Androidでの保存トラブル回避のため、BlobではなくDataURLを使用する
//     // これにより長押し保存がより確実に動作する可能性が高まる
//     const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

//     // モーダル内に画像を表示する
//     const previewImg = document.getElementById('review-generated-image');
//     if (previewImg) {
//         previewImg.src = dataUrl;

//         // 画像読み込み後にモーダル切り替え
//         // DataURLは同期的だが、念のためonloadで待つ
//         previewImg.onload = () => {
//             closeEditor();
//             openReviewGuide();
//         };
//         // 万が一onloadが発火しない場合への保険
//         setTimeout(() => {
//             if (document.getElementById('privacy-editor-modal').classList.contains('active')) {
//                 closeEditor();
//                 openReviewGuide();
//             }
//         }, 500);
//     } else {
//         closeEditor();
//         openReviewGuide();
//     }
// };

// ダウンロードボタンのイベントリスナー設定
// window.downloadEditedImage = () => {
//     const previewImg = document.getElementById('review-generated-image');
//     if (previewImg && previewImg.src) {
//         const a = document.createElement('a');
//         a.href = previewImg.src;
//         a.download = `yhd_review_${Date.now()}.jpg`;
//         document.body.appendChild(a);
//         a.click();
//         document.body.removeChild(a);
//     } else {
//         alert("画像の生成に失敗しました。もう一度お試しください。");
//     }
// };

// HTML側のボタンにイベントリスナーを追加するためのフック
// setTimeout(() => {
//     const dlBtn = document.getElementById('download-image-btn');
//     if (dlBtn) {
//         dlBtn.onclick = window.downloadEditedImage;
//     }
// }, 1000); // DOM読み込み待ち

const openReviewGuide = () => {
    document.getElementById('review-guide-modal').classList.add('active');
};

// レビュー機能
window.copyComment = () => {
    const input = document.getElementById('review-comment-input');
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(input.value).then(() => {
        alert("コメントをコピーしました！");
    }).catch(err => {
        console.error(err);
        alert("コピーに失敗しました。手動でコピーしてください。");
    });
};

window.goToGoogleMaps = () => {
    // ユーザー提供の共有リンクを使用 (宮崎市検索は不評だったため元に戻す)
    const url = "https://share.google/mncHYcWcXR98gDdJT";
    window.open(url, '_blank');
};
