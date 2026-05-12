# Requirements Document

## Introduction

This feature adds optional Supabase-backed cloud synchronization to the existing local-first time-tracking desktop application (Tauri 2 + React 19 + SQLite). A logged-in user can back up and restore data across devices without breaking the anonymous-mode UX established in Phases 1–3. The app remains fully functional offline; authentication and sync are opt-in.

## Glossary

- **App**: The Tauri 2 desktop time-tracking application
- **Supabase_Client**: The `@supabase/supabase-js` singleton instance, nullable when environment variables are missing
- **Auth_Store**: Zustand store managing authentication state and sync status
- **Sync_Outbox**: Local SQLite table that queues pending mutations for cloud synchronization
- **Sync_Worker**: Foreground TypeScript interval-based process that drains the Sync_Outbox to Supabase Postgres
- **LWW_Merge**: Last-Write-Wins merge algorithm that resolves conflicts by comparing `updated_at` timestamps
- **Initial_Pull**: One-shot download of all cloud data triggered on first login per user session
- **RLS**: Row Level Security policies on Supabase Postgres ensuring user data isolation
- **Auth_Modal**: UI component providing Login and Sign-up tabs for email/password authentication
- **Auth_Gate**: Header UI component showing sign-in button (anonymous) or user menu (authenticated)
- **Sync_Status_Badge**: Header UI component displaying current synchronization state
- **Sync_Status_Modal**: Dialog showing recent sync errors with retry and clear actions
- **Resource**: A project, stage, substage, or task entity in the hierarchy
- **Event**: A time-logging entry associated with a Resource

## Requirements

### Requirement 1: Graceful Degradation Without Configuration

**User Story:** As a developer deploying the app, I want the cloud sync features to be completely hidden when Supabase environment variables are not configured, so that the app works identically to Phases 1–3 without any setup.

#### Acceptance Criteria

1. WHEN the environment variables `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` are missing or empty, THE Supabase_Client SHALL be null
2. WHILE the Supabase_Client is null, THE App SHALL hide all authentication and synchronization UI components (Auth_Gate, Sync_Status_Badge)
3. WHILE the Supabase_Client is null, THE App SHALL provide full offline functionality for project management, time logging, and dashboard analytics
4. WHEN the Supabase_Client is null and the App starts, THE App SHALL log a console warning message `[supabase] env vars missing — cloud sync disabled`

### Requirement 2: Email/Password Authentication

**User Story:** As a user, I want to create an account and sign in with email and password, so that I can enable cloud backup of my data.

#### Acceptance Criteria

1. WHEN the user submits valid credentials on the Login tab, THE Auth_Store SHALL authenticate the user via Supabase Auth `signInWithPassword` and transition state to `authed`
2. WHEN the user submits valid credentials on the Sign-up tab, THE Auth_Store SHALL create a new account via Supabase Auth `signUp` and transition state to `authed`
3. WHEN authentication fails, THE Auth_Modal SHALL display the error message returned by Supabase Auth inline below the form without closing the modal
4. THE Auth_Modal SHALL validate that the email contains an `@` character and does not exceed 254 characters before submission, and SHALL display an inline validation error indicating the failing rule if validation fails
5. THE Auth_Modal SHALL validate that the password is at least 8 characters and does not exceed 128 characters before submission, and SHALL display an inline validation error indicating the failing rule if validation fails
6. WHEN the user clicks Sign out, THE Auth_Store SHALL call `supabase.auth.signOut()` and transition state to `anonymous`
7. WHILE an authentication request is in progress, THE Auth_Modal SHALL disable the submit button to prevent duplicate submissions

### Requirement 3: Session Persistence

**User Story:** As a user, I want my login session to persist across app restarts, so that I do not need to sign in every time I open the app.

#### Acceptance Criteria

1. WHEN the App starts, THE Auth_Store SHALL call `supabase.auth.getSession()` and, if a session with a valid or refreshable token is returned, transition state to `authed` without requiring re-login
2. WHEN the session token expires, THE Supabase_Client SHALL automatically refresh the token using `autoRefreshToken`
3. IF the session restoration or token refresh fails (e.g., refresh token revoked or network unavailable), THEN THE Auth_Store SHALL transition state to `anonymous`
4. WHEN the `onAuthStateChange` listener receives a session update, THE Auth_Store SHALL update its state to reflect the current session: transitioning to `authed` on `SIGNED_IN`, `TOKEN_REFRESHED`, or `INITIAL_SESSION` with a non-null session, and transitioning to `anonymous` on `SIGNED_OUT` or `INITIAL_SESSION` with a null session

### Requirement 4: Anonymous Mode Preservation

**User Story:** As a user who does not want to create an account, I want the app to work fully offline without any degradation, so that cloud sync remains optional.

#### Acceptance Criteria

