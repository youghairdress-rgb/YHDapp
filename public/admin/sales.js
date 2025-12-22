import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import {
    collection, getDocs, doc, getDoc, setDoc, deleteDoc,
    query, where, Timestamp, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const salesMain = async (auth, user) => {
    // --- State ---
    let editingSaleId = null;

    // --- DOM Elements ---
    const monthlyGoalInput = document.getElementById('monthly-goal');
    const setGoalBtn = document.getElementById('set-goal-btn');
    const goalProgressText = document.getElementById('goal-progress-text');
    const goalProgressBar = document.getElementById('goal-progress-bar');

    // History elements
    const historyDatePicker = document.getElementById('history-date-picker');
    const salesHistoryTableBody = document.querySelector('#sales-history-table tbody');
    // ▼▼▼ 合計表示用DOM (新規追加) ▼▼▼
    const historyDailyTotalEl = document.getElementById('history-daily-total');
    // ▲▲▲ 新規追加ここまで ▲▲▲

    // Chart instances
    let monthlySalesChart = null;

    // --- Functions ---
    const loadSalesData = async () => {
        try {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();

            const goalDocRef = doc(db, 'sales_goals', `${year}-${String(month + 1).padStart(2, '0')}`);
            const goalDoc = await getDoc(goalDocRef);
            const monthlyGoal = goalDoc.exists() ? goalDoc.data().goal : 0;
            if (monthlyGoalInput) monthlyGoalInput.value = monthlyGoal;

            const startOfMonth = new Date(year, month, 1);
            const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);

            // ▼▼▼ 修正: 月間売上集計は `reservationTime` (予約日) 基準に変更 ▼▼▼
            const salesQuery = query(collection(db, 'sales'),
                where('reservationTime', '>=', Timestamp.fromDate(startOfMonth)),
                where('reservationTime', '<=', Timestamp.fromDate(endOfMonth))
            );
            // ▲▲▲ 修正ここまで ▲▲▲

            const salesSnapshot = await getDocs(salesQuery);
            const sales = salesSnapshot.docs.map(doc => doc.data());

            updateMonthlyGoalProgress(sales, monthlyGoal);

            const monthlySalesData = await getMonthlySalesForLastSixMonths();
            renderMonthlySalesChart(monthlySalesData); // この中でテーブルも描画
        } catch (error) {
            console.error("売上データの読み込みに失敗:", error);
            alert("売上データの読み込みに失敗しました。");
        }
    };

    const setMonthlyGoal = async () => {
        const goal = parseInt(monthlyGoalInput.value);
        if (isNaN(goal) || goal < 0) {
            alert('有効な数値を入力してください。');
            return;
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const goalDocRef = doc(db, 'sales_goals', `${year}-${String(month + 1).padStart(2, '0')}`);

        try {
            await setDoc(goalDocRef, { goal: goal });
            alert('月間目標を設定しました。');
            await loadSalesData();
        } catch (error) {
            console.error("目標設定に失敗:", error);
            alert('目標設定に失敗しました。');
        }
    };

    const updateMonthlyGoalProgress = (sales, goal) => {
        const currentSales = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
        const percentage = goal > 0 ? Math.min(Math.round((currentSales / goal) * 100), 100) : 0;

        goalProgressText.textContent = `${percentage}% 達成 (¥${currentSales.toLocaleString()} / ¥${goal.toLocaleString()})`;
        goalProgressBar.style.width = `${percentage}%`;

        // ▼▼▼ 追加: 半月ごとの集計 ▼▼▼
        let firstHalfTotal = 0;
        let secondHalfTotal = 0;

        sales.forEach(sale => {
            if (!sale.reservationTime) return;
            const date = sale.reservationTime.toDate().getDate();
            const amount = sale.total || 0;

            if (date <= 15) {
                firstHalfTotal += amount;
            } else {
                secondHalfTotal += amount;
            }
        });

        const firstHalfEl = document.getElementById('first-half-stats');
        const secondHalfEl = document.getElementById('second-half-stats');
        if (firstHalfEl) firstHalfEl.textContent = `1日〜15日: ¥${firstHalfTotal.toLocaleString()}`;
        if (secondHalfEl) secondHalfEl.textContent = `16日〜末日: ¥${secondHalfTotal.toLocaleString()}`;
        // ▲▲▲ 追加ここまで ▲▲▲
    };

    const getMonthlySalesForLastSixMonths = async () => {
        const salesByMonth = {};
        const monthLabels = [];
        const now = new Date();

        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const year = d.getFullYear();
            const month = d.getMonth();
            const label = `${year}/${String(month + 1).padStart(2, '0')}`;
            monthLabels.push(label);
            salesByMonth[label] = { total: 0, count: 0, average: 0 }; // averageを追加

            const start = new Date(year, month, 1);
            const end = new Date(year, month + 1, 0, 23, 59, 59);

            // ▼▼▼ 修正: 月次集計も `reservationTime` (予約日) 基準に変更 ▼▼▼
            const q = query(collection(db, 'sales'),
                where('reservationTime', '>=', Timestamp.fromDate(start)),
                where('reservationTime', '<=', Timestamp.fromDate(end))
            );
            // ▲▲▲ 修正ここまで ▲▲▲

            const snapshot = await getDocs(q);
            snapshot.forEach(doc => {
                const sale = doc.data();
                salesByMonth[label].total += sale.total || 0;
                salesByMonth[label].count += 1;
            });

            if (salesByMonth[label].count > 0) {
                salesByMonth[label].average = Math.round(salesByMonth[label].total / salesByMonth[label].count);
            }
        }
        return { salesByMonth, monthLabels };
    };

    const renderMonthlySalesChart = ({ salesByMonth, monthLabels }) => {
        const ctx = document.getElementById('monthly-sales-chart').getContext('2d');
        const salesTotals = monthLabels.map(label => salesByMonth[label].total);
        const customerCounts = monthLabels.map(label => salesByMonth[label].count);

        if (monthlySalesChart) monthlySalesChart.destroy();

        monthlySalesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [{
                    label: '売上合計',
                    data: salesTotals,
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    yAxisID: 'y-sales',
                }, {
                    label: '客数',
                    data: customerCounts,
                    backgroundColor: 'rgba(255, 159, 64, 0.6)',
                    yAxisID: 'y-customers',
                }]
            },
            options: {
                scales: {
                    'y-sales': { position: 'left', title: { display: true, text: '売上 (円)' } },
                    'y-customers': { position: 'right', title: { display: true, text: '客数 (人)' }, grid: { drawOnChartArea: false }, beginAtZero: true }
                }
            }
        });

        const summaryTableBody = document.querySelector('#monthly-summary-table tbody');
        summaryTableBody.innerHTML = '';
        monthLabels.slice().reverse().forEach(label => { // 最新の月から表示
            const data = salesByMonth[label];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${label}</td>
                <td>¥${data.total.toLocaleString()}</td>
                <td>${data.count}人</td>
                <td>¥${data.average.toLocaleString()}</td>
            `;
            summaryTableBody.appendChild(tr);
        });
    };

    const loadSalesHistory = async (dateStr) => {
        salesHistoryTableBody.innerHTML = '<tr><td colspan="4">読み込み中...</td></tr>';

        const date = new Date(dateStr);
        const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);

        // ▼▼▼ 修正: クエリ対象を 'createdAt' (会計日) から 'reservationTime' (予約日) に戻します ▼▼▼
        const q = query(collection(db, 'sales'),
            where('reservationTime', '>=', Timestamp.fromDate(startOfDay)),
            where('reservationTime', '<=', Timestamp.fromDate(endOfDay)),
            orderBy('reservationTime', 'desc') // 並び順も予約日時に基づく
        );
        // ▲▲▲ 修正ここまで ▲▲▲

        const snapshot = await getDocs(q);

        // ▼▼▼ 日次合計計算ロジック (新規追加) ▼▼▼
        let dailyTotal = 0;

        if (snapshot.empty) {
            salesHistoryTableBody.innerHTML = '<tr><td colspan="4">この日の会計履歴はありません。</td></tr>';
        } else {
            salesHistoryTableBody.innerHTML = '';
            snapshot.forEach(doc => {
                const sale = { id: doc.id, ...doc.data() };
                dailyTotal += sale.total || 0; // 合計に加算

                // ▼▼▼ 表示する日時は 'createdAt' (会計日時) を使用 ▼▼▼
                const saleTime = sale.createdAt.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                // ▲▲▲ 修正ここまで ▲▲▲

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${saleTime}</td>
                    <td>${sale.customerName}</td>
                    <td class="text-right">¥${(sale.total || 0).toLocaleString()}</td>
                    <td class="text-center">
                        <a href="./pos.html?saleId=${sale.id}" class="icon-button small-btn" title="編集"><i class="fa-solid fa-pen"></i></a>
                        <button class="icon-button small-btn delete-btn" data-id="${sale.id}" title="削除"><i class="fa-solid fa-trash"></i></button>
                    </td>
                `;

                tr.querySelector('.delete-btn').addEventListener('click', (e) => {
                    const saleId = e.currentTarget.dataset.id;
                    deleteSale(saleId);
                });

                salesHistoryTableBody.appendChild(tr);
            });
        }

        // 合計金額をフッターに表示
        if (historyDailyTotalEl) {
            historyDailyTotalEl.innerHTML = `<strong>¥${dailyTotal.toLocaleString()}</strong>`;
        }
        // ▲▲▲ 新規追加ここまで ▲▲▲
    };

    const deleteSale = async (saleId) => {
        if (confirm('この会計履歴を本当に削除しますか？この操作は元に戻せません。')) {
            try {
                await deleteDoc(doc(db, 'sales', saleId));
                alert('会計履歴を削除しました。');
                await loadSalesHistory(historyDatePicker.value);
                await loadSalesData();
            } catch (error) {
                console.error("会計履歴の削除に失敗:", error);
                alert("会計履歴の削除に失敗しました。");
            }
        }
    };

    // --- Event Listeners ---
    setGoalBtn.addEventListener('click', setMonthlyGoal);
    historyDatePicker.addEventListener('change', (e) => loadSalesHistory(e.target.value));

    // --- Initial Load ---
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    historyDatePicker.value = todayStr;

    await loadSalesData();
    await loadSalesHistory(todayStr);
};

runAdminPage(salesMain);