# Design Document — Faza 6: Team Features

## Overview

Phase 6 adds team collaboration capabilities to the Tracker desktop application on top of the multi-tenant workspace foundation established in Phase 5. The feature set covers four areas:

1. **User profiles** — display names and avatars stored in Supabase, cached locally, shown throughout the UI.
2. **Resource assignments** — linking workspace members to projects/stages/tasks, synced via the existing outbox mechanism.
3. **Team analytics view** — a new "Team" tab showing per-member time aggregates read from local SQLite.
4. **Assignment-scoped filtering** — a filter control in the Projects view to narrow the tree to resources assigned to a specific member.

All team features are gated behind authentication and workspace membership. The Local_Personal_Workspace (anonymous mode) is unaffected.

---

## Architecture

The feature follows the existing layered architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  React UI (components)                                       │
│  ProfileSettingsPanel · TeamView · AssignmentPicker          │
│  TreeNode (assignee avatars) · ProjectsView (filter)         │
└────────────────────┬────────────────────────────────────────┘
                     │ Zustand stores
┌────────────────────▼────────────────────────────────────────┐
│  profileStore  ·  assignmentStore  ·  (existing stores)      │
└────────────────────┬────────────────────────────────────────┘
                     │ service layer
┌────────────────────▼────────────────────────────────────────┐
│  ProfileService  ·  AvatarService  ·  AssignmentService      │
│  (pure TS, no React)                                         │
└──────┬─────────────────────────────────────┬────────────────┘
       │ SQLite (tauri-plugin-sql)            │ Supabase JS client
┌──────▼──────────┐                 ┌────────▼────────────────┐
│  Local SQLite   │◄── outbox sync ─►│  Supabase Postgres      │
│  assignments    │                 │  assignments · profiles  │
│  profiles cache │                 │  (RLS enforced)          │
└─────────────────┘                 └─────────────────────────┘
```

Key architectural decisions:

- **Profiles are Supabase-primary, locally cached.** The `profiles` table lives in Supabase. A local `profiles_cache` table in SQLite stores the last-fetched `display_name` and `avatar_url` per `user_id` for offline use. Profile writes go directly to Supabase (not through the outbox) because they are user-owned and not workspace-scoped.
- **Assignments follow the existing outbox pattern.** Create/soft-delete operations write to SQLite first, then enqueue an `'assignment'` outbox entry. The sync worker flushes them to Supabase using the same `mapToCloud` timestamp conversion.
- **Team analytics are read-only from local SQLite.** The Team_View queries `events JOIN workspace_memberships` locally, requiring no live Supabase connection.
- **Avatar uploads go directly to Supabase Storage.** The AvatarService validates client-side, uploads to a public bucket, then updates `profiles.avatar_url` in Supabase and the local cache.

---

## Components and Interfaces

### New Zustand Stores

#### `profileStore` (`src/store/profile.ts`)

```typescript
interface ProfileState {
  // Keyed by user_id
  profiles: Record<string, CachedProfile>;
  loading: boolean;
  error: string | null;

  // Fetch profiles for all members of the active workspace
  fetchProfiles: (userIds: string[]) => Promise<void>;
  // Update the current user's display name
  updateDisplayName: (displayName: string) => Promise<void>;
  // Upload a new avatar for the current user
  uploadAvatar: (file: File) => Promise<void>;
  // Get a profile (or fallback) for a user_id
  getProfile: (userId: string) => CachedProfile;
}

interface CachedProfile {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  cached_at: number;
}
```

#### `assignmentStore` (`src/store/assignments.ts`)

```typescript
interface AssignmentState {
  // Keyed by resource_id → array of user_ids
  assignmentsByResource: Record<string, string[]>;
  loading: boolean;
  error: string | null;

  // Load all assignments for the active workspace
  loadAssignments: (workspaceId: string) => Promise<void>;
  // Assign a member to a resource (idempotent)
  assign: (resourceId: string, userId: string, workspaceId: string) => Promise<void>;
  // Remove an assignment (idempotent)
  unassign: (resourceId: string, userId: string, workspaceId: string) => Promise<void>;
  // Get assignees for a resource
  getAssignees: (resourceId: string) => string[];
}
```

### New Service Layer

#### `ProfileService` (`src/lib/profile/profileService.ts`)

```typescript
// Validate display name — returns trimmed value or throws
export function validateDisplayName(raw: string): string;

