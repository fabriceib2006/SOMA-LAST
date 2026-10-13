# Implementation Plan: Gemini API Key Correction

## Overview
The Gemini API key currently being used is formatted incorrectly (starts with "AQ."), which is causing the API to reject it. Gemini API keys MUST start with "AIza".

## Objectives
1. Correctly generate and configure a valid Gemini API key.

## Planned Actions
### 1. Key Generation
- Navigate to Google AI Studio.
- In the "Get API key" section, explicitly click **"Create API key in new project"** (if necessary) or ensure the generated key starts with **"AIza..."**.
- The "AQ..." key format is not a valid Gemini API key and will always be rejected.

### 2. Configuration
- Update the `GEMINI_API_KEY` in the **Settings > Secrets** panel with the new "AIza..." key.

### 3. Verification
- Refresh the application.
- The server logs will now show "AIza" as the prefix, and the study plan generation will proceed.
