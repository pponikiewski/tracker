# Requirements Document

## Introduction

Faza 5 rozszerza aplikację tracker (Tauri 2 + React 19 + SQLite + Supabase) o model multi-tenant oparty na workspaces. Każdy zasób (Resource) i zdarzenie (Event) należy do dokładnie jednego Workspace. Użytkownik może tworzyć wiele Workspace'ów i zapraszać do nich innych użytkowników. Hierarchia zasobów w Postgres migruje z kolumny `path TEXT` (materialized path) na typ `ltree` (Postgres extension), co umożliwia wydajne zapytania po poddrzewach. Row Level Security jest rozszerzone z `user_id = auth.uid()` na `workspace_id IN (workspaces użytkownika)`. Lokalna baza SQLite zachowuje materialized path (SQLite nie obsługuje ltree).

Zakres Fazy 5:
- **Workspaces** — model danych, tworzenie, przełączanie, zarządzanie
- **ltree w Postgres** — migracja kolumny `path` z `TEXT` na `ltree`
- **RLS na workspace_id** — każdy zasób należy do workspace, polityki RLS oparte na przynależności do workspace
- **Invites** — zapraszanie użytkowników do workspace przez email

## Glossary

- **App**: Aplikacja desktopowa Tauri 2 + React 19
- **Workspace**: Izolowana przestrzeń robocza zawierająca Resources i Events; każdy Workspace ma dokładnie jednego właściciela (Owner) i może mieć wielu członków (Members)
- **Workspace_Owner**: Użytkownik, który utworzył Workspace; ma pełne uprawnienia do zarządzania Workspace (edycja nazwy, usuwanie, zarządzanie członkami)
- **Workspace_Member**: Użytkownik zaproszony do Workspace; może tworzyć, edytować i usuwać Resources i Events w tym Workspace
- **Workspace_Store**: Zustand store zarządzający listą Workspace'ów, aktywnym Workspace'em i operacjami CRUD
- **Active_Workspace**: Workspace aktualnie wybrany przez użytkownika; wszystkie operacje na Resources i Events dotyczą Active_Workspace
- **Workspace_Switcher**: Komponent UI umożliwiający wybór Active_Workspace z listy dostępnych Workspace'ów
- **Invite**: Zaproszenie do Workspace wysłane na adres email; zawiera token jednorazowego użytku i datę wygaśnięcia
- **Invite_Token**: Unikalny UUID v4 identyfikujący zaproszenie; używany w URL zaproszenia
- **Resource**: Projekt, etap, podetat lub zadanie w hierarchii; od Fazy 5 każdy Resource należy do dokładnie jednego Workspace
- **Event**: Wpis czasu pracy powiązany z Resource; od Fazy 5 każdy Event należy do dokładnie jednego Workspace
- **ltree**: Typ danych PostgreSQL (rozszerzenie `ltree`) reprezentujący ścieżkę hierarchiczną jako ciąg etykiet oddzielonych kropkami (np. `abc123.def456.ghi789`)
- **Materialized_Path**: Lokalna reprezentacja hierarchii w SQLite jako ciąg UUID oddzielonych ukośnikami (np. `id1/id2/id3`); niezmieniona od Fazy 1
- **RLS**: Row Level Security — mechanizm PostgreSQL ograniczający dostęp do wierszy na podstawie tożsamości użytkownika
- **Workspace_Membership**: Tabela łącząca użytkowników z Workspace'ami; zawiera rolę (owner/member) i datę dołączenia
- **Sync_Outbox**: Lokalna tabela SQLite kolejkująca mutacje do synchronizacji z Supabase (bez zmian od Fazy 4)
- **Personal_Workspace**: Domyślny Workspace tworzony automatycznie przy pierwszym logowaniu użytkownika; nazwa: `"My workspace"`
- **Local_Personal_Workspace**: Workspace tworzony lokalnie w SQLite dla użytkowników w trybie anonimowym; posiada stabilne UUID przechowywane w SQLite i nigdy nie jest synchronizowany z Supabase

## Requirements

