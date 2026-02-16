/**
 * src/utils/fetchHelper.js
 * Generic fetch and processing utilities
 */

const logger = require("firebase-functions/logger");

/**
 * Fetch a resource from a URL and convert it to a Base64 object for Gemini.
 * @param {string} url - The URL to fetch.
 * @param {string} logKey - A label for logging purposes.
 * @param {Array<string>} allowedTypes - List of allowed mime types (optional).
 * @returns {Promise<{inlineData: {mimeType: string, data: string}}>}
 */
async function fetchAsBase64(url, logKey = "Resource", allowedTypes = null) {
    logger.info(`[fetchHelper] Fetching ${logKey} from: ${url.substring(0, 50)}...`);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${logKey}: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type");
        let mimeType = contentType;

        // Simple type inference if content-type is missing or generic
        if (!mimeType || mimeType === 'application/octet-stream') {
            if (url.endsWith('.png')) mimeType = 'image/png';
            else if (url.endsWith('.jpg') || url.endsWith('.jpeg')) mimeType = 'image/jpeg';
            else if (url.endsWith('.mp4')) mimeType = 'video/mp4';
            else if (url.endsWith('.mov')) mimeType = 'video/quicktime';
        }

        // Validate type if allowedTypes provided
        if (allowedTypes && !allowedTypes.some(t => mimeType.includes(t))) {
            logger.warn(`[fetchHelper] Unexpected mime type for ${logKey}: ${mimeType}`);
            // We might continue or throw depending on strictness. Let's log warning and proceed for now.
        }

        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");

        logger.info(`[fetchHelper] ${logKey} fetched successfully. Type: ${mimeType}, Size: ${base64.length}`);

        return {
            inlineData: {
                mimeType: mimeType || "application/octet-stream",
                data: base64,
            },
        };

    } catch (error) {
        logger.error(`[fetchHelper] Error fetching ${logKey}:`, error);
        throw error;
    }
}

module.exports = {
    fetchAsBase64,
};
