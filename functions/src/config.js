/**
 * src/config.js
 * Application Configuration
 */

const { defineSecret, defineString } = require("firebase-functions/params");

// Define Params (Legacy for YHD-db compatibility & simplified config)
const lineChannelIds = defineString("LINE_CHANNEL_IDS");
const lineChannelAccessToken = defineString("LINE_CHANNEL_ACCESS_TOKEN");
const adminLineUserIds = defineString("ADMIN_LINE_USER_IDS");
const geminiApiKey = defineString("GEMINI_API_KEY");

// Map keys to existing env var to avoid Secret Manager dependency
const llmApiKey = geminiApiKey;
const imageGenApiKey = geminiApiKey;

module.exports = {
    // Params (Compatible with YHD-db index.js structure)
    params: {
        lineChannelIds,
        lineChannelAccessToken,
        adminLineUserIds,
        geminiApiKey
    },
    // Secrets (Empty as we verify using env vars now)
    secrets: {},

    // Model Configurations
    models: {
        diagnosis: "gemini-2.5-flash-preview-09-2025",
        imageGen: "gemini-2.5-flash-image", // User requested "2.5 flash image 001"
    },

    // Vertex AI Configuration
    vertex: {
        location: "us-west1", // Try us-west1 to avoid us-central1 congestion
        projectId: process.env.GCLOUD_PROJECT || "yhd-dx",
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