1. WHILE the Auth_Store state is `anonymous`, THE App SHALL provide full functionality for creating, editing, moving, and deleting Resources and Events
2. WHILE the Auth_Store state is `anonymous`, THE Sync_Worker SHALL not attempt to flush the Sync_Outbox
3. WHILE the Auth_Store state is `anonymous`, THE App SHALL continue to insert rows into the Sync_Outbox within the same transaction as each local mutation, so that pending changes are available for flush upon future login
4. WHEN the user signs out, THE App SHALL transition to anonymous mode without deleting or modifying any locally stored Resources, Events, or Sync_Outbox rows
5. WHEN the user signs out, THE App SHALL preserve the Sync_Outbox so that pending items are flushed upon next login

### Requirement 5: Transactional Outbox Enqueue

**User Story:** As a user, I want every local data change to be reliably queued for sync, so that no mutations are lost even if the app crashes.

#### Acceptance Criteria

1. WHEN a Resource is created, renamed, recolored, moved, or soft-deleted, THE App SHALL insert a corresponding row into the Sync_Outbox within the same database transaction as the mutation
2. WHEN an Event is created, updated, or soft-deleted, THE App SHALL insert a corresponding row into the Sync_Outbox within the same database transaction as the mutation
3. THE Sync_Outbox row SHALL contain the entity type (`resource` or `event`), entity ID, operation type (`upsert` or `delete`), full JSON payload of the post-mutation row, and the enqueue timestamp as Unix milliseconds
4. WHEN a soft-delete mutation sets `deleted_at`, THE App SHALL enqueue the row with operation type `upsert` (not `delete`)
5. WHEN a subtree soft-delete affects multiple Resources and their associated Events, THE App SHALL enqueue a Sync_Outbox row for each affected Resource and each affected Event within the same transaction
6. WHEN a move operation updates descendant Resource paths, THE App SHALL enqueue a Sync_Outbox row for each descendant Resource whose `path` or `parent_id` was modified
7. IF the database transaction containing the mutation fails, THEN THE App SHALL not persist the Sync_Outbox row (atomic rollback with the mutation)

### Requirement 6: Outbox Worker Flush with Exponential Backoff

**User Story:** As a user, I want my queued changes to be automatically pushed to the cloud in the background, so that I do not need to manually trigger sync.

#### Acceptance Criteria

1. WHILE the Auth_Store state is `authed`, THE Sync_Worker SHALL execute a flush tick every 10 seconds
2. WHEN the Sync_Worker executes a tick, THE Sync_Worker SHALL select up to 50 rows from the Sync_Outbox where `next_retry_at` is NULL or `next_retry_at` ≤ current time, ordered by ID ascending
3. WHEN the selected rows contain multiple entries for the same `(entity, entity_id)` pair, THE Sync_Worker SHALL collapse them by keeping only the row with the highest ID and deleting the superseded rows from the Sync_Outbox
4. WHEN the flush succeeds for a batch, THE Sync_Worker SHALL delete the successfully flushed rows from the Sync_Outbox
5. WHEN the flush fails for a batch, THE Sync_Worker SHALL increment the `attempts` counter on each affected row and set `next_retry_at` to `now + min(2^attempts_new × 1000ms, 300000ms)` where `attempts_new` is the value after increment
6. WHEN the flush fails, THE Sync_Worker SHALL store the error message (truncated to 1024 characters maximum) in the `last_error` field of the affected Sync_Outbox rows
7. WHEN a flush batch contains rows for multiple entity types and one entity type fails while another succeeds, THE Sync_Worker SHALL delete the successfully flushed rows and apply backoff only to the failed rows
8. WHEN `navigator.onLine` is false at the start of a tick, THE Sync_Worker SHALL skip the flush and set sync status to `offline`
9. WHEN the document visibility changes to `visible`, THE Sync_Worker SHALL execute an immediate flush tick

### Requirement 7: Cloud Data Mapping

**User Story:** As a user, I want my local data to be correctly transformed when pushed to the cloud, so that timestamps and user ownership are properly stored.

#### Acceptance Criteria

1. WHEN pushing data to Supabase, THE Sync_Worker SHALL convert `created_at` and `updated_at` from Unix milliseconds to ISO 8601 UTC timestamps (e.g., `2024-01-15T10:30:00.000Z`) for both `resources` and `events` rows
2. WHEN pushing data to Supabase, THE Sync_Worker SHALL inject the authenticated user's `user_id` (from the current session) into each row
3. WHEN pushing data to Supabase, THE Sync_Worker SHALL use Postgres `UPSERT` with conflict resolution on the `id` column
4. IF `deleted_at` is non-null, THEN THE Sync_Worker SHALL convert it from Unix milliseconds to ISO 8601 UTC timestamp; otherwise THE Sync_Worker SHALL pass null
5. IF a timestamp field (`created_at`, `updated_at`, or `deleted_at`) contains a value that is not a positive integer, THEN THE Sync_Worker SHALL skip that row and record an error in the Sync_Outbox `last_error` field