### Requirement 1: Workspace Data Model

**User Story:** As a developer, I want a well-defined workspace data model in both SQLite and Postgres, so that all resources and events are correctly scoped to a workspace.

#### Acceptance Criteria

1. THE Postgres `workspaces` table SHALL contain columns: `id UUID PRIMARY KEY`, `name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255)`, `owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`, `deleted_at TIMESTAMPTZ`
2. THE Postgres `workspace_memberships` table SHALL contain columns: `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`, `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `role TEXT NOT NULL CHECK (role IN ('owner', 'member'))`, `joined_at TIMESTAMPTZ NOT NULL`, and a PRIMARY KEY on `(workspace_id, user_id)`
3. THE Postgres `resources` table SHALL have a `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` column added via migration; FOR any existing rows at migration time, `workspace_id` SHALL be backfilled with the Personal_Workspace `id` of the row's `user_id` before the NOT NULL constraint is enforced
4. THE Postgres `events` table SHALL have a `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` column added via migration; FOR any existing rows at migration time, `workspace_id` SHALL be backfilled with the Personal_Workspace `id` of the row's `user_id` before the NOT NULL constraint is enforced
5. THE local SQLite `workspaces` table SHALL contain columns: `id TEXT PRIMARY KEY`, `name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255)`, `owner_id TEXT NOT NULL`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`, `deleted_at INTEGER`
6. THE local SQLite `workspace_memberships` table SHALL contain columns: `workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`, `user_id TEXT NOT NULL`, `role TEXT NOT NULL CHECK (role IN ('owner', 'member'))`, `joined_at INTEGER NOT NULL`, and a PRIMARY KEY on `(workspace_id, user_id)`
7. THE local SQLite `resources` table SHALL have a `workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` column added via migration; FOR any existing rows at migration time, `workspace_id` SHALL be backfilled with the Local_Personal_Workspace `id` before the NOT NULL constraint is enforced
8. THE local SQLite `events` table SHALL have a `workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` column added via migration; FOR any existing rows at migration time, `workspace_id` SHALL be backfilled with the Local_Personal_Workspace `id` before the NOT NULL constraint is enforced
9. FOR every Workspace row in `workspaces`, THE `workspace_memberships` table SHALL contain a row with `role = 'owner'` for the `owner_id` of that Workspace; this invariant SHALL be enforced by the migration and by all Workspace creation paths

### Requirement 2: Personal Workspace Provisioning

**User Story:** As a new user logging in for the first time, I want a personal workspace to be created automatically, so that I can start using the app immediately without manual setup.

#### Acceptance Criteria

1. WHEN a user authenticates for the first time and no Workspace exists for that user in Supabase, THE App SHALL create a Personal_Workspace with `name = "My workspace"` and `owner_id = auth.uid()` in Supabase; IF the Supabase creation fails, THE App SHALL set sync status to error with the failure reason and SHALL NOT proceed to Initial_Pull until the Personal_Workspace is successfully created
2. WHEN the Personal_Workspace is created in Supabase, THE App SHALL insert a corresponding row into the local SQLite `workspaces` table and a `workspace_memberships` row with `role = 'owner'` within the same SQLite transaction
3. IF the local SQLite insertion in criterion 2 fails after a successful Supabase creation, THEN THE App SHALL retry the local insertion on the next Initial_Pull by fetching the Workspace and Workspace_Membership rows from Supabase and writing them locally, ensuring eventual consistency without rolling back the remote workspace
4. WHEN the Initial_Pull runs, THE App SHALL pull Workspace and Workspace_Membership data alongside Resources and Events
5. WHEN a user operates in anonymous mode (not logged in), THE App SHALL use a Local_Personal_Workspace with a stable UUID that is generated once and persisted in SQLite, so that all Resources and Events have a valid `workspace_id`; IF no Local_Personal_Workspace UUID exists in SQLite, THE App SHALL generate a new UUID v4 and persist it before any Resource or Event is created
6. IF a user already has at least one non-deleted Workspace in Supabase when logging in, THEN THE App SHALL NOT create a new Personal_Workspace and SHALL use the existing Workspace(s); a user with zero existing Workspaces SHALL be treated as a first-time user and SHALL have a Personal_Workspace created for them

