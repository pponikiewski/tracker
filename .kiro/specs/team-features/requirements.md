# Requirements Document

## Introduction

This document defines the requirements for **Faza 6 — Team Features** of the Tracker desktop application. The application is a Tauri + React desktop time tracker with a local SQLite database and optional Supabase cloud sync. Phase 5 established the multi-tenant workspace model with workspaces, memberships, and invite flows. Phase 6 builds on that foundation to enable meaningful team collaboration: assigning resources (projects, stages, tasks) to specific workspace members, displaying member identity (display names and avatars), and providing team-level analytics so workspace owners and members can see aggregated time data across the team.

The feature targets authenticated users who belong to shared workspaces. Anonymous (local-only) users are unaffected — all team features are gated behind authentication and workspace membership.

## Glossary

- **Workspace**: A named container that groups resources, events, and members. Defined in Phase 5.
- **Member**: An authenticated user who belongs to a workspace via a `workspace_memberships` row. Has role `owner` or `member`.
- **Owner**: The workspace member with role `owner`. Has full administrative rights over the workspace.
- **Assignment**: A record linking a resource (project, stage, substage, or task) to one or more workspace members who are responsible for it.
- **Assignee**: A workspace member who has been assigned to a resource.
- **Display_Name**: A human-readable name chosen by a user to identify themselves within the application (e.g. "Alice Smith"). Stored in a `profiles` table in Supabase.
- **Avatar**: A small image (≤ 256 KB, JPEG/PNG/WebP) uploaded by a user to represent themselves visually.
- **Avatar_URL**: A public URL pointing to a user's avatar image, stored in the `profiles` table and served from Supabase Storage.
- **Profile**: A record in the `profiles` table containing a user's `display_name` and `avatar_url`, keyed by `user_id`.
- **Team_View**: A dedicated UI panel that shows time tracking data aggregated across all members of the active workspace.
- **Member_Row**: A single row in the Team_View representing one workspace member's aggregated time data for a selected date range.
- **Local_Personal_Workspace**: The anonymous-mode workspace stored only in SQLite, never synced. Unaffected by team features.
- **Sync_Worker**: The existing outbox-based background worker that pushes local mutations to Supabase.
- **RLS**: Row-Level Security policies in Postgres/Supabase that restrict data access to authorized users.

---

## Requirements

### Requirement 1: User Profile — Display Name

**User Story:** As a workspace member, I want to set a display name for my account, so that other team members can identify me by name rather than by a raw UUID or email address.

#### Acceptance Criteria

1. THE Profile_Service SHALL store a `display_name` (1–80 characters, measured after trimming leading and trailing whitespace) for each authenticated user in a `profiles` table in Supabase.
2. WHEN an authenticated user submits a display name whose trimmed length is between 1 and 80 characters (inclusive), THE Profile_Service SHALL persist the trimmed display name and return a success response.
3. IF an authenticated user submits a display name whose trimmed length is 0 or exceeds 80 characters, THEN THE Profile_Service SHALL reject the update and return an error message that identifies which rule was violated (empty or too long).
4. WHEN an authenticated user logs in for the first time and no profile record exists, THE Profile_Service SHALL create a profile record with a `display_name` defaulting to the user's email address prefix (the portion before `@`).
5. THE Profile_Service SHALL allow any authenticated member of the active workspace to read the `display_name` of every other member of that same workspace; access to profiles of users outside the member's workspaces SHALL be denied at the RLS layer.
6. WHEN a user updates their display name, THE WorkspaceSwitcher and WorkspaceSettingsPanel SHALL reflect the updated name without requiring a full page reload.
7. IF the Profile_Service fails to persist a display name update due to a network or server error, THEN THE Profile_Service SHALL return an error response and THE Profile_Settings_Panel SHALL display an error message indicating the save failed.

---

### Requirement 2: User Profile — Avatar

**User Story:** As a workspace member, I want to upload a profile avatar, so that my teammates can visually recognize me in the team view and member lists.

#### Acceptance Criteria

