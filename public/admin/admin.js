import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import {
    collection, onSnapshot, query, where, Timestamp, doc, getDoc, setDoc,
    addDoc, deleteDoc, orderBy, getDocs, collectionGroup, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const adminMain = async (auth, user) => {
    // --- State ---
    let salonSettings = {};
    let customers = [];
    let menuCategories = [];
    let editingBooking = null;
    let unsubscribeReservations = null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fixedStartHour = 8;
    const fixedEndHour = 22;

    // --- DOM Elements ---
    const todayDateEl = document.getElementById('today-date');
    const timeLabelsContainer = document.getElementById('time-labels');
    const timelineContainer = document.getElementById('today-schedule-timeline');
    const memoTextarea = document.getElementById('today-memo');
    const saveMemoBtn = document.getElementById('save-memo-btn');

    // 日計表示用DOM
    const dailySalesTotalEl = document.getElementById('daily-sales-total');
    const dailySalesCountEl = document.getElementById('daily-sales-count');

    // --- Modal Elements ---
    const detailModal = document.getElementById('booking-detail-modal');
    const actionModal = document.getElementById('timeslot-action-modal');
    const editModal = document.getElementById('booking-edit-modal');
    const bookingForm = document.getElementById('booking-form');
    const editModalTitle = document.getElementById('edit-modal-title');
    const customerInput = document.getElementById('customer-input');
    const customerDatalist = document.getElementById('customer-datalist');
    const menuAccordionContainer = document.getElementById('menu-accordion-container');
    const startTimeSelect = document.getElementById('start-time');
    const endTimeSelect = document.getElementById('end-time');
    const deleteBtn = document.getElementById('delete-booking-btn');
    const newCustomerFields = document.getElementById('new-customer-fields');
    const newCustomerKanaInput = document.getElementById('new-customer-kana');
    const newCustomerPhoneInput = document.getElementById('new-customer-phone');
    // 予約不可モーダル関連
    const unavailableModal = document.getElementById('unavailable-modal');
    const unavailableForm = document.getElementById('unavailable-form');
    const unavailableStartTimeSelect = document.getElementById('unavailable-start-time');
    const unavailableEndTimeSelect = document.getElementById('unavailable-end-time');
    const unavailableTitle = document.getElementById('unavailable-modal-title');

    // Admin Notes Elements
    const adminNotesWrapper = document.getElementById('detail-admin-notes-wrapper');
    const adminNotesEl = document.getElementById('detail-admin-notes');

    const openModal = (modal) => {
        document.body.classList.add('modal-open');
        modal.style.display = 'flex';
    };
    const closeModal = (modal) => {
        document.body.classList.remove('modal-open');
        modal.style.display = 'none';
    };

    // --- Utility Functions ---
    const loadSalonSettings = async () => {
        const docRef = doc(db, "settings", "salon");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            salonSettings = docSnap.data();
        } else {
            salonSettings = {
                businessHours: {
                    '0': { isOpen: true, start: '10:00', end: '20:00' },
                    '1': { isOpen: true, start: '10:00', end: '20:00' },
                    '2': { isOpen: true, start: '10:00', end: '20:00' },
                    '3': { isOpen: true, start: '10:00', end: '20:00' },
                    '4': { isOpen: true, start: '10:00', end: '20:00' },
                    '5': { isOpen: true, start: '10:00', end: '20:00' },
                    '6': { isOpen: true, start: '10:00', end: '20:00' },
                }
            };
        }
    };

    // --- Timeline Rendering ---
    const renderTimeline = (reservations) => {
        timelineContainer.innerHTML = '';

        // ▼▼▼ 追加: グリッド線の描画 (時間軸と正確に合わせるためJSで生成) ▼▼▼
        const totalHours = fixedEndHour - fixedStartHour;
        for (let i = 0; i <= totalHours; i++) {
            const left = (i / totalHours) * 100;
            const gridLine = document.createElement('div');
            gridLine.className = 'timeline-grid-line';
            gridLine.style.left = `${left}%`;
            timelineContainer.appendChild(gridLine);
        }
        // ▲▲▲ 追加ここまで ▲▲▲

        const dayOfWeek = today.getDay();
        const todaySettings = salonSettings.businessHours ? salonSettings.businessHours[dayOfWeek] : null;

        const totalMinutesInView = (fixedEndHour - fixedStartHour) * 60;

        // 営業時間マーカーの描画
        if (todaySettings && todaySettings.isOpen) {
            const [startH, startM] = todaySettings.start.split(':').map(Number);
            const [endH, endM] = todaySettings.end.split(':').map(Number);

            const startMinutes = (startH * 60 + startM) - (fixedStartHour * 60);
            const endMinutes = (endH * 60 + endM) - (fixedStartHour * 60);

            const startLeft = (startMinutes / totalMinutesInView) * 100;
            const endLeft = (endMinutes / totalMinutesInView) * 100;

            const startMarker = document.createElement('div');
            startMarker.className = 'business-hours-marker-h';
            startMarker.style.left = `${startLeft}%`;
            timelineContainer.appendChild(startMarker);

            const endMarker = document.createElement('div');
            endMarker.className = 'business-hours-marker-h';
            endMarker.style.left = `${endLeft}%`;
            timelineContainer.appendChild(endMarker);
        }

        reservations.forEach(booking => {
            if (!booking.startTime || !booking.endTime) return;
            if (booking.isConsultation) return;

            const start = booking.startTime.toDate();
            const end = booking.endTime.toDate();

            const startMinutes = (start.getHours() * 60 + start.getMinutes()) - (fixedStartHour * 60);
            const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);

            const left = (startMinutes / totalMinutesInView) * 100;
            const width = (durationMinutes / totalMinutesInView) * 100;

            if (left < 0 || width <= 0) return;

            const item = document.createElement('div');
            item.className = 'timeline-item';
            if (booking.status === 'unavailable') item.classList.add('unavailable');
            if (booking.status === 'completed') item.classList.add('completed');
            item.style.left = `${left}%`;
            item.style.width = `${width}%`;
            const customerName = booking.status === 'unavailable' ? '予約不可' : (booking.customerName || '顧客');

            const customer = customers.find(c => c.id === booking.customerId);
            const lineIcon = customer && customer.isLineUser ? '<i class="fa-brands fa-line line-icon"></i>' : '';
            const noteIcon = customer && customer.notes ? '<i class="fa-solid fa-triangle-exclamation note-icon"></i>' : '';

            const adminNotesHtml = booking.adminNotes ? `<small class="admin-notes-preview" style="display:block; color:var(--primary-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size: 0.7rem;">📝 ${booking.adminNotes}</small>` : '';

            item.innerHTML = `${lineIcon}<span class="timeline-item-name">${customerName}</span>${noteIcon}${adminNotesHtml}`;

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                openDetailModal(booking);
            });
            timelineContainer.appendChild(item);
        });
    };

    const populateTimeSelects = () => {
        startTimeSelect.innerHTML = '';
        endTimeSelect.innerHTML = '';
        unavailableStartTimeSelect.innerHTML = '';
        unavailableEndTimeSelect.innerHTML = '';

        for (let h = fixedStartHour; h <= fixedEndHour; h++) {
            for (let m = 0; m < 60; m += 30) {
                if (h === fixedEndHour && m > 0) continue;
                const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                startTimeSelect.add(new Option(time, time));
                endTimeSelect.add(new Option(time, time));
                unavailableStartTimeSelect.add(new Option(time, time));
                unavailableEndTimeSelect.add(new Option(time, time));
            }
        }
    };

    // --- Modal Logics ---
    const openDetailModal = (booking) => {
        editingBooking = booking;
        const detailModalTitle = document.getElementById('detail-modal-title');
        const normalActions = document.getElementById('normal-booking-actions');
        const unavailableActions = document.getElementById('unavailable-booking-actions');
        const requestsWrapper = document.getElementById('detail-requests-wrapper');
        const requestsEl = document.getElementById('detail-requests');

        if (booking.status === 'unavailable') {
            detailModalTitle.textContent = '予約不可設定';
            document.getElementById('normal-booking-details').style.display = 'none';
            if (normalActions) normalActions.style.display = 'none';
            if (unavailableActions) unavailableActions.style.display = 'block';
        } else {
            document.getElementById('normal-booking-details').style.display = 'block';
            detailModalTitle.textContent = '予約詳細';
            document.getElementById('detail-customer-name').textContent = booking.customerName || 'N/A';
            const start = booking.startTime.toDate();
            const end = booking.endTime.toDate();

            if (booking.isConsultation) {
                document.getElementById('detail-datetime').textContent = '時間未定（相談中）';
            } else {
                document.getElementById('detail-datetime').textContent =
                    `${start.toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
            }

            if (booking.userRequests) {
                requestsEl.textContent = booking.userRequests;
                requestsWrapper.style.display = 'block';
            } else {
                requestsWrapper.style.display = 'none';
            }

            if (booking.adminNotes) {
                adminNotesEl.textContent = booking.adminNotes;
                adminNotesWrapper.style.display = 'block';
            } else {
                adminNotesWrapper.style.display = 'none';
            }

            document.getElementById('detail-menus').textContent = booking.selectedMenus?.map(m => m.name).join(', ') || 'N/A';
            if (normalActions) normalActions.style.display = 'grid';
            if (unavailableActions) unavailableActions.style.display = 'none';

            const posLink = document.getElementById('detail-pos-link');
            if (booking.status === 'completed') {
                posLink.style.display = 'none';
            } else {
                posLink.style.display = 'flex';
                posLink.href = `./pos.html?bookingId=${booking.id}`;
            }

            const customerNameEncoded = encodeURIComponent(booking.customerName);
            document.getElementById('detail-customer-link').href = `./customers.html?customerId=${booking.customerId}&customerName=${customerNameEncoded}`;
        }
        openModal(detailModal);
    };

    const openActionModal = (time) => {
        document.getElementById('timeslot-action-title').textContent = `${today.toLocaleDateString('ja-JP')} ${time}`;

        document.getElementById('action-add-booking').onclick = () => {
            closeModal(actionModal);
            openEditModal(time);
        };

        document.getElementById('action-set-unavailable').onclick = async () => {
            closeModal(actionModal);
            openUnavailableModal(time);
        };
        openModal(actionModal);
    };

    const openUnavailableModal = (time) => {
        unavailableForm.reset();
        unavailableTitle.textContent = `予約不可設定 (${today.toLocaleDateString('ja-JP')})`;
        unavailableStartTimeSelect.value = time;
        const [h, m] = time.split(':').map(Number);
        const startDate = new Date(today);
        startDate.setHours(h, m, 0, 0);
        const endDate = new Date(startDate.getTime() + 30 * 60000);
        const endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;

        if (endDate.getHours() > fixedEndHour || (endDate.getHours() === fixedEndHour && endDate.getMinutes() > 0)) {
            unavailableEndTimeSelect.value = `${String(fixedEndHour).padStart(2, '0')}:00`;
        } else {
            unavailableEndTimeSelect.value = endTime;
        }

        openModal(unavailableModal);
    };

    const saveUnavailable = async (e) => {
        e.preventDefault();
        const startTimeStr = unavailableStartTimeSelect.value;
        const endTimeStr = unavailableEndTimeSelect.value;

        const [startH, startM] = startTimeStr.split(':').map(Number);
        const startTime = new Date(today);
        startTime.setHours(startH, startM, 0, 0);

        const [endH, endM] = endTimeStr.split(':').map(Number);
        const endTime = new Date(today);
        endTime.setHours(endH, endM, 0, 0);

        if (endTime <= startTime) {
            alert('終了時間は開始時間より後に設定してください。');
            return;
        }

        const data = {
            startTime: Timestamp.fromDate(startTime),
            endTime: Timestamp.fromDate(endTime),
            status: 'unavailable',
            customerName: '予約不可',
            customerId: null,
            selectedMenus: [],
            isConsultation: false,
            createdAt: serverTimestamp(),
            createdBy: 'admin'
        };

        try {
            await addDoc(collection(db, "reservations"), data);
            closeModal(unavailableModal);
        } catch (error) {
            console.error("予約不可設定の追加に失敗:", error);
            alert("予約不可設定の追加に失敗しました。");
        }
    };

    const calculateEndTime = () => {
        const selectedMenuCheckboxes = menuAccordionContainer.querySelectorAll('input:checked');
        const allMenus = menuCategories.flatMap(cat => cat.menus);
        const selectedMenus = Array.from(selectedMenuCheckboxes).map(cb => {
            return allMenus.find(m => m.id === cb.value);
        }).filter(Boolean);

        const totalDuration = selectedMenus.reduce((sum, menu) => sum + menu.duration, 0);

        const startTimeStr = startTimeSelect.value;
        if (!startTimeStr) return;

        const [startH, startM] = startTimeSelect.value.split(':').map(Number);
        const startDate = new Date(today);
        startDate.setHours(startH, startM, 0, 0);

        const endDate = new Date(startDate.getTime() + totalDuration * 60000);

        const endMinutesTotal = endDate.getHours() * 60 + endDate.getMinutes();
        const roundedEndMinutes = Math.ceil(endMinutesTotal / 30) * 30;
        const endH = Math.floor(roundedEndMinutes / 60);
        const endM = roundedEndMinutes % 60;

        const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        if (endH > fixedEndHour || (endH === fixedEndHour && endM > 0)) {
            endTimeSelect.value = `${String(fixedEndHour).padStart(2, '0')}:00`;
        } else if (endTimeSelect.querySelector(`option[value="${endTimeStr}"]`)) {
            endTimeSelect.value = endTimeStr;
        } else {
            endTimeSelect.value = endTimeSelect.options[endTimeSelect.options.length - 1].value;
        }
    };

    const openEditModal = (timeOrBooking) => {
        bookingForm.reset();
        customerInput.value = '';
        deleteBtn.style.display = 'none';
        newCustomerFields.style.display = 'none';
        newCustomerKanaInput.required = false;

        menuAccordionContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);

        if (typeof timeOrBooking === 'string') {
            editingBooking = null;
            editModalTitle.textContent = '新規予約追加';
            startTimeSelect.value = timeOrBooking;
            endTimeSelect.value = timeOrBooking;
            customerInput.disabled = false;
        } else {
            editingBooking = timeOrBooking;
            editModalTitle.textContent = '予約編集';

            customerInput.value = editingBooking.customerName;
            customerInput.disabled = true;

            if (editingBooking.selectedMenus) {
                editingBooking.selectedMenus.forEach(menu => {
                    const checkbox = menuAccordionContainer.querySelector(`input[value="${menu.id}"]`);
                    if (checkbox) checkbox.checked = true;
                });
            }

            const start = editingBooking.startTime.toDate();
            const end = editingBooking.endTime.toDate();
            startTimeSelect.value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;

            const endMinutesTotal = end.getHours() * 60 + end.getMinutes();
            const roundedEndMinutes = Math.ceil(endMinutesTotal / 30) * 30;
            const endH = Math.floor(roundedEndMinutes / 60);
            const endM = roundedEndMinutes % 60;
            const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

            if (endTimeSelect.querySelector(`option[value="${endTimeStr}"]`)) {
                endTimeSelect.value = endTimeStr;
            } else {
                endTimeSelect.value = endTimeSelect.options[endTimeSelect.options.length - 1].value;
            }

            deleteBtn.style.display = 'inline-block';
        }

        startTimeSelect.disabled = false;
        endTimeSelect.disabled = false;

        openModal(editModal);
    };

    const handleCustomerInputChange = () => {
        const customerName = customerInput.value.trim();
        const existingCustomer = customers.find(c => c.name === customerName);
        if (customerName && !existingCustomer) {
            newCustomerFields.style.display = 'block';
            newCustomerKanaInput.required = true;
        } else {
            newCustomerFields.style.display = 'none';
            newCustomerKanaInput.required = false;
        }
    };


    const saveBooking = async (e) => {
        e.preventDefault();

        let customerId;
        let customerName = customerInput.value.trim();

        const existingCustomer = customers.find(c => c.name === customerName);

        if (existingCustomer) {
            customerId = existingCustomer.id;
        } else {
            const newKana = newCustomerKanaInput.value.trim();
            const newPhone = newCustomerPhoneInput.value.trim();

            if (!customerName || !newKana) {
                alert('新しいお客様の場合、名前とふりがなは必須です。');
                return;
            }

            try {
                const newCustomerData = {
                    name: customerName,
                    kana: newKana,
                    phone: newPhone,
                    isLineUser: false,
                    createdAt: serverTimestamp(),
                };
                const docRef = await addDoc(collection(db, "users"), newCustomerData);
                customerId = docRef.id;

                customers.push({ id: customerId, ...newCustomerData });
                customerDatalist.innerHTML = customers.map(c => `<option value="${c.name}"></option>`).join('');

            } catch (error) {
                console.error("新規顧客の作成に失敗:", error);
                alert("新規顧客の作成に失敗しました。");
                return;
            }
        }

        if (!customerName) {
            alert('顧客名を入力してください。');
            return;
        }

        const selectedMenuCheckboxes = menuAccordionContainer.querySelectorAll('input:checked');
        const allMenus = menuCategories.flatMap(cat => cat.menus);
        const selectedMenus = Array.from(selectedMenuCheckboxes).map(cb => {
            const menu = allMenus.find(m => m.id === cb.value);
            return { id: menu.id, name: menu.name, price: menu.price, duration: menu.duration };
        });

        if (selectedMenus.length === 0) {
            alert('メニューを1つ以上選択してください。');
            return;
        }

        const [startH, startM] = startTimeSelect.value.split(':').map(Number);
        const startTime = new Date(today);
        startTime.setHours(startH, startM, 0, 0);

        const [endH, endM] = endTimeSelect.value.split(':').map(Number);
        const endTime = new Date(today);
        endTime.setHours(endH, endM, 0, 0);

        const data = {
            customerId: customerId,
            customerName: customerName,
            selectedMenus: selectedMenus,
            startTime: Timestamp.fromDate(startTime),
            endTime: Timestamp.fromDate(endTime),
            status: 'confirmed',
            isConsultation: false,
            createdAt: serverTimestamp(),
            createdBy: 'admin',
            adminNotes: document.getElementById('admin-notes')?.value || ''
        };

        try {
            if (editingBooking) {
                await setDoc(doc(db, "reservations", editingBooking.id), data, { merge: true });
            } else {
                await addDoc(collection(db, "reservations"), data);
            }
            closeModal(editModal);
        } catch (error) {
            console.error("予約の保存に失敗:", error);
            alert("予約の保存に失敗しました。");
        }
    };

    const deleteBooking = async () => {
        if (editingBooking && confirm('この予約または予約不可設定を削除しますか？')) {
            try {
                await deleteDoc(doc(db, "reservations", editingBooking.id));
                closeModal(editModal);
                closeModal(detailModal);
            } catch (error) {
                console.error("予約の削除に失敗:", error);
                alert("予約の削除に失敗しました。");
            }
        }
    };

    // --- Memo Handling ---
    const loadMemo = async () => {
        const todayStr = today.toISOString().split('T')[0];
        const memoDocRef = doc(db, "daily_memos", todayStr);
        const docSnap = await getDoc(memoDocRef);
        if (docSnap.exists()) {
            memoTextarea.value = docSnap.data().content || '';
        } else {
            memoTextarea.value = '';
        }
    };

    const saveMemo = async () => {
        const todayStr = today.toISOString().split('T')[0];
        const memoDocRef = doc(db, "daily_memos", todayStr);
        await setDoc(memoDocRef, { content: memoTextarea.value });
        alert('メモを保存しました。');
    };

    // --- Realtime Listener ---
    const listenToBookings = () => {
        if (unsubscribeReservations) unsubscribeReservations();

        const startOfDay = new Date(today);
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);

        const q = query(
            collection(db, "reservations"),
            where("startTime", ">=", Timestamp.fromDate(startOfDay)),
            where("startTime", "<=", Timestamp.fromDate(endOfDay)),
            orderBy("startTime")
        );

        unsubscribeReservations = onSnapshot(q, (snapshot) => {
            const reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderTimeline(reservations);
        }, (error) => {
            console.error("予約データの取得に失敗:", error);
            timelineContainer.innerHTML = `<div class="timeline-message error">予約データの取得に失敗しました</div>`;
        });
    };

    // 日計集計リスナー (reservationTime 基準に変更)
    const listenToDailySales = () => {
        const startOfDay = new Date(today); // today は adminMain の冒頭で 00:00:00 に設定済み
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);

        // クエリ対象を 'createdAt' (会計日) から 'reservationTime' (予約日) に変更
        const q = query(
            collection(db, "sales"),
            where("reservationTime", ">=", Timestamp.fromDate(startOfDay)),
            where("reservationTime", "<=", Timestamp.fromDate(endOfDay))
        );

        onSnapshot(q, (snapshot) => {
            let totalSales = 0;
            const customerCount = snapshot.size;

            snapshot.forEach(doc => {
                totalSales += doc.data().total || 0;
            });

            if (dailySalesTotalEl && dailySalesCountEl) {
                dailySalesTotalEl.textContent = `¥${totalSales.toLocaleString()}`;
                dailySalesCountEl.textContent = `${customerCount}人`;
            }

        }, (error) => {
            console.error("日次売上の取得に失敗:", error);
            if (dailySalesTotalEl) {
                dailySalesTotalEl.textContent = "取得エラー";
            }
            if (dailySalesCountEl) {
                dailySalesCountEl.textContent = "-";
            }
        });
    };

    // --- Initial Data Load ---
    const loadInitialData = async () => {
        const customersSnapshot = await getDocs(query(collection(db, 'users'), orderBy('kana')));
        customers = customersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        customerDatalist.innerHTML = customers.map(c => `<option value="${c.name}"></option>`).join('');

        const categoriesSnapshot = await getDocs(query(collection(db, 'service_categories'), orderBy('order')));
        const menusSnapshot = await getDocs(query(collectionGroup(db, 'menus'), orderBy('order')));

        const allMenus = menusSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            categoryId: doc.ref.parent.parent.id
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
            category.menus.forEach(menu => {
                menuHtml += `<label class="checkbox-label"><input type="checkbox" value="${menu.id}"> ${menu.name}</label>`;
            });
            accordion.innerHTML = `
                <summary class="accordion-header">${category.name}</summary>
                <div class="accordion-content">${menuHtml}</div>
            `;
            menuAccordionContainer.appendChild(accordion);
        });

        menuAccordionContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', calculateEndTime);
        });
        startTimeSelect.addEventListener('change', calculateEndTime);

        const totalHours = fixedEndHour - fixedStartHour;
        timeLabelsContainer.innerHTML = '';
        for (let i = 0; i <= totalHours; i++) {
            const hour = fixedStartHour + i;
            const label = document.createElement('span');
            label.textContent = hour;
            label.style.left = `${(i / totalHours) * 100}%`;
            timeLabelsContainer.appendChild(label);
        }

        populateTimeSelects();
    };

    // --- Event Listeners Setup ---
    saveMemoBtn.addEventListener('click', saveMemo);
    bookingForm.addEventListener('submit', saveBooking);
    deleteBtn.addEventListener('click', deleteBooking);
    unavailableForm.addEventListener('submit', saveUnavailable);

    document.getElementById('detail-edit-btn').addEventListener('click', () => {
        closeModal(detailModal);
        openEditModal(editingBooking);
    });
    document.getElementById('detail-cancel-btn').addEventListener('click', deleteBooking);
    document.getElementById('unavailable-delete-btn').addEventListener('click', deleteBooking);

    customerInput.addEventListener('input', handleCustomerInputChange);

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            closeModal(e.target.closest('.modal'));
        });
    });

    timelineContainer.addEventListener('click', (e) => {
        if (e.target !== timelineContainer) return;

        const rect = e.target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;

        const totalMinutesInView = (fixedEndHour - fixedStartHour) * 60;

        const clickedMinute = totalMinutesInView * percentage;

        const hour = Math.floor(clickedMinute / 60) + fixedStartHour;
        const minute = Math.round((clickedMinute % 60) / 30) * 30;

        let finalHour = hour;
        let finalMinute = minute;

        if (finalMinute === 60) {
            finalHour += 1;
            finalMinute = 0;
        }

        if (finalHour > fixedEndHour) {
            finalHour = fixedEndHour;
            finalMinute = 0;
        }

        const time = `${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`;
        openActionModal(time);
    });

    // --- Initial Execution ---
    todayDateEl.textContent = today.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    await loadSalonSettings();
    await loadInitialData();
    listenToBookings();
    loadMemo();
    listenToDailySales();
};

runAdminPage(adminMain);