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
    const galleryUploadingOverlay = document.getElementById('gallery-uploading-overlay');


    // State
    let editingCustomerId = null;
    let allCustomers = [];
    let unsubscribeCustomers = null;
    // ▼▼▼ 修正: URLパラメータ処理用の変数を追加 ▼▼▼
    let targetCustomerId = null;
    let paramsHandled = false;
    // ▲▲▲ 修正ここまで ▲▲▲

    // ▼▼▼ 修正: checkUrlParamsを修正 ▼▼▼
    const checkUrlParams = () => {
        const params = new URLSearchParams(window.location.search);
        const customerId = params.get('customerId');
        if (customerId) {
            // 顧客IDが指定されている場合、グローバル変数にセット
            targetCustomerId = customerId;
        } else {
            // 顧客名が指定されている場合（従来）
            const customerName = params.get('customerName');
            if (customerName) {
                customerSearchInput.value = customerName;
            }
        }
    };
    // ▲▲▲ 修正ここまで ▲▲▲

    const createInitialNav = () => {
        const hiraganaRows = {
            'あ': ['あ', 'い', 'う', 'え', 'お'],
            'か': ['か', 'き', 'く', 'け', 'こ', 'が', 'ぎ', 'ぐ', 'げ', 'ご'],
            'さ': ['さ', 'し', 'す', 'せ', 'そ', 'ざ', 'じ', 'ず', 'ぜ', 'ぞ'],
            'た': ['た', 'ち', 'つ', 'て', 'と', 'だ', 'ぢ', 'づ', 'で', 'ど'],
            'な': ['な', 'に', 'ぬ', 'ね', 'の'],
            'は': ['は', 'ひ', 'ふ', 'へ', 'ほ', 'ば', 'び', 'ぶ', 'べ', 'ぼ', 'ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ'],
            'ま': ['ま', 'み', 'む', 'め', 'も'],
            'や': ['や', 'ゆ', 'よ'],
            'ら': ['ら', 'り', 'る', 'れ', 'ろ'],
            'わ': ['わ', 'を', 'ん']
        };
        const initials = Object.keys(hiraganaRows);
        initials.push('他');

        initialNav.innerHTML = '';
        initials.forEach(initial => {
            const button = document.createElement('button');
            button.textContent = initial;
            button.addEventListener('click', (e) => {
                e.preventDefault();
                customerSearchInput.value = '';
                document.querySelectorAll('.initial-nav button').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');

                let filtered;
                if (initial === '他') {
                    const allHiragana = Object.values(hiraganaRows).flat();
                    filtered = allCustomers.filter(c => !c.kana || !allHiragana.some(char => c.kana.startsWith(char)));
                } else {
                    const charsInRow = hiraganaRows[initial];
                    filtered = allCustomers.filter(c => c.kana && charsInRow.some(char => c.kana.startsWith(char)));
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
            galleryContent.querySelector('#gallery-grid').innerHTML = '<p>まだ写真がありません。</p>';
        }
        
        document.body.classList.add('modal-open');
        customerModal.style.display = 'flex';
    };

    const closeModal = () => {
        document.body.classList.remove('modal-open');
        customerModal.style.display = 'none';
    }

    const saveCustomer = async (e) => {
        e.preventDefault();
        const data = {
            name: customerNameInput.value.trim(),
            kana: customerKanaInput.value.trim(),
            phone: customerPhoneInput.value.trim(),
            notes: customerNotesInput.value.trim(),
            memo: customerMemoInput.value.trim(),
            updatedAt: serverTimestamp(),
            isLineUser: !!customerLineIdInput.value,
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
            closeModal();
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

                // ▼▼▼ 修正: メモ欄を2つに分割 ▼▼▼
                html += `
                    <div class="visit-history-item">
                        <div class="visit-info">
                            <strong>${visitDate}</strong>
                            <span>${menus}</span>
                        </div>
                        <div class="visit-total">¥${sale.total.toLocaleString()}</div>
                        
                        <!-- メッセージ（お客様と共有） -->
                        <div class="staff-note-section">
                            <label for="staff-public-message-${sale.id}">メッセージ（お客様と共有）</label>
                            <textarea id="staff-public-message-${sale.id}" class="input-field" rows="3" inputmode="kana">${sale.staffPublicMessage || ''}</textarea>
                            <button class="button-secondary save-staff-note-btn" data-sale-id="${sale.id}" data-field-type="staffPublicMessage">共有メッセージを保存</button>
                        </div>
                        
                        <!-- スタッフ専用メモ（非公開） -->
                        <div class="staff-note-section">
                            <label for="staff-note-${sale.id}">スタッフ専用メモ（非公開）</label>
                            <textarea id="staff-note-${sale.id}" class="input-field" rows="3" inputmode="kana">${sale.staffNote || ''}</textarea>
                            <button class="button-secondary save-staff-note-btn" data-sale-id="${sale.id}" data-field-type="staffNote">専用メモを保存</button>
                        </div>

                        ${sale.customerNote ? `
                        <div class="customer-note-section">
                            <strong>お客様からのコメント:</strong>
                            <p>${sale.customerNote}</p>
                        </div>
                        ` : ''}
                    </div>
                `;
                // ▲▲▲ 修正ここまで ▲▲▲
            });
            visitHistoryList.innerHTML = html;

            visitHistoryList.querySelectorAll('.save-staff-note-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const saleId = e.target.dataset.saleId;
                    const fieldType = e.target.dataset.fieldType; // 'staffNote' or 'staffPublicMessage'
                    const note = document.getElementById(`${fieldType === 'staffNote' ? 'staff-note' : 'staff-public-message'}-${saleId}`).value.trim();
                    
                    btn.textContent = "保存中...";
                    btn.disabled = true;
                    try {
                        const dataToUpdate = {};
                        dataToUpdate[fieldType] = note;
                        await updateDoc(doc(db, "sales", saleId), dataToUpdate);
                        alert('メモを保存しました。');
                    } catch (error) {
                        alert('メモの保存に失敗しました。');
                        console.error(error);
                    } finally {
                        btn.textContent = fieldType === 'staffNote' ? "専用メモを保存" : "共有メッセージを保存";
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
        const galleryGrid = galleryContent.querySelector('#gallery-grid');
        galleryGrid.innerHTML = '<div class="spinner"></div>';
        try {
            const q = query(collection(db, `users/${customerId}/gallery`), orderBy("createdAt", "desc"));
            const snapshot = await getDocs(q);
            if (snapshot.empty) {
                galleryGrid.innerHTML = '<p>まだ写真がありません。</p>';
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
            galleryGrid.innerHTML = html;

            galleryGrid.querySelectorAll('.gallery-thumbnail').forEach(img => {
                img.addEventListener('click', () => {
                    viewerImg.src = img.src;
                    document.body.classList.add('modal-open'); // スクロール禁止
                    imageViewer.style.display = 'flex';
                });
            });

        } catch (error) {
            console.error("ギャラリーの読み込みエラー:", error);
            galleryGrid.innerHTML = '<p>ギャラリーの読み込みに失敗しました。</p>';
        }
    };

    const handleTakePhoto = () => {
        photoUploadInput.setAttribute('capture', 'environment');
        photoUploadInput.click();
    };

    const uploadAndSavePhoto = async (file) => {
        if (!editingCustomerId || !file) return;
        
        if(galleryUploadingOverlay) galleryUploadingOverlay.style.display = 'flex';
        try {
            const timestamp = Date.now();
            const storageRef = ref(storage, `users/${editingCustomerId}/gallery/${timestamp}-${file.name}`);

            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(db, `users/${editingCustomerId}/gallery`), {
                url: downloadURL,
                createdAt: serverTimestamp(),
            });
            if (customerModal.style.display === 'flex') {
                 await fetchGallery(editingCustomerId);
            }
        } catch (error) {
            console.error("写真のアップロードに失敗:", error);
            alert("写真のアップロードに失敗しました。");
        } finally {
            if(galleryUploadingOverlay) galleryUploadingOverlay.style.display = 'none';
        }
    };

    const renderCustomers = (customersToRender) => {
        customerListContainer.innerHTML = '';
        if (customersToRender.length === 0) {
            customerInfoPlaceholder.textContent = '該当する顧客情報がありません。';
            customerInfoPlaceholder.style.display = 'block';
            return;
        }
        customerInfoPlaceholder.style.display = 'none';

        customersToRender.forEach(customer => {
            const card = document.createElement('div');
            card.className = 'customer-card';

            const encodedName = encodeURIComponent(customer.name);
            const counselingLiffUrl = `https://liff.line.me/2008345232-pVNR18m1?customerId=${customer.id}&customerName=${encodedName}`;

            // ▼▼▼ 修正: LINEアイコンと注意事項アイコンのロジックを変更 ▼▼▼
            const lineIcon = customer.isLineUser ? '<i class="fa-brands fa-line line-icon"></i>' : '';
            const noteIcon = customer.notes ? '<i class="fa-solid fa-triangle-exclamation note-icon"></i>' : '';

            card.innerHTML = `
                <div class="customer-card-header">
                    ${lineIcon}
                    <span class="customer-card-name">${customer.name}</span>
                    ${noteIcon}
                </div>
                <div class="customer-card-actions">
                    <button class="icon-button camera-btn" title="写真"><i class="fa-solid fa-camera"></i></button>
                    
                    <a href="${counselingLiffUrl}" class="icon-button" title="AIカウンセリング" target="_blank"><i class="fa-solid fa-wand-magic-sparkles"></i></a>
                    
                    <a href="./pos.html?customerId=${customer.id}&customerName=${encodeURIComponent(customer.name)}" class="icon-button" title="会計"><i class="fa-solid fa-cash-register"></i></a>
                    <button class="icon-button delete-btn" title="削除"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            // ▲▲▲ 修正ここまで ▲▲▲

            card.querySelector('.customer-card-header').addEventListener('click', () => openCustomerModal(customer));
            card.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteCustomer(customer.id, customer.name); });
            card.querySelector('.camera-btn').addEventListener('click', (e) => { 
                e.stopPropagation(); 
                editingCustomerId = customer.id; 
                handleTakePhoto(); 
            });
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

    const startCustomerListener = () => {
        if (unsubscribeCustomers) {
            unsubscribeCustomers();
        }
        const q = query(collection(db, "users"), orderBy("kana", "asc"));
        unsubscribeCustomers = onSnapshot(q, (snapshot) => {
            allCustomers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const activeInitial = document.querySelector('.initial-nav button.active');

            // ▼▼▼ 修正: URLパラメータ処理を onSnapshot 内に移動 ▼▼▼
            if (targetCustomerId && !paramsHandled) {
                // 会計ページから顧客ID付きでリダイレクトされた場合
                const customer = allCustomers.find(c => c.id === targetCustomerId);
                if (customer) {
                    openCustomerModal(customer);
                    paramsHandled = true;
                    customerInfoPlaceholder.style.display = 'none';
                    customerListContainer.innerHTML = ''; // リストをクリア
                }
            } else if (customerSearchInput.value && !paramsHandled) {
                // 予約ページなどから顧客名付きでリダイレクトされた場合
                filterCustomers();
                paramsHandled = true;
            } else if (customerSearchInput.value) {
                // 通常の検索入力
                filterCustomers();
            } else if (activeInitial) {
                // 通常のインデックスクリック
                activeInitial.click();
            } else if (allCustomers.length > 0 && !paramsHandled) {
                // 初期ロード時 (URLパラメータなし)
                 customerInfoPlaceholder.textContent = '検索または上のインデックスから顧客を表示します。';
                 customerInfoPlaceholder.style.display = 'block';
                 customerListContainer.innerHTML = '';
            }
            // ▲▲▲ 修正ここまで ▲▲▲

        }, (error) => {
            console.error("顧客データの取得に失敗:", error);
            customerInfoPlaceholder.textContent = "顧客データの読み込みに失敗しました。";
        });
    };

    // --- イベントリスナーの設定 ---
    addCustomerBtn.addEventListener('click', () => openCustomerModal());
    closeModalBtn.addEventListener('click', closeModal);
    customerForm.addEventListener('submit', saveCustomer);
    customerSearchInput.addEventListener('input', () => {
         // ▼▼▼ 修正: 手動検索時はURLパラメータフラグをリセット ▼▼▼
         paramsHandled = true; // URLパラメータ処理を停止
         targetCustomerId = null; // 顧客ID指定を解除
         // ▲▲▲ 修正ここまで ▲▲▲
        filterCustomers();
    });
    photoUploadInput.addEventListener('change', (e) => {
        if(e.target.files.length > 0) {
            uploadAndSavePhoto(e.target.files[0])
        }
    });
    closeViewerBtn.addEventListener('click', () => {
        document.body.classList.remove('modal-open'); // スクロール許可
        imageViewer.style.display = 'none';
    });
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetContentId = button.dataset.tabContent;
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            button.classList.add('active');
            document.getElementById(targetContentId).classList.add('active');

            if (editingCustomerId) {
                if (targetContentId === 'visit-history-content') {
                    fetchVisitHistory(editingCustomerId);
                }
                if (targetContentId === 'gallery-content') {
                    fetchGallery(editingCustomerId);
                }
            }
        });
    });

    // --- 初期化処理 ---
    createInitialNav();
    startCustomerListener();
    // ▼▼▼ 修正: checkUrlParamsはリスナー起動前に呼び出す ▼▼▼
    checkUrlParams();
    // ▲▲▲ 修正ここまで ▲▲▲
};

runAdminPage(customersMain);