### Requirement 3: Workspace Creation and Management

**User Story:** As a user, I want to create and manage multiple workspaces, so that I can organize my work across different contexts (e.g., personal, client projects).

#### Acceptance Criteria

1. WHEN a user submits a new workspace name of 1–80 characters, THE Workspace_Store SHALL create a new Workspace with a client-generated UUID v4, insert it into local SQLite, and enqueue it in the Sync_Outbox
2. IF the workspace name is empty or exceeds 80 characters, THEN THE App SHALL display an inline validation error indicating the failing rule and SHALL NOT create the Workspace
3. WHEN a Workspace_Owner submits a renamed workspace name of 1–80 characters that differs from the current name, THE Workspace_Store SHALL update the Workspace `name` and `updated_at` in local SQLite AND enqueue the update in the Sync_Outbox within the same database transaction; both the local SQLite update and the Sync_Outbox enqueue SHALL succeed together or neither SHALL be applied; IF the submitted name is identical to the current name, THE App SHALL take no action
4. WHEN a Workspace_Owner explicitly initiates workspace deletion AND confirms the confirmation prompt, THE Workspace_Store SHALL soft-delete the Workspace by setting `deleted_at` to the current Unix millisecond timestamp in local SQLite and enqueue the update in the Sync_Outbox
5. IF a workspace deletion is triggered by any path other than explicit Workspace_Owner action followed by confirmation, THEN THE App SHALL reject the operation and leave the Workspace unchanged
6. IF the Workspace being deleted is the Active_Workspace, THEN THE App SHALL switch the Active_Workspace to another non-deleted Workspace the current user belongs to before completing the deletion; IF no other such Workspace exists, THE App SHALL create a new Personal_Workspace first and then set it as the Active_Workspace
7. WHEN a Workspace_Member (non-owner) views workspace settings, THE App SHALL display the workspace name as read-only and SHALL NOT show delete or rename controls
8. THE Workspace_Store SHALL expose the list of all non-deleted Workspaces the current user belongs to, ordered by `created_at` ascending
9. IF a workspace deletion is triggered programmatically without explicit Workspace_Owner action (e.g., via a direct store call without user confirmation), THEN THE App SHALL reject the operation and leave the Workspace unchanged

### Requirement 4: Active Workspace Selection

**User Story:** As a user, I want to switch between workspaces, so that I can view and manage resources in different contexts.

#### Acceptance Criteria

1. THE Workspace_Switcher SHALL display the name of the Active_Workspace and a list of all non-deleted Workspaces the current user belongs to (including the Active_Workspace itself)
2. WHEN the user selects a Workspace from the Workspace_Switcher, THE App SHALL set it as the Active_Workspace and reload Resources and Events scoped to that Workspace's `workspace_id`; IF the reload fails, THE App SHALL display an error notification and revert the Active_Workspace to the previously selected Workspace
3. WHEN the App starts and a user is authenticated, THE App SHALL restore the exact previously selected Active_Workspace from local storage; IF no previous selection exists OR the previously selected Workspace is no longer available (soft-deleted or membership revoked), THE App SHALL select the first non-deleted Workspace the user belongs to ordered by `created_at` ascending; IF no such Workspace exists, THE App SHALL trigger Personal_Workspace provisioning (Requirement 2)
4. WHEN the App starts and a user is in anonymous mode, THE App SHALL use the Local_Personal_Workspace (a local-only Workspace with a stable UUID stored in SQLite that is never synced to Supabase) as the Active_Workspace
5. WHILE the Active_Workspace is set, THE App SHALL scope all Resource and Event queries (create, read, update, delete) to that Workspace's `workspace_id`
6. IF the reload of Resources and Events after a workspace switch fails due to a network or database error, THEN THE App SHALL display an error notification, revert the Active_Workspace to the previously selected Workspace, and leave the previously loaded Resources and Events unchanged in the UI; this error handling SHALL trigger only when the failure is caused by a network or database error

