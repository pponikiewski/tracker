# Implementation Plan: Faza 6 — Team Features

## Overview

Implement team collaboration capabilities on top of the Phase 5 workspace foundation. The work is organized into six areas: schema migration, profile service + UI, avatar service, assignment service + UI, team analytics view, and assignment-scoped filtering. All code is TypeScript/React following the existing layered architecture (service layer → Zustand stores → React components).

## Tasks

- [ ] 1. Extend SQLite schema for Phase 6 (assignments + profiles_cache)
  - [ ] 1.1 Add `SCHEMA_V6_SQL` constant to `src/lib/db/schema.ts`
    - Define `assignments` table with all required columns and indexes
    - Define `profiles_cache` table
    - Recreate `sync_outbox` with extended `entity` CHECK constraint using CREATE-INSERT-DROP-RENAME pattern
    - _Requirements: 10.1, 10.2_
  - [ ] 1.2 Add `runPhase6Migration` to `src/lib/db/connection.ts`
    - Check for `assignments` table existence via `PRAGMA table_info('assignments')` before executing
    - Call `runPhase6Migration` from the existing DB initialization flow
    - _Requirements: 10.6, 10.7_
  - [ ]* 1.3 Write unit tests for `SCHEMA_V6_SQL` migration
    - Verify idempotency (running twice does not error or duplicate data)
    - Verify existing Phase 5 rows in `workspaces`, `workspace_memberships`, `resources`, `events` are preserved
    - Verify `sync_outbox` accepts `'assignment'` as entity value after migration
    - _Requirements: 10.6, 10.7, 8.1_

- [ ] 2. Add TypeScript types for Phase 6 entities
  - [ ] 2.1 Extend `src/lib/db/types.ts` with `Assignment`, `CachedProfile`, and updated `Entity` union
    - Add `Assignment` interface with all fields matching the SQLite schema
    - Add `CachedProfile` interface
    - Extend `Entity` type to include `'assignment'`
    - _Requirements: 8.1, 10.1_
  - [ ]* 2.2 Write property test for Assignment JSON round-trip
    - **Property 9: Assignment JSON round-trip is lossless**
    - **Validates: Requirements 8.6**
    - _Requirements: 8.6_

- [ ] 3. Implement ProfileService
  - [ ] 3.1 Create `src/lib/profile/profileService.ts` with all exported functions
    - Implement `validateDisplayName` — trims input, throws on empty or > 80 chars
    - Implement `upsertProfile` — upserts to Supabase `profiles` table and writes to local `profiles_cache`
    - Implement `fetchAndCacheProfiles` — fetches from Supabase for given user IDs, writes to `profiles_cache`
    - Implement `getCachedProfiles` — reads from local `profiles_cache` only (offline-safe)
    - Implement `ensureProfile` — creates profile with email prefix as default display name on first login
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_
  - [ ]* 3.2 Write property test for `validateDisplayName` — valid inputs accepted
    - **Property 1: Valid display names are accepted and stored trimmed**
    - **Validates: Requirements 1.2**
    - _Requirements: 1.2_
  - [ ]* 3.3 Write property test for `validateDisplayName` — invalid inputs rejected
    - **Property 2: Invalid display names are rejected with a specific error**
    - **Validates: Requirements 1.3**
    - _Requirements: 1.3_
  - [ ]* 3.4 Write unit tests for `ProfileService`
    - Test boundary values for `validateDisplayName` (length 0, 1, 80, 81, whitespace-only, leading/trailing whitespace)
    - Test `ensureProfile` creates profile with email prefix default
    - Test `getCachedProfiles` returns cached data when offline
    - _Requirements: 1.2, 1.3, 1.4_

