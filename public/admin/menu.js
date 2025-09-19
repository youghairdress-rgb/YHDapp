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
    const categoryIconInput = document.getElementById('category-icon');
    const categoryOrderInput = document.getElementById('category-order');
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
    const menuOrderInput = document.getElementById('menu-order');
    const menuModalTitle = document.getElementById('menu-modal-title');
    let currentCategoryIdForMenu = null;
    let editingMenuId = null;

    const openModal = (modal) => modal.style.display = 'flex';
    const closeModal = (modal) => modal.style.display = 'none';

    const loadData = async () => {
        try {
            categoriesContainer.innerHTML = '';
            const categoriesQuery = query(collection(db, 'service_categories'), orderBy('order'));
            const querySnapshot = await getDocs(categoriesQuery);
            
            for (const categoryDoc of querySnapshot.docs) {
                const category = { id: categoryDoc.id, ...categoryDoc.data() };
                const categoryAccordion = document.createElement('details');
                categoryAccordion.className = 'menu-category-accordion';
                
                const menusQuery = query(collection(db, `service_categories/${category.id}/menus`), orderBy('order'));
                const menusSnapshot = await getDocs(menusQuery);
                const menus = menusSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                categoryAccordion.innerHTML = `
                    <summary class="accordion-header">
                        <div class="accordion-title">
                            <i class="${category.icon || 'fa-solid fa-tag'}"></i>
                            <span>${category.name}</span>
                        </div>
                        <div class="accordion-actions">
                            <button class="icon-button edit-category-btn" title="カテゴリー編集"><i class="fa-solid fa-pen"></i></button>
                            <button class="icon-button delete-category-btn delete-btn" title="カテゴリー削除"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </summary>
                    <div class="accordion-content">
                        <ul class="menu-item-list">
                            ${menus.map(menu => `
                                <li class="menu-item">
                                    <div class="menu-item-info">
                                        <span class="menu-item-name">${menu.name}</span>
                                        <span class="menu-item-details">${menu.pricePrefix ? '～' : ''}¥${menu.price.toLocaleString()} / ${menu.duration}分</span>
                                    </div>
                                    <div class="menu-item-actions">
                                        <button class="icon-button edit-menu-btn" data-menu='${JSON.stringify(menu).replace(/'/g, "&apos;")}' title="メニュー編集"><i class="fa-solid fa-pen"></i></button>
                                        <button class="icon-button delete-menu-btn delete-btn" data-menu-id="${menu.id}" data-category-id="${category.id}" title="メニュー削除"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </li>
                            `).join('')}
                        </ul>
                        <button class="button-secondary add-menu-btn" style="margin-top: 1rem;"><i class="fa-solid fa-plus"></i> メニューを追加</button>
                    </div>
                `;

                // Event Listeners for this category
                categoryAccordion.querySelector('.add-menu-btn').addEventListener('click', () => openMenuModal(category.id));
                categoryAccordion.querySelector('.edit-category-btn').addEventListener('click', (e) => {
                    e.preventDefault(); // Prevent accordion from toggling
                    openCategoryModal(category);
                });
                categoryAccordion.querySelector('.delete-category-btn').addEventListener('click', (e) => {
                    e.preventDefault();
                    deleteCategory(category.id, menus.length);
                });

                categoryAccordion.querySelectorAll('.edit-menu-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const menuData = JSON.parse(e.currentTarget.dataset.menu);
                        openMenuModal(category.id, menuData);
                    });
                });

                categoryAccordion.querySelectorAll('.delete-menu-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        deleteMenu(e.currentTarget.dataset.categoryId, e.currentTarget.dataset.menuId);
                    });
                });

                categoriesContainer.appendChild(categoryAccordion);
            }
        } catch(error) {
            console.error("データ読み込みエラー:", error);
            alert("データの読み込みに失敗しました。");
        }
    };

    const openCategoryModal = (category = null) => {
        categoryForm.reset();
        if (category) {
            editingCategoryId = category.id;
            categoryModalTitle.textContent = 'カテゴリー編集';
            categoryNameInput.value = category.name;
            categoryIconInput.value = category.icon || '';
            categoryOrderInput.value = category.order;
        } else {
            editingCategoryId = null;
            categoryModalTitle.textContent = '新規カテゴリー追加';
            categoryOrderInput.value = 10;
        }
        openModal(categoryModal);
    };

    const saveCategory = async (e) => {
        e.preventDefault();
        const data = {
            name: categoryNameInput.value.trim(),
            icon: categoryIconInput.value.trim(),
            order: parseInt(categoryOrderInput.value)
        };
        if (!data.name) {
            alert('カテゴリー名は必須です。');
            return;
        }
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
        const message = menuCount > 0 
            ? `このカテゴリーには${menuCount}件のメニューが登録されています。本当にカテゴリーごと削除しますか？`
            : 'このカテゴリーを削除しますか？';
        
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
            menuOrderInput.value = menu.order;
        } else {
            editingMenuId = null;
            menuModalTitle.textContent = '新規メニュー追加';
            menuOrderInput.value = 10;
        }
        openModal(menuModal);
    };

    const saveMenu = async (e) => {
        e.preventDefault();
        const data = {
            name: menuNameInput.value.trim(),
            description: menuDescriptionInput.value.trim(),
            price: parseInt(menuPriceInput.value),
            pricePrefix: menuPricePrefixCheckbox.checked,
            duration: parseInt(menuDurationInput.value),
            order: parseInt(menuOrderInput.value)
        };
         if (!data.name || !data.price || !data.duration) {
            alert('メニュー名、価格、所要時間は必須です。');
            return;
        }
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

    // Initial Load
    await loadData();
};

runAdminPage(menuMain);