### Requirement 5: ltree Migration in Postgres

**User Story:** As a developer, I want the resource hierarchy in Postgres to use the ltree extension, so that subtree queries are efficient and use native Postgres capabilities.

#### Acceptance Criteria

1. THE Postgres migration SHALL enable the `ltree` extension via `CREATE EXTENSION IF NOT EXISTS ltree`
2. THE Postgres `resources` table SHALL have the `path` column type changed from `TEXT` to `ltree` via migration; the `ALTER COLUMN` step SHALL be guarded so that re-running the migration when the column is already of type `ltree` does not produce an error
3. WHEN the Sync_Worker pushes a Resource to Supabase, THE Sync_Worker SHALL convert the local Materialized_Path (slash-separated UUIDs, e.g., `"id1/id2/id3"` or a single segment `"id1"`) to ltree format by replacing each `-` with `_` and each `/` with `.` (e.g., `"id1_uuid.id2_uuid.id3_uuid"` or `"id1_uuid"`) before inserting or updating
4. WHEN the Initial_Pull fetches Resources from Supabase, THE App SHALL convert ltree path values back to slash-separated UUID Materialized_Path format by replacing each `_` with `-` and each `.` with `/` for storage in local SQLite, including single-label ltree values which map to a single UUID segment
5. THE Postgres migration SHALL add a GiST index on `resources(path)` to support efficient ltree subtree queries (`path <@ 'label'`); the index creation SHALL be guarded with `IF NOT EXISTS` so that re-running the migration does not produce an error
6. THE Postgres migration SHALL be idempotent — each of the three migration steps (extension, column type change, index) SHALL be individually guarded so that running the migration twice produces no errors and no duplicate data
7. FOR ALL valid Materialized_Path strings (defined as one or more UUID v4 segments joined by `/`, with a maximum of 10 segments), converting to ltree format and back SHALL produce the original Materialized_Path (round-trip property)

### Requirement 6: Row Level Security on workspace_id

**User Story:** As a user, I want my workspace data to be isolated from other workspaces, so that members of one workspace cannot access data from another workspace they do not belong to.

#### Acceptance Criteria

1. WHEN an authenticated user performs SELECT, INSERT, UPDATE, or DELETE on the `workspaces` table, THE Supabase Postgres SHALL permit the operation only for rows where `is_workspace_member(id)` returns TRUE; all other rows SHALL be invisible or rejected; this policy applies exclusively to the `workspaces` table and does not extend to `workspace_memberships`
2. WHEN an authenticated user performs SELECT on the `workspace_memberships` table, THE Supabase Postgres SHALL return only rows where `is_workspace_member(workspace_id)` returns TRUE
3. WHEN an authenticated user performs any operation on the `resources` table, THE Supabase Postgres SHALL permit the operation only for rows where `is_workspace_member(workspace_id)` returns TRUE; any prior `user_id = auth.uid()` policy on this table SHALL be dropped and superseded by this workspace-scoped policy
4. WHEN an authenticated user performs any operation on the `events` table, THE Supabase Postgres SHALL permit the operation only for rows where `is_workspace_member(workspace_id)` returns TRUE; any prior `user_id = auth.uid()` policy on this table SHALL be dropped and superseded by this workspace-scoped policy
5. WHEN an authenticated user queries `resources` or `events`, THE Supabase Postgres SHALL return only rows belonging to Workspaces the user is a member of; IF the user has no memberships, THE query SHALL return zero rows without error
6. WHEN an authenticated user attempts to INSERT a Resource or Event with a `workspace_id` for which `is_workspace_member(workspace_id)` returns FALSE, THE Supabase Postgres SHALL reject the operation with an RLS violation error and leave the table unchanged
7. THE `is_workspace_member(workspace_id UUID)` helper function SHALL return TRUE if and only if `auth.uid()` is non-null AND a row exists in `workspace_memberships` with the given `workspace_id` and `user_id = auth.uid()`; IF `auth.uid()` is null, THE function SHALL return FALSE
8. WHEN an unauthenticated request (null `auth.uid()`) is made to any RLS-protected table (`workspaces`, `workspace_memberships`, `resources`, `events`), THE Supabase Postgres SHALL return zero rows for SELECT and reject INSERT/UPDATE/DELETE operations
9. WHEN an authenticated user performs INSERT or DELETE on the `workspace_memberships` table, THE Supabase Postgres SHALL permit the operation only for rows where the user is an owner of the referenced workspace (`role = 'owner'` in their own membership row for that `workspace_id`)

