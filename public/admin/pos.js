import { runAdminPage, showLoading, showContent, showError } from './admin-auth.js';
import { db } from './firebase-init.js';
// ▼▼▼ 修正: collectionGroup をインポート ▼▼▼
import { 
    collection, getDocs, doc, getDoc, addDoc, setDoc,
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
    const totalEl = document.getElementById('total');

    // Action elements
    const paymentBtns = document.querySelectorAll('.payment-btn');
    const completeSaleBtn = document.getElementById('complete-sale-btn');

    // --- Functions ---
    const loadInitialData = async () => {
        // ▼▼▼ 修正: 顧客とメニューの読み込みを並列化＆collectionGroupを使用 ▼▼▼
        const [customersSnapshot, categoriesSnapshot, menusSnapshot] = await Promise.all([
            getDocs(query(collection(db, 'users'), orderBy('kana'))),
            getDocs(query(collection(db, 'service_categories'), orderBy('order'))),
            getDocs(query(collectionGroup(db, 'menus'), orderBy('order')))
        ]);

        // 顧客リストの処理
        customers = customersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        customerDatalist.innerHTML = customers.map(c => `<option value="${c.name}"></option>`).join('');

        // メニューとカテゴリの処理
        const allMenus = menusSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            categoryId: doc.ref.parent.parent.id // 親カテゴリのIDを取得
        }));

        menuCategories = categoriesSnapshot.docs.map(catDoc => {
            const category = { id: catDoc.id, ...catDoc.data() };
            return {
                ...category,
                menus: allMenus.filter(menu => menu.categoryId === category.id)
            };
        });

        menuAccordionContainer.innerHTML = '';
        menuCategories.forEach(category => {
            const accordion = document.createElement('details');
            accordion.className = 'menu-category-accordion';
            
            let menuHtml = '';
            category.menus.forEach(menu => { // 修正: `category.menus` を使用
                menuHtml += `<div class="menu-item-selectable" data-menu='${JSON.stringify(menu)}'>
                                <span>${menu.name}</span>
                                <span>¥${menu.price.toLocaleString()}</span>
                             </div>`;
            });

            accordion.innerHTML = `
                <summary class="accordion-header">${category.name}</summary>
                <div class="accordion-content">${menuHtml}</div>
            `;
            menuAccordionContainer.appendChild(accordion);
        });
        // ▲▲▲ 修正ここまで ▲▲▲
        
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
        
        let customerId = selectedCustomer ? selectedCustomer.id : null;
        if (!customerId && sourceCustomerId) {
            customerId = sourceCustomerId;
        }
        
        const subtotal = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
        const discountValue = parseFloat(discountValueInput.value) || 0;
        const discountType = discountTypeSelect.value;
        const lengthFee = parseInt(lengthFeeSelect.value) || 0;
        const pointDiscount = parseFloat(pointDiscountInput.value) || 0;
        let discountAmount = (discountType === 'yen') ? discountValue : Math.round(subtotal * (discountValue / 100));
        const taxExclusiveTotal = subtotal - discountAmount + lengthFee;
        const taxAmount = Math.floor(taxExclusiveTotal * 0.1);
        const total = taxExclusiveTotal + taxAmount - pointDiscount;
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
            total: total,
            paymentMethod: paymentMethod,
            createdAt: now, 
            bookingId: sourceBookingId,
            reservationTime: sourceBookingData ? sourceBookingData.startTime : now
        };

        // ▼▼▼ 修正: 編集中の場合、`createdAt` と `reservationTime` を上書きしない ▼▼▼
        if (editingSaleId) {
            // 編集の場合、元の予約時間と作成時間を保持する（もしあれば）
            try {
                const originalSaleDoc = await getDoc(doc(db, 'sales', editingSaleId));
                if (originalSaleDoc.exists()) {
                    const originalData = originalSaleDoc.data();
                    saleData.createdAt = originalData.createdAt || now; // 元の会計日を保持
                    saleData.reservationTime = originalData.reservationTime || (sourceBookingData ? sourceBookingData.startTime : now); // 元の予約日を保持
                }
            } catch (e) {
                console.warn("元の会計情報の読み込みに失敗:", e);
                // 失敗した場合は、新しい会計情報（createdAt: nowなど）でそのまま進む
            }
        }
        // ▲▲▲ 修正ここまで ▲▲▲

        try {
            completeSaleBtn.disabled = true;
            completeSaleBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 処理中...';
            
            if (editingSaleId) {
                // ▼▼▼ 修正: `setDoc` を使用して既存のドキュメントを上書き ▼▼▼
                await setDoc(doc(db, 'sales', editingSaleId), saleData);
                // ▲▲▲ 修正ここまで ▲▲▲
            } else {
                await addDoc(collection(db, 'sales'), saleData);
                if (sourceBookingId) {
                    const bookingRef = doc(db, "reservations", sourceBookingId);
                    await setDoc(bookingRef, { status: 'completed' }, { merge: true });
                }
            }
            
            if (customerId) {
                // ▼▼▼ 追加: 顧客の最終来店日を更新 ▼▼▼
                const userRef = doc(db, "users", customerId);
                await updateDoc(userRef, {
                    lastVisit: saleData.reservationTime
                });
                // ▲▲▲ 追加ここまで ▲▲▲

                const customerNameEncoded = encodeURIComponent(customerName);
                // ▼▼▼ 修正: 編集完了時は売上分析ページに戻る ▼▼▼
                if (editingSaleId) {
                    alert('会計情報を更新しました。売上分析ページに戻ります。');
                    window.location.href = './sales.html';
                } else {
                    window.location.href = `./customers.html?customerId=${customerId}&customerName=${customerNameEncoded}`;
                }
                // ▲▲▲ 修正ここまで ▲▲▲
            } else {
                // ▼▼▼ 修正: 編集完了時は売上分析ページに戻る ▼▼▼
                if (editingSaleId) {
                    alert('会計情報を更新しました。売上分析ページに戻ります。');
                    window.location.href = './sales.html';
                } else {
                    alert('会計が完了しました。顧客管理ページに戻ります。');
                    window.location.href = './customers.html';
                }
                // ▲▲▲ 修正ここまで ▲▲▲
            }

        } catch (error) {
            console.error("会計処理に失敗:", error);
            alert("会計処理に失敗しました。");
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
        sourceBookingData = null;
        sourceCustomerId = null;
        sourceCustomerName = '';
        
        paymentBtns.forEach(btn => btn.classList.remove('active'));
        renderSelectedMenus();
        calculateTotals();
    };

    // ▼▼▼ 修正: `checkUrlParams` を `saleId` に対応 ▼▼▼
    const checkUrlParams = async () => {
        const params = new URLSearchParams(window.location.search);
        sourceBookingId = params.get('bookingId');
        sourceCustomerId = params.get('customerId');
        sourceCustomerName = params.get('customerName');
        const saleId = params.get('saleId');

        if (saleId) { 
            editingSaleId = saleId; // 編集モードに設定
            showLoading("会計履歴を読み込み中...");
            try {
                const saleDoc = await getDoc(doc(db, "sales", saleId));
                if (saleDoc.exists()) {
                    const sale = saleDoc.data();
                    
                    // フォームにデータを充填
                    customerInput.value = sale.customerName;
                    selectedMenus = sale.menus || [];
                    sourceCustomerId = sale.customerId; // 顧客IDをセット
                    sourceBookingId = sale.bookingId; // 元の予約IDもセット
                    
                    discountValueInput.value = sale.discountValue || 0;
                    discountTypeSelect.value = sale.discountType || 'yen';
                    lengthFeeSelect.value = sale.lengthFee || 0;
                    pointDiscountInput.value = sale.pointDiscount || 0;
                    
                    paymentMethod = sale.paymentMethod;
                    if (paymentMethod) {
                        paymentBtns.forEach(btn => {
                            btn.classList.toggle('active', btn.dataset.method === paymentMethod);
                        });
                    }
                    
                    // 予約データを取得（`reservationTime`を保持するため）
                    if (sourceBookingId) {
                         const bookingDoc = await getDoc(doc(db, "reservations", sourceBookingId));
                         if (bookingDoc.exists()) {
                             sourceBookingData = bookingDoc.data();
                         }
                    }

                    renderSelectedMenus();
                    calculateTotals();
                } else {
                    showError("該当する会計履歴が見つかりません。");
                }
            } catch (error) {
                showError("会計履歴の読み込みに失敗しました。");
            } finally {
                showContent();
            }
        } else if (sourceBookingId) {
            // 予約IDがある場合（予約管理からの遷移）
            showLoading("予約情報を読み込み中...");
            try {
                const bookingDoc = await getDoc(doc(db, "reservations", sourceBookingId));
                if (bookingDoc.exists()) {
                    const booking = bookingDoc.data();
                    sourceBookingData = booking; 
                    customerInput.value = booking.customerName;
                    selectedMenus = booking.selectedMenus || [];
                    sourceCustomerId = booking.customerId; 
                    renderSelectedMenus();
                    calculateTotals();
                }
            } catch (error) {
                showError("予約情報の読み込みに失敗しました。");
            } finally {
                showContent();
            }
        } else if (sourceCustomerId && sourceCustomerName) {
            // 顧客IDと名前がある場合（顧客管理からの遷移）
            customerInput.value = sourceCustomerName;
            renderSelectedMenus();
            calculateTotals();
            showContent();
        } else {
             showContent();
        }
    };
    // ▲▲▲ 修正ここまで ▲▲▲

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
    showLoading("会計ページを準備中...");
    await loadInitialData();
    // ▼▼▼ 修正: ページ読み込み時の関数呼び出しを変更 ▼▼▼
    await checkUrlParams();
    // ▲▲▲ 修正ここまで ▲▲▲
};

runAdminPage(posMain);