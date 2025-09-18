import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { 
    collection, getDocs, onSnapshot, addDoc, doc, setDoc, deleteDoc, 
    query, where, Timestamp, orderBy, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- メイン処理 ---
const bookingMain = async (auth, user) => {
    // DOM Elements
    const calendarMonthEl = document.getElementById('calendar-month');
    const calendarGridEl = document.getElementById('calendar-grid');
    const prevMonthBtn = document.getElementById('prev-month');
    const nextMonthBtn = document.getElementById('next-month');
    const timelineDateEl = document.getElementById('timeline-date');
    const timelineSlotsEl = document.getElementById('timeline-slots');
    const timelineHoursEl = document.querySelector('.timeline-hours');
    const dailyMemoEl = document.getElementById('daily-memo');

    // Modals
    const detailModal = document.getElementById('booking-detail-modal');
    const actionModal = document.getElementById('timeslot-action-modal');
    const editModal = document.getElementById('booking-edit-modal');
    
    // Edit Modal Form Fields
    const bookingForm = document.getElementById('booking-form');
    const editModalTitle = document.getElementById('edit-modal-title');
    const customerSelect = document.getElementById('customer-id');
    const menuCheckboxList = document.getElementById('menu-checkbox-list');
    const startTimeSelect = document.getElementById('start-time');
    const endTimeSelect = document.getElementById('end-time');
    const deleteBtn = document.getElementById('delete-booking-btn');
    
    // State
    let salonSettings = {};
    let currentDate = new Date();
    let selectedDate = new Date();
    let customers = [];
    let menuCategories = [];
    let editingBooking = null;
    let unsubscribeReservations = null; 

    const openModal = (modal) => modal.style.display = 'flex';
    const closeModal = (modal) => modal.style.display = 'none';
    
    const loadSalonSettings = async () => {
        const docRef = doc(db, "settings", "salon");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            salonSettings = docSnap.data();
        } else {
            console.log("サロン設定が見つかりません。");
        }
    };

    // --- Calendar Rendering ---
    const renderCalendar = async () => {
        currentDate.setDate(1);
        const month = currentDate.getMonth();
        const year = currentDate.getFullYear();
        calendarMonthEl.textContent = `${year}年 ${month + 1}月`;
        
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        
        const startOfMonth = Timestamp.fromDate(firstDayOfMonth);
        const endOfMonth = Timestamp.fromDate(new Date(year, month + 1, 1));
        const q = query(collection(db, "reservations"), where("startTime", ">=", startOfMonth), where("startTime", "<", endOfMonth));
        const snapshot = await getDocs(q);
        const bookingCounts = {};
        snapshot.forEach(doc => {
            const date = doc.data().startTime.toDate().getDate();
            bookingCounts[date] = (bookingCounts[date] || 0) + 1;
        });

        calendarGridEl.innerHTML = '';
        const startDay = firstDayOfMonth.getDay();
        for (let i = 0; i < startDay; i++) {
            calendarGridEl.innerHTML += '<div></div>';
        }
        
        for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';
            const date = new Date(year, month, i);
            
            let html = `<span>${i}</span>`;
            if (bookingCounts[i]) {
                html += `<span class="booking-count">${bookingCounts[i]}</span>`;
            }
            dayCell.innerHTML = html;
            dayCell.dataset.date = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            
            const dayOfWeek = date.getDay();
            const dateString = dayCell.dataset.date;
            if ((salonSettings.holidays && salonSettings.holidays.includes(dayOfWeek)) || (salonSettings.specialHolidays && salonSettings.specialHolidays.includes(dateString))) {
                dayCell.classList.add('holiday');
            }

            const today = new Date();
            if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && i === today.getDate()) {
                dayCell.classList.add('today');
            }

            const selectedDateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
            if (dateString === selectedDateString) {
                dayCell.classList.add('selected');
            }
            
            dayCell.addEventListener('click', (e) => {
                // ▼▼▼ 日本時間での日付生成を確実にするための修正 ▼▼▼
                const dateStr = e.currentTarget.dataset.date + "T00:00:00";
                selectedDate = new Date(dateStr);

                renderCalendar();
                listenToReservations();
                loadDailyMemo();
            });
            calendarGridEl.appendChild(dayCell);
        }
    };

    // --- Timeline Rendering ---
    const renderTimeline = (reservations) => {
        timelineDateEl.textContent = `${selectedDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}`;
        timelineSlotsEl.innerHTML = '';
        
        reservations.forEach(res => {
            if (!res.startTime || !res.endTime) return; 

            const start = res.startTime.toDate();
            const end = res.endTime.toDate();
            
            const startMinutes = start.getHours() * 60 + start.getMinutes();
            const endMinutes = end.getHours() * 60 + end.getMinutes();
            const duration = endMinutes - startMinutes;
            
            const top = (startMinutes - (10 * 60)) * 2;
            const height = duration * 2;

            const resElement = document.createElement('div');
            resElement.className = 'reservation-item';
            resElement.style.top = `${top}px`;
            resElement.style.height = `${height}px`;
            if(res.status === 'unavailable') {
                resElement.classList.add('unavailable');
            }

            const menuNames = res.selectedMenus && Array.isArray(res.selectedMenus) 
                ? res.selectedMenus.map(m => m.name).join(', ') 
                : (res.status === 'unavailable' ? '予約不可' : 'メニュー情報なし');
            
            resElement.innerHTML = `
                <strong>${res.customerName || ''}</strong>
                <small>${start.getHours()}:${String(start.getMinutes()).padStart(2, '0')} - ${end.getHours()}:${String(end.getMinutes()).padStart(2, '0')}</small>
                <small class="menu-names">${menuNames}</small>
            `;
            resElement.addEventListener('click', (e) => {
                e.stopPropagation(); 
                openDetailModal(res);
            });
            timelineSlotsEl.appendChild(resElement);
        });
    };

    // --- Modal Logics ---
    const openDetailModal = (booking) => {
        editingBooking = booking;
        const detailModalTitle = document.getElementById('detail-modal-title');
        const normalActions = document.getElementById('normal-booking-actions');
        const unavailableActions = document.getElementById('unavailable-booking-actions');

        if (booking.status === 'unavailable') {
            detailModalTitle.textContent = '予約不可設定';
            if (normalActions) normalActions.style.display = 'none';
            if (unavailableActions) unavailableActions.style.display = 'block';
        } else {
            detailModalTitle.textContent = '予約詳細';
            document.getElementById('detail-customer-name').textContent = booking.customerName || 'N/A';
            const start = booking.startTime.toDate();
            const end = booking.endTime.toDate();
            document.getElementById('detail-datetime').textContent = 
                `${start.toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
            document.getElementById('detail-menus').textContent = booking.selectedMenus?.map(m => m.name).join(', ') || 'N/A';
            if (normalActions) normalActions.style.display = 'grid';
            if (unavailableActions) unavailableActions.style.display = 'none';
            document.getElementById('detail-pos-link').href = `./pos.html?bookingId=${booking.id}`;
            document.getElementById('detail-customer-link').href = `./customers.html?customerId=${booking.customerId}`;
        }
        openModal(detailModal);
    };

    const openActionModal = (time) => {
        document.getElementById('timeslot-action-title').textContent = `${selectedDate.toLocaleDateString('ja-JP')} ${time}`;
        document.getElementById('action-add-booking').onclick = () => {
            closeModal(actionModal);
            openEditModal(time);
        };
        document.getElementById('action-set-unavailable').onclick = async () => {
            const [startH, startM] = time.split(':').map(Number);
            const startTime = new Date(selectedDate);
            startTime.setHours(startH, startM, 0, 0);
            const endTime = new Date(startTime.getTime() + 30 * 60000); // 30分後

            const data = {
                startTime: Timestamp.fromDate(startTime),
                endTime: Timestamp.fromDate(endTime),
                status: 'unavailable',
                customerName: '',
                customerId: '',
                selectedMenus: []
            };
            await addDoc(collection(db, "reservations"), data);
            closeModal(actionModal);
            renderCalendar();
        };
        openModal(actionModal);
    };

    const openEditModal = (timeOrBooking) => {
        bookingForm.reset();
        deleteBtn.style.display = 'none';
        menuCheckboxList.querySelectorAll('input').forEach(cb => cb.checked = false);

        if (typeof timeOrBooking === 'string') {
            editingBooking = null;
            editModalTitle.textContent = '新規予約追加';
            startTimeSelect.value = timeOrBooking;
            endTimeSelect.value = timeOrBooking;
        } else {
            editingBooking = timeOrBooking;
            editModalTitle.textContent = '予約編集';
            customerSelect.value = editingBooking.customerId;
            if(editingBooking.selectedMenus) {
                editingBooking.selectedMenus.forEach(menu => {
                    const checkbox = menuCheckboxList.querySelector(`input[value="${menu.id}"]`);
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

    // --- Data Handling ---
    const saveBooking = async (e) => {
        e.preventDefault();
        const customerId = customerSelect.value;
        const selectedCustomer = customers.find(c => c.id === customerId);
        
        const selectedMenuIds = Array.from(menuCheckboxList.querySelectorAll('input:checked')).map(cb => cb.value);
        const allMenus = menuCategories.flatMap(cat => cat.menus);
        const selectedMenus = selectedMenuIds.map(id => {
            const menu = allMenus.find(m => m.id === id);
            return { id: menu.id, name: menu.name, price: menu.price, duration: menu.duration };
        });

        if (!customerId || selectedMenus.length === 0) {
            alert('顧客とメニューを1つ以上選択してください。');
            return;
        }

        const [startH, startM] = startTimeSelect.value.split(':').map(Number);
        const startTime = new Date(selectedDate);
        startTime.setHours(startH, startM, 0, 0);

        const [endH, endM] = endTimeSelect.value.split(':').map(Number);
        const endTime = new Date(selectedDate);
        endTime.setHours(endH, endM, 0, 0);
        
        const data = {
            customerId: customerId,
            customerName: selectedCustomer ? selectedCustomer.name : '不明',
            selectedMenus: selectedMenus,
            startTime: Timestamp.fromDate(startTime),
            endTime: Timestamp.fromDate(endTime),
            status: 'confirmed'
        };
        
        try {
            if (editingBooking) {
                await setDoc(doc(db, "reservations", editingBooking.id), data, { merge: true });
            } else {
                await addDoc(collection(db, "reservations"), data);
            }
            closeModal(editModal);
            renderCalendar();
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
                renderCalendar();
            } catch(error) {
                console.error("予約の削除に失敗:", error);
                alert("予約の削除に失敗しました。");
            }
        }
    };
    
    const listenToReservations = () => {
        if (unsubscribeReservations) unsubscribeReservations();
        const startOfDay = new Date(selectedDate); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDate); endOfDay.setHours(23, 59, 59, 999);
        const q = query(collection(db, "reservations"), 
            where("startTime", ">=", Timestamp.fromDate(startOfDay)),
            where("startTime", "<=", Timestamp.fromDate(endOfDay)),
            orderBy("startTime")
        );
        unsubscribeReservations = onSnapshot(q, (snapshot) => {
            const reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderTimeline(reservations);
        });
    };
    
    // --- Memo Handling ---
    const loadDailyMemo = async () => {
        const dateId = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
        const memoDocRef = doc(db, "daily_memos", dateId);
        try {
            const docSnap = await getDoc(memoDocRef);
            dailyMemoEl.value = docSnap.exists() ? docSnap.data().content : "";
        } catch (error) {
             console.error("メモの読み込みエラー:", error);
        }
    };

    let memoTimeout;
    dailyMemoEl.addEventListener('input', () => {
        clearTimeout(memoTimeout);
        memoTimeout = setTimeout(async () => {
            const dateId = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
            try {
                await setDoc(doc(db, "daily_memos", dateId), { content: dailyMemoEl.value });
            } catch (error) {
                console.error("メモの保存エラー:", error);
            }
        }, 1000);
    });

    // --- Initial Data Load ---
    const loadInitialData = async () => {
        const customersSnapshot = await getDocs(query(collection(db, 'users'), orderBy('kana')));
        customers = customersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data()}));
        customerSelect.innerHTML = '<option value="">顧客を選択</option>' + customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

        const categoriesSnapshot = await getDocs(query(collection(db, 'service_categories'), orderBy('order')));
        menuCheckboxList.innerHTML = '';
        for (const catDoc of categoriesSnapshot.docs) {
            const category = { id: catDoc.id, ...catDoc.data(), menus: [] };
            const menusSnapshot = await getDocs(query(collection(db, `service_categories/${catDoc.id}/menus`), orderBy('order')));
            const categoryDiv = document.createElement('div');
            categoryDiv.innerHTML = `<strong>${category.name}</strong>`;
            menusSnapshot.forEach(menuDoc => {
                const menu = { id: menuDoc.id, ...menuDoc.data() };
                category.menus.push(menu);
                const label = document.createElement('label');
                label.className = 'checkbox-label';
                label.innerHTML = `<input type="checkbox" value="${menu.id}"> ${menu.name}`;
                categoryDiv.appendChild(label);
            });
            menuCategories.push(category);
            menuCheckboxList.appendChild(categoryDiv);
        }
        
        startTimeSelect.innerHTML = ''; endTimeSelect.innerHTML = '';
        for (let h = 10; h < 21; h++) {
            for (let m = 0; m < 60; m += 30) {
                if (h === 20 && m > 0) continue;
                const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                startTimeSelect.add(new Option(time, time));
                endTimeSelect.add(new Option(time, time));
            }
        }
        
        timelineHoursEl.innerHTML = '';
        for (let h = 10; h <= 20; h++) {
            timelineHoursEl.innerHTML += `<span>${h}:00</span>`;
        }
    };
    
    // --- Event Listeners Setup ---
    prevMonthBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
    nextMonthBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });
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
            const modal = e.target.closest('.modal');
            if (modal) {
                closeModal(modal);
            }
        });
    });

    timelineSlotsEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('timeline-slots')) {
            const rect = e.target.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const totalMinutes = y / 2;
            const hour = Math.floor(totalMinutes / 60) + 10;
            const minute = (totalMinutes % 60) < 30 ? 0 : 30;
            const time = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
            openActionModal(time);
        }
    });

    // --- Initial Execution ---
    await loadSalonSettings();
    await loadInitialData();
    await renderCalendar();
    listenToReservations();
    loadDailyMemo();
};

// ▼▼▼ 安定化のための修正 ▼▼▼
// ページのDOMがすべて読み込まれてから認証処理を開始する
runAdminPage(bookingMain);

