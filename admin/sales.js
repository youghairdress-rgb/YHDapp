import { runAdminPage } from './admin-auth.js';
import { db } from './firebase-init.js';
import { collection, getDocs, doc, getDoc, setDoc, query, where, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const salesMain = async (auth, user) => {
    // DOM Elements
    const monthlyGoalInput = document.getElementById('monthly-goal');
    const setGoalBtn = document.getElementById('set-goal-btn');
    const goalProgressText = document.getElementById('goal-progress-text');
    const goalProgressBar = document.getElementById('goal-progress-bar');
    
    // Chart instances
    let monthlySalesChart = null;
    let categorySalesChart = null;

    const loadSalesData = async () => {
        try {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();
            
            // Load monthly goal
            const goalDocRef = doc(db, 'sales_goals', `${year}-${String(month + 1).padStart(2, '0')}`);
            const goalDoc = await getDoc(goalDocRef);
            const monthlyGoal = goalDoc.exists() ? goalDoc.data().goal : 0;
            monthlyGoalInput.value = monthlyGoal;

            // Load sales for the current month
            const startOfMonth = new Date(year, month, 1);
            const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
            const salesQuery = query(collection(db, 'sales'), 
                where('createdAt', '>=', Timestamp.fromDate(startOfMonth)),
                where('createdAt', '<=', Timestamp.fromDate(endOfMonth))
            );
            const salesSnapshot = await getDocs(salesQuery);
            const sales = salesSnapshot.docs.map(doc => doc.data());
            
            updateMonthlyGoalProgress(sales, monthlyGoal);
            renderCategoryChart(sales);
            
            // Load sales for the last 6 months
            const monthlySalesData = await getMonthlySalesForLastSixMonths();
            renderMonthlySalesChart(monthlySalesData);
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
            await loadSalesData(); // Reload data to reflect new goal
        } catch (error) {
            console.error("目標設定に失敗:", error);
            alert('目標設定に失敗しました。');
        }
    };

    const updateMonthlyGoalProgress = (sales, goal) => {
        const currentSales = sales.reduce((sum, sale) => sum + sale.total, 0);
        const percentage = goal > 0 ? Math.min(Math.round((currentSales / goal) * 100), 100) : 0;
        
        goalProgressText.textContent = `${percentage}% 達成 (¥${currentSales.toLocaleString()} / ¥${goal.toLocaleString()})`;
        goalProgressBar.style.width = `${percentage}%`;
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
            salesByMonth[label] = { total: 0, count: 0 };

            const start = new Date(year, month, 1);
            const end = new Date(year, month + 1, 0, 23, 59, 59);
            
            const q = query(collection(db, 'sales'),
                where('createdAt', '>=', Timestamp.fromDate(start)),
                where('createdAt', '<=', Timestamp.fromDate(end))
            );

            const snapshot = await getDocs(q);
            snapshot.forEach(doc => {
                const sale = doc.data();
                salesByMonth[label].total += sale.total;
                salesByMonth[label].count += 1;
            });
        }
        return { salesByMonth, monthLabels };
    };

    const renderMonthlySalesChart = ({ salesByMonth, monthLabels }) => {
        const ctx = document.getElementById('monthly-sales-chart').getContext('2d');
        const salesTotals = monthLabels.map(label => salesByMonth[label].total);
        const customerCounts = monthLabels.map(label => salesByMonth[label].count);

        if (monthlySalesChart) {
            monthlySalesChart.destroy();
        }

        monthlySalesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [{
                    label: '売上合計',
                    data: salesTotals,
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1,
                    yAxisID: 'y-sales',
                }, {
                    label: '客数',
                    data: customerCounts,
                    backgroundColor: 'rgba(255, 159, 64, 0.6)',
                    borderColor: 'rgba(255, 159, 64, 1)',
                    borderWidth: 1,
                    yAxisID: 'y-customers',
                }]
            },
            options: {
                scales: {
                    'y-sales': {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '売上 (円)' }
                    },
                    'y-customers': {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: '客数 (人)' },
                        grid: { drawOnChartArea: false },
                        beginAtZero: true
                    }
                }
            }
        });
    };

    const renderCategoryChart = (sales) => {
        const categorySales = {};
        sales.forEach(sale => {
            if (sale.menus && Array.isArray(sale.menus)) {
                sale.menus.forEach(menu => {
                    const name = menu.name || '名称不明';
                    if (!categorySales[name]) {
                        categorySales[name] = 0;
                    }
                    categorySales[name] += menu.price || 0;
                });
            }
        });
        
        const ctx = document.getElementById('category-sales-chart').getContext('2d');
        const labels = Object.keys(categorySales);
        const data = Object.values(categorySales);

        if (categorySalesChart) {
            categorySalesChart.destroy();
        }

        categorySalesChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    label: 'メニュー別売上',
                    data: data,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
            }
        });
    };

    // Event Listeners
    setGoalBtn.addEventListener('click', setMonthlyGoal);

    // Initial Load
    await loadSalesData();
};

runAdminPage(salesMain);

