import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { collection, getDocs, addDoc, doc, setDoc, deleteDoc, query, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const menuMain = async (auth, user) => {
    // DOM Elements
    const categoriesContainer = document.getElementById('categories-container');
    const addCategoryBtn = document.getElementById('add-category-btn');

    // Category Modal
    const categoryModal = document.getElementById('category-modal');
    const categoryForm = document.getElementById('category-form');
    const categoryNameInput = document.getElementById('category-name');
    const categoryModalTitle = document.getElementById('category-modal-title');
    let editingCategoryId = null;

    // Menu Modal
    const menuModal = document.getElementById('menu-modal');
    const menuForm = document.getElementById('menu-form');
    const menuNameInput = document.getElementById('menu-name');
    const menuDescriptionInput = document.getElementById('menu-description');
    const menuPriceInput = document.getElementById('menu-price');
    const menuPricePrefixCheckbox = document.getElementById('menu-price-prefix');
    const menuDurationInput = document.getElementById('menu-duration');
    const menuModalTitle = document.getElementById('menu-modal-title');
    let currentCategoryIdForMenu = null;
    let editingMenuId = null;

    // State
    let categories = [];

    const openModal = (modal) => modal.style.display = 'flex';
    const closeModal = (modal) => modal.style.display = 'none';

    // Firestoreの複数のドキュメントを一度に更新するための関数
    const batchUpdateOrder = async (items, path) => {
        const batch = writeBatch(db);
        items.forEach((item, index) => {
            const docRef = doc(db, path, item.id);
            batch.update(docRef, { order: index });
        });
        await batch.commit();
        loadData(); // 再描画
    };

    const loadData = async () => {
        try {
            categoriesContainer.innerHTML = '';
            const categoriesQuery = query(collection(db, 'service_categories'), orderBy('order'));
            const querySnapshot = await getDocs(categoriesQuery);
            
            categories = []; // Reset state
            for (const categoryDoc of querySnapshot.docs) {
                const categoryData = { id: categoryDoc.id, ...categoryDoc.data(), menus: [] };
                const menusQuery = query(collection(db, `service_categories/${categoryData.id}/menus`), orderBy('order'));
                const menusSnapshot = await getDocs(menusQuery);
                categoryData.menus = menusSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                categories.push(categoryData);
            }
            renderCategories();
        } catch(error) {
            console.error("データ読み込みエラー:", error);
            alert("データの読み込みに失敗しました。");
        }
    };

    const renderCategories = () => {
        categoriesContainer.innerHTML = '';
        categories.forEach((category, catIndex) => {
            const categoryAccordion = document.createElement('details');
            categoryAccordion.className = 'menu-category-accordion';
            
            categoryAccordion.innerHTML = `
                <summary class="accordion-header">
                    <div class="order-controls">
                        <button class="order-btn category-order-up" ${catIndex === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
                        <button class="order-btn category-order-down" ${catIndex === categories.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
                    </div>
                    <div class="accordion-title">
                        <span>${category.name}</span>
                    </div>
                    <div class="accordion-actions">
                        <button class="icon-button edit-category-btn" title="カテゴリー編集"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-button delete-category-btn delete-btn" title="カテゴリー削除"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </summary>
                <div class="accordion-content">
                    <ul class="menu-item-list">
                        ${category.menus.map((menu, menuIndex) => `
                            <li class="menu-item" data-menu-id="${menu.id}">
                                <div class="order-controls">
                                    <button class="order-btn menu-order-up" ${menuIndex === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
                                    <button class="order-btn menu-order-down" ${menuIndex === category.menus.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
                                </div>
                                <div class="menu-item-info">
                                    <span class="menu-item-name">${menu.name}</span>
                                    <span class="menu-item-details">${menu.pricePrefix ? '～' : ''}¥${menu.price.toLocaleString()} / ${menu.duration}分</span>
                                </div>
                                <div class="menu-item-actions">
                                    <button class="icon-button edit-menu-btn" data-menu='${JSON.stringify(menu).replace(/'/g, "&apos;")}' title="メニュー編集"><i class="fa-solid fa-pen"></i></button>
                                    <button class="icon-button delete-menu-btn delete-btn" title="メニュー削除"><i class="fa-solid fa-trash"></i></button>
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                    <button class="button-secondary add-menu-btn" style="margin-top: 1rem;"><i class="fa-solid fa-plus"></i> メニューを追加</button>
                </div>
            `;
            
            // Event Listeners
            categoryAccordion.querySelector('.add-menu-btn').addEventListener('click', () => openMenuModal(category.id));
            categoryAccordion.querySelector('.edit-category-btn').addEventListener('click', (e) => { e.preventDefault(); openCategoryModal(category); });
            categoryAccordion.querySelector('.delete-category-btn').addEventListener('click', (e) => { e.preventDefault(); deleteCategory(category.id, category.menus.length); });
            categoryAccordion.querySelector('.category-order-up').addEventListener('click', (e) => { e.preventDefault(); moveCategory(catIndex, -1); });
            categoryAccordion.querySelector('.category-order-down').addEventListener('click', (e) => { e.preventDefault(); moveCategory(catIndex, 1); });

            categoryAccordion.querySelectorAll('.menu-item').forEach((item, menuIndex) => {
                item.querySelector('.edit-menu-btn').addEventListener('click', () => openMenuModal(category.id, category.menus[menuIndex]));
                item.querySelector('.delete-menu-btn').addEventListener('click', () => deleteMenu(category.id, category.menus[menuIndex].id));
                item.querySelector('.menu-order-up').addEventListener('click', () => moveMenu(catIndex, menuIndex, -1));
                item.querySelector('.menu-order-down').addEventListener('click', () => moveMenu(catIndex, menuIndex, 1));
            });

            categoriesContainer.appendChild(categoryAccordion);
        });
    };

    const moveCategory = (index, direction) => {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= categories.length) return;
        [categories[index], categories[newIndex]] = [categories[newIndex], categories[index]]; // Swap
        batchUpdateOrder(categories, 'service_categories');
    };
    
    const moveMenu = (catIndex, menuIndex, direction) => {
        const menus = categories[catIndex].menus;
        const newIndex = menuIndex + direction;
        if (newIndex < 0 || newIndex >= menus.length) return;
        [menus[menuIndex], menus[newIndex]] = [menus[newIndex], menus[menuIndex]]; // Swap
        batchUpdateOrder(menus, `service_categories/${categories[catIndex].id}/menus`);
    };

    const openCategoryModal = (category = null) => {
        categoryForm.reset();
        if (category) {
            editingCategoryId = category.id;
            categoryModalTitle.textContent = 'カテゴリー編集';
            categoryNameInput.value = category.name;
        } else {
            editingCategoryId = null;
            categoryModalTitle.textContent = '新規カテゴリー追加';
        }
        openModal(categoryModal);
    };

    const saveCategory = async (e) => {
        e.preventDefault();
        const data = {
            name: categoryNameInput.value.trim(),
            order: editingCategoryId ? categories.find(c => c.id === editingCategoryId).order : categories.length,
        };
        if (!data.name) return alert('カテゴリー名は必須です。');

        try {
            if (editingCategoryId) {
                await setDoc(doc(db, 'service_categories', editingCategoryId), data, { merge: true });
            } else {
                await addDoc(collection(db, 'service_categories'), data);
            }
            closeModal(categoryModal);
            loadData();
        } catch(error) {
            console.error("カテゴリー保存エラー:", error);
            alert("カテゴリーの保存に失敗しました。");
        }
    };
    
    const deleteCategory = async (id, menuCount) => {
        const message = menuCount > 0 ? `このカテゴリーには${menuCount}件のメニューが登録されています。本当にカテゴリーごと削除しますか？` : 'このカテゴリーを削除しますか？';
        if (!confirm(message)) return;

        try {
            const batch = writeBatch(db);
            const menusSnapshot = await getDocs(collection(db, `service_categories/${id}/menus`));
            menusSnapshot.forEach(doc => batch.delete(doc.ref));
            batch.delete(doc(db, 'service_categories', id));
            await batch.commit();
            loadData();
        } catch(error) {
            console.error("カテゴリー削除エラー:", error);
            alert("カテゴリーの削除に失敗しました。");
        }
    };

    const openMenuModal = (categoryId, menu = null) => {
        menuForm.reset();
        currentCategoryIdForMenu = categoryId;
        if (menu) {
            editingMenuId = menu.id;
            menuModalTitle.textContent = 'メニュー編集';
            menuNameInput.value = menu.name;
            menuDescriptionInput.value = menu.description || '';
            menuPriceInput.value = menu.price;
            menuPricePrefixCheckbox.checked = menu.pricePrefix || false;
            menuDurationInput.value = menu.duration;
        } else {
            editingMenuId = null;
            menuModalTitle.textContent = '新規メニュー追加';
        }
        openModal(menuModal);
    };

    const saveMenu = async (e) => {
        e.preventDefault();
        const category = categories.find(c => c.id === currentCategoryIdForMenu);
        const data = {
            name: menuNameInput.value.trim(),
            description: menuDescriptionInput.value.trim(),
            price: parseInt(menuPriceInput.value),
            pricePrefix: menuPricePrefixCheckbox.checked,
            duration: parseInt(menuDurationInput.value),
            order: editingMenuId ? category.menus.find(m => m.id === editingMenuId).order : category.menus.length,
        };
        if (!data.name || isNaN(data.price) || isNaN(data.duration)) return alert('メニュー名、価格、所要時間は必須です。');

        const path = `service_categories/${currentCategoryIdForMenu}/menus`;
        try {
            if (editingMenuId) {
                await setDoc(doc(db, path, editingMenuId), data, { merge: true });
            } else {
                await addDoc(collection(db, path), data);
            }
            closeModal(menuModal);
            loadData();
        } catch(error) {
            console.error("メニュー保存エラー:", error);
            alert("メニューの保存に失敗しました。");
        }
    };

    const deleteMenu = async (categoryId, menuId) => {
        if (confirm('このメニューを削除しますか？')) {
            try {
                await deleteDoc(doc(db, `service_categories/${categoryId}/menus`, menuId));
                loadData();
            } catch(error) {
                console.error("メニュー削除エラー:", error);
                alert("メニューの削除に失敗しました。");
            }
        }
    };

    // Global Event Listeners
    addCategoryBtn.addEventListener('click', () => openCategoryModal());
    categoryForm.addEventListener('submit', saveCategory);
    menuForm.addEventListener('submit', saveMenu);
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            closeModal(categoryModal);
            closeModal(menuModal);
        });
    });

    loadData();
};

runAdminPage(menuMain);
