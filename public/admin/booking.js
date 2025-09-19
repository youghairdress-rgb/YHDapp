import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { 
    collection, getDocs, onSnapshot, addDoc, doc, setDoc, deleteDoc, 
    query, where, Timestamp, orderBy, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
    const timelineWrapper = document.querySelector('.timeline-wrapper');
    const consultationCard = document.getElementById('consultation-card');
    const consultationList = document.getElementById('consultation-list');

    // Modals
    const detailModal = document.getElementById('booking-detail-modal');
    const actionModal = document.getElementById('timeslot-action-modal');
    const editModal = document.getElementById('booking-edit-modal');
    
    // Edit Modal Form Fields
    const bookingForm = document.getElementById('booking-form');
    const editModalTitle = document.getElementById('edit-modal-title');
    const customerInput = document.getElementById('customer-input');
    const customerDatalist = document.getElementById('customer-datalist');
    const menuAccordionContainer = document.getElementById('menu-accordion-container');
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
            console.log("サロン設定が見つかりません。デフォルト値を使用します。");
            salonSettings = { startTime: '10:00', endTime: '20:00', holidays: [], specialHolidays: [] };
        }
    };

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
            } else {
                html += `<span class="booking-count" style="visibility: hidden;">0</span>`;
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
                const dateStr = e.currentTarget.dataset.date;
                selectedDate = new Date(dateStr + "T00:00:00");
                renderCalendar();
                listenToReservations();
                loadDailyMemo();
            });
            calendarGridEl.appendChild(dayCell);
        }
    };

    const renderTimeline = (reservations) => {
        timelineDateEl.textContent = `${selectedDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}`;
        
        const normalReservations = reservations.filter(r => !r.isConsultation && r.status !== 'unavailable');
        const unavailableSlots = reservations.filter(r => r.status === 'unavailable');
        const consultationRequests = reservations.filter(r => r.isConsultation);

        timelineSlotsEl.innerHTML = ''; 
        
        [...normalReservations, ...unavailableSlots].forEach(res => {
            if (!res.startTime || !res.endTime) return; 
            const start = res.startTime.toDate();
            const end = res.endTime.toDate();
            const startHour = parseInt(salonSettings.startTime.split(':')[0]);
            
            const startMinutes = start.getHours() * 60 + start.getMinutes();
            const endMinutes = end.getHours() * 60 + end.getMinutes();
            const duration = endMinutes - startMinutes;
            
            const top = (startMinutes - (startHour * 60)) * 2;
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

        if (consultationRequests.length > 0) {
            consultationList.innerHTML = '';
            consultationRequests.forEach(res => {
                const li = document.createElement('li');
                li.className = 'consultation-item';
                li.innerHTML = `<strong>${res.customerName}</strong><span>${res.userRequests || 'ご要望なし'}</span>`;
                li.addEventListener('click', () => openDetailModal(res));
                consultationList.appendChild(li);
            });
            consultationCard.style.display = 'block';
        } else {
            consultationCard.style.display = 'none';
        }
    };
    
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
        document.getElementById('timeslot-action-title').textContent = `${selectedDate.toLocaleDateString('ja-JP')} ${time}`;
        document.getElementById('action-add-booking').onclick = () => {
            closeModal(actionModal);
            openEditModal(time);
        };
        // ▼▼▼ `action-set-unavailable`のonclickを修正 ▼▼▼
        document.getElementById('action-set-unavailable').onclick = async () => {
            const [startH, startM] = time.split(':').map(Number);
            const startTime = new Date(selectedDate);
            startTime.setHours(startH, startM, 0, 0);
            const endTime = new Date(startTime.getTime() + 30 * 60000); 

            // Firestoreに保存するデータに必須フィールドを追加
            const data = {
                startTime: Timestamp.fromDate(startTime),
                endTime: Timestamp.fromDate(endTime),
                status: 'unavailable',
                customerName: '',
                customerId: null, // null許容
                selectedMenus: [],
                isConsultation: false
            };
            
            await addDoc(collection(db, "reservations"), data);
            closeModal(actionModal);
        };
        // ▲▲▲ 修正ここまで ▲▲▲
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
        const startTime = new Date(selectedDate);
        startTime.setHours(startH, startM, 0, 0);

        const [endH, endM] = endTimeSelect.value.split(':').map(Number);
        const endTime = new Date(selectedDate);
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
        
        const startHour = parseInt(salonSettings.startTime.split(':')[0]);
        const endHour = parseInt(salonSettings.endTime.split(':')[0]);
        const totalHours = endHour - startHour;

        startTimeSelect.innerHTML = ''; endTimeSelect.innerHTML = '';
        for (let h = startHour; h <= endHour; h++) {
            for (let m = 0; m < 60; m += 30) {
                if (h === endHour && m > 0) continue;
                const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                startTimeSelect.add(new Option(time, time));
                endTimeSelect.add(new Option(time, time));
            }
        }
        
        timelineHoursEl.innerHTML = '';
        timelineSlotsEl.innerHTML = ''; // クリア
        const timelineHeight = totalHours * 120 + 20;
        timelineWrapper.style.height = `${timelineHeight}px`;

        for (let h = startHour; h <= endHour; h++) {
            const top = (h - startHour) * 120;
            const hourLabel = document.createElement('div');
            hourLabel.className = 'timeline-hour-label';
            hourLabel.textContent = `${h}:00`;
            hourLabel.style.top = `${top}px`;
            timelineHoursEl.appendChild(hourLabel);

            const borderLine = document.createElement('div');
            borderLine.className = 'timeline-border';
            borderLine.style.top = `${top}px`;
            timelineSlotsEl.appendChild(borderLine);

            if (h < endHour) {
                const halfHourBorderLine = document.createElement('div');
                halfHourBorderLine.className = 'timeline-border-half';
                halfHourBorderLine.style.top = `${top + 60}px`;
                timelineSlotsEl.appendChild(halfHourBorderLine);
            }
        }
    };
    
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
            closeModal(e.target.closest('.modal'));
        });
    });

    timelineSlotsEl.addEventListener('click', (e) => {
        if (!e.target.classList.contains('timeline-slots')) return;
        
        const startHour = parseInt(salonSettings.startTime.split(':')[0]);
        const rect = e.target.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const totalMinutes = y / 2 + (startHour * 60);
        const hour = Math.floor(totalMinutes / 60);
        const minute = (totalMinutes % 60) < 30 ? 0 : 30;
        const time = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
        openActionModal(time);
    });

    await loadSalonSettings();
    await loadInitialData();
    await renderCalendar();
    listenToReservations();
    loadDailyMemo();
};

runAdminPage(bookingMain);
