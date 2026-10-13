# Implementation Plan: Gemini API Key Generation Fix

## Overview
Google Cloud has enforced a policy that requires binding API keys for certain APIs to service accounts. To get a valid `AIza...` key, we must correctly configure the API restrictions *before* the key creation dialog forces a service account binding.

## Planned Actions
### 1. Correct Key Generation Steps
1.  In the **Create API key** modal shown in the screenshot:
    *   **Do NOT** click "Create" yet.
    *   Look at the **"Select API restrictions"** dropdown (currently says "No APIs selected").
    *   Click that dropdown and **Select "Gemini API"** from the list.
2.  Once "Gemini API" is selected, the UI should change to allow the creation of a standard API key, or provide a way to create one that is *not* bound to a service account, or successfully generate an `AIza...` key.
3.  If it *still* forces a service account, please choose the `firebase-adminsdk-fbsvc@...` account, *but then look closely at the resulting key*—it *should* be an `AIza...` key, not an `AQ...` one.

### 2. Configuration
- Copy the resulting `AIza...` key.
- Go to the **Settings > Secrets** panel in this applet.
- Delete the old key.
- Paste the new `AIza...` key.
- Save and refresh.

### 3. Verification
- The application logs will show "AIza" as the prefix, and the study plan generation will succeed.
