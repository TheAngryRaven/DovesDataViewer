-- Group the courses uploaded together in one bulk "contribute to the community
-- database" submit. Each course is still its own `submissions` row (so the
-- existing admin review/approve flow is unchanged); batch_id ties a user's
-- one-shot upload together so the admin can review it as a unit.
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE INDEX IF NOT EXISTS submissions_batch_id_idx ON public.submissions (batch_id);

COMMENT ON COLUMN public.submissions.batch_id IS
  'Groups multiple course submissions uploaded together in a single bulk submit. NULL for legacy single-course submissions.';
