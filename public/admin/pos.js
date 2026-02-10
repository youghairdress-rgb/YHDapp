import { runAdminPage, showLoading, showContent, showError } from './admin-auth.js';
import { db } from './firebase-init.js';
// ▼▼▼ 修正: collectionGroup をインポート ▼▼▼
import {
    collection, getDocs, doc, getDoc, addDoc, setDoc, updateDoc,
    Timestamp, query, orderBy, collectionGroup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// ▲▲▲ 修正ここまで ▲▲▲

const posMain = async (auth, user) => {
    // --- State ---
    let customers = [];
    let menuCategories = [];
    let selectedMenus = [];
    let editingSaleId = null; // ★★★ 編集対象のSaleIDを保持
    let paymentMethod = null;
    let sourceBookingId = null; // 予約情報から来た場合のIDを保持
    let sourceBookingData = null;
    let sourceCustomerId = null;
    let sourceCustomerName = '';

    // --- DOM Elements ---
    const customerInput = document.getElementById('customer-input');
    const customerDatalist = document.getElementById('customer-datalist');
    const selectedMenuList = document.getElementById('selected-menu-list');
    const addMenuModalBtn = document.getElementById('add-menu-modal-btn');
    const addMenuModal = document.getElementById('add-menu-modal');
    const menuAccordionContainer = document.getElementById('menu-accordion-container');

    // Calculation elements
    const subtotalEl = document.getElementById('subtotal');
    const discountValueInput = document.getElementById('discount-value');
    const discountTypeSelect = document.getElementById('discount-type');
    const lengthFeeSelect = document.getElementById('length-fee');
    const taxExclusiveTotalEl = document.getElementById('tax-exclusive-total');
    const taxAmountEl = document.getElementById('tax-amount');
    const pointDiscountInput = document.getElementById('point-discount');
    const deductionAmountInput = document.getElementById('deduction-amount'); // 追加
    const totalEl = document.getElementById('total');

    // Cash Payment Elements
    const cashPaymentFields = document.getElementById('cash-payment-fields');
    const amountReceivedInput = document.getElementById('amount-received');
    const changeDueEl = document.getElementById('change-due');

    // Action elements
    const paymentBtns = document.querySelectorAll('.payment-btn');
    const completeSaleBtn = document.getElementById('complete-sale-btn');

    // --- Functions ---
    const loadInitialData = async () => {
        // ... (省略)
    };

    // ... (省略)

    const calculateTotals = () => {
        const subtotal = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
        const discountValue = parseFloat(discountValueInput.value) || 0;
        const discountType = discountTypeSelect.value;
        const lengthFee = parseInt(lengthFeeSelect.value) || 0;
        const pointDiscount = parseFloat(pointDiscountInput.value) || 0;
        const deductionAmount = parseFloat(deductionAmountInput.value) || 0; // 追加

        let discountAmount = 0;
        if (discountType === 'yen') {
            discountAmount = discountValue;
        } else {
            discountAmount = Math.round(subtotal * (discountValue / 100));
        }

        const taxExclusiveTotal = subtotal - discountAmount + lengthFee;
        const taxAmount = Math.floor(taxExclusiveTotal * 0.1);

        // 修正: 差引額（deductionAmount）も引く
        const total = taxExclusiveTotal + taxAmount - pointDiscount - deductionAmount;

        subtotalEl.textContent = `¥${subtotal.toLocaleString()}`;
        taxExclusiveTotalEl.textContent = `¥${taxExclusiveTotal.toLocaleString()}`;
        taxAmountEl.textContent = `¥${taxAmount.toLocaleString()}`;
        totalEl.textContent = `¥${total.toLocaleString()}`;

        // 追加: おつり計算
        calculateChange(total);

        validateForm();
    };

    const validateForm = () => {
        const customerName = customerInput.value.trim();
        let isValid = customerName && selectedMenus.length > 0 && paymentMethod;

        if (isValid && paymentMethod === '現金') {
            // 現金の場合は預り金が合計以上であること
            const subtotal = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
            const discountValue = parseFloat(discountValueInput.value) || 0;
            const discountType = discountTypeSelect.value;
            const lengthFee = parseInt(lengthFeeSelect.value) || 0;
            const pointDiscount = parseFloat(pointDiscountInput.value) || 0;
            const deductionAmount = parseFloat(deductionAmountInput.value) || 0; // 追加

            // 再計算 (冗長だが確実性のため)
            let discountAmount = (discountType === 'yen') ? discountValue : Math.round(subtotal * (discountValue / 100));
            const taxExclusiveTotal = subtotal - discountAmount + lengthFee;
            const taxAmount = Math.floor(taxExclusiveTotal * 0.1);

            // 修正: 差引額も引く
            const total = taxExclusiveTotal + taxAmount - pointDiscount - deductionAmount;

            const received = parseInt(amountReceivedInput.value) || 0;
            if (received < total) {
                isValid = false;
            }
        }

        completeSaleBtn.disabled = !isValid;
    };

    // ... (省略)

    const completeSale = async () => {
        // ... (省略)
        const pointDiscount = parseFloat(pointDiscountInput.value) || 0;
        const deductionAmount = parseFloat(deductionAmountInput.value) || 0; // 追加

        let discountAmount = (discountType === 'yen') ? discountValue : Math.round(subtotal * (discountValue / 100));
        const taxExclusiveTotal = subtotal - discountAmount + lengthFee;
        const taxAmount = Math.floor(taxExclusiveTotal * 0.1);

        // 修正: 差引額も引く
        const total = taxExclusiveTotal + taxAmount - pointDiscount - deductionAmount;

        const now = Timestamp.now(); // 会計日時

        const saleData = {
            customerId: customerId,
            customerName: customerName,
            menus: selectedMenus,
            subtotal: subtotal,
            discountValue: discountValue,
            discountType: discountType,
            lengthFee: lengthFee,
            pointDiscount: pointDiscount,
            deductionAmount: deductionAmount, // 追加: DBに保存
            total: total,
            paymentMethod: paymentMethod,
            // ... (省略)
        };

        // ... (省略)
    };

    const resetForm = () => {
        // ... (省略)
        pointDiscountInput.value = '0';
        deductionAmountInput.value = '0'; // 追加
        // ... (省略)
    };

    const checkUrlParams = async () => {
        // ... (省略)
        if (saleId) {
            // ... (省略)
            if (saleDoc.exists()) {
                const sale = saleDoc.data();

                // ... (省略)
                lengthFeeSelect.value = sale.lengthFee || 0;
                pointDiscountInput.value = sale.pointDiscount || 0;
                deductionAmountInput.value = sale.deductionAmount || 0; // 追加: 復元
                // ... (省略)
            }
            // ... (省略)
        }
        // ... (省略)
    };

    // --- Event Listeners ---
    // ... (省略)

    [discountValueInput, discountTypeSelect, lengthFeeSelect, pointDiscountInput, deductionAmountInput].forEach(el => {
        el.addEventListener('input', calculateTotals);
    });

    // 追加: 預り金の入力イベント
    if (amountReceivedInput) {
        amountReceivedInput.addEventListener('input', () => {
            calculateTotals();
            // validateFormはcalculateTotals内で呼ばれる
        });
    }

    customerInput.addEventListener('input', validateForm);

    paymentBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            paymentBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            paymentMethod = btn.dataset.method;

            // 追加: 現金の場合のみフィールド表示
            if (paymentMethod === '現金') {
                cashPaymentFields.style.display = 'block';
            } else {
                cashPaymentFields.style.display = 'none';
            }

            calculateTotals(); // おつり再計算のため
            validateForm();
        });
    });

    completeSaleBtn.addEventListener('click', completeSale);

    // --- Initial Load ---
    showLoading("会計ページを準備中...");
    await loadInitialData();
    // ▼▼▼ 修正: ページ読み込み時の関数呼び出しを変更 ▼▼▼
    await checkUrlParams();
    // ▲▲▲ 修正ここまで ▲▲▲
};

runAdminPage(posMain);