- [ ] 4. Implement AvatarService
  - [ ] 4.1 Create `src/lib/profile/avatarService.ts` with all exported functions
    - Implement `validateAvatarFile` — throws on invalid MIME type (with format name in message), > 256 KB, or > 2048px dimensions
    - Implement `uploadAvatar` — validates, uploads to Supabase Storage `avatars` bucket, deletes old file (non-fatal on failure), updates `profiles.avatar_url` and local cache; returns new URL
    - Implement `getInitials` — returns up to 2 uppercase chars (first letter of first word + first letter of last word)
    - Implement `getAvatarColor` — deterministic hex color derived from `user_id` hash
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [ ]* 4.2 Write property test for `validateAvatarFile` — invalid MIME types rejected
    - **Property 3: Avatar validation rejects invalid MIME types with the format named**
    - **Validates: Requirements 2.2**
    - _Requirements: 2.2_
  - [ ]* 4.3 Write property test for `getInitials` — deterministic and at most 2 characters
    - **Property 4: Fallback initials are deterministic and at most 2 characters**
    - **Validates: Requirements 2.6**
    - _Requirements: 2.6_
  - [ ]* 4.4 Write property test for `getAvatarColor` — deterministic
    - **Property 5: Fallback avatar color is deterministic**
    - **Validates: Requirements 2.6**
    - _Requirements: 2.6_
  - [ ]* 4.5 Write unit tests for `AvatarService`
    - Test each invalid MIME type, exact 256 KB boundary, exact 2048px boundary
    - Test `getInitials` with single word, two words, many words, unicode names
    - Test `getAvatarColor` returns valid hex color string
    - _Requirements: 2.2, 2.3, 2.4, 2.6_

- [ ] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement AssignmentService
  - [ ] 6.1 Create `src/lib/assignments/assignmentService.ts` with all exported functions
    - Implement `createAssignment` — idempotent; validates workspace membership; writes to SQLite and enqueues outbox entry in same transaction; throws for Local_Personal_Workspace
    - Implement `removeAssignment` — idempotent; soft-deletes; writes to SQLite and enqueues outbox entry in same transaction; throws for Local_Personal_Workspace
    - Implement `listAssignments` — returns all active assignments for a workspace from local SQLite
    - Implement `softDeleteAssignmentsForResource` — soft-deletes all assignments for a resource within a provided transaction
    - Implement `softDeleteAssignmentsForUser` — soft-deletes all assignments for a user in a workspace
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 9.1, 9.5_
  - [ ]* 6.2 Write property test for `createAssignment` — idempotent
    - **Property 6: Assignment creation is idempotent**
    - **Validates: Requirements 5.2**
    - _Requirements: 5.2_
  - [ ]* 6.3 Write property test for `removeAssignment` — idempotent
    - **Property 7: Assignment removal is idempotent**
    - **Validates: Requirements 5.3**
    - _Requirements: 5.3_
  - [ ]* 6.4 Write property test for non-member assignment rejection
    - **Property 8: Non-members cannot be assigned**
    - **Validates: Requirements 5.4**
    - _Requirements: 5.4_
  - [ ]* 6.5 Write unit tests for `AssignmentService`
    - Test non-member rejection error message
    - Test Local_Personal_Workspace rejection
    - Test `softDeleteAssignmentsForResource` cascades correctly
    - Test `softDeleteAssignmentsForUser` on membership removal
    - _Requirements: 5.4, 5.5, 5.7, 9.5_

- [ ] 7. Implement sync support for assignments
  - [ ] 7.1 Add `mapAssignmentToCloud` to the sync layer (`src/lib/sync/`)
    - Convert `created_at`, `updated_at`, `deleted_at` from Unix epoch ms to ISO 8601 strings
    - Handle `null` `deleted_at` correctly
    - _Requirements: 8.3_
  - [ ]* 7.2 Write property test for `mapAssignmentToCloud` — valid ISO 8601 output
    - **Property 10: Assignment timestamp mapping produces valid ISO 8601 strings**
    - **Validates: Requirements 8.3**
    - _Requirements: 8.3_
  - [ ] 7.3 Extend the sync worker to flush `assignment` outbox entries
    - Add `'assignment'` case to the outbox flush switch/dispatch in `src/lib/sync/worker.ts`
    - Push upserts to Supabase `assignments` table using `mapAssignmentToCloud`
    - Follow existing retry/backoff pattern; skip invalid rows with `bumpRetry`
    - _Requirements: 8.2, 8.3_
  - [ ] 7.4 Extend the initial pull to fetch and merge assignment records
    - Fetch `assignments` from Supabase for all member workspaces in `src/lib/sync/pull.ts`
    - Merge into local SQLite using LWW algorithm keyed on `(resource_id, user_id)` with `updated_at` as tiebreaker; local wins on equal `updated_at`
    - _Requirements: 8.4, 9.4_
  - [ ]* 7.5 Write unit tests for assignment sync
    - Test `mapAssignmentToCloud` null `deleted_at` handling
    - Test LWW merge: remote wins when `updated_at` is greater; local wins on equal `updated_at`
    - _Requirements: 8.3, 8.4, 9.4_

