-- Resource manual ordering.
--
-- Adds a persisted sibling order used by the Projects tree. Existing rows are
-- backfilled from created_at so old workspaces keep a stable deterministic
-- order, while new projects can be inserted at the top.

BEGIN;

ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS sort_order BIGINT NOT NULL DEFAULT 0;

UPDATE public.resources
SET sort_order = FLOOR(EXTRACT(EPOCH FROM created_at) * 1000)::BIGINT
WHERE sort_order = 0;

CREATE INDEX IF NOT EXISTS resources_workspace_parent_order_idx
  ON public.resources (workspace_id, parent_id, sort_order, created_at);

COMMIT;
