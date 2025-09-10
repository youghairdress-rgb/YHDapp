let idToken = null;

// The base URL for all API calls.
const API_BASE_URL = '/api';

/**
 * Sets the authentication token for subsequent API calls.
 * @param {string} token - The LIFF ID token.
 */
function setAuthToken(token) {
    idToken = token;
    console.log('[API] Auth token set.');
}

/**
 * A generic request handler for all API calls to the backend.
 * @param {string} endpoint - The API endpoint to call (e.g., '/user/initialData').
 * @param {string} method - The HTTP method (GET, POST, etc.).
 * @param {object} body - The request body for POST/PUT requests.
 * @returns {Promise<object>} - The JSON response from the server.
 */
async function request(endpoint, method = 'GET', body = null) {
    const url = `${API_BASE_URL}${endpoint}`;
    console.log(`[API] Requesting: ${method} ${url}`);

    const headers = {
        'Content-Type': 'application/json',
    };

    // Add the Authorization header if the token is available and the endpoint is not public
    if (idToken && !endpoint.startsWith('/public')) {
        headers['Authorization'] = `Bearer ${idToken}`;
    }

    const config = {
        method,
        headers,
    };

    if (body) {
        config.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, config);
        
        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json();
                 console.error(`[API] Error Response from ${endpoint}:`, errorData);
            } catch (e) {
                errorData = { message: response.statusText };
                console.error(`[API] Non-JSON Error Response from ${endpoint}:`, response.statusText);
            }
            throw new Error(errorData.message || `Server responded with status ${response.status}`);
        }
        // Handle cases where the response might be empty (e.g., a 204 No Content)
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            return response.json();
        } else {
            return {}; 
        }

    } catch (error) {
        console.error(`[API] Fetch failed for ${endpoint}:`, error);
        throw error;
    }
}

// --- Public API Calls (No Auth Required) ---

/**
 * Fetches the public configuration, including LIFF IDs.
 */
function getPublicConfig() {
    return request('/public/config');
}


// --- User-Facing API Calls (Auth Required) ---

/**
 * Fetches all initial data needed for the user booking page.
 */
function getInitialData() {
    return request('/user/initialData');
}

/**
 * Fetches the current user's data (e.g., visit history).
 */
function getMyData() {
    return request('/user/myData');
}

/**
 * Saves a new booking to the database.
 * @param {object} bookingData - The booking details.
 */
function saveBooking(bookingData) {
    return request('/user/saveBooking', 'POST', bookingData);
}


// --- Admin-Facing API Calls (Admin Auth Required) ---
// ... (Future admin-specific API functions will go here)


export {
    setAuthToken,
    getPublicConfig,
    getInitialData,
    getMyData,
    saveBooking,
    // ... export other functions as they are created
};