// Upsert profile in Supabase and update local cache
export async function upsertProfile(userId: string, displayName: string): Promise<void>;

// Fetch profiles for a list of user IDs from Supabase, write to local cache
export async function fetchAndCacheProfiles(userIds: string[]): Promise<CachedProfile[]>;

// Read profiles from local cache (offline-safe)
export async function getCachedProfiles(userIds: string[]): Promise<CachedProfile[]>;

// Ensure a profile exists for the user (called on first login)
export async function ensureProfile(userId: string, email: string): Promise<void>;
```

#### `AvatarService` (`src/lib/profile/avatarService.ts`)

```typescript
// Validate file before upload — throws with specific error message on failure
export function validateAvatarFile(file: File): void;

// Upload avatar to Supabase Storage, delete old file, update profiles.avatar_url
export async function uploadAvatar(userId: string, file: File): Promise<string>; // returns new URL

// Generate fallback initials from display_name (pure function)
export function getInitials(displayName: string): string; // max 2 chars, uppercased

// Generate deterministic background color from user_id (pure function)
export function getAvatarColor(userId: string): string; // hex color string
```

#### `AssignmentService` (`src/lib/assignments/assignmentService.ts`)

```typescript
// Create an assignment (idempotent — no-op if already exists)
export async function createAssignment(
  resourceId: string, userId: string, workspaceId: string
): Promise<void>;

// Remove an assignment (idempotent — no-op if not exists)
export async function removeAssignment(
  resourceId: string, userId: string, workspaceId: string
): Promise<void>;

// List all active assignments for a workspace
export async function listAssignments(workspaceId: string): Promise<Assignment[]>;

// Soft-delete all assignments for a resource (called within softDeleteSubtree)
export async function softDeleteAssignmentsForResource(
  db: Database, resourceId: string, ts: number
): Promise<void>;

