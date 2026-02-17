/**
 * src/services/vertex.js
 *
 * Vertex AI API calling service.
 * Handles authentication (ADC) and retry logic.
 */
const { GoogleAuth } = require('google-auth-library');
const logger = require("firebase-functions/logger");

const auth = new GoogleAuth({
    scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

/**
 * Call Vertex AI Prediction API with retry logic
 * @param {string} projectId 
 * @param {string} location 
 * @param {string} modelId 
 * @param {Array} instances 
 * @param {Object} parameters 
 * @param {number} maxRetries 
 * @returns {Promise<Object>} API Response
 */
async function callVertexAiWithRetry(projectId, location, modelId, instances, parameters, maxRetries = 3) {
    let attempt = 0;
    let delay = 1000;

    // Get Access Token (cached by library)
    const client = await auth.getClient();

    while (attempt < maxRetries) {
        attempt++;
        const tokenResponse = await client.getAccessToken();
        const accessToken = tokenResponse.token;

        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

        logger.info(`[callVertexAiWithRetry] Attempt ${attempt}/${maxRetries} calling: ${url}`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify({ instances, parameters })
            });

            if (response.ok) {
                return await response.json();
            }

            // Retry logic
            if ([429, 500, 503].includes(response.status)) {
                logger.warn(`[callVertexAiWithRetry] Status ${response.status}. Retrying in ${delay}ms...`);
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, delay));
                    delay *= 2;
                } else {
                    throw new Error(`Vertex AI failed with status ${response.status}`);
                }
            } else {
                // Non-retriable
                const errorText = await response.text();
                logger.error(`[callVertexAiWithRetry] Non-retriable error ${response.status}: ${errorText}`);
                throw new Error(`Vertex AI Error ${response.status}: ${errorText}`);
            }
        } catch (error) {
            logger.error(`[callVertexAiWithRetry] Fetch error attempt ${attempt}:`, error);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
            } else {
                throw new Error(`Vertex AI fetch failed: ${error.message}`);
            }
        }
    }
}

module.exports = { callVertexAiWithRetry };
