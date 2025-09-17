import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { collection, getDocs, onSnapshot, addDoc, doc, setDoc, deleteDoc, query, where, Timestamp, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const bookingMain = async (auth, user) => {
    // DOM Elements
    const calendarMonthEl = document.getElementById('calendar-month');
    const calendarGridEl = document.getElementById('calendar-grid');
    const prevMonthBtn = document.getElementById('prev-month');
    const nextMonthBtn = document.getElementById('next-month');
    const timelineDateEl = document.getElementById('timeline-date');
    const timelineSlotsEl = document.getElementById('timeline-slots');

    // Modal Elements
    const bookingModal = document.getElementById('booking-modal');
    const bookingForm = document.getElementById('booking-form');
    const closeModalBtn = document.getElementById('close-modal');
    const modalTitle = document.getElementById('modal-title');
    const customerSelect = document.getElementById('customer-id');
    const menuSelect = document.getElementById('menu-id');
    const startTimeSelect = document.getElementById('start-time');
    const endTimeSelect = document.getElementById('end-time');
    const deleteBtn = document.getElementById('delete-booking-btn');
    
    // State
    let currentDate = new Date();
    let selectedDate = new Date();
    let editingBookingId = null;
    let customers = [];
    let menus = [];
    let unsubscribeReservations = null; 

    const renderCalendar = () => {
        currentDate.setDate(1);
        const month = currentDate.getMonth();
        const year = currentDate.getFullYear();
        calendarMonthEl.textContent = `${year}年 ${month + 1}月`;
        
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        const startDay = firstDayOfMonth.getDay();
        
        calendarGridEl.innerHTML = '';
        
        for (let i = 0; i < startDay; i++) {
            calendarGridEl.innerHTML += '<div></div>';
        }
        
        for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
            const dayCell = document.createElement('div');
            dayCell.textContent = i;
            const date = new Date(year, month, i);
            dayCell.dataset.date = date.toISOString().split('T')[0];
            
            const today = new Date();
            today.setHours(0,0,0,0);
            const cellDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

            if (cellDate.getTime() === today.getTime()) {
                dayCell.classList.add('today');
            }
            if (cellDate.getTime() === new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()).getTime()) {
                dayCell.classList.add('selected');
            }
            
            dayCell.addEventListener('click', (e) => {
                const newSelectedDate = new Date(e.target.dataset.date);
                // JST timezone fix
                selectedDate = new Date(newSelectedDate.getTime() + newSelectedDate.getTimezoneOffset() * 60000);
                renderCalendar();
                listenToReservations();
            });
            calendarGridEl.appendChild(dayCell);
        }
    };

    const listenToReservations = () => {
        if (unsubscribeReservations) {
            unsubscribeReservations();
        }

        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        const q = query(collection(db, "reservations"), 
            where("startTime", ">=", Timestamp.fromDate(startOfDay)),
            where("startTime", "<=", Timestamp.fromDate(endOfDay)),
            orderBy("startTime")
        );

        unsubscribeReservations = onSnapshot(q, (snapshot) => {
            const reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderTimeline(reservations);
        }, (error) => {
            console.error("予約の監視に失敗:", error);
        });
    };

    const renderTimeline = (reservations) => {
        timelineDateEl.textContent = `${selectedDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}`;
        timelineSlotsEl.innerHTML = '';
        
        for (let h = 10; h < 20; h++) {
            for (let m = 0; m < 60; m+=30) {
                 const timeSlot = document.createElement('div');
                 timeSlot.className = 'time-slot';
                 const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                 timeSlot.innerHTML = `<span class="time-label">${time}</span>`;
                 timeSlot.dataset.time = time;
                 timeSlot.addEventListener('click', () => openBookingModal(time));
                 timelineSlotsEl.appendChild(timeSlot);
            }
        }

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

            const customer = customers.find(c => c.id === res.customerId);
            const menuNames = res.selectedMenus && Array.isArray(res.selectedMenus) 
                ? res.selectedMenus.map(m => m.name).join(', ') 
                : 'メニュー情報なし';
            
            resElement.innerHTML = `
                <strong>${res.customerName || (customer ? customer.name : '不明な顧客')}</strong>
                <small>${menuNames}</small>
            `;
            resElement.addEventListener('click', (e) => {
                e.stopPropagation(); 
                openBookingModal(null, res)
            });
            timelineSlotsEl.appendChild(resElement);
        });
    };
    
    const openBookingModal = (time, booking = null) => {
        bookingForm.reset();
        deleteBtn.style.display = 'none';
        if (booking) {
            editingBookingId = booking.id;
            modalTitle.textContent = '予約編集';
            customerSelect.value = booking.customerId;
            if (booking.selectedMenus && booking.selectedMenus.length > 0) {
                 menuSelect.value = booking.selectedMenus[0].id; 
            }
            const start = booking.startTime.toDate();
            const end = booking.endTime.toDate();
            startTimeSelect.value = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
            endTimeSelect.value = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
            deleteBtn.style.display = 'inline-block';
        } else {
            editingBookingId = null;
            modalTitle.textContent = '新規予約追加';
            startTimeSelect.value = time;
            const [h, m] = time.split(':').map(Number);
            const endDate = new Date();
            endDate.setHours(h, m + 30);
            endTimeSelect.value = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        }
        bookingModal.style.display = 'flex';
    };

    const saveBooking = async (e) => {
        e.preventDefault();
        const customerId = customerSelect.value;
        const selectedCustomer = customers.find(c => c.id === customerId);
        const selectedMenuInfo = menus.find(m => m.id === menuSelect.value);

        if (!customerId || !selectedMenuInfo) {
            alert('顧客とメニューを選択してください。');
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
            selectedMenus: [selectedMenuInfo],
            startTime: Timestamp.fromDate(startTime),
            endTime: Timestamp.fromDate(endTime),
        };
        
        try {
            if (editingBookingId) {
                await setDoc(doc(db, "reservations", editingBookingId), data, { merge: true });
            } else {
                await addDoc(collection(db, "reservations"), data);
            }
            bookingModal.style.display = 'none';
        } catch(error) {
            console.error("予約の保存に失敗:", error);
            alert("予約の保存に失敗しました。");
        }
    };

    const deleteBooking = async () => {
        if (editingBookingId && confirm('この予約を削除しますか？')) {
            try {
                await deleteDoc(doc(db, "reservations", editingBookingId));
                bookingModal.style.display = 'none';
            } catch(error) {
                console.error("予約の削除に失敗:", error);
                alert("予約の削除に失敗しました。");
            }
        }
    };
    
    const loadInitialData = async () => {
        try {
            const customersSnapshot = await getDocs(query(collection(db, 'users'), orderBy('kana')));
            customers = customersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data()}));
            customerSelect.innerHTML = '<option value="">顧客を選択</option>' + customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

            const categoriesSnapshot = await getDocs(query(collection(db, 'service_categories'), orderBy('order')));
            menus = [];
            for (const catDoc of categoriesSnapshot.docs) {
                const menusSnapshot = await getDocs(query(collection(db, `service_categories/${catDoc.id}/menus`), orderBy('order')));
                menusSnapshot.forEach(menuDoc => {
                    menus.push({ id: menuDoc.id, ...menuDoc.data()});
                });
            }
            menuSelect.innerHTML = '<option value="">メニューを選択</option>' + menus.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            
            startTimeSelect.innerHTML = '';
            endTimeSelect.innerHTML = '';
            for (let h = 10; h < 21; h++) {
                for (let m = 0; m < 60; m += 30) {
                    if (h === 20 && m > 0) continue;
                    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    startTimeSelect.add(new Option(time, time));
                    endTimeSelect.add(new Option(time, time));
                }
            }
        } catch (error) {
            console.error("初期データの読み込みに失敗:", error);
            alert("顧客・メニュー情報の読み込みに失敗しました。");
        }
    };

    // Event Listeners
    prevMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });
    nextMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });
    closeModalBtn.addEventListener('click', () => bookingModal.style.display = 'none');
    bookingForm.addEventListener('submit', saveBooking);
    deleteBtn.addEventListener('click', deleteBooking);
    
    // Initial calls
    await loadInitialData();
    renderCalendar();
    listenToReservations();
};

runAdminPage(bookingMain);

