# Implementation Plan - SOMA Intelligence Capability Expansion & System Bridge

## Overview
Based on Fabrice's requirements, this plan outlines the architecture and execution strategy for expanding SOMA Intelligence to support full Google Calendar synchronization, real-time file upload intelligence, and multi-week timetable management.

## Capability Breakdown & Implementation Roadmap

| No | Required Functionality | Current Status | Implementation & Enhancement Plan |
| :--- | :--- | :--- | :--- |
| 1 | Homepage & Timetable Real-Time Audit | **Capable** | Audits active semester days, study plans, and deadlines directly from Firestore context in real time. |
| 2 | Google Calendar Read/Write/Delete API Bridge | **Partial (Schema Ready)** | Implement Google Calendar API OAuth integration to automatically create color-coded priority events (red for high priority), set alarms, and update/delete events upon deadline changes. |
| 3 | File Upload Intelligence & Study Planning | **Capable** | Expand file upload ingestion in the Library Dashboard so SOMA automatically indexes newly uploaded lecture notes, syllabi, and CAT briefs into the active study plan. |
| 4 | Pre-Session Module Knowledge Indexing | **Capable** | Cache module files, lecture topics, and past quizzes in Gemini context windows so study sessions start instantly without manual prep. |
| 5 | Multi-Week Timetable & Class Shifting | **Partial** | Add batch timetable operations supporting single-week or all-weeks class rescheduling across semester day records in Firestore. |

## Next Steps
1. Finalize Google Calendar OAuth scopes and API event sync functions.
2. Build batch timetable shift helper functions for single-week and semester-wide class updates.
3. Enable automated document ingestion triggers for library uploads.
