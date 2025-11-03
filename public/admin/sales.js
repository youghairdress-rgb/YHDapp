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
            const salesQuery = query(collection(db, 'sales'), 
                where('createdAt', '>=', Timestamp.fromDate(startOfMonth)),
                where('createdAt', '<=', Timestamp.fromDate(endOfMonth))
            );
            
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
    };
    
    // ▼▼▼ この関数を修正 ▼▼▼
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
            
            const q = query(collection(db, 'sales'),
                where('createdAt', '>=', Timestamp.fromDate(start)),
                where('createdAt', '<=', Timestamp.fromDate(end))
            );

            const snapshot = await getDocs(q);
            snapshot.forEach(doc => {
                const sale = doc.data();
                salesByMonth[label].total += sale.total || 0;
                salesByMonth[label].count += 1;
            });

            // 客単価を計算
            if (salesByMonth[label].count > 0) {
                salesByMonth[label].average = Math.round(salesByMonth[label].total / salesByMonth[label].count);
            }
        }
        return { salesByMonth, monthLabels };
    };

    // ▼▼▼ この関数を修正 ▼▼▼
    const renderMonthlySalesChart = ({ salesByMonth, monthLabels }) => {
        // --- グラフ描画 (既存のロジック) ---
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

        // --- 月次サマリーテーブル描画 (新規追加) ---
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

        const q = query(collection(db, 'sales'), 
            where('createdAt', '>=', Timestamp.fromDate(startOfDay)),
            where('createdAt', '<=', Timestamp.fromDate(endOfDay)),
            orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            salesHistoryTableBody.innerHTML = '<tr><td colspan="4">この日の会計履歴はありません。</td></tr>';
            return;
        }

        salesHistoryTableBody.innerHTML = '';
        snapshot.forEach(doc => {
            const sale = { id: doc.id, ...doc.data() };
            const saleTime = sale.createdAt.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            
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