// Soft-delete all assignments for a user in a workspace (called on membership removal)
export async function softDeleteAssignmentsForUser(
  workspaceId: string, userId: string
): Promise<void>;
```

### New UI Components

#### `ProfileSettingsPanel` (`src/components/Profile/ProfileSettingsPanel.tsx`)

A slide-in panel (similar to `WorkspaceSettingsPanel`) accessible from the app header. Contains:
- Display name text field with inline validation
- Avatar display (current or fallback initials) with file upload control
- Loading/success/error states

#### `AvatarBadge` (`src/components/Profile/AvatarBadge.tsx`)

A reusable component rendering either an `<img>` (when `avatar_url` is set) or a fallback initials badge. Used in `TeamView`, `WorkspaceSettingsPanel`, `TreeNode`, and `AssignmentPicker`.

```typescript
interface AvatarBadgeProps {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  size?: 'xs' | 'sm' | 'md'; // default 'sm'
}
```

#### `TeamView` (`src/components/Team/TeamView.tsx`)

A new top-level tab view. Contains:
- Date range selector (reuses the existing `DateRangePicker` pattern from `DashboardView`)
- List of `MemberRow` components, sorted by total minutes descending
- Expandable per-project breakdown per member

#### `AssignmentPicker` (`src/components/Assignments/AssignmentPicker.tsx`)

A dropdown/popover opened from the context menu. Lists all workspace members with checkboxes showing current assignment status.

### Modified Components

- **`App.tsx`** — adds "Team" tab (conditionally shown when workspace has > 1 member)
- **`AuthGate.tsx`** — adds a "Profile" button/link for authenticated users
- **`WorkspaceSettingsPanel.tsx`** — replaces raw `user_id` display with `AvatarBadge` + `display_name`; shows inviter display name in pending invites
- **`TreeNode.tsx`** — renders up to 3 `AvatarBadge` components inline + overflow count badge
- **`ProjectsView.tsx`** — adds assignment filter control (hidden for Local_Personal_Workspace)
- **`ContextMenu.tsx`** — adds "Assign members" menu item

---

## Data Models

### SQLite — New Tables

#### `assignments` table (added in `SCHEMA_V6_SQL`)

```sql
CREATE TABLE IF NOT EXISTS assignments (
  id           TEXT PRIMARY KEY,
  resource_id  TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_assignments_resource ON assignments(resource_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user     ON assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_workspace ON assignments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assignments_active   ON assignments(deleted_at) WHERE deleted_at IS NULL;
```

#### `profiles_cache` table (added in `SCHEMA_V6_SQL`)

```sql
CREATE TABLE IF NOT EXISTS profiles_cache (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  cached_at    INTEGER NOT NULL
);
```

#### `sync_outbox` — extended CHECK constraint (recreated in `SCHEMA_V6_SQL`)

The `entity` CHECK constraint is extended to include `'assignment'`:

```sql
entity TEXT NOT NULL CHECK (entity IN (
  'resource', 'event', 'workspace', 'workspace_membership', 'assignment'
))
```

The migration follows the same CREATE-INSERT-DROP-RENAME pattern used in `SCHEMA_V5_SQL`.

### TypeScript Types (additions to `src/lib/db/types.ts`)

```typescript
export interface Assignment {
  id: string;
  resource_id: string;
  user_id: string;
  workspace_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface CachedProfile {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  cached_at: number;
}

// Extend Entity type
export type Entity =
  | 'resource'
  | 'event'
  | 'workspace'
  | 'workspace_membership'
  | 'assignment';
```

### Supabase (Postgres) — New Tables

#### `assignments`

```sql
CREATE TABLE assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id  UUID NOT NULL,
  user_id      UUID NOT NULL,
  workspace_id UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ
);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_rw" ON assignments
  FOR ALL
  USING (is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid()));
```

#### `profiles`

```sql
CREATE TABLE profiles (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Write: only the profile owner
CREATE POLICY "owner_write" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update" ON profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Read: any user who shares at least one workspace with the profile owner
CREATE POLICY "shared_workspace_read" ON profiles
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM workspace_memberships wm1
      JOIN workspace_memberships wm2 ON wm1.workspace_id = wm2.workspace_id
      WHERE wm1.user_id = auth.uid()
        AND wm2.user_id = profiles.user_id
    )
  );