### Requirement 8: Initial Pull and LWW Merge on Login

**User Story:** As a user logging in on a new or existing device, I want my cloud data to be merged with local data, so that I have a complete view of all my tracked time.

#### Acceptance Criteria

1. WHEN the user authenticates and no Initial_Pull has been performed for that user_id in the current application process, THE App SHALL perform an Initial_Pull of all cloud Resources and Events for that user, including soft-deleted records where `deleted_at` is non-null
2. WHEN a record exists only in the cloud, THE LWW_Merge SHALL convert its timestamps from ISO 8601 to Unix milliseconds and write it to local SQLite
3. WHEN a record exists only locally, THE LWW_Merge SHALL enqueue it to the Sync_Outbox for push to cloud
4. WHEN a record exists in both local and cloud with different `updated_at` timestamps and the cloud value is higher, THE LWW_Merge SHALL overwrite the local record with the cloud version (converting ISO 8601 timestamps to Unix milliseconds)
5. WHEN a record exists in both local and cloud with different `updated_at` timestamps and the local value is higher, THE LWW_Merge SHALL enqueue the local record to the Sync_Outbox for push to cloud
6. WHEN a record exists in both local and cloud with equal `updated_at` timestamps, THE LWW_Merge SHALL treat them as identical and take no action
7. WHEN the Initial_Pull writes Resources to local SQLite, THE App SHALL rebuild materialized paths from `parent_id` chains
8. WHEN the Initial_Pull completes successfully, THE App SHALL recalculate `cached_minutes` for all affected Resources and reload the projects store to reflect merged data in the UI
9. IF the Initial_Pull fails due to a network error or Supabase query error, THEN THE App SHALL leave local data unchanged, set sync status to error with the failure reason, and allow the user to retry via the Sync_Status_Modal
10. FOR ALL valid Resource objects, merging then serializing then merging again SHALL produce an equivalent result (idempotence property)

### Requirement 9: Row Level Security

**User Story:** As a user, I want my data to be isolated from other users on the shared Supabase backend, so that no one else can read or modify my records.

#### Acceptance Criteria

1. THE RLS policy on the `resources` table SHALL restrict all operations (SELECT, INSERT, UPDATE, DELETE) to rows where `user_id` equals `auth.uid()`
2. THE RLS policy on the `events` table SHALL restrict all operations (SELECT, INSERT, UPDATE, DELETE) to rows where `user_id` equals `auth.uid()`
3. WHEN a user queries the `resources` table, THE Supabase Postgres SHALL return only rows belonging to that user
4. WHEN a user attempts to insert a row with a different `user_id`, THE Supabase Postgres SHALL reject the operation

### Requirement 10: Sync Status UI

**User Story:** As a user, I want to see the current sync status at a glance, so that I know whether my data is backed up.

#### Acceptance Criteria

1. WHILE the Auth_Store state is `anonymous`, THE App SHALL not display the Sync_Status_Badge
2. WHILE the Auth_Store state is `authed` and the Sync_Outbox is empty and the last successful flush completion occurred within the previous 60 seconds, THE Sync_Status_Badge SHALL display "✓ Synced" with green styling
3. WHILE the Auth_Store state is `authed` and the Sync_Outbox contains one or more rows, THE Sync_Status_Badge SHALL display "● {N} pending" with amber styling, where N is the total number of rows in the Sync_Outbox
4. WHILE the Sync_Worker is actively flushing, THE Sync_Status_Badge SHALL display "Syncing…" with amber styling
5. IF one or more Sync_Outbox rows have a non-null `last_error` and the Sync_Worker is not actively flushing, THEN THE Sync_Status_Badge SHALL display "⚠ Error" with red styling
6. WHILE `navigator.onLine` is false, THE Sync_Status_Badge SHALL display "⏸ Offline"
7. WHEN the user clicks the Sync_Status_Badge, THE App SHALL open the Sync_Status_Modal
8. WHILE multiple badge display conditions are satisfied simultaneously, THE Sync_Status_Badge SHALL apply the following priority order (highest first): offline, syncing, error, pending, synced

### Requirement 11: Sync Error Management

**User Story:** As a user, I want to view and manage sync errors, so that I can retry or clear stuck items.

#### Acceptance Criteria

