/**
 * src/config.js
 * Application Configuration
 */

const { defineString } = require("firebase-functions/params");

// Define Parameters (Using defineString to match .env.yhd-db)
const lineChannelIds = defineString('LINE_CHANNEL_IDS');
const lineChannelAccessToken = defineString('LINE_CHANNEL_ACCESS_TOKEN');
const adminLineUserIds = defineString('ADMIN_LINE_USER_IDS');
const geminiApiKey = defineString('GEMINI_API_KEY');

module.exports = {
    // Parameters
    params: {
        lineChannelIds,
        lineChannelAccessToken,
        adminLineUserIds,
        geminiApiKey,
    },

    // Model Configurations
    models: {
        diagnosis: "gemini-2.5-flash",
        imageGen: "gemini-2.5-flash",
    },

    // API Configurations
    api: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
        retryLimit: 3,
    },

    // CORS Settings
    cors: {
        origin: true,
        methods: ["POST", "GET", "OPTIONS"],
    },
};

