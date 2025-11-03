import { runAdminPage, showLoading, showContent, showError } from './admin-auth.js';
import { db } from './firebase-init.js';
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc,
    Timestamp, query, orderBy 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const posMain = async (auth, user) => {
    // --- State ---
    let customers = [];
    let menuCategories = [];
    let selectedMenus = [];
    let editingSaleId = null;
    let paymentMethod = null;
    let sourceBookingId = null; // 予約情報から来た場合のIDを保持

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
    const totalEl = document.getElementById('total');

    // Action elements
    const paymentBtns = document.querySelectorAll('.payment-btn');
    const completeSaleBtn = document.getElementById('complete-sale-btn');

    // --- Functions ---
    const loadInitialData = async () => {
        const customersSnapshot = await getDocs(query(collection(db, 'users'), orderBy('kana')));
        customers = customersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        customerDatalist.innerHTML = customers.map(c => `<option value="${c.name}"></option>`).join('');

        const categoriesSnapshot = await getDocs(query(collection(db, 'service_categories'), orderBy('order')));
        menuAccordionContainer.innerHTML = '';
        menuCategories = [];
        for (const catDoc of categoriesSnapshot.docs) {
            const category = { id: catDoc.id, ...catDoc.data(), menus: [] };
            const menusSnapshot = await getDocs(query(collection(db, `service_categories/${catDoc.id}/menus`), orderBy('order')));
            
            const accordion = document.createElement('details');
            accordion.className = 'menu-category-accordion';
            
            let menuHtml = '';
            menusSnapshot.forEach(menuDoc => {
                const menu = { id: menuDoc.id, ...menuDoc.data() };
                category.menus.push(menu);
                menuHtml += `<div class="menu-item-selectable" data-menu='${JSON.stringify(menu)}'>
                                <span>${menu.name}</span>
                                <span>¥${menu.price.toLocaleString()}</span>
                             </div>`;
            });

            accordion.innerHTML = `
                <summary class="accordion-header">${category.name}</summary>
                <div class="accordion-content">${menuHtml}</div>
            `;
            menuCategories.push(category);
            menuAccordionContainer.appendChild(accordion);
        }
        
        menuAccordionContainer.querySelectorAll('.menu-item-selectable').forEach(item => {
            item.addEventListener('click', (e) => {
                const menuData = JSON.parse(e.currentTarget.dataset.menu);
                addMenu(menuData);
                addMenuModal.style.display = 'none';
            });
        });
    };

    const addMenu = (menu) => {
        selectedMenus.push(menu);
        renderSelectedMenus();
        calculateTotals();
    };

    const removeMenu = (index) => {
        selectedMenus.splice(index, 1);
        renderSelectedMenus();
        calculateTotals();
    };

    const renderSelectedMenus = () => {
        selectedMenuList.innerHTML = '';
        if (selectedMenus.length === 0) {
            selectedMenuList.innerHTML = '<li class="placeholder">メニューを追加してください</li>';
            return;
        }
        selectedMenus.forEach((menu, index) => {
            const li = document.createElement('li');
            li.className = 'selected-menu-item';
            li.innerHTML = `
                <span>${menu.name}</span>
                <div class="item-actions">
                    <span>¥${menu.price.toLocaleString()}</span>
                    <button class="icon-button small-btn delete-btn"><i class="fa-solid fa-times"></i></button>
                </div>
            `;
            li.querySelector('.delete-btn').addEventListener('click', () => removeMenu(index));
            selectedMenuList.appendChild(li);
        });
    };

    const calculateTotals = () => {
        const subtotal = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
        const discountValue = parseFloat(discountValueInput.value) || 0;
        const discountType = discountTypeSelect.value;
        const lengthFee = parseInt(lengthFeeSelect.value) || 0;
        const pointDiscount = parseFloat(pointDiscountInput.value) || 0;

        let discountAmount = 0;
        if (discountType === 'yen') {
            discountAmount = discountValue;
        } else {
            discountAmount = Math.round(subtotal * (discountValue / 100));
        }

        const taxExclusiveTotal = subtotal - discountAmount + lengthFee;
        const taxAmount = Math.floor(taxExclusiveTotal * 0.1);
        const total = taxExclusiveTotal + taxAmount - pointDiscount;

        subtotalEl.textContent = `¥${subtotal.toLocaleString()}`;
        taxExclusiveTotalEl.textContent = `¥${taxExclusiveTotal.toLocaleString()}`;
        taxAmountEl.textContent = `¥${taxAmount.toLocaleString()}`;
        totalEl.textContent = `¥${total.toLocaleString()}`;
        
        validateForm();
    };
    
    const validateForm = () => {
        const customerName = customerInput.value.trim();
        const isValid = customerName && selectedMenus.length > 0 && paymentMethod;
        completeSaleBtn.disabled = !isValid;
    };

    const completeSale = async () => {
        const customerName = customerInput.value.trim();
        const selectedCustomer = customers.find(c => c.name === customerName);
        
        const subtotal = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
        const discountValue = parseFloat(discountValueInput.value) || 0;
        const discountType = discountTypeSelect.value;
        const lengthFee = parseInt(lengthFeeSelect.value) || 0;
        const pointDiscount = parseFloat(pointDiscountInput.value) || 0;
        let discountAmount = (discountType === 'yen') ? discountValue : Math.round(subtotal * (discountValue / 100));
        const taxExclusiveTotal = subtotal - discountAmount + lengthFee;
        const taxAmount = Math.floor(taxExclusiveTotal * 0.1);
        const total = taxExclusiveTotal + taxAmount - pointDiscount;

        const saleData = {
            customerId: selectedCustomer ? selectedCustomer.id : null,
            customerName: customerName,
            menus: selectedMenus,
            subtotal: subtotal,
            discountValue: discountValue,
            discountType: discountType,
            lengthFee: lengthFee,
            pointDiscount: pointDiscount,
            total: total,
            paymentMethod: paymentMethod,
            createdAt: Timestamp.now(),
            bookingId: sourceBookingId // 元の予約IDを保存
        };

        try {
            completeSaleBtn.disabled = true;
            completeSaleBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 処理中...';
            
            if (editingSaleId) {
                await setDoc(doc(db, 'sales', editingSaleId), saleData, { merge: true });
                alert('会計情報を更新しました。');
            } else {
                await addDoc(collection(db, 'sales'), saleData);
                // ▼▼▼ 予約ステータスを更新する処理を追加 ▼▼▼
                if (sourceBookingId) {
                    const bookingRef = doc(db, "reservations", sourceBookingId);
                    await setDoc(bookingRef, { status: 'completed' }, { merge: true });
                }
                alert('会計が完了しました。');
            }
            resetForm();
        } catch (error) {
            console.error("会計処理に失敗:", error);
            alert("会計処理に失敗しました。");
        } finally {
            completeSaleBtn.disabled = false;
            completeSaleBtn.innerHTML = '<i class="fa-solid fa-check"></i> 会計完了';
            validateForm();
        }
    };
    
    const resetForm = () => {
        customerInput.value = '';
        selectedMenus = [];
        discountValueInput.value = '0';
        discountTypeSelect.value = 'yen';
        lengthFeeSelect.value = '0';
        pointDiscountInput.value = '0';
        paymentMethod = null;
        editingSaleId = null;
        sourceBookingId = null;
        
        paymentBtns.forEach(btn => btn.classList.remove('active'));
        renderSelectedMenus();
        calculateTotals();
    };

    const checkUrlParams = async () => {
        const params = new URLSearchParams(window.location.search);
        sourceBookingId = params.get('bookingId'); // bookingIdをグローバル変数に保持
        if (!sourceBookingId) return;

        showLoading("予約情報を読み込み中...");
        try {
            const bookingDoc = await getDoc(doc(db, "reservations", sourceBookingId));
            if (bookingDoc.exists()) {
                const booking = bookingDoc.data();
                customerInput.value = booking.customerName;
                selectedMenus = booking.selectedMenus || [];
                renderSelectedMenus();
                calculateTotals();
            }
        } catch (error) {
            showError("予約情報の読み込みに失敗しました。");
        } finally {
            showContent();
        }
    };

    // --- Event Listeners ---
    addMenuModalBtn.addEventListener('click', () => addMenuModal.style.display = 'flex');
    addMenuModal.querySelector('.close-modal-btn').addEventListener('click', () => addMenuModal.style.display = 'none');
    
    [discountValueInput, discountTypeSelect, lengthFeeSelect, pointDiscountInput].forEach(el => {
        el.addEventListener('input', calculateTotals);
    });
    
    customerInput.addEventListener('input', validateForm);

    paymentBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            paymentBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            paymentMethod = btn.dataset.method;
            validateForm();
        });
    });
    
    completeSaleBtn.addEventListener('click', completeSale);
    
    // --- Initial Load ---
    await loadInitialData();
    renderSelectedMenus();
    calculateTotals();
    await checkUrlParams();
};

runAdminPage(posMain);