### Requirement 7: Workspace Sync Integration

**User Story:** As a user, I want workspace data to be synchronized to the cloud just like resources and events, so that my workspace configuration is available across devices.

#### Acceptance Criteria

1. WHEN a Workspace is created, renamed, or soft-deleted locally, THE App SHALL insert a corresponding row into the Sync_Outbox with `op = 'upsert'` within the same database transaction as the mutation
2. WHEN a Workspace_Membership is created locally, THE App SHALL insert a Sync_Outbox row with `op = 'upsert'`; WHEN a Workspace_Membership is hard-deleted locally, THE App SHALL insert a Sync_Outbox row with `op = 'delete'`; both insertions SHALL occur within the same database transaction as the membership mutation
3. THE Sync_Outbox `entity` column CHECK constraint SHALL be extended to include `'workspace'` and `'workspace_membership'` as valid values alongside the existing `'resource'` and `'event'` values
4. WHEN the Sync_Worker pushes a Workspace to Supabase, THE Sync_Worker SHALL convert `created_at` and `updated_at` from Unix milliseconds to ISO 8601 UTC timestamps; IF `deleted_at` is non-null, THE Sync_Worker SHALL also convert it from Unix milliseconds to ISO 8601 UTC timestamp; IF `deleted_at` is null, THE Sync_Worker SHALL pass null
5. WHEN the Initial_Pull runs, THE App SHALL fetch Workspaces and Workspace_Memberships from Supabase before fetching Resources and Events so that foreign key constraints are satisfied during local SQLite writes; IF the Workspace or Workspace_Membership fetch fails, THE App SHALL set sync status to error with the failure reason and SHALL NOT proceed to fetch Resources and Events; the user SHALL manually retry the sync to recover from this error state
6. THE Sync_Worker SHALL apply the same `updated_at`-based Last-Write-Wins algorithm to Workspace rows as it does to Resource and Event rows: WHEN a Workspace exists only in the cloud, THE worker SHALL write it to local SQLite; WHEN a Workspace exists only locally, THE worker SHALL enqueue it to the Sync_Outbox; WHEN a Workspace exists in both and the cloud `updated_at` is higher, THE worker SHALL overwrite the local row; WHEN a Workspace exists in both and the local `updated_at` is higher or equal, THE worker SHALL enqueue the local row (or take no action if equal)

### Requirement 8: Workspace Invites

**User Story:** As a workspace owner, I want to invite other users by email, so that they can collaborate in my workspace.

#### Acceptance Criteria

