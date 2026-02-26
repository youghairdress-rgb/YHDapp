import { runAdminPage, showLoading, showContent, showError } from './admin-auth.js';
import { db } from './firebase-init.js';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  query,
  orderBy,
  collectionGroup,
} from 'firebase/firestore';

const posMain = async (auth, user) => {
  // --- State ---
  let customers = [];
  let menuCategories = [];
  let selectedMenus = [];
  let editingSaleId = null;
  let currentDraftId = null; // 追加: 現在編集中の下書きID
  let paymentMethod = null;
  let sourceBookingId = null;
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
  const deductionAmountInput = document.getElementById('deduction-amount');
  const totalEl = document.getElementById('total');
  const todayPaymentRow = document.getElementById('today-payment-row');
  const todayPaymentEl = document.getElementById('today-payment');

  // Cash Payment Elements
  const cashPaymentFields = document.getElementById('cash-payment-fields');
  const amountReceivedInput = document.getElementById('amount-received');
  const changeDueEl = document.getElementById('change-due');

  // Action elements
  const paymentBtns = document.querySelectorAll('.payment-btn');
  const saveDraftBtn = document.getElementById('save-draft-btn'); // 追加
  const openDraftsModalBtn = document.getElementById('open-drafts-modal-btn'); // 追加
  const draftListModal = document.getElementById('draft-list-modal'); // 追加
  const draftListContainer = document.getElementById('draft-list-container'); // 追加
  const draftCountBadge = document.getElementById('draft-count-badge'); // 追加
  const completeSaleBtn = document.getElementById('complete-sale-btn');

  // --- Functions ---
  const loadInitialData = async () => {
    const [customersSnapshot, categoriesSnapshot, menusSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'users'), orderBy('kana'))),
      getDocs(query(collection(db, 'service_categories'), orderBy('order'))),
      getDocs(query(collectionGroup(db, 'menus'), orderBy('order'))),
    ]);

    // 顧客リストの処理
    customers = customersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    customerDatalist.innerHTML = customers
      .map((c) => `<option value="${c.name}"></option>`)
      .join('');

    // メニューとカテゴリの処理
    const allMenus = menusSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      categoryId: doc.ref.parent.parent.id,
    }));

    menuCategories = categoriesSnapshot.docs.map((catDoc) => {
      const category = { id: catDoc.id, ...catDoc.data() };
      return {
        ...category,
        menus: allMenus.filter((menu) => menu.categoryId === category.id),
      };
    });

    menuAccordionContainer.innerHTML = '';
    menuCategories.forEach((category) => {
      const accordion = document.createElement('details');
      accordion.className = 'menu-category-accordion';

      let menuHtml = '';
      category.menus.forEach((menu) => {
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

    menuAccordionContainer.querySelectorAll('.menu-item-selectable').forEach((item) => {
      item.addEventListener('click', (e) => {
        const menuData = JSON.parse(e.currentTarget.dataset.menu);
        addMenu(menuData);
        addMenuModal.style.display = 'none';
      });
    });

    // 初期データロード時に下書き数も更新
    updateDraftCount();
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
    const deductionAmount = parseFloat(deductionAmountInput.value) || 0;

    let discountAmount;
    if (discountType === 'yen') {
      discountAmount = discountValue;
    } else {
      discountAmount = Math.round(subtotal * (discountValue / 100));
    }

    const taxExclusiveTotal = subtotal - discountAmount + lengthFee;
    const taxAmount = Math.floor(taxExclusiveTotal * 0.1);
    const total = taxExclusiveTotal + taxAmount - deductionAmount;

    subtotalEl.textContent = `¥${subtotal.toLocaleString()}`;
    taxExclusiveTotalEl.textContent = `¥${taxExclusiveTotal.toLocaleString()}`;
    taxAmountEl.textContent = `¥${taxAmount.toLocaleString()}`;
    totalEl.textContent = `¥${total.toLocaleString()}`;

    if (pointDiscount > 0) {
      const todayPaymentValue = total - pointDiscount;
      todayPaymentEl.textContent = `¥${todayPaymentValue.toLocaleString()}`;
      todayPaymentRow.style.display = 'flex';
    } else {
      todayPaymentRow.style.display = 'none';
    }

    calculateChange(total, pointDiscount);
    validateForm();
  };

  const validateForm = () => {
    const customerName = customerInput.value.trim();
    let isValid = customerName && selectedMenus.length > 0 && paymentMethod;

    if (isValid && paymentMethod === '現金') {
      const subtotal = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
      const discountValue = parseFloat(discountValueInput.value) || 0;
      const discountType = discountTypeSelect.value;
      const lengthFee = parseInt(lengthFeeSelect.value) || 0;
      const pointDiscount = parseFloat(pointDiscountInput.value) || 0;
      const deductionAmount = parseFloat(deductionAmountInput.value) || 0;

      const discountAmount =
        discountType === 'yen' ? discountValue : Math.round(subtotal * (discountValue / 100));
      const total = Math.floor((subtotal - discountAmount + lengthFee) * 1.1) - deductionAmount;
      const paymentDue = total - pointDiscount;
      const received = parseInt(amountReceivedInput.value) || 0;

      if (received < paymentDue) {
        isValid = false;
      }
    }

    completeSaleBtn.disabled = !isValid;
    // 一時保存は「顧客名」か「メニュー」のいずれかがあれば有効にする
    saveDraftBtn.disabled = !(customerName || selectedMenus.length > 0);
  };

  const calculateChange = (currentTotal, currentPoints = 0) => {
    if (paymentMethod !== '現金') return;
    const received = parseInt(amountReceivedInput.value) || 0;
    const change = received + currentPoints - currentTotal;

    if (change >= 0) {
      changeDueEl.textContent = `¥${change.toLocaleString()}`;
      changeDueEl.style.color = 'var(--text-color)';
    } else {
      changeDueEl.textContent = `不足 ¥${Math.abs(change).toLocaleString()}`;
      changeDueEl.style.color = 'var(--danger-color)';
    }
  };

  // --- Temporary Save (Draft) Logic ---
  const saveDraft = async () => {
    const customerName = customerInput.value.trim();
    if (!customerName && selectedMenus.length === 0) return;

    try {
      saveDraftBtn.disabled = true;
      saveDraftBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中';

      const draftData = {
        customerName,
        customerId: sourceCustomerId,
        menus: selectedMenus,
        discountValue: parseFloat(discountValueInput.value) || 0,
        discountType: discountTypeSelect.value,
        lengthFee: parseInt(lengthFeeSelect.value) || 0,
        pointDiscount: Math.max(0, parseFloat(pointDiscountInput.value) || 0),
        deductionAmount: parseFloat(deductionAmountInput.value) || 0,
        paymentMethod: paymentMethod,
        updatedAt: serverTimestamp(),
        bookingId: sourceBookingId
      };

      if (currentDraftId) {
        await setDoc(doc(db, 'pos_drafts', currentDraftId), draftData, { merge: true });
      } else {
        const docRef = await addDoc(collection(db, 'pos_drafts'), {
          ...draftData,
          createdAt: serverTimestamp()
        });
        currentDraftId = docRef.id;
      }

      alert('伝票を一時保存しました。');
      updateDraftCount();

    } catch (e) {
      console.error('一時保存に失敗:', e);
      alert('一時保存に失敗しました。');
    } finally {
      saveDraftBtn.disabled = false;
      saveDraftBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 一時保存';
    }
  };

  const updateDraftCount = async () => {
    try {
      const snap = await getDocs(collection(db, 'pos_drafts'));
      const count = snap.size;
      if (count > 0) {
        draftCountBadge.textContent = count;
        draftCountBadge.style.display = 'block';
      } else {
        draftCountBadge.style.display = 'none';
      }
    } catch (e) {
      console.warn('下書き数の取得失敗');
    }
  };

  const openDraftList = async () => {
    draftListContainer.innerHTML = '<p class="text-center">読み込み中...</p>';
    draftListModal.style.display = 'flex';

    try {
      const q = query(collection(db, 'pos_drafts'), orderBy('updatedAt', 'desc'));
      const snap = await getDocs(q);

      if (snap.empty) {
        draftListContainer.innerHTML = '<p class="text-center">保存された伝票はありません。</p>';
        return;
      }

      let html = '';
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const date = d.updatedAt ? d.updatedAt.toDate().toLocaleString('ja-JP') : '不明';
        const itemsCount = d.menus ? d.menus.length : 0;
        html += `
          <div class="draft-item" data-id="${docSnap.id}">
            <div class="draft-info">
              <h4>${d.customerName || '(名前なし)'}</h4>
              <p>${date} | ${itemsCount}項目</p>
            </div>
            <div class="draft-actions">
              <button class="button-secondary small-btn load-draft-btn">開く</button>
              <button class="button-danger small-btn delete-draft-btn"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        `;
      });
      draftListContainer.innerHTML = html;

      draftListContainer.querySelectorAll('.load-draft-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.closest('.draft-item').dataset.id;
          const draft = snap.docs.find(d => d.id === id).data();
          applyDraft(id, draft);
        });
      });

      draftListContainer.querySelectorAll('.delete-draft-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('この一時保存データを削除してもよろしいですか？')) {
            const id = e.target.closest('.draft-item').dataset.id;
            await deleteDoc(doc(db, 'pos_drafts', id));
            openDraftList();
            updateDraftCount();
            if (currentDraftId === id) currentDraftId = null;
          }
        });
      });

    } catch (e) {
      draftListContainer.innerHTML = '<p class="error-msg">読み込みに失敗しました。</p>';
    }
  };

  const applyDraft = (id, data) => {
    currentDraftId = id;
    customerInput.value = data.customerName || '';
    selectedMenus = data.menus || [];
    sourceCustomerId = data.customerId || null;
    sourceBookingId = data.bookingId || null;
    discountValueInput.value = data.discountValue || 0;
    discountTypeSelect.value = data.discountType || 'yen';
    lengthFeeSelect.value = data.lengthFee || 0;
    pointDiscountInput.value = data.pointDiscount || 0;
    deductionAmountInput.value = data.deductionAmount || 0;
    paymentMethod = data.paymentMethod || null;

    if (paymentMethod) {
      paymentBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.method === paymentMethod));
      cashPaymentFields.style.display = paymentMethod === '現金' ? 'block' : 'none';
    } else {
      paymentBtns.forEach(btn => btn.classList.remove('active'));
      cashPaymentFields.style.display = 'none';
    }

    renderSelectedMenus();
    calculateTotals();
    draftListModal.style.display = 'none';
    alert('保存された伝票を読み込みました。');
  };

  const completeSale = async () => {
    const customerName = customerInput.value.trim();
    const selectedCustomer = customers.find((c) => c.name === customerName);

    let customerId = selectedCustomer ? selectedCustomer.id : null;
    if (!customerId && sourceCustomerId) {
      customerId = sourceCustomerId;
    }

    const subtotal = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
    const discountValue = parseFloat(discountValueInput.value) || 0;
    const discountType = discountTypeSelect.value;
    const lengthFee = parseInt(lengthFeeSelect.value) || 0;
    const pointDiscount = parseFloat(pointDiscountInput.value) || 0;
    const deductionAmount = parseFloat(deductionAmountInput.value) || 0;

    let discountAmount =
      discountType === 'yen' ? discountValue : Math.round(subtotal * (discountValue / 100));
    const taxExclusiveTotal = subtotal - discountAmount + lengthFee;
    const taxAmount = Math.floor(taxExclusiveTotal * 0.1);
    const total = taxExclusiveTotal + taxAmount - deductionAmount;

    const now = Timestamp.now();
    const saleData = {
      customerId, customerName, menus: selectedMenus, subtotal,
      discountValue, discountType, lengthFee, pointDiscount, deductionAmount, total,
      paymentMethod, createdAt: now, bookingId: sourceBookingId,
      reservationTime: sourceBookingData ? sourceBookingData.startTime : now,
      amountReceived: paymentMethod === '現金' ? parseInt(amountReceivedInput.value) || 0 : null,
      changeDue: paymentMethod === '現金' ? (parseInt(amountReceivedInput.value) || 0) + pointDiscount - total : null,
    };

    try {
      completeSaleBtn.disabled = true;
      completeSaleBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 処理中...';

      if (editingSaleId) {
        await setDoc(doc(db, 'sales', editingSaleId), saleData);
      } else {
        await addDoc(collection(db, 'sales'), saleData);
        if (sourceBookingId) {
          await setDoc(doc(db, 'reservations', sourceBookingId), { status: 'completed' }, { merge: true });
        }
      }

      // 会計完了後、一時保存データがあれば削除
      if (currentDraftId) {
        try {
          await deleteDoc(doc(db, 'pos_drafts', currentDraftId));
        } catch (e) {
          console.warn('下書きの削除に失敗しましたが会計は完了しています');
        }
      }

      if (customerId) {
        await updateDoc(doc(db, 'users', customerId), { lastVisit: saleData.reservationTime });
        window.location.href = editingSaleId ? './sales.html' : `./customers.html?customerId=${customerId}&customerName=${encodeURIComponent(customerName)}`;
      } else {
        alert('会計が完了しました。');
        window.location.href = editingSaleId ? './sales.html' : './customers.html';
      }
    } catch (error) {
      console.error('会計処理失敗:', error);
      alert('会計処理に失敗しました。');
      completeSaleBtn.disabled = false;
      completeSaleBtn.innerHTML = '<i class="fa-solid fa-check"></i> 会計完了';
      validateForm();
    }
  };

  const checkUrlParams = async () => {
    const params = new URLSearchParams(window.location.search);
    sourceBookingId = params.get('bookingId');
    sourceCustomerId = params.get('customerId');
    sourceCustomerName = params.get('customerName');
    const saleId = params.get('saleId');

    if (saleId) {
      editingSaleId = saleId;
      showLoading('会計履歴を読み込み中...');
      try {
        const saleDoc = await getDoc(doc(db, 'sales', saleId));
        if (saleDoc.exists()) {
          const sale = saleDoc.data();
          customerInput.value = sale.customerName;
          selectedMenus = sale.menus || [];
          sourceCustomerId = sale.customerId;
          sourceBookingId = sale.bookingId;
          discountValueInput.value = sale.discountValue || 0;
          discountTypeSelect.value = sale.discountType || 'yen';
          lengthFeeSelect.value = sale.lengthFee || 0;
          pointDiscountInput.value = sale.pointDiscount || 0;
          deductionAmountInput.value = sale.deductionAmount || 0;
          paymentMethod = sale.paymentMethod;
          if (paymentMethod) {
            paymentBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.method === paymentMethod));
            cashPaymentFields.style.display = paymentMethod === '現金' ? 'block' : 'none';
          }
          if (sale.amountReceived) amountReceivedInput.value = sale.amountReceived;
          renderSelectedMenus();
          calculateTotals();
        }
      } finally { showContent(); }
    } else if (sourceBookingId) {
      showLoading('予約情報を読み込み中...');
      try {
        const bookingDoc = await getDoc(doc(db, 'reservations', sourceBookingId));
        if (bookingDoc.exists()) {
          const booking = bookingDoc.data();
          sourceBookingData = booking;
          customerInput.value = booking.customerName;
          selectedMenus = booking.selectedMenus || [];
          sourceCustomerId = booking.customerId;
          renderSelectedMenus();
          calculateTotals();
        }
      } finally { showContent(); }
    } else if (sourceCustomerId && sourceCustomerName) {
      customerInput.value = sourceCustomerName;
      renderSelectedMenus();
      calculateTotals();
      showContent();
    } else {
      showContent();
    }
  };

  // --- Event Listeners ---
  addMenuModalBtn.addEventListener('click', () => (addMenuModal.style.display = 'flex'));
  addMenuModal.querySelector('.close-modal-btn').addEventListener('click', () => (addMenuModal.style.display = 'none'));

  openDraftsModalBtn.addEventListener('click', openDraftList);
  draftListModal.querySelector('.close-modal-btn').addEventListener('click', () => (draftListModal.style.display = 'none'));
  saveDraftBtn.addEventListener('click', saveDraft);

  [discountValueInput, discountTypeSelect, lengthFeeSelect, pointDiscountInput, deductionAmountInput].forEach(el => {
    el.addEventListener('input', calculateTotals);
  });
  if (amountReceivedInput) amountReceivedInput.addEventListener('input', calculateTotals);
  customerInput.addEventListener('input', validateForm);

  paymentBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      paymentBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      paymentMethod = btn.dataset.method;
      cashPaymentFields.style.display = paymentMethod === '現金' ? 'block' : 'none';
      calculateTotals();
    });
  });

  completeSaleBtn.addEventListener('click', completeSale);

  showLoading('会計ページを準備中...');
  await loadInitialData();
  await checkUrlParams();
};

runAdminPage(posMain);
