import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { collection, onSnapshot, addDoc, doc, setDoc, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const customersMain = async (auth, user) => {
    // DOM Elements
    const customerList = document.getElementById('customer-list');
    const addCustomerBtn = document.getElementById('add-customer-btn');
    const customerSearchInput = document.getElementById('customer-search');

    // Modal Elements
    const customerModal = document.getElementById('customer-modal');
    const customerForm = document.getElementById('customer-form');
    const closeModalBtn = document.getElementById('close-modal');
    const modalTitle = document.getElementById('modal-title');
    const customerNameInput = document.getElementById('customer-name');
    const customerKanaInput = document.getElementById('customer-kana');
    const customerPhoneInput = document.getElementById('customer-phone');
    const customerMemoInput = document.getElementById('customer-memo');
    
    // State
    let editingCustomerId = null;
    let allCustomers = [];

    const openCustomerModal = (customer = null) => {
        customerForm.reset();
        if (customer) {
            editingCustomerId = customer.id;
            modalTitle.textContent = '顧客情報の編集';
            customerNameInput.value = customer.name || '';
            customerKanaInput.value = customer.kana || '';
            customerPhoneInput.value = customer.phone || '';
            customerMemoInput.value = customer.memo || '';
        } else {
            editingCustomerId = null;
            modalTitle.textContent = '新規顧客追加';
        }
        customerModal.style.display = 'flex';
    };

    const saveCustomer = async (e) => {
        e.preventDefault();
        const data = {
            name: customerNameInput.value,
            kana: customerKanaInput.value,
            phone: customerPhoneInput.value,
            memo: customerMemoInput.value,
            updatedAt: serverTimestamp(),
        };

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
    
    const renderCustomers = (customers) => {
        customerList.innerHTML = '';
        customers.forEach(customer => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${customer.name}</td>
                <td>${customer.phone || '-'}</td>
                <td><button class="edit-btn">編集</button></td>
            `;
            row.querySelector('.edit-btn').addEventListener('click', () => openCustomerModal(customer));
            customerList.appendChild(row);
        });
    };
    
    const filterCustomers = () => {
        const searchTerm = customerSearchInput.value.toLowerCase().trim();
        if (!searchTerm) {
            renderCustomers(allCustomers);
            return;
        }
        const filtered = allCustomers.filter(c => 
            (c.name && c.name.toLowerCase().includes(searchTerm)) || 
            (c.kana && c.kana.toLowerCase().includes(searchTerm))
        );
        renderCustomers(filtered);
    };

    // Event Listeners
    addCustomerBtn.addEventListener('click', () => openCustomerModal());
    closeModalBtn.addEventListener('click', () => customerModal.style.display = 'none');
    customerForm.addEventListener('submit', saveCustomer);
    customerSearchInput.addEventListener('input', filterCustomers);

    // Initial Load
    const q = query(collection(db, "users"), orderBy("kana", "asc"));
    onSnapshot(q, (snapshot) => {
        allCustomers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        filterCustomers();
    }, (error) => {
        console.error("顧客データの取得に失敗:", error);
        alert("顧客データの取得に失敗しました。");
    });
};

runAdminPage(customersMain);