1. WHEN the Sync_Status_Modal opens, THE App SHALL display up to 20 Sync_Outbox rows that have a non-null `last_error`, ordered by descending `id`
2. THE Sync_Status_Modal SHALL display each error row with the entity type, entity_id, attempt count, and the `last_error` message
3. WHEN the user clicks "Retry now" in the Sync_Status_Modal, THE App SHALL set `next_retry_at` to null for all Sync_Outbox rows with a non-null `last_error` and trigger an immediate Sync_Worker tick
4. WHEN the user clicks "Clear outbox" in the Sync_Status_Modal, THE App SHALL prompt for confirmation before deleting all Sync_Outbox rows
5. IF the user cancels the confirmation prompt, THEN THE App SHALL leave the Sync_Outbox unchanged and keep the Sync_Status_Modal open
6. WHEN the outbox is cleared, THE Sync_Status_Badge SHALL update to reflect zero pending items and THE Sync_Status_Modal SHALL close

### Requirement 12: Auth Gate Header Integration

**User Story:** As a user, I want authentication controls integrated into the app header, so that I can sign in or manage my account without navigating away.

#### Acceptance Criteria

1. WHILE the Auth_Store state is `anonymous`, THE Auth_Gate SHALL display a "Sign in" button in the header navigation bar
2. WHILE the Auth_Store state is `authed`, THE Auth_Gate SHALL display the user's email truncated to a maximum of 30 characters with a dropdown menu containing a "Sign out" option
3. WHEN the user clicks "Sign in", THE Auth_Gate SHALL open the Auth_Modal
4. WHILE the Auth_Store state is `loading`, THE Auth_Gate SHALL display a spinner in place of the sign-in button or user email
5. WHEN the user clicks "Sign out" in the dropdown menu, THE Auth_Gate SHALL close the dropdown and invoke the Auth_Store sign-out action

### Requirement 13: Postgres Schema Compatibility

**User Story:** As a developer, I want the cloud schema to mirror the local schema with appropriate type conversions, so that data integrity is maintained across both stores.

#### Acceptance Criteria

1. THE Postgres `resources` table SHALL contain all columns from the local SQLite `resources` table plus a `user_id UUID NOT NULL` column referencing `auth.users(id)`
2. THE Postgres `events` table SHALL contain all columns from the local SQLite `events` table plus a `user_id UUID NOT NULL` column referencing `auth.users(id)`
3. THE Postgres schema SHALL use `TIMESTAMPTZ` for timestamp columns (`created_at`, `updated_at`, `deleted_at`) that are stored as `INTEGER` (Unix ms) in SQLite
4. THE Postgres schema SHALL use `DATE` for the `events.date` column that is stored as `TEXT` (ISO format) in SQLite
5. THE Postgres schema SHALL enforce referential integrity with `ON DELETE CASCADE` from `resources` to `auth.users` and from `events` to both `auth.users` and `resources`

### Requirement 14: Outbox Schema

**User Story:** As a developer, I want a well-defined local outbox table, so that the sync engine can reliably track and retry pending operations.

#### Acceptance Criteria

1. THE Sync_Outbox table SHALL have an auto-incrementing integer primary key column named `id`
2. THE Sync_Outbox table SHALL store `entity` as a TEXT column constrained to values `resource` or `event`
3. THE Sync_Outbox table SHALL store `op` as a TEXT column constrained to values `upsert` or `delete`
4. THE Sync_Outbox table SHALL store `entity_id` as a non-nullable TEXT column identifying the target row's UUID
5. THE Sync_Outbox table SHALL store `payload` as a non-nullable TEXT column containing the JSON-serialized post-mutation row snapshot
6. THE Sync_Outbox table SHALL store `enqueued_at` as a non-nullable INTEGER column containing the Unix millisecond timestamp of when the row was inserted
7. THE Sync_Outbox table SHALL store `attempts` as an INTEGER defaulting to 0, `last_error` as nullable TEXT, and `next_retry_at` as a nullable INTEGER storing a Unix millisecond timestamp
8. THE Sync_Outbox table SHALL have an index on `next_retry_at` to support querying rows where `next_retry_at IS NULL OR next_retry_at <= now`

### Requirement 15: Worker Lifecycle Management

**User Story:** As a user, I want the sync worker to start and stop automatically based on my auth state, so that resources are not wasted when I am not logged in.

#### Acceptance Criteria

1. WHEN the Auth_Store transitions from non-`authed` to `authed`, THE App SHALL start the Sync_Worker interval, register the visibility-change tick listener, and trigger an immediate tick
2. WHEN the Auth_Store transitions from `authed` to non-`authed`, THE App SHALL clear the Sync_Worker interval, remove the visibility-change tick listener, and allow any in-flight flush to complete without initiating new flushes
3. WHEN the Sync_Worker is already running and a start is requested, THE App SHALL keep the existing worker instance and not create a duplicate interval
4. IF the Auth_Store transitions from `authed` to non-`authed` while a flush is in progress, THEN THE App SHALL allow the current flush batch to finish and then not process further batches until the worker is restarted
