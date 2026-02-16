/**
 * src/utils/responseHelper.js
 * Standardized response formatters
 */

const logger = require("firebase-functions/logger");

/**
 * Send a success JSON response.
 * @param {object} res - Express response object.
 * @param {object} data - Data to send.
 * @param {string} message - Optional success message.
 */
function sendSuccess(res, data, message = "Success") {
    return res.status(200).json({
        ...data,
        message, // Optional top-level message
    });
}

/**
 * Send an error JSON response.
 * @param {object} res - Express response object.
 * @param {number} status - HTTP status code (default 500).
 * @param {string} error - Short error code/name.
 * @param {string} message - Detailed error message.
 * @param {object} debugInfo - Optional debug information.
 */
function sendError(res, status, error, message, debugInfo = null) {
    const payload = {
        error,
        message,
    };
    if (debugInfo) {
        payload.debugInfo = debugInfo;
    }

    // Log the error on the server side
    logger.error(`[ResponseError] ${status} - ${error}: ${message}`, debugInfo);

    return res.status(status || 500).json(payload);
}

module.exports = {
    sendSuccess,
    sendError,
};
