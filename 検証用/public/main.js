import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, addDoc, query, orderBy, where, Timestamp, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Firebaseの初期化 ---
const firebaseConfig = {
    apiKey: "AIzaSyCjZcF8GFC4CJMYmpucjJ_yShsn74wDLVw",
    authDomain: "yhd-db.firebaseapp.com",
    projectId: "yhd-db",
    storageBucket: "yhd-db.firebasestorage.app",
    messagingSenderId: "940208179982",
    appId: "1:940208179982:web:92abb326fa1dc8ee0b655f",
    measurementId: "G-RSYFJW3TN6"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- DOM操作ヘルパー関数 ---
const loadingContainer = document.getElementById('loading-container');
const contentContainer = document.getElementById('content-container');
const loadingText = document.getElementById('loading-text');
const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');

const showLoading = (text) => {
    if(loadingText) loadingText.textContent = text;
    if(loadingContainer) loadingContainer.style.display = 'flex';
    if(contentContainer) contentContainer.style.display = 'none';
    if(errorContainer) errorContainer.style.display = 'none';
};
const showContent = () => {
    if(loadingContainer) loadingContainer.style.display = 'none';
    if(contentContainer) contentContainer.style.display = 'block';
};
const showError = (text) => {
    console.error("エラー:", text);
    if(errorMessage) errorMessage.textContent = text;
    if(loadingContainer) loadingContainer.style.display = 'none';
    if(errorContainer) errorContainer.style.display = 'block';
};

// --- メイン処理 ---
const main = async () => {
    showLoading("LIFFを初期化中...");
    await liff.init({ liffId: "2008029428-GNNaR1Nm" }); 
    
    if (!liff.isLoggedIn()) {
        liff.login();
        return;
    }
    
    const profile = await liff.getProfile();

    showLoading("店舗情報を読み込み中...");
    const salonSettings = await loadSalonSettings();
    if (!salonSettings || !salonSettings.businessHours) {
        throw new Error("サロン情報が設定されていません。管理者にご連絡ください。");
    }
    const menuCategories = await loadMenus();
    const allMenus = menuCategories.flatMap(cat => cat.menus);

    let state = {
        currentStep: 1,
        selectedMenuIds: [],
        weekOffset: 0,
        selectedDateTime: null,
        customerName: profile.displayName,
        userRequests: '',
    };
    
    let unsubscribeReservations = null;
    
    const stepIndicators = [document.getElementById('step-1-indicator'), document.getElementById('step-2-indicator'), document.getElementById('step-3-indicator')];
    const stepContents = [document.getElementById('step-1'), document.getElementById('step-2'), document.getElementById('step-3'), document.getElementById('step-4')];
    const nextBtn = document.getElementById('next-btn');
    const backBtn = document.getElementById('back-btn');
    const customerNameInput = document.getElementById('customer-name');
    const userRequestsTextarea = document.getElementById('user-requests');
    
    const navigateToStep = (step) => {
        if (step !== 2 && unsubscribeReservations) {
            unsubscribeReservations();
            unsubscribeReservations = null;
        }
        
        state.currentStep = step;
        stepIndicators.forEach((el, i) => el.classList.toggle('active', i + 1 === step));
        stepContents.forEach((el, i) => el.classList.toggle('active', i + 1 === step));
        window.scrollTo(0, 0);
        updateNavigation();
    };

    const updateNavigation = () => {
        const summaryFooter = document.querySelector('.summary-footer');
        const summaryP = summaryFooter.querySelector('p');
        
        if (state.currentStep === 1) {
            summaryFooter.style.display = 'flex';
            backBtn.style.display = 'none';
            nextBtn.style.display = 'block';
            nextBtn.textContent = '日時選択へ';
            nextBtn.disabled = state.selectedMenuIds.length === 0;
            if (!summaryP) {
                const p = document.createElement('p');
                p.innerHTML = `合計: <span id="total-duration-step1">0</span>分 / ¥<span id="total-price-step1">0</span>`;
                nextBtn.parentNode.insertBefore(p, nextBtn);
            }
            updateFooterSummary();
        } else if (state.currentStep === 2) {
            summaryFooter.style.display = 'flex';
            backBtn.style.display = 'block';
            nextBtn.style.display = 'block';
            nextBtn.textContent = '予約確認へ';
            nextBtn.disabled = !state.selectedDateTime;
            if (summaryP) summaryP.remove();
        } else if (state.currentStep === 3) {
            summaryFooter.style.display = 'flex';
            backBtn.style.display = 'block';
            nextBtn.style.display = 'block';
            nextBtn.textContent = '予約を確定する';
            nextBtn.disabled = customerNameInput.value.trim() === '';
            if (summaryP) summaryP.remove();
        } else if (state.currentStep === 4) {
            summaryFooter.style.display = 'none';
        }
    };
    
    const handleNext = () => {
        if (state.currentStep === 1) {
            navigateToStep(2);
            renderTimetable();
        } else if (state.currentStep === 2) {
            state.userRequests = userRequestsTextarea.value.trim();
            navigateToStep(3);
            renderConfirmation();
        } else if (state.currentStep === 3) {
            submitBooking();
        }
    };

    const handleBack = () => {
        if (state.currentStep > 1) {
            navigateToStep(state.currentStep - 1);
        }
    };

    const updateFooterSummary = () => {
        const totalDurationEl = document.getElementById('total-duration-step1');
        const totalPriceEl = document.getElementById('total-price-step1');
        if (!totalDurationEl || !totalPriceEl) return;
        const selectedMenus = state.selectedMenuIds.map(id => allMenus.find(m => m.id === id)).filter(Boolean);
        const totalDuration = selectedMenus.reduce((sum, menu) => sum + menu.duration, 0);
        const totalPrice = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
        totalDurationEl.textContent = totalDuration;
        totalPriceEl.textContent = totalPrice.toLocaleString();
    };

    const renderMenus = () => {
        const container = document.getElementById('menu-categories-container');
        container.innerHTML = '';
        menuCategories.forEach(category => {
            const accordion = document.createElement('div');
            accordion.className = 'category-accordion';
            const header = document.createElement('div');
            header.className = 'category-header';
            header.innerHTML = `<span>${category.name}</span><span>▼</span>`;
            const itemsContainer = document.createElement('div');
            itemsContainer.className = 'menu-items';
            
            header.addEventListener('click', () => {
                const isOpen = itemsContainer.style.maxHeight;
                document.querySelectorAll('.menu-items').forEach(el => el.style.maxHeight = null);
                if (!isOpen) {
                    itemsContainer.style.maxHeight = `${itemsContainer.scrollHeight}px`;
                }
            });
            
            category.menus.forEach(menu => {
                const item = document.createElement('div');
                item.className = 'menu-item';
                item.dataset.menuId = menu.id;
                const isSelected = state.selectedMenuIds.includes(menu.id);
                if (isSelected) item.classList.add('selected');

                item.innerHTML = `
                    <div>
                        <p><strong>${menu.name}</strong></p>
                        <p><small>${menu.duration}分 / ¥${menu.price.toLocaleString()}</small></p>
                        <p><small>${menu.description || ''}</small></p>
                    </div>
                    <div class="checkbox"></div>
                `;
                item.addEventListener('click', () => {
                    item.classList.toggle('selected');
                    const menuId = item.dataset.menuId;
                    if (state.selectedMenuIds.includes(menuId)) {
                        state.selectedMenuIds = state.selectedMenuIds.filter(id => id !== menuId);
                    } else {
                        state.selectedMenuIds.push(menuId);
                    }
                    updateFooterSummary();
                    updateNavigation();
                });
                itemsContainer.appendChild(item);
            });
            accordion.appendChild(header);
            accordion.appendChild(itemsContainer);
            container.appendChild(accordion);
        });
    };
    
    const renderTimetable = () => {
        showLoading("予約枠を検索中...");
    
        if (unsubscribeReservations) unsubscribeReservations();
    
        const viewStartDate = new Date();
        viewStartDate.setHours(0, 0, 0, 0);
        viewStartDate.setDate(viewStartDate.getDate() - viewStartDate.getDay() + state.weekOffset * 7);
    
        const viewEndDate = new Date(viewStartDate);
        viewEndDate.setDate(viewStartDate.getDate() + 7);
    
        const q = query(collection(db, "reservations"), 
            where("startTime", ">=", Timestamp.fromDate(viewStartDate)),
            where("startTime", "<", Timestamp.fromDate(viewEndDate))
        );
    
        unsubscribeReservations = onSnapshot(q, (snapshot) => {
            const reservations = snapshot.docs.map(doc => ({
                start: doc.data().startTime.toDate(),
                end: doc.data().endTime.toDate(),
            }));
            updateTimetableUI(reservations);
        }, (error) => {
            console.error("予約データのリアルタイム取得に失敗:", error);
            showError("予約枠の更新に失敗しました。");
        });
    };

    const updateTimetableUI = (reservations) => {
        const timetableHeader = document.getElementById('timetable-header');
        const timetableBody = document.getElementById('timetable-body');
        const timetableFooter = document.getElementById('timetable-footer');
        const calendarHeaderText = document.getElementById('calendar-header-text');

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
        
        const viewStartDate = new Date();
        viewStartDate.setHours(0, 0, 0, 0);
        viewStartDate.setDate(viewStartDate.getDate() - viewStartDate.getDay() + state.weekOffset * 7);

        const startDate = new Date(viewStartDate);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);
        calendarHeaderText.textContent = `${startDate.getMonth()+1}/${startDate.getDate()} - ${endDate.getMonth()+1}/${endDate.getDate()}`;
        
        let headerHtml = '<th></th>';
        let footerHtml = '<td></td>';
        const datesOfWeek = [];
        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + i);
            datesOfWeek.push(currentDate);
            const isToday = currentDate.getTime() === today.getTime();
            headerHtml += `<th class="${isToday ? 'today' : ''}">${currentDate.getDate()}<br>(${weekDays[currentDate.getDay()]})</th>`;
            
            const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
            const isSelected = state.selectedDateTime && state.selectedDateTime.time === '相談' && state.selectedDateTime.date === dateStr;
            footerHtml += `<td class="consult-cell"><button class="consult-button ${isSelected ? 'selected' : ''}" data-date="${dateStr}">相談</button></td>`;
        }
        timetableHeader.innerHTML = headerHtml;
        timetableFooter.innerHTML = `<tr>${footerHtml}</tr>`;
        
        const availableSlots = generateAllTimeSlotsForWeek(datesOfWeek, reservations);
        
        timetableBody.innerHTML = '';
        let minStart = 24 * 60;
        let maxEnd = 0;
        Object.values(salonSettings.businessHours).forEach(day => {
            if (day.isOpen) {
                const [startH, startM] = day.start.split(':').map(Number);
                const [endH, endM] = day.end.split(':').map(Number);
                minStart = Math.min(minStart, startH * 60 + startM);
                maxEnd = Math.max(maxEnd, endH * 60 + endM);
            }
        });

        const openH = Math.floor(minStart / 60);
        const openM = minStart % 60;
        const closeH = Math.floor(maxEnd / 60);
        const closeM = maxEnd % 60;

        let currentTime = new Date();
        currentTime.setHours(openH, openM, 0, 0);
        let loopEndTime = new Date();
        loopEndTime.setHours(closeH, closeM, 0, 0);

        while(currentTime < loopEndTime) {
            const timeStr = currentTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
            let rowHtml = `<td class="time-label-cell">${timeStr}</td>`;

            for(const date of datesOfWeek) {
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const slotId = `${dateStr}T${timeStr}`;
                const isAvailable = availableSlots[dateStr] && availableSlots[dateStr].includes(timeStr);
                const isSelected = state.selectedDateTime && state.selectedDateTime.date === dateStr && state.selectedDateTime.time === timeStr;
                
                rowHtml += `<td class="slot-cell">`;
                if(isAvailable) {
                    rowHtml += `<button class="slot-button ${isSelected ? 'selected' : ''}" data-slot-id="${slotId}">○</button>`;
                } else {
                    rowHtml += `<button class="slot-button" disabled>-</button>`;
                }
                rowHtml += `</td>`;
            }
            const tr = document.createElement('tr');
            tr.innerHTML = rowHtml;
            timetableBody.appendChild(tr);

            currentTime.setMinutes(currentTime.getMinutes() + 30);
        }
        
        timetableBody.querySelectorAll('.slot-button:not([disabled])').forEach(button => {
            button.addEventListener('click', (e) => {
                const [dateStr, timeStr] = e.target.dataset.slotId.split('T');
                state.selectedDateTime = { date: dateStr, time: timeStr };
                updateTimetableUI(reservations);
            });
        });
        
        timetableFooter.querySelectorAll('.consult-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const dateStr = e.target.dataset.date;
                state.selectedDateTime = { date: dateStr, time: "相談" };
                alert('ご要望にご希望時間を記入して下さい。後ほど担当者よりご連絡いたします。');
                updateTimetableUI(reservations);
            });
        });

        updateNavigation();
        showContent();
    };

    const generateAllTimeSlotsForWeek = (datesOfWeek, reservations) => {
        const weekSlots = {};
        datesOfWeek.forEach(date => {
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const today = new Date(); today.setHours(0,0,0,0);
            const isPast = date < today;
            
            const dayOfWeek = date.getDay();
            const daySetting = salonSettings.businessHours[dayOfWeek];
            const isHoliday = !daySetting.isOpen || (salonSettings.specialHolidays || []).includes(dateStr);

            if(isPast || isHoliday){
                weekSlots[dateStr] = [];
            } else {
                weekSlots[dateStr] = generateTimeSlots(date, reservations);
            }
        });
        return weekSlots;
    };

    const generateTimeSlots = (date, reservations) => {
        const selectedMenus = state.selectedMenuIds.map(id => allMenus.find(m => m.id === id)).filter(Boolean);
        const totalDuration = selectedMenus.reduce((sum, menu) => sum + menu.duration, 0);
        if (totalDuration === 0) return [];

        const slots = [];
        const dayOfWeek = date.getDay();
        const daySetting = salonSettings.businessHours[dayOfWeek];
        const [openH, openM] = daySetting.start.split(':').map(Number);
        const [closeH, closeM] = daySetting.end.split(':').map(Number);
        
        let currentTime = new Date(date);
        currentTime.setHours(openH, openM, 0, 0);
        
        let endTime = new Date(date);
        endTime.setHours(closeH, closeM, 0, 0);

        while(currentTime < endTime) {
            const slotStart = new Date(currentTime);
            const slotEnd = new Date(slotStart.getTime() + totalDuration * 60000);

            if (slotEnd > endTime) break;

            const isOverlapping = reservations.some(res => 
                (slotStart < res.end && slotEnd > res.start)
            );
            
            const now = new Date();
            const deadline = new Date(now.getTime() + (salonSettings.bookingDeadline || 30) * 60000);

            if (!isOverlapping && slotStart > deadline) {
                slots.push(slotStart.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }));
            }
            
            currentTime.setMinutes(currentTime.getMinutes() + 30);
        }
        return slots;
    };

    const renderConfirmation = () => {
        const selectedMenus = state.selectedMenuIds.map(id => allMenus.find(m => m.id === id)).filter(Boolean);
        const totalDuration = selectedMenus.reduce((sum, menu) => sum + menu.duration, 0);
        const totalPrice = selectedMenus.reduce((sum, menu) => sum + menu.price, 0);
        
        const dateParts = state.selectedDateTime.date.split('-').map(Number);
        const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
        const dateStr = dateObj.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
        
        document.getElementById('confirm-datetime').textContent = `${dateStr} ${state.selectedDateTime.time}`;
        document.getElementById('confirm-duration').textContent = totalDuration;
        document.getElementById('confirm-price').textContent = totalPrice.toLocaleString();
        const menuList = document.getElementById('confirm-menu-list');
        menuList.innerHTML = selectedMenus.map(m => `<li>${m.name} (¥${m.price.toLocaleString()})</li>`).join('');
        
        const requestsWrapper = document.getElementById('confirm-requests-wrapper');
        const requestsP = document.getElementById('confirm-requests');
        if (state.userRequests) {
            requestsP.textContent = state.userRequests;
            requestsWrapper.style.display = 'block';
        } else {
            requestsWrapper.style.display = 'none';
        }
        
        customerNameInput.value = '';
        customerNameInput.placeholder = '例：山田花子';
        updateNavigation();
    };

    const submitBooking = async () => {
        nextBtn.disabled = true;
        showLoading("予約を処理中...");

        try {
            const selectedMenus = state.selectedMenuIds.map(id => allMenus.find(m => m.id === id)).filter(Boolean);
            const totalDuration = selectedMenus.reduce((sum, menu) => sum + menu.duration, 0);
            const isConsultation = state.selectedDateTime.time === '相談';
            let startTime, endTime;
            
            const dateParts = state.selectedDateTime.date.split('-').map(Number);

            if (isConsultation) {
                startTime = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
                endTime = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
            } else {
                const [startH, startM] = state.selectedDateTime.time.split(':').map(Number);
                startTime = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], startH, startM);
                endTime = new Date(startTime.getTime() + totalDuration * 60000);
            }
            
            const bookingData = {
                customerId: profile.userId,
                customerName: customerNameInput.value.trim(),
                lineDisplayName: profile.displayName,
                selectedMenus: selectedMenus.map(m => ({ id: m.id, name: m.name, price: m.price, duration: m.duration })),
                startTime: Timestamp.fromDate(startTime),
                endTime: Timestamp.fromDate(endTime),
                userRequests: state.userRequests,
                isConsultation: isConsultation,
                status: 'confirmed', 
                createdAt: serverTimestamp(),
            };

            await addDoc(collection(db, "reservations"), bookingData);
            
            navigateToStep(4);
            showContent();

        } catch (error) {
            showError(`予約に失敗しました: ${error.message}`);
            navigateToStep(state.currentStep);
        }
    };
    
    // --- イベントリスナー ---
    nextBtn.addEventListener('click', handleNext);
    backBtn.addEventListener('click', handleBack);

    document.getElementById('prev-week-btn').addEventListener('click', () => {
        state.weekOffset--;
        state.selectedDateTime = null;
        renderTimetable();
    });
    document.getElementById('next-week-btn').addEventListener('click', () => {
        state.weekOffset++;
        state.selectedDateTime = null;
        renderTimetable();
    });
    
    customerNameInput.addEventListener('input', () => {
        updateNavigation();
    });
    
    // --- 初期化 ---
    renderMenus();
    updateFooterSummary();
    updateNavigation();
    showContent();
};

async function loadSalonSettings() {
    try {
        const docRef = doc(db, "settings", "salon");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            console.log("サロン設定ドキュメントが見つかりません。");
            return null;
        }
    } catch (error) {
        console.error("サロン設定の読み込みに失敗しました:", error);
        throw new Error("サロン設定の読み込みに失敗しました。");
    }
}

async function loadMenus() {
    try {
        const categories = [];
        const categoriesQuery = query(collection(db, 'service_categories'), orderBy('order'));
        const querySnapshot = await getDocs(categoriesQuery);
        
        for (const categoryDoc of querySnapshot.docs) {
            const category = { id: categoryDoc.id, ...categoryDoc.data(), menus: [] };
            const menusQuery = query(collection(db, `service_categories/${category.id}/menus`), orderBy('order'));
            const menusSnapshot = await getDocs(menusQuery);
            category.menus = menusSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            categories.push(category);
        }
        return categories;
    } catch (error) {
        console.error("メニューの読み込みに失敗しました:", error);
        throw new Error("メニューの読み込みに失敗しました。");
    }
}

// --- アプリケーション実行 ---
document.addEventListener('DOMContentLoaded', () => {
    main().catch(error => { showError(error.message); });
});

