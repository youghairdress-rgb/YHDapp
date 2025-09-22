import { runAdminPage } from './admin-auth.js';
import { db, storage } from './firebase-init.js';
import {
    collection, onSnapshot, addDoc, doc, setDoc, deleteDoc,
    query, orderBy, serverTimestamp, getDocs, where, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
    const galleryContent = document.getElementById('gallery-content');
    const photoUploadInput = document.getElementById('photo-upload-input');
    const imageViewer = document.getElementById('image-viewer-modal');
    const viewerImg = document.getElementById('image-viewer-content');
    const closeViewerBtn = document.getElementById('close-viewer-btn');

    // State
    let editingCustomerId = null;
    let allCustomers = [];

    const checkUrlParams = () => {
        const params = new URLSearchParams(window.location.search);
        const customerName = params.get('customerName');
        if (customerName) {
            customerSearchInput.value = customerName;
            setTimeout(() => {
                filterCustomers();
            }, 100);
        }
    };

    const createInitialNav = () => {
        const initials = "あかさたなはまやらわ".split('');
        initials.push('他');
        initialNav.innerHTML = '';
        initials.forEach(initial => {
            const button = document.createElement('button');
            button.textContent = initial;
            button.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.initial-nav button').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');

                let filtered;
                if (initial === '他') {
                    filtered = allCustomers.filter(c => !c.kana);
                } else {
                    filtered = allCustomers.filter(c => c.kana && c.kana.startsWith(initial));
                }
                renderCustomers(filtered);
            });
            initialNav.appendChild(button);
        });
    };

    const openCustomerModal = async (customer = null) => {
        customerForm.reset();
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        customerModal.querySelector('[data-tab-content="basic-info-content"]').classList.add('active');
        customerModal.querySelector('#basic-info-content').classList.add('active');

        if (customer) {
            editingCustomerId = customer.id;
            modalTitle.textContent = '顧客情報の編集';
            customerNameInput.value = customer.name || '';
            customerKanaInput.value = customer.kana || '';
            customerLineIdInput.value = customer.lineDisplayName || '';
            customerPhoneInput.value = customer.phone || '';
            customerNotesInput.value = customer.notes || '';
            customerMemoInput.value = customer.memo || '';
        } else {
            editingCustomerId = null;
            modalTitle.textContent = '新規顧客追加';
            visitHistoryList.innerHTML = '<p>まだ来店履歴はありません。</p>';
            galleryContent.innerHTML = '<p>まだ写真がありません。</p>';
        }
        customerModal.style.display = 'flex';
    };

    const saveCustomer = async (e) => {
        e.preventDefault();
        const data = {
            name: customerNameInput.value.trim(),
            kana: customerKanaInput.value.trim(),
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
                const sale = { id: doc.id, ...doc.data() };
                const visitDate = sale.createdAt.toDate().toLocaleDateString('ja-JP');
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
                        <div class="staff-note-section">
                            <label for="staff-note-${sale.id}">スタッフメモ（お客様へのメッセージ）</label>
                            <textarea id="staff-note-${sale.id}" class="input-field" rows="3">${sale.staffNote || ''}</textarea>
                            <button class="button-secondary save-staff-note-btn" data-sale-id="${sale.id}">メモを保存</button>
                        </div>
                        ${sale.customerNote ? `
                        <div class="customer-note-section">
                            <strong>お客様からのコメント:</strong>
                            <p>${sale.customerNote}</p>
                        </div>
                        ` : ''}
                    </div>
                `;
            });
            visitHistoryList.innerHTML = html;

            visitHistoryList.querySelectorAll('.save-staff-note-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const saleId = e.target.dataset.saleId;
                    const note = document.getElementById(`staff-note-${saleId}`).value.trim();
                    btn.textContent = "保存中...";
                    btn.disabled = true;
                    try {
                        await updateDoc(doc(db, "sales", saleId), { staffNote: note });
                        alert('スタッフメモを保存しました。');
                    } catch (error) {
                        alert('メモの保存に失敗しました。');
                        console.error(error);
                    } finally {
                        btn.textContent = "メモを保存";
                        btn.disabled = false;
                    }
                });
            });

        } catch (error) {
            console.error("来店履歴の取得に失敗:", error);
            visitHistoryList.innerHTML = '<p>来店履歴の取得に失敗しました。</p>';
        }
    };

    const fetchGallery = async (customerId) => {
        galleryContent.querySelector('#gallery-grid').innerHTML = '<div class="spinner"></div>';
        try {
            const q = query(collection(db, `users/${customerId}/gallery`), orderBy("createdAt", "desc"));
            const snapshot = await getDocs(q);
            if (snapshot.empty) {
                galleryContent.querySelector('#gallery-grid').innerHTML = '<p>まだ写真がありません。</p>';
                return;
            }
            const photosByDate = {};
            snapshot.forEach(doc => {
                const photo = { id: doc.id, ...doc.data() };
                const date = photo.createdAt.toDate().toLocaleDateString('ja-JP');
                if (!photosByDate[date]) photosByDate[date] = [];
                photosByDate[date].push(photo);
            });

            let html = '';
            for (const date in photosByDate) {
                html += `<h3 class="gallery-date-header">${date}</h3>`;
                html += '<div class="gallery-grid-group">';
                photosByDate[date].forEach(photo => {
                    html += `<img src="${photo.url}" alt="ギャラリー写真" class="gallery-thumbnail">`;
                });
                html += '</div>';
            }
            galleryContent.querySelector('#gallery-grid').innerHTML = html;

            galleryContent.querySelectorAll('.gallery-thumbnail').forEach(img => {
                img.addEventListener('click', () => {
                    viewerImg.src = img.src;
                    imageViewer.style.display = 'flex';
                });
            });

        } catch (error) {
            console.error("ギャラリーの読み込みエラー:", error);
            galleryContent.querySelector('#gallery-grid').innerHTML = '<p>ギャラリーの読み込みに失敗しました。</p>';
        }
    };

    const handleTakePhoto = () => {
        photoUploadInput.setAttribute('capture', 'environment');
        photoUploadInput.click();
    };

    const uploadAndSavePhoto = async (file) => {
        if (!editingCustomerId || !file) return;

        const overlay = document.getElementById('gallery-uploading-overlay');
        overlay.style.display = 'flex';
        try {
            const timestamp = Date.now();
            const date = new Date(timestamp);
            const dateFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const storageRef = ref(storage, `galleries/${editingCustomerId}/${dateFolder}/${timestamp}-${file.name}`);

            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(db, `users/${editingCustomerId}/gallery`), {
                url: downloadURL,
                createdAt: serverTimestamp(),
            });
            await fetchGallery(editingCustomerId);
        } catch (error) {
            console.error("写真のアップロードに失敗:", error);
            alert("写真のアップロードに失敗しました。");
        } finally {
            overlay.style.display = 'none';
        }
    };

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
                    <button class="icon-button camera-btn" title="写真"><i class="fa-solid fa-camera"></i></button>
                    <a href="./pos.html?bookingId=&customerId=${customer.id}&customerName=${encodeURIComponent(customer.name)}" class="icon-button" title="会計"><i class="fa-solid fa-cash-register"></i></a>
                    <button class="icon-button delete-btn" title="削除"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;

            card.querySelector('.customer-card-header').addEventListener('click', () => openCustomerModal(customer));
            card.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteCustomer(customer.id, customer.name); });
            card.querySelector('.camera-btn').addEventListener('click', (e) => { e.stopPropagation(); editingCustomerId = customer.id; handleTakePhoto(); });
            customerListContainer.appendChild(card);
        });
    };

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

    addCustomerBtn.addEventListener('click', () => openCustomerModal());
    closeModalBtn.addEventListener('click', () => customerModal.style.display = 'none');
    customerForm.addEventListener('submit', saveCustomer);
    customerSearchInput.addEventListener('input', filterCustomers);
    photoUploadInput.addEventListener('change', (e) => uploadAndSavePhoto(e.target.files[0]));
    closeViewerBtn.addEventListener('click', () => imageViewer.style.display = 'none');

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
            if (targetContentId === 'gallery-content' && editingCustomerId) {
                fetchGallery(editingCustomerId);
            }
        });
    });

    createInitialNav();
    const q = query(collection(db, "users"), orderBy("kana", "asc"));
    onSnapshot(q, (snapshot) => {
        allCustomers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        checkUrlParams();
    }, (error) => {
        console.error("顧客データの取得に失敗:", error);
        customerInfoPlaceholder.textContent = "顧客データの読み込みに失敗しました。";
    });
};

runAdminPage(customersMain);