- [ ] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Create Zustand stores for profiles and assignments
  - [ ] 9.1 Create `src/store/profile.ts` implementing `ProfileState`
    - Implement `fetchProfiles`, `updateDisplayName`, `uploadAvatar`, `getProfile` actions
    - Wire to `ProfileService` and `AvatarService`
    - `getProfile` returns a fallback `CachedProfile` (email prefix + null avatar) when not found
    - _Requirements: 1.6, 2.8, 3.4_
  - [ ] 9.2 Create `src/store/assignments.ts` implementing `AssignmentState`
    - Implement `loadAssignments`, `assign`, `unassign`, `getAssignees` actions
    - Wire to `AssignmentService`
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ]* 9.3 Write unit tests for `profileStore` and `assignmentStore`
    - Test `getProfile` fallback when profile not in cache
    - Test `assign`/`unassign` update `assignmentsByResource` correctly
    - _Requirements: 1.6, 5.2, 5.3_

- [ ] 10. Build shared `AvatarBadge` component
  - [ ] 10.1 Create `src/components/Profile/AvatarBadge.tsx`
    - Render `<img>` when `avatarUrl` is set; render initials badge otherwise
    - Support `size` prop: `'xs' | 'sm' | 'md'` (default `'sm'`)
    - Use `getInitials` and `getAvatarColor` from `AvatarService` for fallback rendering
    - _Requirements: 2.6, 4.1, 5.9_

- [ ] 11. Build `ProfileSettingsPanel` component
  - [ ] 11.1 Create `src/components/Profile/ProfileSettingsPanel.tsx`
    - Display name text field pre-populated with current value; inline validation error before network request
    - Avatar display (`AvatarBadge`) with file upload control; client-side validation before upload
    - Loading indicator + disabled upload control during upload; success confirmation for ≥ 3 s; inline error on failure
    - Show cached data when offline; show email prefix + fallback initials when no cache
    - Wire to `profileStore`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 9.3_
  - [ ] 11.2 Add "Profile" button to `src/components/Auth/AuthGate.tsx` for authenticated users
    - Opens `ProfileSettingsPanel` (slide-in panel pattern matching `WorkspaceSettingsPanel`)
    - _Requirements: 3.1_

- [ ] 12. Update `WorkspaceSettingsPanel` with member identity
  - [ ] 12.1 Modify `src/components/Workspace/WorkspaceSettingsPanel.tsx`
    - Replace raw `user_id` display with `AvatarBadge` + `display_name` in member list
    - Show loading skeleton/spinner while profiles are being fetched
    - Fall back to `user_id` + fallback initials if profile fetch fails
    - Show inviter's `display_name` (not UUID) in pending invites list; fall back to user ID
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 13. Add assignee avatars to `TreeNode` and context menu assignment picker
  - [ ] 13.1 Modify `src/components/Tree/TreeNode.tsx`
    - Render up to 3 `AvatarBadge` components inline for resources with assignees
    - Render "+N" overflow count badge when more than 3 assignees
    - Read assignees from `assignmentStore.getAssignees`
    - _Requirements: 5.9_
  - [ ] 13.2 Create `src/components/Assignments/AssignmentPicker.tsx`
    - Dropdown/popover listing all workspace members with checkboxes showing current assignment status
    - Toggle assignment on checkbox click (calls `assignmentStore.assign` / `assignmentStore.unassign`)
    - _Requirements: 5.10, 5.11_
  - [ ] 13.3 Modify `src/components/ContextMenu.tsx`
    - Add "Assign members" menu item that opens `AssignmentPicker`
    - _Requirements: 5.10_

