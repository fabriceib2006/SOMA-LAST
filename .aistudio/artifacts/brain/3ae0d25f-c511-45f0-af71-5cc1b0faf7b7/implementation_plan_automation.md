# Implementation Plan: Assessment Automation

## Overview
Automate the lifecycle of high-priority academic events (Assessments, CATs, Quizzes, Exams) to ensure they are synced to the calendar and correctly reflect their status on the Home dashboard.

## Objectives
1. **Auto-Calendar Sync**: Automatically sync all high-priority academic work to the Google Calendar upon creation/update.
2. **Status Automation**: Automatically mark past-due events as "Ended" or "Completed" and remove them from the "Upcoming Deadlines" view on the Home dashboard.

## Planned Actions
### 1. Calendar Integration
- Update `libraryFirestore.ts` and `semesterFirestore.ts` to trigger `syncSOMAEntityToGoogle` whenever a new high-priority assessment (CAT, Quiz, Exam, Assignment) is created or updated.

### 2. Status Lifecycle Management
- Implement a utility to check assessment/event due dates against the current date (CAT).
- Update the assessment status to "Ended" if the due date has passed.
- Filter the Home Dashboard "Deadlines" view to exclude items with status "Ended" or "Completed".

### 3. Verification
- Verify that new high-priority items automatically appear in the connected Google Calendar.
- Verify that past-due items no longer appear in the "Deadlines" list on the Home Dashboard.
