import { db, initializeLiffAndAuth } from './admin/firebase-init.js';
import { collection, getDocs, doc, getDoc, addDoc, query, orderBy, where, Timestamp, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- DOM Helper Functions ---
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

// --- Main Application Logic ---
const main = async () => {
    try {
        showLoading("LIFFを初期化中...");
        // 共通認証関数を呼び出す
        const { user, profile } = await initializeLiffAndAuth("2008029428-GNNaR1Nm");

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
            // customerNameは初期化せず、フォームから取得
            userRequests: '',
            profile: profile, // 予約データに含めるためプロフィール情報を保持
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
            stepContents.forEach((el, i) => el.style.display = (i + 1 === step) ? 'block' : 'none');
            window.scrollTo(0, 0);
            updateNavigation();
        };

        const updateNavigation = () => {
            const summaryFooter = document.querySelector('.summary-footer');
            const summaryContent = document.getElementById('footer-summary-content');
            
            if (state.currentStep === 1) {
                summaryFooter.style.display = 'flex';
                backBtn.style.display = 'none';
                nextBtn.style.display = 'block';
                nextBtn.textContent = '日時選択へ';
                nextBtn.disabled = state.selectedMenuIds.length === 0;
                summaryContent.style.display = 'block';
                updateFooterSummary();
            } else if (state.currentStep === 2) {
                summaryFooter.style.display = 'flex';
                backBtn.style.display = 'block';
                nextBtn.style.display = 'block';
                nextBtn.textContent = '予約確認へ';
                nextBtn.disabled = !state.selectedDateTime;
                summaryContent.style.display = 'none';
            } else if (state.currentStep === 3) {
                summaryFooter.style.display = 'flex';
                backBtn.style.display = 'block';
                nextBtn.style.display = 'block';
                nextBtn.textContent = '予約を確定する';
                nextBtn.disabled = customerNameInput.value.trim() === '';
                summaryContent.style.display = 'none';
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
            const hasPrefix = selectedMenus.some(menu => menu.pricePrefix);
            
            totalDurationEl.textContent = totalDuration;
            totalPriceEl.textContent = `${totalPrice.toLocaleString()}${hasPrefix ? '～' : ''}`;
        };

        const renderMenus = () => {
            const container = document.getElementById('menu-categories-container');
            container.innerHTML = '';
            menuCategories.forEach(category => {
                const accordion = document.createElement('div');
                accordion.className = 'category-accordion';
                const header = document.createElement('div');
                header.className = 'category-header';
                header.innerHTML = `<span>${category.name}</span><span class="accordion-icon">▼</span>`;
                const itemsContainer = document.createElement('div');
                itemsContainer.className = 'menu-items';
                
                header.addEventListener('click', () => {
                    const isOpen = itemsContainer.style.maxHeight;
                    // Close all other accordions
                    document.querySelectorAll('.menu-items').forEach(el => {
                        if (el !== itemsContainer) {
                           el.style.maxHeight = null;
                           el.previousElementSibling.querySelector('.accordion-icon').classList.remove('open');
                        }
                    });
                     // Toggle current accordion
                    if (isOpen) {
                        itemsContainer.style.maxHeight = null;
                        header.querySelector('.accordion-icon').classList.remove('open');
                    } else {
                        itemsContainer.style.maxHeight = `${itemsContainer.scrollHeight}px`;
                        header.querySelector('.accordion-icon').classList.add('open');
                    }
                });
                
                category.menus.forEach(menu => {
                    const item = document.createElement('div');
                    item.className = 'menu-item';
                    item.dataset.menuId = menu.id;
                    const isSelected = state.selectedMenuIds.includes(menu.id);
                    if (isSelected) item.classList.add('selected');
                    const priceString = `¥${menu.price.toLocaleString()}${menu.pricePrefix ? '～' : ''}`;

                    item.innerHTML = `
                        <div>
                            <p><strong>${menu.name}</strong></p>
                            <p><small>${menu.duration}分 / ${priceString}</small></p>
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
                showContent();
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

            const todayDate = new Date();
            todayDate.setHours(0, 0, 0, 0);
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
                const isToday = currentDate.getTime() === todayDate.getTime();
                headerHtml += `<th class="${isToday ? 'today' : ''}">${currentDate.getDate()}<br>(${weekDays[currentDate.getDay()]})</th>`;
                
                const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
                const isSelected = state.selectedDateTime && state.selectedDateTime.time === '相談' && state.selectedDateTime.date === dateStr;
                footerHtml += `<td class="consult-cell"><button class="consult-button ${isSelected ? 'selected' : ''}" data-date="${dateStr}">時間相談</button></td>`;
            }
            timetableHeader.innerHTML = `<tr>${headerHtml}</tr>`;
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
            
            const handleSlotSelection = (dateStr, timeStr) => {
                state.selectedDateTime = { date: dateStr, time: timeStr };
                updateTimetableUI(reservations);
                updateNavigation();
            };

            timetableBody.querySelectorAll('.slot-button:not([disabled])').forEach(button => {
                button.addEventListener('click', (e) => {
                    const [dateStr, timeStr] = e.target.dataset.slotId.split('T');
                    handleSlotSelection(dateStr, timeStr);
                });
            });
            
            timetableFooter.querySelectorAll('.consult-button').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dateStr = e.target.dataset.date;
                    handleSlotSelection(dateStr, "相談");
                    alert('ご要望欄にご希望の時間帯をご記入ください。後ほど担当者よりご連絡いたします。');
                });
            });
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
            const selectedMenusData = state.selectedMenuIds.map(id => allMenus.find(m => m.id === id)).filter(Boolean);
            const totalDuration = selectedMenusData.reduce((sum, menu) => sum + menu.duration, 0);
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

                // ★★★ 修正点: 重複チェックのロジックを厳密化 ★★★
                const isOverlapping = reservations.some(res => 
                    (slotStart < res.end && slotEnd > res.start)
                );
                
                const now = new Date();
                const deadlineMinutes = salonSettings.bookingDeadline || 30;
                const deadline = new Date(now.getTime() + deadlineMinutes * 60000);

                if (!isOverlapping && slotStart > deadline) {
                    slots.push(slotStart.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }));
                }
                
                currentTime.setMinutes(currentTime.getMinutes() + 30);
            }
            return slots;
        };

        const renderConfirmation = () => {
            const selectedMenusData = state.selectedMenuIds.map(id => allMenus.find(m => m.id === id)).filter(Boolean);
            const totalDuration = selectedMenusData.reduce((sum, menu) => sum + menu.duration, 0);
            const totalPrice = selectedMenusData.reduce((sum, menu) => sum + menu.price, 0);
            const hasPrefix = selectedMenusData.some(menu => menu.pricePrefix);
            
            const dateParts = state.selectedDateTime.date.split('-').map(Number);
            const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
            const dateStr = dateObj.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
            
            document.getElementById('confirm-datetime').textContent = `${dateStr} ${state.selectedDateTime.time}`;
            document.getElementById('confirm-duration').textContent = `${totalDuration}分`;
            document.getElementById('confirm-price').textContent = `¥${totalPrice.toLocaleString()}${hasPrefix ? '～' : ''}`;
            
            const menuList = document.getElementById('confirm-menu-list');
            menuList.innerHTML = selectedMenusData.map(m => {
                const priceString = `¥${m.price.toLocaleString()}${m.pricePrefix ? '～' : ''}`;
                return `<li>${m.name} (${priceString})</li>`;
            }).join('');
            
            const requestsWrapper = document.getElementById('confirm-requests-wrapper');
            const requestsP = document.getElementById('confirm-requests');
            if (state.userRequests) {
                requestsP.textContent = state.userRequests;
                requestsWrapper.style.display = 'block';
            } else {
                requestsWrapper.style.display = 'none';
            }
            
            // お名前欄を空にする
            customerNameInput.value = '';
            customerNameInput.placeholder = '例：山田花子';

            updateNavigation();
        };

        const submitBooking = async () => {
            nextBtn.disabled = true;
            nextBtn.textContent = '処理中...';
            showLoading("予約を処理中...");

            try {
                const selectedMenusData = state.selectedMenuIds.map(id => allMenus.find(m => m.id === id)).filter(Boolean);
                const totalDuration = selectedMenusData.reduce((sum, menu) => sum + menu.duration, 0);
                const isConsultation = state.selectedDateTime.time === '相談';
                let startTime, endTime;
                
                const dateParts = state.selectedDateTime.date.split('-').map(Number);

                if (isConsultation) {
                    startTime = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 0, 0, 0); // 相談の場合は0時で登録
                    endTime = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 0, 0, 0);
                } else {
                    const [startH, startM] = state.selectedDateTime.time.split(':').map(Number);
                    startTime = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], startH, startM);
                    endTime = new Date(startTime.getTime() + totalDuration * 60000);
                }
                
                const bookingData = {
                    customerId: state.profile.userId,
                    customerName: customerNameInput.value.trim(),
                    lineDisplayName: state.profile.displayName,
                    selectedMenus: selectedMenusData.map(m => ({ id: m.id, name: m.name, price: m.price, duration: m.duration, pricePrefix: m.pricePrefix || false })),
                    startTime: Timestamp.fromDate(startTime),
                    endTime: Timestamp.fromDate(endTime),
                    userRequests: state.userRequests,
                    isConsultation: isConsultation,
                    status: 'confirmed', 
                    createdAt: serverTimestamp(),
                };

                await addDoc(collection(db, "reservations"), bookingData);
                
                navigateToStep(4);

            } catch (error) {
                showError(`予約に失敗しました: ${error.message}`);
                navigateToStep(3); // 確認画面に戻す
            } finally {
                showContent();
                nextBtn.disabled = false;
                nextBtn.textContent = '予約を確定する';
            }
        };
        
        // --- Event Listeners ---
        nextBtn.addEventListener('click', handleNext);
        backBtn.addEventListener('click', handleBack);

        document.getElementById('prev-week-btn').addEventListener('click', () => {
            state.weekOffset--;
            state.selectedDateTime = null;
            updateNavigation();
            renderTimetable();
        });
        document.getElementById('next-week-btn').addEventListener('click', () => {
            state.weekOffset++;
            state.selectedDateTime = null;
            updateNavigation();
            renderTimetable();
        });
        
        customerNameInput.addEventListener('input', updateNavigation);
        
        // --- Initialization ---
        renderMenus();
        updateNavigation();
        navigateToStep(1); // 初期表示はステップ1
        showContent();

    } catch (error) {
        showError(error.message);
    }
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

// --- Application Execution ---
document.addEventListener('DOMContentLoaded', main);