1. WHEN an authenticated user uploads an image file that is JPEG, PNG, or WebP, is at most 256 KB in size, and has dimensions no greater than 2048×2048 pixels, THE Avatar_Service SHALL store the image in Supabase Storage and update the user's `avatar_url` in the `profiles` table.
2. IF an authenticated user uploads a file whose MIME type is not `image/jpeg`, `image/png`, or `image/webp`, THEN THE Avatar_Service SHALL reject the upload and return an error message that names the unsupported format.
3. IF an authenticated user uploads a file that exceeds 256 KB, THEN THE Avatar_Service SHALL reject the upload and return an error message stating the 256 KB size limit.
4. IF an authenticated user uploads an image whose width or height exceeds 2048 pixels, THEN THE Avatar_Service SHALL reject the upload and return an error message stating the 2048×2048 pixel dimension limit.
5. WHEN an avatar is successfully uploaded, THE Avatar_Service SHALL delete the user's previously stored avatar file from Supabase Storage (if one exists) and replace the `avatar_url` in the `profiles` table with the new URL (one avatar per user).
6. WHERE a user has not uploaded an avatar, THE UI SHALL display a deterministic fallback avatar consisting of the user's initials (up to two characters: first letter of the first word and first letter of the last word of the display name, uppercased) rendered on a background color derived by hashing the user's `user_id`.
7. THE Avatar_Service SHALL serve avatar images via a public URL that is accessible without authentication.
8. WHEN a user's `avatar_url` changes, THE Team_View and WorkspaceSettingsPanel SHALL display the updated avatar within 5 seconds of the profile update completing, without requiring a full page reload.

---

### Requirement 3: Profile Settings UI

**User Story:** As a workspace member, I want a dedicated profile settings screen, so that I can update my display name and avatar in one place.

#### Acceptance Criteria

1. THE Profile_Settings_Panel SHALL be accessible from the application header for any authenticated user.
2. THE Profile_Settings_Panel SHALL display the current display name in an editable text field pre-populated with the user's existing display name.
3. THE Profile_Settings_Panel SHALL display the current avatar (or fallback initials) with a file upload control.
4. WHEN a user submits a valid display name change (1–80 characters after trimming), THE Profile_Settings_Panel SHALL show a success confirmation message for at least 3 seconds and update the displayed name without requiring a full page reload.
5. IF a display name submission fails client-side validation (empty or exceeds 80 characters), THEN THE Profile_Settings_Panel SHALL display an inline error message adjacent to the input field before any network request is made.
6. WHEN a user selects a file for avatar upload, THE Profile_Settings_Panel SHALL validate the file type (JPEG, PNG, or WebP) and size (≤ 256 KB) client-side before initiating the upload, and SHALL display an inline error message if validation fails.
7. WHILE an avatar upload is in progress, THE Profile_Settings_Panel SHALL display a loading indicator on the upload control and disable the upload control to prevent concurrent uploads.
8. WHEN an avatar upload completes successfully, THE Profile_Settings_Panel SHALL immediately display the newly uploaded avatar in place of the previous avatar or fallback.
9. IF an avatar upload fails due to a server or network error, THEN THE Profile_Settings_Panel SHALL display an inline error message and re-enable the upload control.

---

### Requirement 4: Member Identity in Workspace Settings

**User Story:** As a workspace owner, I want to see display names and avatars for all workspace members, so that I can manage the team without needing to know raw user IDs.

#### Acceptance Criteria

1. THE WorkspaceSettingsPanel SHALL display each member's avatar (or fallback initials) and display name alongside their role badge in the member list.
2. WHEN the WorkspaceSettingsPanel loads, THE WorkspaceSettingsPanel SHALL fetch the `display_name` and `avatar_url` for all members of the workspace and display them within the member list.
3. WHILE profile data is being fetched, THE WorkspaceSettingsPanel SHALL display a loading skeleton or spinner in place of each member's avatar and display name.
4. IF the `display_name` or `avatar_url` for a member cannot be fetched, THEN THE WorkspaceSettingsPanel SHALL display the member's user ID as a fallback identifier and the fallback initials avatar.
5. THE WorkspaceSettingsPanel SHALL display the inviter's display name (not raw UUID) in the pending invites list; IF the inviter's profile cannot be fetched, THEN the inviter's user ID SHALL be shown as a fallback.

---

### Requirement 5: Resource Assignments

**User Story:** As a workspace owner or member, I want to assign workspace members to resources (projects, stages, tasks), so that the team knows who is responsible for each piece of work.

#### Acceptance Criteria

