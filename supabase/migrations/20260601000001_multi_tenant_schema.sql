BEGIN;

-- 1. Rozszerzenie ltree
CREATE EXTENSION IF NOT EXISTS ltree;

-- 2. Tabela workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces(owner_id);

-- 3. Tabela workspace_memberships
CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS wm_user_idx ON workspace_memberships(user_id);

-- 4. Backfill: Personal_Workspace dla uzytkownikow bez workspace
INSERT INTO workspaces (id, name, owner_id, created_at, updated_at)
SELECT gen_random_uuid(), 'My workspace', u.id, now(), now()
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM workspaces w WHERE w.owner_id = u.id AND w.deleted_at IS NULL
);

-- 5. Owner membership dla nowych workspace'ow
INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
SELECT w.id, w.owner_id, 'owner', now()
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_memberships wm
  WHERE wm.workspace_id = w.id AND wm.user_id = w.owner_id
);

-- 6. Dodaj workspace_id do resources
ALTER TABLE resources ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE resources r SET workspace_id = (
  SELECT w.id FROM workspaces w WHERE w.owner_id = r.user_id AND w.deleted_at IS NULL LIMIT 1
) WHERE r.workspace_id IS NULL;

-- 7. Dodaj workspace_id do events
ALTER TABLE events ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE events e SET workspace_id = (
  SELECT r.workspace_id FROM resources r WHERE r.id = e.resource_id LIMIT 1
) WHERE e.workspace_id IS NULL;

-- 8. Migracja ltree: path TEXT -> ltree (idempotentna)
-- Najpierw konwertuj wartosci: '-' -> '_', '/' -> '.' (ltree nie akceptuje myslnikow)
-- Potem zmien typ kolumny.
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'resources' AND column_name = 'path') = 'text' THEN
    -- Krok 1: przekonwertuj istniejace wartosci na format ltree
    UPDATE resources SET path = replace(replace(path, '-', '_'), '/', '.');
    -- Krok 2: zmien typ kolumny
    ALTER TABLE resources ALTER COLUMN path TYPE ltree USING path::ltree;
  END IF;
END $$;

-- 9. Indeks GiST na path
CREATE INDEX IF NOT EXISTS resources_path_gist_idx ON resources USING GIST (path);

-- 10. Tabela invites
CREATE TABLE IF NOT EXISTS invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_email   TEXT NOT NULL,
  invited_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token           UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invites_token_idx ON invites(token);
CREATE INDEX IF NOT EXISTS invites_workspace_idx ON invites(workspace_id);

-- 11. Funkcja pomocnicza is_workspace_member
CREATE OR REPLACE FUNCTION is_workspace_member(p_workspace_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_memberships
    WHERE workspace_id = p_workspace_id AND user_id = auth.uid()
  ) AND auth.uid() IS NOT NULL;
$$;

-- 12. Wlacz RLS
ALTER TABLE workspaces            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites                ENABLE ROW LEVEL SECURITY;

-- 13. Polityki RLS: workspaces
DROP POLICY IF EXISTS "workspace_member_access" ON workspaces;
DROP POLICY IF EXISTS "workspace_select" ON workspaces;
DROP POLICY IF EXISTS "workspace_insert" ON workspaces;
DROP POLICY IF EXISTS "workspace_update_delete" ON workspaces;
DROP POLICY IF EXISTS "workspace_update" ON workspaces;
DROP POLICY IF EXISTS "workspace_delete" ON workspaces;

-- SELECT: members can see their workspaces; owners can always see their own
-- (breaks the chicken-and-egg: owner needs to see the workspace before membership exists)
CREATE POLICY "workspace_select" ON workspaces
  FOR SELECT USING (is_workspace_member(id) OR owner_id = auth.uid());

-- INSERT: authenticated user can create a workspace where they are the owner
CREATE POLICY "workspace_insert" ON workspaces
  FOR INSERT WITH CHECK (owner_id = auth.uid() AND auth.uid() IS NOT NULL);

-- UPDATE: members can update workspaces they belong to; owner can always update their own
CREATE POLICY "workspace_update" ON workspaces
  FOR UPDATE USING (is_workspace_member(id) OR owner_id = auth.uid());

-- DELETE: only owner can delete
CREATE POLICY "workspace_delete" ON workspaces
  FOR DELETE USING (owner_id = auth.uid());

-- 14. Polityki RLS: workspace_memberships
DROP POLICY IF EXISTS "wm_select" ON workspace_memberships;
CREATE POLICY "wm_select" ON workspace_memberships
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "wm_owner_write" ON workspace_memberships;
DROP POLICY IF EXISTS "wm_insert" ON workspace_memberships;
DROP POLICY IF EXISTS "wm_delete" ON workspace_memberships;
DROP POLICY IF EXISTS "wm_update" ON workspace_memberships;

-- INSERT: allowed when user is inserting themselves as owner of a workspace they own,
-- OR when an existing owner is adding a new member to their workspace.
CREATE POLICY "wm_insert" ON workspace_memberships
  FOR INSERT WITH CHECK (
    -- Case 1: user is adding themselves as owner of a workspace they just created
    (user_id = auth.uid() AND role = 'owner'
     AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
    OR
    -- Case 2: existing owner is adding a member
    EXISTS (
      SELECT 1 FROM workspace_memberships wm2
      WHERE wm2.workspace_id = workspace_memberships.workspace_id
        AND wm2.user_id = auth.uid()
        AND wm2.role = 'owner'
    )
  );

-- UPDATE/DELETE: only workspace owners can modify memberships
CREATE POLICY "wm_update" ON workspace_memberships
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm2
      WHERE wm2.workspace_id = workspace_memberships.workspace_id
        AND wm2.user_id = auth.uid()
        AND wm2.role = 'owner'
    )
  );

CREATE POLICY "wm_delete" ON workspace_memberships
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm2
      WHERE wm2.workspace_id = workspace_memberships.workspace_id
        AND wm2.user_id = auth.uid()
        AND wm2.role = 'owner'
    )
  );

-- 15. Polityki RLS: resources (zastap stara polityke user_id)
DROP POLICY IF EXISTS "own_resources" ON resources;
CREATE POLICY "workspace_resources" ON resources
  FOR ALL USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

-- 16. Polityki RLS: events (zastap stara polityke user_id)
DROP POLICY IF EXISTS "own_events" ON events;
CREATE POLICY "workspace_events" ON events
  FOR ALL USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

-- 17. Polityki RLS: invites
DROP POLICY IF EXISTS "invites_owner" ON invites;
CREATE POLICY "invites_owner" ON invites
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = invites.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = 'owner'
    )
  );

DROP POLICY IF EXISTS "invites_accept" ON invites;
CREATE POLICY "invites_accept" ON invites
  FOR UPDATE USING (
    invited_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND accepted_at IS NULL
    AND expires_at > now()
  );

COMMIT;
