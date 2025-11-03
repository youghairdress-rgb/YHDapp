import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

    // --- Initial calls ---
    await loadSettings();
};

runAdminPage(settingsMain);
