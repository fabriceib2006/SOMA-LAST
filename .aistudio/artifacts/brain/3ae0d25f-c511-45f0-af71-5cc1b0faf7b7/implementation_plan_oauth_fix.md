# Implementation Plan: Using OAuth Secret for Authentication

## Overview
The organizational policy forces binding API keys to service accounts, resulting in OAuth 2.0 tokens (`AQ...`) rather than traditional API Keys (`AIza...`). We must adjust our backend to use this token for authentication.

## Objectives
1. Update `server.ts` to accept the `AQ...` credential as the authorization token.
2. Ensure the Gemini SDK uses this correctly.

## Planned Actions
### 1. Backend Authentication Update (`server.ts`)
- Modify the `GoogleGenAI` initialization. Instead of treating the credential as a simple API key, we will pass it as an authorization token if it starts with `AQ.`.
- We will likely need to adjust the `ai` client initialization to use an `auth` header or different SDK configuration.

### 2. Implementation
- Update `server.ts` to detect the `AQ...` prefix.
- If detected, configure the Gemini client to use `Authorization: Bearer <key>`.

### 3. Verification
- Restart the server.
- The authentication rejection will be bypassed, allowing the Gemini API to function.
