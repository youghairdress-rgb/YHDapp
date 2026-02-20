# Project Context

## Project Purpose

**YOU-G HAIR Dress (ユージ ヘア ドレス)**
A hair salon management system and customer-facing web application for a salon in Miyazaki City.
Key features include:

- Customer "My Page" for viewing reservation history and photo gallery.
- Reservation management.
- AI-based hair diagnosis (implied by file names).
- Point of Sale (POS) and sales recording.

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla ES Modules).
- **Backend**: Firebase (Cloud Functions, Firestore, Storage, Hosting).
- **Integration**: LINE Front-end Framework (LIFF).
- **Build/Env**: Node.js (v20 for Functions).

## Architecture Overview

- **Client**: Static files in `public/`. Accessible via Firebase Hosting.
- **Database**: Cloud Firestore. Collections include `users`, `sales`, `customers` (implied).
- **Storage**: Firebase Storage. Used for user galleries, booking photos, and AI diagnosis results.
- **Serverless**: Firebase Cloud Functions in `functions/` handle backend logic.

## Coding Conventions

- Standard HTML/CSS structure.
- JavaScript ES6+ syntax (async/await, modules).
- Importing Firebase SDKs from CDN/URLs in frontend (`https://www.gstatic.com/...`).

## Important Constraints

- **Cross-Origin**: CORS configured in `cors.json`.
- **Authentication**: LIFF and Firebase Auth.
- **Google Maps Integration**: No direct API for posting reviews; uses deep links.

## External Services

- Firebase
- LINE (Messaging API / LIFF)
- Google Maps Platform (Business Profile, Maps)
