import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { collection, onSnapshot, query, where, Timestamp, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const adminMain = async (auth, user) => {
    // DOM Elements
    const todayDateEl = document.getElementById('today-date');
    const timeLabelsContainer = document.querySelector('.time-labels');
    const timelineContainer = document.getElementById('today-schedule-timeline');
    const memoTextarea = document.getElementById('today-memo');
    const saveMemoBtn = document.getElementById('save-memo-btn');

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // --- 日付の表示 ---
    // 「本日の予約」というテキストを削除し、日付と曜日のみ表示
    todayDateEl.textContent = today.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short'
    });

    // --- タイムラインの時間ラベル生成 ---
    const renderTimelineHours = () => {
        timeLabelsContainer.innerHTML = '';
        for (let i = 10; i <= 20; i++) {
            const label = document.createElement('span');
            label.textContent = i;
            timeLabelsContainer.appendChild(label);
        }
    };

    // --- 予約データのリアルタイム監視と描画 ---
    const listenToBookings = () => {
        const startOfDay = new Date(today);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);

        const q = query(
            collection(db, "reservations"),
            where("startTime", ">=", Timestamp.fromDate(startOfDay)),
            where("startTime", "<=", Timestamp.fromDate(endOfDay))
        );

        onSnapshot(q, (snapshot) => {
            timelineContainer.innerHTML = ''; // Clear previous items
            snapshot.forEach(doc => {
                const booking = doc.data();
                const start = booking.startTime.toDate();
                const end = booking.endTime.toDate();

                // Calculate position and width
                const totalMinutes = (20 - 10) * 60; // 10:00 to 20:00
                const startMinutes = (start.getHours() * 60 + start.getMinutes()) - (10 * 60);
                const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);

                const left = (startMinutes / totalMinutes) * 100;
                const width = (durationMinutes / totalMinutes) * 100;

                if (left < 0 || width <= 0) return;

                const item = document.createElement('div');
                item.className = 'timeline-item';
                item.style.left = `${left}%`;
                item.style.width = `${width}%`;
                item.textContent = `${booking.customerName || '顧客'}様`;
                timelineContainer.appendChild(item);
            });
        }, (error) => {
            console.error("予約の読み込みエラー: ", error);
        });
    };

    // --- 連絡事項メモの読み込みと保存 ---
    const memoDocRef = doc(db, "daily_memos", todayStr);

    const loadMemo = async () => {
        try {
            const docSnap = await getDoc(memoDocRef);
            if (docSnap.exists()) {
                memoTextarea.value = docSnap.data().content || '';
            }
        } catch (error) {
            console.error("メモの読み込みエラー:", error);
        }
    };

    const saveMemo = async () => {
        try {
            await setDoc(memoDocRef, { content: memoTextarea.value });
            alert('メモを保存しました。');
        } catch (error) {
            console.error("メモの保存エラー:", error);
            alert('メモの保存に失敗しました。');
        }
    };

    // --- イベントリスナー ---
    saveMemoBtn.addEventListener('click', saveMemo);

    // --- 初期化処理 ---
    renderTimelineHours();
    listenToBookings();
    loadMemo();
};

runAdminPage(adminMain);