1. WHEN a Workspace_Owner submits an email address that contains an `@` character and does not exceed 254 characters in the invite form, THE App SHALL create an Invite record in Supabase with: `id UUID`, `workspace_id`, `invited_email TEXT`, `invited_by UUID` (owner's user_id), `token UUID` (unique Invite_Token generated client-side), `created_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ` (72 hours after creation), `accepted_at TIMESTAMPTZ` (NULL until accepted)
2. WHEN an Invite is created, THE App SHALL display the invite link in the format `https://{VITE_APP_URL}/invite/{token}` for the owner to share manually
3. IF the invited email already belongs to an existing Workspace_Member of that Workspace, THEN THE App SHALL display an inline validation error and SHALL NOT create a duplicate Invite
4. IF a pending (non-expired, non-accepted) Invite already exists for the same email and workspace, THEN THE App SHALL display an inline validation error indicating a pending invite already exists and SHALL NOT create a duplicate Invite
5. WHEN an authenticated user opens an invite link, THE App SHALL look up the Invite by token, verify it has not expired (`expires_at > now()`) and has not been accepted (`accepted_at IS NULL`), and display the workspace name and inviting user's email
6. IF an unauthenticated user opens an invite link, THEN THE App SHALL redirect the user to the authentication flow and, upon successful authentication, resume the invite acceptance flow with the original token
7. WHEN an authenticated user accepts a valid Invite and the authenticated user's email matches `invited_email`, THE App SHALL insert a `workspace_memberships` row with `role = 'member'` AND set `accepted_at` on the Invite to the current UTC timestamp within the same atomic operation; IF either the membership insertion or the `accepted_at` update fails, THE App SHALL roll back both changes, display an error notification, and leave the Invite and membership table unchanged; the accepted user SHALL be assigned `role = 'member'` regardless of any ownership they hold in other Workspaces, and add the Workspace to the user's local SQLite and Workspace_Store
8. IF the Invite token is not found, THE App SHALL display an error indicating the invite link is invalid
9. IF the Invite has expired (`expires_at <= now()`), THE App SHALL display an error indicating the invite has expired
10. IF the Invite has already been accepted (`accepted_at IS NOT NULL`), THE App SHALL display an error indicating the invite has already been used
11. WHEN a Workspace_Owner views the workspace members list, THE App SHALL display all current members (name/email + role) and all pending Invites (email + expiry date)
12. WHEN a Workspace_Owner cancels a pending Invite, THE App SHALL delete the Invite record from Supabase
13. THE Postgres `invites` table SHALL have RLS allowing INSERT and SELECT for users who are owners of the referenced workspace, and allowing UPDATE (to set `accepted_at`) for any authenticated user where `invited_email` matches the authenticated user's email

### Requirement 9: Workspace Member Management

**User Story:** As a workspace owner, I want to remove members from my workspace, so that I can control who has access to workspace data.

#### Acceptance Criteria

1. WHEN a Workspace_Owner removes a member and confirms the confirmation prompt, THE App SHALL delete the `workspace_memberships` row for that user from Supabase first and, upon success, delete it from local SQLite; IF the Supabase deletion fails, THE App SHALL display an error notification and leave the local SQLite row unchanged
2. WHEN a Workspace_Member is removed, THE App SHALL NOT delete or modify any Resources or Events created by that member in the Workspace
3. WHEN a Workspace_Owner attempts to remove themselves, THE App SHALL display an error indicating the owner cannot be removed and SHALL NOT perform the removal
4. WHEN a Workspace_Member views the members list, THE App SHALL display all members but SHALL NOT show a remove action for any member
5. WHEN a user is removed from a Workspace that was their Active_Workspace, THE App SHALL switch the Active_Workspace to the most recently accessed non-deleted Workspace the user belongs to; IF no other such Workspace exists, THE App SHALL immediately create a new Personal_Workspace and set it as the Active_Workspace, regardless of whether the removed Workspace was the Active_Workspace or not, ensuring the user is never left without an Active_Workspace

### Requirement 10: Backward Compatibility and Migration

**User Story:** As an existing user of Faza 4, I want my existing data to be migrated to the workspace model without data loss, so that I can continue using the app after the upgrade.

#### Acceptance Criteria

1. THE Postgres migration script SHALL first create a Personal_Workspace for each `auth.users` row that does not already have a Workspace (using `name = 'My workspace'` and `owner_id = user.id`), and then assign all existing Resources and Events for that user to their Personal_Workspace by setting `workspace_id`; both steps SHALL execute within the same transaction so that IF either step fails, the entire migration rolls back
2. THE local SQLite migration SHALL add `workspaces` and `workspace_memberships` tables, insert the Local_Personal_Workspace row and its owner membership row, and then add `workspace_id` columns to `resources` and `events` tables populated with the Local_Personal_Workspace `id` for all existing rows; all steps SHALL execute within the same SQLite transaction
3. THE local SQLite migration SHALL add `workspace_id` columns to `resources` and `events` tables and populate them with the Local_Personal_Workspace `id` for all existing rows within the same transaction as step 2
4. WHEN the migration runs on a fresh install (no existing data), THE migration SHALL complete without errors, leave the schema in the correct state, and treat the absence of rows to migrate as a valid no-op outcome
5. THE Sync_Outbox `entity` column CHECK constraint SHALL be updated to include `'workspace'` and `'workspace_membership'` atomically — either the constraint is updated successfully or the migration rolls back entirely; this update SHALL occur within the same migration transaction as the schema changes
6. THE Postgres migration SHALL be idempotent — running it twice SHALL produce no errors and no duplicate data; each of the migration steps SHALL be individually guarded on every migration run as a safety measure

### Requirement 11: Workspace UI Components

**User Story:** As a user, I want clear UI controls for workspace management, so that I can create, switch, and manage workspaces without confusion.

#### Acceptance Criteria

1. THE Workspace_Switcher SHALL be displayed in the app header, adjacent to the existing Auth_Gate component
2. WHILE the Auth_Store state is `anonymous`, THE Workspace_Switcher SHALL display the Local_Personal_Workspace name (truncated to 50 characters if longer) without a dropdown, since only one workspace is available in anonymous mode
3. WHILE the Auth_Store state is `authed` and the user belongs to exactly one Workspace, THE Workspace_Switcher SHALL display that Workspace's name (truncated to 50 characters if longer) without a dropdown
4. WHILE the Auth_Store state is `authed` and the user belongs to more than one Workspace, THE Workspace_Switcher SHALL display a dropdown listing all available non-deleted Workspaces the user belongs to
5. WHEN the user opens the Workspace_Switcher dropdown (in authed state with multiple workspaces), THE App SHALL display a "New workspace" option at the bottom of the dropdown list
6. WHEN the user clicks the settings icon or "Manage workspace" option in the Workspace_Switcher, THE App SHALL open a workspace settings panel showing: workspace name (editable by owner), member list, pending invites, and invite form (owner only)
7. WHEN the Active_Workspace changes, THE App SHALL update the header to reflect the new Active_Workspace name (truncated to 50 characters if longer)
8. WHEN a user is a Workspace_Member (not owner) and views workspace settings, THE App SHALL completely hide rename and delete controls; owner-only elements SHALL NOT be visible to non-owners
9. WHEN a user is a Workspace_Member (not owner) and views workspace settings, THE App SHALL display member roles as read-only without remove controls, and SHALL NOT show the invite form — the member SHALL have no ability to modify any workspace settings, member roles, or membership

### Requirement 12: ltree Path Conversion

**User Story:** As a developer, I want a well-defined, tested conversion between SQLite materialized paths and Postgres ltree paths, so that data integrity is maintained during sync.

#### Acceptance Criteria

1. THE `pathToLtree` function SHALL convert a slash-separated UUID materialized path (e.g., `"550e8400-e29b-41d4-a716-446655440000/6ba7b810-9dad-11d1-80b4-00c04fd430c8"`) to a dot-separated ltree label path by replacing each `-` with `_` and each `/` with `.`
2. THE `ltreeToPath` function SHALL convert a dot-separated ltree label path back to a slash-separated UUID materialized path by replacing each `_` with `-` and each `.` with `/`
3. THE `pathToLtree` and `ltreeToPath` functions SHALL be pure functions with no side effects, located in `src/lib/utils/ltree.ts`; for any valid UUID v4 materialized path of depth 1–10, `ltreeToPath(pathToLtree(path))` SHALL equal the original path
4. IF the input to `pathToLtree` is an empty string or contains characters other than hexadecimal digits, hyphens, and forward slashes, THEN THE function SHALL throw an error whose message identifies the invalid characters found or states that the input is empty
5. IF the input to `ltreeToPath` is an empty string or contains characters other than hexadecimal digits, underscores, and dots, THEN THE function SHALL throw an error whose message identifies the invalid characters found or states that the input is empty; these error-handling rules apply independently to each function
