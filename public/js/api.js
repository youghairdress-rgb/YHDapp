/**
 * @file api.js
 * @description Centralized API calls to the backend Cloud Functions.
 */

import { authManager } from './auth.js';

const API_BASE_URL = '/api'; // This will be correctly rewritten by firebase.json

/**
 * A helper function to make authenticated requests to the backend.
 * @param {string} endpoint - The API endpoint to call (e.g., '/user/getData').
 * @param {string} method - HTTP method ('GET', 'POST', etc.).
 * @param {object|null} body - The request body for POST/PUT requests.
 * @returns {Promise<object>} - The JSON response from the server.
 */
async function request(endpoint, method = 'GET', body = null) {
    const idToken = authManager.getIdToken();
    if (!idToken) {
        throw new Error('認証トークンがありません。再度ログインしてください。');
    }

    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json',
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    console.log(`[API] Requesting: ${method} ${API_BASE_URL}${endpoint}`);

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);

        if (!response.ok) {
            let errorData = { message: '' };
            try {
                errorData = await response.json();
                console.error(`[API] Error Response from ${endpoint}:`, errorData);
            } catch (e) {
                console.error(`[API] Could not parse error JSON from ${endpoint}. Status: ${response.status}`);
            }
            throw new Error(`Server responded with status ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`[API] Fetch failed for ${endpoint}:`, error);
        throw error;
    }
}

// --- User API Calls ---
export const getInitialData = () => request('/user/getInitialData');
export const saveBooking = (bookingData) => request('/user/saveBooking', 'POST', bookingData);
export const getMyData = () => request('/user/getMyData');

// --- Admin API Calls ---
export const getAdminAllData = () => request('/admin/getAllData');
// Add other admin API calls here as needed, e.g.:
// export const updateSettings = (settings) => request('/admin/settings', 'POST', settings);
// export const saveCustomer = (customer) => request('/admin/customers', 'POST', customer);

