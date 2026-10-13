# Migration Plan: Legacy Base64 File Migration to Cloud Storage

## Goal
Migrate all historical files (`fileData` in base64 format) stored in Firestore to Firebase Cloud Storage, keeping only references (`storagePath`, `fileUrl`) in Firestore.

## Scope
- All `LibraryTopic` documents in `libraryTopics` collection.
- All `AcademicAssessment` documents in `academicAssessments` collection.

## Steps
1. **Script Creation**: Create a Node.js script `migrate_files.mjs` using `firebase-admin` to:
    - Initialize the Firebase Admin SDK.
    - Query `libraryTopics` for documents with `fileData`.
    - For each document:
        - Decode base64 to buffer.
        - Upload buffer to Cloud Storage.
        - Update Firestore document with `storagePath` and `fileUrl`, and remove `fileData`.
    - Repeat for `academicAssessments`.
2. **Validation**: Run the script in a test/dry-run mode (if possible) or ensure robust error handling.
3. **Execution**: Run `node migrate_files.mjs`.
4. **Cleanup**: Verify the migration by checking a few documents, then ensure no `fileData` fields remain.
