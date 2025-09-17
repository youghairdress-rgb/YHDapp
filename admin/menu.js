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
    const categoryOrderInput = document.getElementById('category-order');
    const closeCategoryModalBtn = document.getElementById('close-category-modal');
    const categoryModalTitle = document.getElementById('category-modal-title');
    let editingCategoryId = null;

    // Menu Modal
    const menuModal = document.getElementById('menu-modal');
    const menuForm = document.getElementById('menu-form');
    const menuNameInput = document.getElementById('menu-name');
    const menuDescriptionInput = document.getElementById('menu-description');
    const menuPriceInput = document.getElementById('menu-price');
    const menuDurationInput = document.getElementById('menu-duration');
    const menuOrderInput = document.getElementById('menu-order');
    const closeMenuModalBtn = document.getElementById('close-menu-modal');
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
                const categoryElement = document.createElement('div');
                categoryElement.className = 'category-item';
                
                const menusQuery = query(collection(db, `service_categories/${category.id}/menus`), orderBy('order'));
                const menusSnapshot = await getDocs(menusQuery);
                const menus = menusSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                categoryElement.innerHTML = `
                    <div class="category-header">
                        <h3>${category.name} (表示順: ${category.order})</h3>
                        <div>
                            <button class="add-menu-btn">＋ メニュー追加</button>
                            <button class="edit-category-btn">編集</button>
                            <button class="delete-category-btn delete-btn-small">削除</button>
                        </div>
                    </div>
                    <ul class="menu-list">
                        ${menus.map(menu => `
                            <li>
                                <span>${menu.name} (¥${menu.price}, ${menu.duration}分, 表示順: ${menu.order})</span>
                                <div>
                                    <button class="edit-menu-btn" data-menu='${JSON.stringify(menu)}'>編集</button>
                                    <button class="delete-menu-btn" data-menu-id="${menu.id}" data-category-id="${category.id}">削除</button>
                                </div>
                            </li>
                        `).join('') || '<li>メニューが登録されていません</li>'}
                    </ul>
                `;

                categoryElement.querySelector('.add-menu-btn').addEventListener('click', () => openMenuModal(category.id));
                categoryElement.querySelector('.edit-category-btn').addEventListener('click', () => openCategoryModal(category));
                categoryElement.querySelector('.delete-category-btn').addEventListener('click', () => deleteCategory(category.id, menus.length));

                categoryElement.querySelectorAll('.edit-menu-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const menuData = JSON.parse(e.target.dataset.menu);
                        openMenuModal(category.id, menuData);
                    });
                });

                categoryElement.querySelectorAll('.delete-menu-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                         deleteMenu(e.target.dataset.categoryId, e.target.dataset.menuId);
                    });
                });

                categoriesContainer.appendChild(categoryElement);
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
            name: categoryNameInput.value,
            order: parseInt(categoryOrderInput.value)
        };
        try {
            if (editingCategoryId) {
                await setDoc(doc(db, 'service_categories', editingCategoryId), data);
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
        if (menuCount > 0) {
            if (!confirm(`このカテゴリーには${menuCount}件のメニューが登録されています。本当にカテゴリーごと削除しますか？`)) {
                return;
            }
        } else {
            if (!confirm('このカテゴリーを削除しますか？')) {
                return;
            }
        }
        try {
            // Firestoreのバッチ書き込みで、サブコレクションのドキュメントも削除
            const batch = writeBatch(db);
            const menusSnapshot = await getDocs(collection(db, `service_categories/${id}/menus`));
            menusSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
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
            menuDescriptionInput.value = menu.description;
            menuPriceInput.value = menu.price;
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
            name: menuNameInput.value,
            description: menuDescriptionInput.value,
            price: parseInt(menuPriceInput.value),
            duration: parseInt(menuDurationInput.value),
            order: parseInt(menuOrderInput.value)
        };
        const path = `service_categories/${currentCategoryIdForMenu}/menus`;
        try {
            if (editingMenuId) {
                await setDoc(doc(db, path, editingMenuId), data);
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

    // Event Listeners
    addCategoryBtn.addEventListener('click', () => openCategoryModal());
    closeCategoryModalBtn.addEventListener('click', () => closeModal(categoryModal));
    categoryForm.addEventListener('submit', saveCategory);
    closeMenuModalBtn.addEventListener('click', () => closeModal(menuModal));
    menuForm.addEventListener('submit', saveMenu);

    // Initial Load
    await loadData();
};

runAdminPage(menuMain);