1. THE Assignment_Service SHALL allow any workspace member to assign one or more members of the same workspace to any resource within that workspace.
2. WHEN a workspace member assigns another member to a resource and no assignment record already exists for that (resource_id, user_id) pair, THE Assignment_Service SHALL create an `assignment` record linking the resource ID to the assignee's user ID; IF the assignment already exists, THE Assignment_Service SHALL treat the operation as a no-op and return success.
3. WHEN a workspace member removes an assignment that exists, THE Assignment_Service SHALL delete the corresponding `assignment` record; IF the assignment does not exist, THE Assignment_Service SHALL treat the operation as a no-op and return success.
4. IF a user attempts to assign a non-member of the workspace to a resource, THEN THE Assignment_Service SHALL reject the assignment and return an error indicating the user is not a workspace member.
5. WHEN a user's workspace membership is removed, THE Assignment_Service SHALL soft-delete all assignment records for that user within that workspace.
6. THE Assignment_Service SHALL allow a resource to have zero or more assignees (no upper limit enforced at the data layer).
7. WHEN a resource is soft-deleted, THE Assignment_Service SHALL soft-delete all assignment records for that resource within the same SQLite transaction.
8. THE Assignment_Service SHALL sync assignment records to Supabase via the existing outbox mechanism.
9. THE Resource_Tree SHALL display the avatars (or fallback initials) of the first three assignees inline on each resource row that has at least one assignee; IF a resource has more than three assignees, THE Resource_Tree SHALL display a count badge (e.g., "+2") after the third avatar.
10. WHEN a user right-clicks a resource in the tree, THE Context_Menu SHALL include an "Assign members" option that opens an assignment picker.
11. THE Assignment_Picker SHALL list all current workspace members with checkboxes indicating current assignment status, and SHALL allow the user to toggle assignments by clicking a checkbox.

---

### Requirement 6: Team Analytics View

**User Story:** As a workspace owner or member, I want to see a team-level analytics view showing how much time each member has logged, so that I can understand team workload and progress.

#### Acceptance Criteria

1. IF the active workspace has more than one member, THEN THE application header SHALL display a "Team" navigation tab that opens the Team_View; IF the active workspace has exactly one member, THEN the "Team" tab SHALL be hidden.
2. THE Team_View SHALL display one Member_Row per workspace member, showing the member's avatar (or fallback initials), display name, and total minutes logged within the selected date range.
3. THE Team_View SHALL include a date range selector with the presets: Today, This Week, This Month, and Custom Range (matching the existing Dashboard date range selector component).
4. WHEN the date range changes, THE Team_View SHALL recompute and re-render all Member_Rows without requiring a full page reload.
5. THE Team_View SHALL sort Member_Rows in descending order of total minutes logged by default.
6. WHEN a user clicks the expand control on a Member_Row, THE Team_View SHALL display a breakdown of time per top-level project for that member within the selected date range.
7. THE Team_View SHALL read time event data from the local SQLite `events` table, attributing events to members by matching `events.user_id` to `workspace_memberships.user_id`; it SHALL NOT require a live Supabase connection to render.
8. IF no time events exist for a member within the selected date range, THEN THE Team_View SHALL display "0 min" for that member rather than omitting the row.
9. WHEN the active workspace changes, THE Team_View SHALL reload member data and time aggregates for the new workspace.

---

### Requirement 7: Assignment-Scoped Filtering in Projects View

**User Story:** As a workspace member, I want to filter the projects tree to show only resources assigned to me (or to a selected member), so that I can focus on my own work.

#### Acceptance Criteria

1. IF the active workspace is not the Local_Personal_Workspace, THEN THE Projects_View SHALL display a filter control that allows the user to select "All members", "Assigned to me", or a specific named member from the active workspace's member list; IF the active workspace is the Local_Personal_Workspace, THEN the filter control SHALL be hidden.
2. WHEN "Assigned to me" is selected, THE Projects_View SHALL display only resources that have the current user as an assignee, along with their ancestor nodes (to preserve tree structure).
3. WHEN a specific named member is selected, THE Projects_View SHALL display only resources assigned to that member, along with their ancestor nodes.
4. WHEN "All members" is selected, THE Projects_View SHALL display all resources as before (no assignment filter applied).
5. THE assignment filter selection SHALL be stored in component state only (not in localStorage); WHEN the active workspace changes, THE assignment filter SHALL reset to "All members".
6. WHEN the assignment filter is active and a resource node has no assignees matching the filter but has at least one matching descendant, THE Projects_View SHALL show that ancestor node with reduced opacity (0.5) to visually distinguish it from directly matched nodes.
7. IF the assignment filter is active and no resources in the tree match the filter, THEN THE Projects_View SHALL display an empty-state message (e.g., "No resources assigned to [member name]") instead of an empty tree.

---

### Requirement 8: Assignment Sync

**User Story:** As a workspace member, I want assignment data to sync to the cloud so that all team members see consistent assignment information across devices.

#### Acceptance Criteria

