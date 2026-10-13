# Implementation Plan: Service Account Authentication

## Overview
Due to organizational policies that prevent creating traditional "AIza" API keys and force binding to service accounts (generating "AQ" OAuth tokens), we must switch from simple API Key authentication to **Service Account-based Authentication**.

## Planned Actions
### 1. Backend Authentication Update (`server.ts`)
- Instead of using `GoogleGenAI` with an `apiKey`, we will configure the client to authenticate using a **Service Account JSON key**.
- The `Gemini API` client library supports direct service account authentication.

### 2. Configuration
- You need to generate a **Service Account JSON key file** from the Google Cloud Console for the service account that is currently being bound.
- Upload this JSON file content securely as a new secret: `GOOGLE_APPLICATION_CREDENTIALS_JSON`.

### 3. Backend Logic Update
- Update `server.ts` to initialize `GoogleGenAI` using this JSON credential, which provides proper server-to-server authentication.
- This will completely bypass the need for an API Key, solving the "AQ" vs "AIza" issue permanently.

## Verification
- Refresh the app. The backend will now authenticate using the Service Account, allowing AI features to function.