- [ ] 14. Build `TeamView` component and `computeMemberRows` logic
  - [ ] 14.1 Create `src/lib/analytics/teamAnalytics.ts` with `computeMemberRows` function
    - Query `events JOIN workspace_memberships` from local SQLite for the active workspace and date range
    - Aggregate total minutes per member; include members with 0 minutes
    - Sort rows descending by `totalMinutes`
    - Compute per-top-level-project breakdown per member
    - _Requirements: 6.2, 6.5, 6.7, 6.8_
  - [ ]* 14.2 Write property test for `computeMemberRows` — sorted descending by total minutes
    - **Property 11: Team_View member rows are sorted descending by total minutes**
    - **Validates: Requirements 6.5**
    - _Requirements: 6.5_
  - [ ] 14.3 Create `src/components/Team/TeamView.tsx`
    - Date range selector with Today / This Week / This Month / Custom Range presets (reuse `DateRangePicker` pattern)
    - One `MemberRow` per workspace member with `AvatarBadge`, display name, total minutes
    - Expandable per-project breakdown per member
    - Reload on workspace change; display "0 min" for members with no events
    - Wire to `computeMemberRows` and `profileStore`
    - _Requirements: 6.2, 6.3, 6.4, 6.6, 6.8, 6.9_

- [ ] 15. Add assignment filter to `ProjectsView` and wire Team tab in `App.tsx`
  - [ ] 15.1 Modify `src/components/ProjectsView.tsx`
    - Add filter control (hidden for Local_Personal_Workspace) with options: "All members", "Assigned to me", named members
    - Filter tree to show only matching resources + ancestor nodes (ancestors at 0.5 opacity)
    - Show empty-state message when no resources match
    - Reset filter to "All members" on workspace change (component state only)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ] 15.2 Modify `src/App.tsx`
    - Add "Team" tab conditionally shown when active workspace has > 1 member
    - Render `TeamView` when Team tab is active
    - _Requirements: 6.1, 9.5_
  - [ ]* 15.3 Write property test for Team tab visibility
    - **Property 12: Team tab visibility matches workspace member count**
    - **Validates: Requirements 6.1**
    - _Requirements: 6.1_

- [ ] 16. Call `ensureProfile` on login and load assignments on workspace activation
  - [ ] 16.1 Modify `src/store/auth.ts` to call `ensureProfile` after successful login
    - Pass `userId` and `email` to `ensureProfile`
    - _Requirements: 1.4_
  - [ ] 16.2 Modify `src/store/workspace.ts` to call `assignmentStore.loadAssignments` and `profileStore.fetchProfiles` when the active workspace changes
    - Fetch profiles for all workspace members
    - Load all assignments for the workspace
    - _Requirements: 4.2, 5.1, 6.9_

- [ ] 17. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (Properties 1–12 from the design document)
- Unit tests validate specific examples and edge cases
- All assignment operations must be transactional (SQLite write + outbox enqueue in one transaction)
- Profile writes go directly to Supabase (not through the outbox); avatar uploads go to Supabase Storage
- Local_Personal_Workspace must be excluded from all team features at the service layer

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["1.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "4.5", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "6.4", "6.5", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3"] },
    { "id": 7, "tasks": ["7.4", "7.5"] },
    { "id": 8, "tasks": ["9.1", "9.2"] },
    { "id": 9, "tasks": ["9.3", "10.1"] },
    { "id": 10, "tasks": ["11.1", "14.1"] },
    { "id": 11, "tasks": ["11.2", "12.1", "13.1", "14.2", "14.3"] },
    { "id": 12, "tasks": ["13.2", "15.1", "16.1", "16.2"] },
    { "id": 13, "tasks": ["13.3", "15.2"] },
    { "id": 14, "tasks": ["15.3"] }
  ]
}
```
