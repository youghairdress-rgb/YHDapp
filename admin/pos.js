import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { collection, getDocs, addDoc, Timestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const posMain = async (auth, user) => {
    // DOM Elements
    const customerSelect = document.getElementById('customer-select');
    const selectedMenuList = document.getElementById('selected-menu-list');
    const menuCategorySelects = document.getElementById('menu-category-selects');
    const subtotalEl = document.getElementById('subtotal');
    const discountEl = document.getElementById('discount');
    const totalEl = document.getElementById('total');
    const paymentMethodRadios = document.querySelectorAll('input[name="payment-method"]');
    const completeSaleBtn = document.getElementById('complete-sale-btn');

    // State
    let customers = [];
    let menuCategories = [];
    let selectedMenus = [];

    const loadInitialData = async () => {
        try {
            // Load customers
            const customersSnapshot = await getDocs(query(collection(db, 'users'), orderBy('kana')));
            customers = customersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            customerSelect.innerHTML = '<option value="">顧客を選択</option>' + 
                customers.map(c => `<option value="${c.id}">${c.name} (${c.kana || ''})</option>`).join('');
            
            // Load menus
            const categoriesSnapshot = await getDocs(query(collection(db, 'service_categories'), orderBy('order')));
            menuCategorySelects.innerHTML = '';
            for (const catDoc of categoriesSnapshot.docs) {
                const category = { id: catDoc.id, ...catDoc.data() };
                const menusSnapshot = await getDocs(query(collection(db, `service_categories/${catDoc.id}/menus`), orderBy('order')));
                category.menus = menusSnapshot.docs.map(menuDoc => ({ id: menuDoc.id, ...menuDoc.data() }));
                menuCategories.push(category);

                const categoryDiv = document.createElement('div');
                categoryDiv.className = 'category-selection';
                const select = document.createElement('select');
                select.className = 'input-field';
                select.innerHTML = `<option value="">${category.name}から追加</option>` +
                    category.menus.map(m => `<option value='${JSON.stringify(m)}'>${m.name} - ¥${m.price}</option>`).join('');
                
                select.addEventListener('change', (e) => {
                    if(e.target.value) {
                        addMenu(JSON.parse(e.target.value));
                        e.target.value = ''; // Reset select after adding
                    }
                });
                categoryDiv.appendChild(select);
                menuCategorySelects.appendChild(categoryDiv);
            }
        } catch (error) {
            console.error("初期データの読み込みに失敗:", error);
            alert("顧客・メニュー情報の読み込みに失敗しました。");
        }
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
            selectedMenuList.innerHTML = '<li>メニューが選択されていません</li>';
        } else {
            selectedMenus.forEach((menu, index) => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${menu.name}</span><span>¥${menu.price.toLocaleString()}</span><button class="delete-btn-small">×</button>`;
                li.querySelector('button').addEventListener('click', () => removeMenu(index));
                selectedMenuList.appendChild(li);
            });
        }
    };

    const calculateTotals = () => {
        const subtotal = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
        const discount = parseInt(discountEl.value) || 0;
        const total = subtotal - discount;

        subtotalEl.textContent = `¥${subtotal.toLocaleString()}`;
        totalEl.textContent = `¥${total.toLocaleString()}`;
    };

    const completeSale = async () => {
        const customerId = customerSelect.value;
        const discount = parseInt(discountEl.value) || 0;
        const total = selectedMenus.reduce((sum, menu) => sum + menu.price, 0) - discount;
        const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value;
        
        if (!customerId || selectedMenus.length === 0 || !paymentMethod) {
            alert('顧客、メニュー、支払い方法をすべて選択してください。');
            return;
        }

        const saleData = {
            customerId: customerId,
            menus: selectedMenus,
            subtotal: selectedMenus.reduce((sum, menu) => sum + menu.price, 0),
            discount: discount,
            total: total,
            paymentMethod: paymentMethod,
            createdAt: Timestamp.now()
        };

        try {
            await addDoc(collection(db, 'sales'), saleData);
            alert('会計が完了しました。');
            resetForm();
        } catch (error) {
            console.error("会計処理に失敗:", error);
            alert("会計処理に失敗しました。");
        }
    };

    const resetForm = () => {
        customerSelect.value = '';
        selectedMenus = [];
        discountEl.value = '0';
        renderSelectedMenus();
        calculateTotals();
        paymentMethodRadios.forEach(radio => radio.checked = false);
    };

    // Event Listeners
    discountEl.addEventListener('input', calculateTotals);
    completeSaleBtn.addEventListener('click', completeSale);
    
    // Initial Load
    await loadInitialData();
    renderSelectedMenus(); // 初回描画
};

runAdminPage(posMain);

