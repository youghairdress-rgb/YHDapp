import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const settingsMain = async (auth, user) => {
    // DOM Elements
    const businessHoursContainer = document.getElementById('business-hours-container');
    const specialHolidayInput = document.getElementById('special-holiday');
    const addSpecialHolidayBtn = document.getElementById('add-special-holiday');
    const specialHolidaysList = document.getElementById('special-holidays-list');
    const bookingDeadlineInput = document.getElementById('booking-deadline');
    const form = document.getElementById('settings-form');

    // State
    let specialHolidays = [];
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

    // --- Functions ---

    // Generate time options for select elements
    const generateTimeOptions = () => {
        let options = '';
        for (let h = 8; h <= 22; h++) {
            for (let m = 0; m < 60; m += 30) {
                const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                options += `<option value="${time}">${time}</option>`;
            }
        }
        return options;
    };

    // Render the business hours settings for each day
    const renderBusinessHours = (settings = {}) => {
        businessHoursContainer.innerHTML = '';
        const timeOptions = generateTimeOptions();
        const businessHours = settings.businessHours || {};

        weekdays.forEach((day, index) => {
            const daySetting = businessHours[index] || { isOpen: true, start: '10:00', end: '20:00' };

            const row = document.createElement('div');
            row.className = 'day-setting-row';
            row.innerHTML = `
                <div class="day-label">${day}</div>
                <div class="holiday-toggle">
                    <input type="checkbox" id="holiday-${index}" class="holiday-checkbox" ${daySetting.isOpen ? '' : 'checked'}>
                    <label for="holiday-${index}">定休日</label>
                </div>
                <div class="time-range-selector">
                    <select id="start-time-${index}" class="input-field" ${!daySetting.isOpen ? 'disabled' : ''}>${timeOptions}</select>
                    <span>～</span>
                    <select id="end-time-${index}" class="input-field" ${!daySetting.isOpen ? 'disabled' : ''}>${timeOptions}</select>
                </div>
            `;

            businessHoursContainer.appendChild(row);

            // Set select values
            document.getElementById(`start-time-${index}`).value = daySetting.start;
            document.getElementById(`end-time-${index}`).value = daySetting.end;

            // Add event listener for holiday toggle
            const checkbox = row.querySelector(`#holiday-${index}`);
            const selects = row.querySelectorAll('select');
            checkbox.addEventListener('change', () => {
                selects.forEach(select => select.disabled = checkbox.checked);
            });
        });
    };

    const renderSpecialHolidays = () => {
        specialHolidaysList.innerHTML = '';
        specialHolidays.forEach((holiday, index) => {
            const li = document.createElement('li');
            li.textContent = holiday;
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '削除';
            deleteBtn.type = 'button';
            deleteBtn.classList.add('delete-btn-small');
            deleteBtn.addEventListener('click', () => {
                specialHolidays.splice(index, 1);
                renderSpecialHolidays();
            });
            li.appendChild(deleteBtn);
            specialHolidaysList.appendChild(li);
        });
    };

    const loadSettings = async () => {
        try {
            const docRef = doc(db, "settings", "salon");
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const settings = docSnap.data();
                renderBusinessHours(settings);
                specialHolidays = settings.specialHolidays || [];
                renderSpecialHolidays();
                bookingDeadlineInput.value = settings.bookingDeadline || 30;
            } else {
                console.log("設定ドキュメントが存在しません。デフォルト値を表示します。");
                renderBusinessHours(); // Render with default values
            }
        } catch (error) {
            console.error("設定の読み込みに失敗しました:", error);
            alert("設定の読み込みに失敗しました。");
        }
    };

    const saveSettings = async (e) => {
        e.preventDefault();

        const businessHours = {};
        weekdays.forEach((day, index) => {
            const isOpen = !document.getElementById(`holiday-${index}`).checked;
            const start = document.getElementById(`start-time-${index}`).value;
            const end = document.getElementById(`end-time-${index}`).value;
            businessHours[index] = { isOpen, start, end };
        });

        const settingsData = {
            businessHours: businessHours,
            specialHolidays: specialHolidays,
            bookingDeadline: parseInt(bookingDeadlineInput.value)
        };

        try {
            await setDoc(doc(db, "settings", "salon"), settingsData);
            alert("設定を保存しました。");
        } catch (error) {
            console.error("設定の保存に失敗しました:", error);
            alert("設定の保存に失敗しました。");
        }
    };

    // ▼▼▼ 追加: 顧客データ再集計機能 ▼▼▼
    const recalculateCustomerData = async () => {
        const statusEl = document.getElementById('recalc-status');
        const btn = document.getElementById('recalc-customer-data-btn');

        if (!confirm('全顧客の来店データ（最終来店日・来店回数）を再集計します。時間がかかる場合がありますがよろしいですか？')) {
            return;
        }

        try {
            btn.disabled = true;
            statusEl.textContent = 'データを読み込み中...';
            statusEl.style.color = 'var(--text-color)';

            // 全会計データを取得
            const salesSnapshot = await getDocs(collection(db, 'sales'));
            const sales = salesSnapshot.docs.map(doc => doc.data());

            // 顧客ごとに集計
            const customerStats = {};

            sales.forEach(sale => {
                if (!sale.customerId) return;

                if (!customerStats[sale.customerId]) {
                    customerStats[sale.customerId] = {
                        lastVisit: null,
                        visitDates: new Set()
                    };
                }

                // 基準日時の決定: reservationTime があれば優先、なければ createdAt
                // Firestore Timestamp から Date オブジェクトへ変換
                let visitDate = null;
                if (sale.reservationTime && typeof sale.reservationTime.toDate === 'function') {
                    visitDate = sale.reservationTime.toDate();
                } else if (sale.createdAt && typeof sale.createdAt.toDate === 'function') {
                    visitDate = sale.createdAt.toDate();
                }

                if (visitDate) {
                    // 最終来店日の更新
                    if (!customerStats[sale.customerId].lastVisit || visitDate > customerStats[sale.customerId].lastVisit) {
                        customerStats[sale.customerId].lastVisit = visitDate;
                    }

                    // 来店回数（日付ベース）のカウント用
                    // 同日複数回は1回とするため、"YYYY-MM-DD" 形式の文字列を Set に入れる
                    const dateStr = `${visitDate.getFullYear()}-${visitDate.getMonth() + 1}-${visitDate.getDate()}`;
                    customerStats[sale.customerId].visitDates.add(dateStr);
                }
            });

            statusEl.textContent = `集計完了。${Object.keys(customerStats).length}件の顧客データを更新中...`;

            // 顧客ドキュメントを更新
            let updatedCount = 0;
            const total = Object.keys(customerStats).length;

            for (const customerId of Object.keys(customerStats)) {
                const stats = customerStats[customerId];
                const updateData = {
                    visitCount: stats.visitDates.size,
                    lastVisit: Timestamp.fromDate(stats.lastVisit)
                };

                try {
                    await setDoc(doc(db, 'users', customerId), updateData, { merge: true });
                } catch (e) {
                    console.warn(`顧客データの更新に失敗 (ID: ${customerId}):`, e);
                    // エラーが出ても続行
                }
                updatedCount++;
                if (updatedCount % 10 === 0) {
                    statusEl.textContent = `更新中... (${updatedCount}/${total})`;
                }
            }

            statusEl.textContent = 'すべての処理が完了しました。';
            statusEl.style.color = 'var(--success-color, green)';
            alert('再集計が完了しました。');

        } catch (error) {
            console.error("再集計エラー:", error);
            statusEl.textContent = 'エラーが発生しました: ' + error.message;
            statusEl.style.color = 'var(--warning-color, red)';
            alert('処理中にエラーが発生しました。');
        } finally {
            btn.disabled = false;
        }
    };
    // ▲▲▲ 追加ここまで ▲▲▲

    // --- Event Listeners ---
    addSpecialHolidayBtn.addEventListener('click', () => {
        const holidayValue = specialHolidayInput.value;
        if (holidayValue && !specialHolidays.includes(holidayValue)) {
            specialHolidays.push(holidayValue);
            specialHolidays.sort();
            renderSpecialHolidays();
            specialHolidayInput.value = '';
        }
    });
    form.addEventListener('submit', saveSettings);
    // イベント追加
    document.getElementById('recalc-customer-data-btn').addEventListener('click', recalculateCustomerData);

    // --- Initial calls ---
    await loadSettings();
};

runAdminPage(settingsMain);
