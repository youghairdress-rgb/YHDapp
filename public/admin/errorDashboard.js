/**
 * errorDashboard.js
 * 管理画面用エラーダッシュボード
 * 
 * 使用方法:
 * import { renderErrorDashboard, loadErrorStats } from './errorDashboard.js';
 */

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const CLOUD_FUNCTIONS_URL = "https://asia-northeast1-yhd-db.cloudfunctions.net";

/**
 * エラーログを取得
 */
export async function fetchErrorLogs(days = 7, token) {
    try {
        const response = await fetch(`${CLOUD_FUNCTIONS_URL}/getErrorLogs?days=${days}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        return data.errors || [];
    } catch (error) {
        console.error('[fetchErrorLogs]', error);
        return [];
    }
}

/**
 * エラー統計を取得
 */
export async function fetchErrorStats(days = 7, token) {
    try {
        const response = await fetch(`${CLOUD_FUNCTIONS_URL}/getErrorStats?days=${days}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        return data.stats || {};
    } catch (error) {
        console.error('[fetchErrorStats]', error);
        return {};
    }
}

/**
 * エラーダッシュボード HTML をレンダリング
 */
export function renderErrorDashboard(containerId = 'error-dashboard-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
        <div id="error-dashboard" style="padding: 20px; background: #f8fafc; border-radius: 8px;">
            <h2 style="margin-top: 0;">🚨 エラー監視ダッシュボード</h2>
            
            <!-- 統計情報 -->
            <div id="error-stats" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px;">
                <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 12px; color: #666; margin-bottom: 5px;">🚨 Critical</div>
                    <div style="font-size: 28px; font-weight: bold; color: #ef4444;" id="stat-critical">-</div>
                </div>
                <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 12px; color: #666; margin-bottom: 5px;">⚠️ High</div>
                    <div style="font-size: 28px; font-weight: bold; color: #f97316;" id="stat-high">-</div>
                </div>
                <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 12px; color: #666; margin-bottom: 5px;">⚡ Medium</div>
                    <div style="font-size: 28px; font-weight: bold; color: #eab308;" id="stat-medium">-</div>
                </div>
                <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 12px; color: #666; margin-bottom: 5px;">ℹ️ Total</div>
                    <div style="font-size: 28px; font-weight: bold; color: #3b82f6;" id="stat-total">-</div>
                </div>
            </div>

            <!-- 関数別エラー統計 -->
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <h3 style="margin-top: 0; margin-bottom: 15px;">📊 関数別エラー統計</h3>
                <div id="function-stats" style="border-top: 1px solid #e5e7eb;">
                    <!-- 動的に挿入 -->
                </div>
            </div>

            <!-- エラーログテーブル -->
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <h3 style="margin-top: 0; margin-bottom: 15px;">📋 最近のエラーログ</h3>
                <table id="error-logs-table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #f3f4f6; border-bottom: 2px solid #e5e7eb;">
                            <th style="padding: 12px; text-align: left; font-weight: 600;">時刻</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600;">重要度</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600;">関数名</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600;">メッセージ</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600;">ユーザー</th>
                        </tr>
                    </thead>
                    <tbody id="error-logs-body">
                        <!-- 動的に挿入 -->
                    </tbody>
                </table>
                <div id="error-logs-empty" style="padding: 40px; text-align: center; color: #999;">
                    データを読み込み中...
                </div>
            </div>

            <!-- 更新ボタン -->
            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button id="error-refresh-btn" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    🔄 更新
                </button>
                <select id="error-days-filter" style="padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                    <option value="1">過去 1 日</option>
                    <option value="7" selected>過去 7 日</option>
                    <option value="30">過去 30 日</option>
                </select>
            </div>
        </div>
    `;

    // イベントリスナー設定
    document.getElementById('error-refresh-btn')?.addEventListener('click', () => {
        loadErrorData();
    });

    document.getElementById('error-days-filter')?.addEventListener('change', (e) => {
        loadErrorData(parseInt(e.target.value));
    });

    // 初期読み込み
    loadErrorData();
}

/**
 * エラーデータを読み込んでレンダリング
 */
async function loadErrorData(days = 7) {
    try {
        // 認証トークン取得（Firebase Auth）
        const auth = window.firebase?.auth;
        if (!auth || !auth.currentUser) {
            console.warn('[loadErrorData] Not authenticated');
            return;
        }

        const token = await auth.currentUser.getIdToken();

        // データ取得
        const [statsData, logsData] = await Promise.all([
            fetchErrorStats(days, token),
            fetchErrorLogs(days, token)
        ]);

        // 統計情報をレンダリング
        renderErrorStats(statsData);

        // ログテーブルをレンダリング
        renderErrorLogs(logsData);

    } catch (error) {
        console.error('[loadErrorData]', error);
        document.getElementById('error-logs-empty').textContent = 'エラーが発生しました';
    }
}

/**
 * 統計情報をレンダリング
 */
function renderErrorStats(stats) {
    if (!stats || !stats.bySeverity) return;

    document.getElementById('stat-critical').textContent = stats.bySeverity.CRITICAL || 0;
    document.getElementById('stat-high').textContent = stats.bySeverity.HIGH || 0;
    document.getElementById('stat-medium').textContent = stats.bySeverity.MEDIUM || 0;
    document.getElementById('stat-total').textContent = stats.total || 0;

    // 関数別統計
    const functionStatsDiv = document.getElementById('function-stats');
    if (stats.byFunction && Object.keys(stats.byFunction).length > 0) {
        functionStatsDiv.innerHTML = Object.entries(stats.byFunction)
            .map(([func, count]) => `
                <div style="padding: 12px; border-bottom: 1px solid #f3f4f6; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 500; color: #1f2937;">${func}</span>
                    <span style="background: #dbeafe; color: #1e40af; padding: 4px 8px; border-radius: 4px; font-weight: 600;">${count}</span>
                </div>
            `)
            .join('');
    } else {
        functionStatsDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">データなし</div>';
    }
}

/**
 * エラーログテーブルをレンダリング
 */
function renderErrorLogs(logs) {
    const tbody = document.getElementById('error-logs-body');
    const emptyDiv = document.getElementById('error-logs-empty');

    if (!logs || logs.length === 0) {
        tbody.innerHTML = '';
        emptyDiv.textContent = 'エラーログはありません';
        emptyDiv.style.display = 'block';
        return;
    }

    emptyDiv.style.display = 'none';

    const severityColors = {
        CRITICAL: '#ef4444',
        HIGH: '#f97316',
        MEDIUM: '#eab308',
        LOW: '#6b7280'
    };

    const severityEmojis = {
        CRITICAL: '🚨',
        HIGH: '⚠️',
        MEDIUM: '⚡',
        LOW: 'ℹ️'
    };

    tbody.innerHTML = logs.map(log => `
        <tr style="border-bottom: 1px solid #e5e7eb; hover: background: #f9fafb;">
            <td style="padding: 12px; color: #666; font-size: 12px;">${log.timestamp || '-'}</td>
            <td style="padding: 12px;">
                <span style="color: ${severityColors[log.severity]}; font-weight: 600;">
                    ${severityEmojis[log.severity]} ${log.severity}
                </span>
            </td>
            <td style="padding: 12px; font-weight: 500;">${log.functionName || '-'}</td>
            <td style="padding: 12px; color: #374151; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.errorMessage}">
                ${log.errorMessage || '-'}
            </td>
            <td style="padding: 12px; font-size: 12px; color: #666;">
                ${log.userId ? `<small>${log.userId}</small>` : '-'}
            </td>
        </tr>
    `).join('');
}

/**
 * admin 画面に統合するためのヘルパー
 */
export function setupErrorDashboard(adminPage) {
    // admin.html に id="error-dashboard-section" の div があると仮定
    const errorSection = document.getElementById('error-dashboard-section');
    
    if (errorSection) {
        renderErrorDashboard('error-dashboard-section');
    } else {
        console.warn('[setupErrorDashboard] error-dashboard-section not found');
    }
}

// 定期的に自動更新（オプション）
let autoRefreshInterval = null;

export function startAutoRefresh(intervalSeconds = 300) {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    
    autoRefreshInterval = setInterval(() => {
        const daysSelect = document.getElementById('error-days-filter');
        const days = daysSelect ? parseInt(daysSelect.value) : 7;
        loadErrorData(days);
    }, intervalSeconds * 1000);
    
    console.log(`[startAutoRefresh] Started with ${intervalSeconds}s interval`);
}

export function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('[stopAutoRefresh] Stopped');
    }
}
