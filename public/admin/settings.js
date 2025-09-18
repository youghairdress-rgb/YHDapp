import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const settingsMain = async (auth, user) => {
    // DOM Elements
    const startTimeSelect = document.getElementById('start-time');
    const endTimeSelect = document.getElementById('end-time');
    const holidayCheckboxes = document.querySelectorAll('input[name="holiday"]');
    const specialHolidayInput = document.getElementById('special-holiday');
    const addSpecialHolidayBtn = document.getElementById('add-special-holiday');
    const specialHolidaysList = document.getElementById('special-holidays-list');
    const bookingDeadlineInput = document.getElementById('booking-deadline');
    const form = document.getElementById('settings-form');

    // State
    let specialHolidays = [];

    const generateTimeOptions = () => {
        for (let h = 10; h <= 20; h++) {
            for (let m = 0; m < 60; m += 30) {
                if (h === 20 && m > 0) continue;
                const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                const optionStart = new Option(time, time);
                const optionEnd = new Option(time, time);
                startTimeSelect.add(optionStart);
                endTimeSelect.add(optionEnd);
            }
        }
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
                startTimeSelect.value = settings.startTime || "10:00";
                endTimeSelect.value = settings.endTime || "20:00";
                
                holidayCheckboxes.forEach(cb => {
                    cb.checked = (settings.holidays || []).includes(parseInt(cb.value));
                });
                
                specialHolidays = settings.specialHolidays || [];
                renderSpecialHolidays();
                
                bookingDeadlineInput.value = settings.bookingDeadline || 30;
            } else {
                 console.log("設定ドキュメントが存在しません。デフォルト値を表示します。");
            }
        } catch (error) {
            console.error("設定の読み込みに失敗しました:", error);
            alert("設定の読み込みに失敗しました。");
        }
    };

    const saveSettings = async (e) => {
        e.preventDefault();
        
        const selectedHolidays = Array.from(holidayCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => parseInt(cb.value));
            
        const settingsData = {
            startTime: startTimeSelect.value,
            endTime: endTimeSelect.value,
            holidays: selectedHolidays,
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
    
    // Event Listeners
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

    // Initial calls
    generateTimeOptions();
    await loadSettings();
};

runAdminPage(settingsMain);