```

### Supabase Storage

A public bucket named `avatars` stores avatar images. Path convention: `{user_id}/{uuid}.{ext}`. The bucket policy allows public reads and authenticated writes scoped to the user's own folder.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Valid display names are accepted and stored trimmed

*For any* string whose trimmed length is between 1 and 80 characters (inclusive), the `validateDisplayName` function SHALL accept it and return the trimmed value.

**Validates: Requirements 1.2**

### Property 2: Invalid display names are rejected with a specific error

*For any* string whose trimmed length is 0 (empty or whitespace-only) or exceeds 80 characters, the `validateDisplayName` function SHALL throw an error whose message identifies which rule was violated (empty vs. too long).

**Validates: Requirements 1.3**

### Property 3: Avatar validation rejects invalid MIME types with the format named

*For any* MIME type string that is not `image/jpeg`, `image/png`, or `image/webp`, the `validateAvatarFile` function SHALL throw an error whose message contains the rejected MIME type string.

**Validates: Requirements 2.2**

### Property 4: Fallback initials are deterministic and at most 2 characters

*For any* non-empty display name string, `getInitials` SHALL return a string of 1 or 2 uppercase characters consisting of the first letter of the first word and (if a second word exists) the first letter of the last word.

**Validates: Requirements 2.6**

### Property 5: Fallback avatar color is deterministic

*For any* user_id string, calling `getAvatarColor` twice SHALL return the same hex color string both times.

**Validates: Requirements 2.6**

### Property 6: Assignment creation is idempotent

*For any* valid `(resource_id, user_id, workspace_id)` triple, calling `createAssignment` twice SHALL result in exactly one active (non-soft-deleted) assignment record in the local SQLite `assignments` table.

**Validates: Requirements 5.2**

### Property 7: Assignment removal is idempotent

*For any* `(resource_id, user_id, workspace_id)` triple (whether or not an assignment exists), calling `removeAssignment` twice SHALL succeed and result in zero active assignment records for that pair.

**Validates: Requirements 5.3**

### Property 8: Non-members cannot be assigned

*For any* user_id that does not appear in `workspace_memberships` for the given `workspace_id`, calling `createAssignment` SHALL throw an error.

**Validates: Requirements 5.4**

### Property 9: Assignment JSON round-trip is lossless

*For any* valid `Assignment` record, serializing it to JSON with `JSON.stringify` and deserializing with `JSON.parse` SHALL produce an object that is field-for-field equivalent to the original.

**Validates: Requirements 8.6**

### Property 10: Assignment timestamp mapping produces valid ISO 8601 strings

*For any* valid `Assignment` record with Unix epoch millisecond timestamps, applying `mapAssignmentToCloud` SHALL produce an object whose `created_at`, `updated_at`, and (when non-null) `deleted_at` fields are valid ISO 8601 date-time strings.

**Validates: Requirements 8.3**

### Property 11: Team_View member rows are sorted descending by total minutes

*For any* list of workspace members with associated time event data, the `computeMemberRows` function SHALL return rows sorted in descending order of `totalMinutes` (ties may appear in any order).

**Validates: Requirements 6.5**

### Property 12: Team tab visibility matches workspace member count

*For any* workspace, the Team tab SHALL be visible if and only if the workspace has more than one member.

**Validates: Requirements 6.1**

---

## Error Handling

### Profile Service Errors

| Scenario | Behavior |
|---|---|
| Display name trimmed length = 0 | `validateDisplayName` throws `"Display name cannot be empty."` |
| Display name trimmed length > 80 | `validateDisplayName` throws `"Display name must be at most 80 characters."` |
| Supabase upsert fails (network/server) | `upsertProfile` throws; `ProfileSettingsPanel` shows inline error, re-enables form |
| Profile fetch fails | `fetchAndCacheProfiles` throws; UI falls back to locally cached data or email prefix |

### Avatar Service Errors

| Scenario | Behavior |
|---|---|
| Invalid MIME type | `validateAvatarFile` throws with format name in message; no upload initiated |
| File > 256 KB | `validateAvatarFile` throws `"Avatar must be at most 256 KB."` |
| Dimension > 2048px | `validateAvatarFile` throws `"Avatar dimensions must not exceed 2048×2048 pixels."` |
| Storage upload fails | `uploadAvatar` throws; `ProfileSettingsPanel` shows inline error, re-enables upload control |
| Old avatar deletion fails | Logged as a warning; new avatar URL is still saved (non-fatal) |

### Assignment Service Errors

| Scenario | Behavior |
|---|---|
| Assigning a non-member | `createAssignment` throws `"User is not a member of this workspace."` |
| Local SQLite write fails | `createAssignment`/`removeAssignment` rolls back transaction and throws |
| Outbox enqueue fails | Rolled back with the assignment write (same transaction) |
| Local_Personal_Workspace | `createAssignment`/`removeAssignment` throws `"Assignments are not supported in the local workspace."` |

### Sync Worker Errors

Assignment flush errors follow the same retry/backoff pattern as other entities. Invalid timestamp fields cause the row to be skipped with `bumpRetry` (same as existing behavior for resources/events).

### Offline Behavior

- Profile writes (display name, avatar) require a network connection and fail gracefully with an error message.
- Assignment create/remove work offline — they write to SQLite and enqueue in the outbox.
- Team_View and assignment filter render from local SQLite data regardless of connectivity.
- `ProfileSettingsPanel` shows cached data when offline; if no cache exists, shows email prefix and fallback initials.

---

## Testing Strategy

### Unit Tests

Unit tests cover specific examples, edge cases, and error conditions:

- `validateDisplayName`: boundary values (length 0, 1, 80, 81), whitespace-only strings, strings with leading/trailing whitespace
- `validateAvatarFile`: each invalid MIME type, exact 256 KB boundary, exact 2048px boundary
- `getInitials`: single word, two words, many words, empty string, unicode names
- `getAvatarColor`: same input always returns same output, output is a valid hex color
- `AssignmentService`: non-member rejection, Local_Personal_Workspace rejection, cascade soft-delete on resource/membership removal
- `SCHEMA_V6_SQL` migration: idempotency check, existing data preservation
- `mapAssignmentToCloud`: null `deleted_at` handling, all timestamp fields converted

### Property-Based Tests

The project uses [fast-check](https://github.com/dubzzz/fast-check) (already in `devDependencies`). Each property test runs a minimum of 100 iterations.

Tag format: `// Feature: team-features, Property N: <property text>`