1. THE Sync_Worker SHALL include `assignment` as a recognized outbox entity type; THE `sync_outbox` table's `entity` CHECK constraint SHALL be extended to include `'assignment'` alongside `'resource'`, `'event'`, `'workspace'`, and `'workspace_membership'`.
2. WHEN an assignment is created or soft-deleted, THE Assignment_Service SHALL enqueue the operation in the `sync_outbox` table within the same SQLite transaction as the local write, with `op = 'upsert'` for both create and soft-delete (using the `deleted_at` field to signal deletion).
3. THE Sync_Worker SHALL push assignment upserts to the `assignments` table in Supabase using the existing outbox flush mechanism, converting `created_at`, `updated_at`, and `deleted_at` from Unix epoch milliseconds to ISO 8601 strings before sending.
4. THE Initial_Pull SHALL fetch assignment records from Supabase for all workspaces the user is a member of, and SHALL merge them into the local SQLite `assignments` table using the existing LWW merge algorithm keyed on `(resource_id, user_id)` with `updated_at` as the winning timestamp.
5. THE `assignments` table in Supabase SHALL have RLS enabled with a policy that permits read and write access only to users who are current members of the assignment's `workspace_id` (verified via the existing `is_workspace_member` function).
6. FOR ALL valid assignment records `a`, serializing `a` to JSON and deserializing the result SHALL produce a record that is field-for-field equivalent to `a` (round-trip property).

---

### Requirement 9: Data Integrity and Offline Behavior

**User Story:** As a workspace member, I want team features to work correctly even when I am offline, so that I can continue tracking time and viewing assignments without an internet connection.

#### Acceptance Criteria

1. WHILE the application is offline, THE Assignment_Service SHALL allow creating and removing assignments locally, and SHALL enqueue the operations in the `sync_outbox` for later sync.
2. WHILE the application is offline, THE Team_View SHALL render Member_Rows using data from the local SQLite database, displaying the same content as when online.
3. WHILE the application is offline, THE Profile_Settings_Panel SHALL display the locally cached `display_name` and `avatar_url` from the local `profiles` cache; IF no cached profile exists, THE Profile_Settings_Panel SHALL display the user's email address prefix as the display name and the fallback initials avatar.
4. IF a sync conflict occurs between a local assignment change and a remote assignment change for the same `(resource_id, user_id)` pair, THEN THE Sync_Worker SHALL retain the record with the greater `updated_at` value; IF both records have equal `updated_at` values, THEN THE Sync_Worker SHALL retain the local record (no-op on the remote value).
5. IF the active workspace is the Local_Personal_Workspace, THEN THE Assignment_Service SHALL reject all assignment create and remove operations with an error, and THE Team_View tab and assignment filter control SHALL be hidden from the UI.

---

### Requirement 10: Schema and Migration

**User Story:** As a developer, I want the database schema to be extended cleanly for team features, so that existing data is preserved and the migration is safe to apply.

#### Acceptance Criteria

1. THE SQLite schema SHALL be extended with an `assignments` table containing `id` (TEXT PRIMARY KEY), `resource_id` (TEXT NOT NULL), `user_id` (TEXT NOT NULL), `workspace_id` (TEXT NOT NULL), `created_at` (INTEGER NOT NULL), `updated_at` (INTEGER NOT NULL), and `deleted_at` (INTEGER) columns, applied as a new constant `SCHEMA_V6_SQL` in `schema.ts`.
2. THE `SCHEMA_V6_SQL` migration SHALL also recreate the `sync_outbox` table to extend its `entity` CHECK constraint to include `'assignment'`, following the same CREATE-INSERT-DROP-RENAME pattern used in `SCHEMA_V5_SQL`.
3. THE Postgres schema SHALL be extended with an `assignments` table (columns: `id UUID PRIMARY KEY`, `resource_id UUID NOT NULL`, `user_id UUID NOT NULL`, `workspace_id UUID NOT NULL`, `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`, `deleted_at TIMESTAMPTZ`) and a `profiles` table (columns: `user_id UUID PRIMARY KEY`, `display_name TEXT NOT NULL`, `avatar_url TEXT`, `updated_at TIMESTAMPTZ NOT NULL`) via a new migration file.
4. THE `assignments` table in Postgres SHALL have RLS enabled with a policy that permits SELECT, INSERT, UPDATE, and DELETE only to users for whom `is_workspace_member(workspace_id, auth.uid())` returns true.
5. THE `profiles` table in Postgres SHALL have RLS enabled with: (a) a write policy permitting INSERT and UPDATE only when `auth.uid() = user_id`; (b) a read policy permitting SELECT when the reading user shares at least one workspace with the profile owner (verified via `is_workspace_member`).
6. THE SQLite migration SHALL be applied idempotently by checking for the existence of the `assignments` table using `PRAGMA table_info('assignments')` in `connection.ts` before executing `SCHEMA_V6_SQL`, consistent with the `runPhase5Migration` pattern.
7. WHEN the migration is applied to a database that already contains Phase 5 data, THE migration SHALL preserve all existing rows in the `workspaces`, `workspace_memberships`, `resources`, and `events` tables without modification.
