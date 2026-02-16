/**
 * ui-core.js
 * Core UI logic: Phase switching, Loader, Modal, Basic helpers
 */

import { logger, setTextContent } from './helpers.js';
import { appState } from './state.js';

// --- Phase Management ---

export function changePhase(phaseId) {
    logger.log(`Changing phase to: ${phaseId}`);

    // Hide all phases EXCEPT the target
    document.querySelectorAll('.phase-container').forEach(el => {
        if (el.id === phaseId) return; // Skip the target phase
        el.classList.remove('active');
        setTimeout(() => el.style.display = 'none', 300);
    });

    // Show target phase
    const target = document.getElementById(phaseId);
    if (target) {
        target.style.display = 'flex';
        // Force reflow
        void target.offsetWidth;
        target.classList.add('active');

        // Scroll to top
        window.scrollTo(0, 0);
    } else {
        logger.error(`Phase element not found: ${phaseId}`);
    }
}

// --- Loading Screen ---

export function toggleLoader(show, text = "処理中...") {
    const loader = document.getElementById('global-loader');
    const loaderText = document.getElementById('loader-text');
    if (!loader) return;

    if (show) {
        if (loaderText) loaderText.textContent = text;
        loader.classList.remove('hidden');
        loader.style.display = 'flex';
    } else {
        loader.classList.add('hidden');
        setTimeout(() => loader.style.display = 'none', 300);
    }
}

let smartLoaderTimer = null;
const LOADING_MESSAGES = [
    "AIが分析中...",
    "骨格を診断しています...",
    "パーソナルカラーを判定中...",
    "髪質を解析しています...",
    "最適なスタイルを検索中...",
    "提案レポートを作成中..."
];

export function startSmartLoader() {
    toggleLoader(true, LOADING_MESSAGES[0]);
    let index = 1;
    smartLoaderTimer = setInterval(() => {
        if (index < LOADING_MESSAGES.length) {
            updateCaptureLoadingText(document.getElementById('loader-text'), LOADING_MESSAGES[index]);
            index++;
        }
    }, 2500);
}

export function stopSmartLoader() {
    if (smartLoaderTimer) clearInterval(smartLoaderTimer);
    toggleLoader(false);
}

export function updateCaptureLoadingText(element, text) {
    if (element) element.textContent = text;
}

// --- Modal ---

export function showModal(title, message, onOk = null) {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const okBtn = document.getElementById('modal-ok-btn');

    if (!modal || !titleEl || !messageEl || !okBtn) return;

    titleEl.textContent = title || "お知らせ";
    messageEl.textContent = message || "";

    // Clone to remove old listeners
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);

    newOkBtn.addEventListener('click', () => {
        hideModal();
        if (onOk) onOk();
    });

    // Show
    modal.style.visibility = 'visible'; // Ensure visibility
    modal.classList.add('active');
}

export function hideModal() {
    const modal = document.getElementById('custom-modal');
    if (modal) modal.classList.remove('active');
}

export function checkAllFilesUploaded(allUploaded) {
    const btn = document.getElementById('request-diagnosis-btn');
    if (btn) {
        btn.disabled = !allUploaded;
        if (allUploaded) {
            btn.classList.remove('btn-disabled');
        } else {
            btn.classList.add('btn-disabled');
        }
    }
}