**Property 1** — `validateDisplayName` accepts valid inputs:
```typescript
// Feature: team-features, Property 1: valid display names are accepted and stored trimmed
fc.assert(fc.property(
  fc.string({ minLength: 1, maxLength: 80 }).filter(s => s.trim().length >= 1 && s.trim().length <= 80),
  (s) => {
    const result = validateDisplayName(s);
    expect(result).toBe(s.trim());
  }
), { numRuns: 100 });
```

**Property 2** — `validateDisplayName` rejects invalid inputs:
```typescript
// Feature: team-features, Property 2: invalid display names are rejected with a specific error
fc.assert(fc.property(
  fc.oneof(
    fc.string().map(s => s.replace(/\S/g, ' ')), // whitespace-only
    fc.string({ minLength: 81 })                  // too long after trim
  ),
  (s) => {
    expect(() => validateDisplayName(s)).toThrow();
  }
), { numRuns: 100 });
```

**Property 3** — `validateAvatarFile` rejects invalid MIME types:
```typescript
// Feature: team-features, Property 3: avatar validation rejects invalid MIME types with the format named
```

**Property 4** — `getInitials` returns ≤ 2 uppercase chars:
```typescript
// Feature: team-features, Property 4: fallback initials are deterministic and at most 2 characters
```

**Property 5** — `getAvatarColor` is deterministic:
```typescript
// Feature: team-features, Property 5: fallback avatar color is deterministic
```

**Property 6** — `createAssignment` is idempotent:
```typescript
// Feature: team-features, Property 6: assignment creation is idempotent
```

**Property 7** — `removeAssignment` is idempotent:
```typescript
// Feature: team-features, Property 7: assignment removal is idempotent
```

**Property 8** — non-members cannot be assigned:
```typescript
// Feature: team-features, Property 8: non-members cannot be assigned
```

**Property 9** — Assignment JSON round-trip:
```typescript
// Feature: team-features, Property 9: assignment JSON round-trip is lossless
fc.assert(fc.property(
  fc.record({
    id: fc.uuid(),
    resource_id: fc.uuid(),
    user_id: fc.uuid(),
    workspace_id: fc.uuid(),
    created_at: fc.integer({ min: 1 }),
    updated_at: fc.integer({ min: 1 }),
    deleted_at: fc.option(fc.integer({ min: 1 }), { nil: null }),
  }),
  (assignment) => {
    const roundTripped = JSON.parse(JSON.stringify(assignment));
    expect(roundTripped).toEqual(assignment);
  }
), { numRuns: 100 });
```

**Property 10** — `mapAssignmentToCloud` produces valid ISO 8601 strings:
```typescript
// Feature: team-features, Property 10: assignment timestamp mapping produces valid ISO 8601 strings
```

**Property 11** — `computeMemberRows` sorts descending by minutes:
```typescript
// Feature: team-features, Property 11: team view member rows are sorted descending by total minutes
```

**Property 12** — Team tab visibility:
```typescript
// Feature: team-features, Property 12: team tab visibility matches workspace member count
```

### Integration Tests

- Initial pull fetches and merges assignment records from Supabase
- RLS policy enforcement for `assignments` and `profiles` tables
- Avatar upload to Supabase Storage and `avatar_url` update
- Outbox flush for `assignment` entity type

### Migration Tests

- `SCHEMA_V6_SQL` applied to a Phase 5 database preserves all existing rows
- Idempotency: running the migration twice does not error or duplicate data
- `sync_outbox` CHECK constraint includes `'assignment'` after migration
