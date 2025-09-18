import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { 
    collection, onSnapshot, query, where, Timestamp, doc, getDoc, setDoc,
    addDoc, deleteDoc, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const adminMain = async (auth, user) => {
    // --- State ---
    let salonSettings = {};
    let customers = [];
    let menuCategories = [];
    let editingBooking = null;
    let unsubscribeReservations = null;
    const today = new Date();
    
    // --- DOM Elements ---
    const todayDateEl = document.getElementById('today-date');
    const timeLabelsContainer = document.getElementById('time-labels');
    const timelineContainer = document.getElementById('today-schedule-timeline');
    const memoTextarea = document.getElementById('today-memo');
    const saveMemoBtn = document.getElementById('save-memo-btn');
    
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

    const openModal = (modal) => modal.style.display = 'flex';
    const closeModal = (modal) => modal.style.display = 'none';

    // --- Utility Functions ---
    const loadSalonSettings = async () => {
        const docRef = doc(db, "settings", "salon");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            salonSettings = docSnap.data();
        } else {
            salonSettings = { startTime: '10:00', endTime: '20:00' };
        }
    };
    
    // --- Timeline Rendering ---
    const renderTimeline = (reservations) => {
        timelineContainer.innerHTML = '';
        const startHour = parseInt(salonSettings.startTime.split(':')[0]);
        const endHour = parseInt(salonSettings.endTime.split(':')[0]);
        const totalMinutesInView = (endHour - startHour) * 60;

        reservations.forEach(booking => {
            if (booking.isConsultation) return;

            const start = booking.startTime.toDate();
            const end = booking.endTime.toDate();

            const startMinutes = (start.getHours() * 60 + start.getMinutes()) - (startHour * 60);
            const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);

            const left = (startMinutes / totalMinutesInView) * 100;
            const width = (durationMinutes / totalMinutesInView) * 100;

            if (left < 0 || width <= 0) return;

            const item = document.createElement('div');
            item.className = 'timeline-item';
            if (booking.status === 'unavailable') {
                item.classList.add('unavailable');
            }
            item.style.left = `${left}%`;
            item.style.width = `${width}%`;
            const customerName = booking.status === 'unavailable' ? '予約不可' : (booking.customerName || '顧客');
            item.textContent = customerName;
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                openDetailModal(booking);
            });
            timelineContainer.appendChild(item);
        });
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

            if(booking.isConsultation) {
                document.getElementById('detail-datetime').textContent = '時間未定（相談中）';
            } else {
                document.getElementById('detail-datetime').textContent = 
                `${start.toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
            }

            if(booking.userRequests) {
                requestsEl.textContent = booking.userRequests;
                requestsWrapper.style.display = 'block';
            } else {
                requestsWrapper.style.display = 'none';
            }

            document.getElementById('detail-menus').textContent = booking.selectedMenus?.map(m => m.name).join(', ') || 'N/A';
            if (normalActions) normalActions.style.display = 'grid';
            if (unavailableActions) unavailableActions.style.display = 'none';
            
            document.getElementById('detail-pos-link').href = `./pos.html?bookingId=${booking.id}`;
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
            const [startH, startM] = time.split(':').map(Number);
            const startTime = new Date(today);
            startTime.setHours(startH, startM, 0, 0);
            const endTime = new Date(startTime.getTime() + 30 * 60000); 

            const data = {
                startTime: Timestamp.fromDate(startTime),
                endTime: Timestamp.fromDate(endTime),
                status: 'unavailable',
                customerName: '',
                customerId: null,
                selectedMenus: [],
                isConsultation: false
            };
            
            await addDoc(collection(db, "reservations"), data);
            closeModal(actionModal);
        };
        openModal(actionModal);
    };

    const openEditModal = (timeOrBooking) => {
        bookingForm.reset();
        customerInput.value = '';
        deleteBtn.style.display = 'none';
        
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
            
            if(editingBooking.selectedMenus) {
                editingBooking.selectedMenus.forEach(menu => {
                    const checkbox = menuAccordionContainer.querySelector(`input[value="${menu.id}"]`);
                    if (checkbox) checkbox.checked = true;
                });
            }
            
            const start = editingBooking.startTime.toDate();
            const end = editingBooking.endTime.toDate();
            startTimeSelect.value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
            endTimeSelect.value = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
            deleteBtn.style.display = 'inline-block';
        }
        openModal(editModal);
    };

    const saveBooking = async (e) => {
        e.preventDefault();
        
        let customerId, customerName;

        if (editingBooking) {
            customerId = editingBooking.customerId;
            customerName = editingBooking.customerName;
        } else {
            const selectedCustomer = customers.find(c => c.name === customerInput.value);
            if (selectedCustomer) {
                customerId = selectedCustomer.id;
                customerName = selectedCustomer.name;
            } else {
                customerId = null; 
                customerName = customerInput.value.trim();
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
        };
        
        try {
            if (editingBooking) {
                await setDoc(doc(db, "reservations", editingBooking.id), data, { merge: true });
            } else {
                await addDoc(collection(db, "reservations"), data);
            }
            closeModal(editModal);
        } catch(error) {
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
            } catch(error) {
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
        const startOfDay = new Date(today); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(today); endOfDay.setHours(23, 59, 59, 999);
        
        const q = query(
            collection(db, "reservations"),
            where("startTime", ">=", Timestamp.fromDate(startOfDay)),
            where("startTime", "<=", Timestamp.fromDate(endOfDay)),
            orderBy("startTime")
        );

        unsubscribeReservations = onSnapshot(q, (snapshot) => {
            const reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderTimeline(reservations);
        });
    };

    // --- Initial Data Load ---
    const loadInitialData = async () => {
        const customersSnapshot = await getDocs(query(collection(db, 'users'), orderBy('kana')));
        customers = customersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data()}));
        customerDatalist.innerHTML = customers.map(c => `<option value="${c.name}"></option>`).join('');

        const categoriesSnapshot = await getDocs(query(collection(db, 'service_categories'), orderBy('order')));
        menuAccordionContainer.innerHTML = '';
        for (const catDoc of categoriesSnapshot.docs) {
            const category = { id: catDoc.id, ...catDoc.data(), menus: [] };
            const menusSnapshot = await getDocs(query(collection(db, `service_categories/${catDoc.id}/menus`), orderBy('order')));
            
            const accordion = document.createElement('details');
            accordion.className = 'menu-category-accordion';
            
            let menuHtml = '';
            menusSnapshot.forEach(menuDoc => {
                const menu = { id: menuDoc.id, ...menuDoc.data() };
                category.menus.push(menu);
                menuHtml += `<label class="checkbox-label"><input type="checkbox" value="${menu.id}"> ${menu.name}</label>`;
            });

            accordion.innerHTML = `
                <summary class="accordion-header">${category.name}</summary>
                <div class="accordion-content">${menuHtml}</div>
            `;
            menuCategories.push(category);
            menuAccordionContainer.appendChild(accordion);
        }

        // Timeline hours
        timeLabelsContainer.innerHTML = '';
        const startHour = parseInt(salonSettings.startTime.split(':')[0]);
        const endHour = parseInt(salonSettings.endTime.split(':')[0]);
        for (let i = startHour; i <= endHour; i++) {
            const label = document.createElement('span');
            label.textContent = i;
            timeLabelsContainer.appendChild(label);
        }
        
        startTimeSelect.innerHTML = ''; endTimeSelect.innerHTML = '';
        for (let h = startHour; h <= endHour; h++) {
            for (let m = 0; m < 60; m += 30) {
                if (h === endHour && m > 0) continue;
                const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                startTimeSelect.add(new Option(time, time));
                endTimeSelect.add(new Option(time, time));
            }
        }
    };
    
    // --- Event Listeners Setup ---
    saveMemoBtn.addEventListener('click', saveMemo);
    bookingForm.addEventListener('submit', saveBooking);
    deleteBtn.addEventListener('click', deleteBooking);
    
    document.getElementById('detail-edit-btn').addEventListener('click', () => {
        closeModal(detailModal);
        openEditModal(editingBooking);
    });
    document.getElementById('detail-cancel-btn').addEventListener('click', deleteBooking);
    document.getElementById('unavailable-delete-btn').addEventListener('click', deleteBooking);

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            closeModal(e.target.closest('.modal'));
        });
    });

    timelineContainer.addEventListener('click', (e) => {
        if (!e.target.classList.contains('today-schedule-timeline')) return;

        const rect = e.target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;

        const startHour = parseInt(salonSettings.startTime.split(':')[0]);
        const endHour = parseInt(salonSettings.endTime.split(':')[0]);
        const totalMinutesInView = (endHour - startHour) * 60;

        const clickedMinute = totalMinutesInView * percentage;
        
        const hour = Math.floor(clickedMinute / 60) + startHour;
        const minute = (clickedMinute % 60) < 15 ? 0 : 30; // 15分を境に0分か30分かに丸める

        const time = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
        openActionModal(time);
    });
    
    // --- Initial Execution ---
    todayDateEl.textContent = today.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    await loadSalonSettings();
    await loadInitialData();
    listenToBookings();
    loadMemo();
};

runAdminPage(adminMain);

