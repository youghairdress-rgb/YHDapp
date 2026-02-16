/**
 * src/utils/sanitizer.js
 * Input/Output sanitization utilities
 */

/**
 * Decode HTML entities in a string.
 * Accounts for common entities returned by LLMs.
 * @param {string} str 
 * @returns {string}
 */
function decodeHtmlEntities(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&#x2f;/gi, '/')
        .replace(/&#47;/g, '/')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&#x([0-9A-F]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)));
}

/**
 * Recursively decode HTML entities in a string.
 * @param {string} str 
 * @param {number} maxLoops 
 * @returns {string}
 */
function decodeHtmlEntitiesLoop(str, maxLoops = 5) {
    let decoded = str;
    let previous = "";
    let count = 0;
    while (decoded !== previous && count < maxLoops) {
        previous = decoded;
        decoded = decodeHtmlEntities(decoded);
        count++;
    }
    return decoded;
}

/**
 * Recursively sanitize all string properties in an object.
 * @param {any} obj 
 * @returns {any}
 */
function sanitizeObject(obj) {
    if (typeof obj === 'string') {
        return decodeHtmlEntitiesLoop(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }
    if (obj !== null && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                newObj[key] = sanitizeObject(obj[key]);
            }
        }
        return newObj;
    }
    return obj;
}

module.exports = {
    decodeHtmlEntities,
    sanitizeObject,
};
