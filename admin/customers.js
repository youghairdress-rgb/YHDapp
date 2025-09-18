import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { 
    collection, onSnapshot, addDoc, doc, setDoc, deleteDoc, 
    query, orderBy, serverTimestamp, getDocs, where 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const customersMain = async (auth, user) => {
    // DOM Elements
    const customerListContainer = document.getElementById('customer-list-container');
    const customerInfoPlaceholder = document.getElementById('customer-info-placeholder');
    const addCustomerBtn = document.getElementById('add-customer-btn');
    const customerSearchInput = document.getElementById('customer-search');
    const initialNav = document.getElementById('initial-nav');

    // Modal Elements
    const customerModal = document.getElementById('customer-modal');
    const customerForm = document.getElementById('customer-form');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalTitle = document.getElementById('modal-title');
    const tabButtons = customerModal.querySelectorAll('.tab');
    const tabContents = customerModal.querySelectorAll('.tab-content');
    
    // Form fields
    const customerNameInput = document.getElementById('customer-name');
    const customerKanaInput = document.getElementById('customer-kana');
    const customerLineIdInput = document.getElementById('customer-lineId');
    const customerPhoneInput = document.getElementById('customer-phone');
    const customerNotesInput = document.getElementById('customer-notes');
    const customerMemoInput = document.getElementById('customer-memo');
    const visitHistoryList = document.getElementById('visit-history-list');
    
    // State
    let editingCustomerId = null;
    let allCustomers = [];

    // --- 50音インデックス生成 ---
    const createInitialNav = () => {
        const initials = "あかさたなはまやらわ".split('');
        initials.forEach(initial => {
            const button = document.createElement('button');
            button.textContent = initial;
            button.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.initial-nav button').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                
                const filtered = allCustomers.filter(c => (c.kana || ' ').startsWith(initial));
                renderCustomers(filtered);
            });
            initialNav.appendChild(button);
        });
    };

    // --- モーダル制御 ---
    const openCustomerModal = async (customer = null) => {
        customerForm.reset();
        // Reset tabs to default state
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        customerModal.querySelector('[data-tab-content="basic-info-content"]').classList.add('active');
        customerModal.querySelector('#basic-info-content').classList.add('active');

        if (customer) {
            editingCustomerId = customer.id;
            modalTitle.textContent = '顧客情報の編集';
            customerNameInput.value = customer.name || '';
            customerKanaInput.value = customer.kana || '';
            customerLineIdInput.value = customer.lineId || '';
            customerPhoneInput.value = customer.phone || '';
            customerNotesInput.value = customer.notes || '';
            customerMemoInput.value = customer.memo || '';
        } else {
            editingCustomerId = null;
            modalTitle.textContent = '新規顧客追加';
            visitHistoryList.innerHTML = '<p>まだ来店履歴はありません。</p>';
        }
        customerModal.style.display = 'flex';
    };

    // --- データ保存・削除 ---
    const saveCustomer = async (e) => {
        e.preventDefault();
        const data = {
            name: customerNameInput.value.trim(),
            kana: customerKanaInput.value.trim(),
            lineId: customerLineIdInput.value.trim(),
            phone: customerPhoneInput.value.trim(),
            notes: customerNotesInput.value.trim(),
            memo: customerMemoInput.value.trim(),
            updatedAt: serverTimestamp(),
        };

        if (!data.name || !data.kana) {
            alert('名前とふりがなは必須です。');
            return;
        }

        try {
            if (editingCustomerId) {
                await setDoc(doc(db, "users", editingCustomerId), data, { merge: true });
            } else {
                data.createdAt = serverTimestamp();
                await addDoc(collection(db, "users"), data);
            }
            customerModal.style.display = 'none';
        } catch (error) {
            console.error("顧客情報の保存に失敗:", error);
            alert("顧客情報の保存に失敗しました。");
        }
    };

    const deleteCustomer = async (customerId, customerName) => {
        if (confirm(`「${customerName}」様の情報を本当に削除しますか？この操作は元に戻せません。`)) {
            try {
                await deleteDoc(doc(db, "users", customerId));
            } catch (error) {
                console.error("顧客情報の削除に失敗:", error);
                alert("顧客情報の削除に失敗しました。");
            }
        }
    };

    // --- 来店履歴取得 ---
    const fetchVisitHistory = async (customerId) => {
        visitHistoryList.innerHTML = '<div class="spinner"></div>';
        try {
            const salesQuery = query(
                collection(db, 'sales'), 
                where('customerId', '==', customerId),
                orderBy('createdAt', 'desc')
            );
            const snapshot = await getDocs(salesQuery);
            if (snapshot.empty) {
                visitHistoryList.innerHTML = '<p>まだ来店履歴はありません。</p>';
                return;
            }

            let html = '';
            snapshot.forEach(doc => {
                const sale = doc.data();
                const visitDate = sale.createdAt.toDate().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
                const menus = Array.isArray(sale.menus) 
                    ? sale.menus.map(m => m.name || '名称不明').join(', ')
                    : 'メニュー情報なし';

                html += `
                    <div class="visit-history-item">
                        <div class="visit-info">
                            <strong>${visitDate}</strong>
                            <span>${menus}</span>
                        </div>
                        <div class="visit-total">¥${sale.total.toLocaleString()}</div>
                    </div>
                `;
            });
            visitHistoryList.innerHTML = html;
        } catch (error) {
            console.error("来店履歴の取得に失敗:", error);
            visitHistoryList.innerHTML = '<p>来店履歴の取得に失敗しました。</p>';
        }
    };

    // --- 顧客リスト描画 ---
    const renderCustomers = (customers) => {
        customerListContainer.innerHTML = '';
        if (customers.length === 0) {
            customerInfoPlaceholder.textContent = '該当する顧客情報がありません。';
            customerInfoPlaceholder.style.display = 'block';
            return;
        }
        customerInfoPlaceholder.style.display = 'none';

        customers.forEach(customer => {
            const card = document.createElement('div');
            card.className = 'customer-card';
            
            card.innerHTML = `
                <div class="customer-card-header">
                    ${customer.notes ? '<i class="fa-solid fa-triangle-exclamation"></i>' : ''}
                    <span class="customer-card-name">${customer.name}</span>
                </div>
                <div class="customer-card-actions">
                    <button class="icon-button" title="カウンセリング" onclick="location.href='./counseling/index.html?customerId=${customer.id}'"><i class="fa-solid fa-brain"></i></button>
                    <button class="icon-button camera-btn" title="写真"><i class="fa-solid fa-camera"></i></button>
                    <button class="icon-button" title="会計" onclick="location.href='./pos.html?customerId=${customer.id}'"><i class="fa-solid fa-cash-register"></i></button>
                    <button class="icon-button delete-btn" title="削除"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            
            card.querySelector('.customer-card-header').addEventListener('click', () => openCustomerModal(customer));
            card.querySelector('.delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteCustomer(customer.id, customer.name);
            });
            card.querySelector('.camera-btn').addEventListener('click', (e) => {
                 e.stopPropagation();
                 alert('カメラ機能は今後実装されます。');
            });

            customerListContainer.appendChild(card);
        });
    };
    
    // --- 検索・フィルタリング ---
    const filterCustomers = () => {
        const searchTerm = customerSearchInput.value.toLowerCase().trim();
        document.querySelectorAll('.initial-nav button').forEach(btn => btn.classList.remove('active'));

        if (!searchTerm) {
            customerListContainer.innerHTML = '';
            customerInfoPlaceholder.style.display = 'block';
            customerInfoPlaceholder.textContent = '検索または上のインデックスから顧客を表示します。';
            return;
        }
        const filtered = allCustomers.filter(c => 
            (c.name && c.name.toLowerCase().includes(searchTerm)) || 
            (c.kana && c.kana.toLowerCase().includes(searchTerm))
        );
        renderCustomers(filtered);
    };

    // --- イベントリスナー設定 ---
    addCustomerBtn.addEventListener('click', () => openCustomerModal());
    closeModalBtn.addEventListener('click', () => customerModal.style.display = 'none');
    customerForm.addEventListener('submit', saveCustomer);
    customerSearchInput.addEventListener('input', filterCustomers);
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetContentId = button.dataset.tabContent;
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            button.classList.add('active');
            document.getElementById(targetContentId).classList.add('active');

            if (targetContentId === 'visit-history-content' && editingCustomerId) {
                fetchVisitHistory(editingCustomerId);
            }
        });
    });

    // --- 初期化処理 ---
    createInitialNav();
    const q = query(collection(db, "users"), orderBy("kana", "asc"));
    onSnapshot(q, (snapshot) => {
        allCustomers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Initially, don't render anyone, wait for search/filter
        filterCustomers(); 
    }, (error) => {
        console.error("顧客データの取得に失敗:", error);
        customerInfoPlaceholder.textContent = "顧客データの読み込みに失敗しました。";
    });
};

runAdminPage(customersMain);
