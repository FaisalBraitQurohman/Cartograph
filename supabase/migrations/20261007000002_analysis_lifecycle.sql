-- The analysis lifecycle the dashboard's table shows.
--
-- The first migration gave an analysis a status and a creation time. The table
-- the workspace renders needs more: which commit was parsed, when the run
-- finished, and — when it failed — why. This adds those, and renames the
-- in-flight state to the word the interface uses.

-- The old status vocabulary has to go before the new one can be written, and
-- the new columns have to exist before a constraint can reference them. Order
-- matters inside a single migration; this one is written top to bottom.
alter table public.analyses drop constraint analyses_status_check;

alter table public.analyses
  add column if not exists commit_sha text,
  add column if not exists finished_at timestamptz,
  add column if not exists error text;

-- `parsing` replaces `running`. The state is about what is happening to the
-- repository, not how the process is scheduled.
update public.analyses set status = 'parsing' where status = 'running';

-- Rows that already reached a terminal state predate the finish time. Give them
-- one rather than leaving the constraint below impossible to add.
update public.analyses
   set finished_at = created_at
 where status in ('complete', 'failed')
   and finished_at is null;

alter table public.analyses
  add constraint analyses_status_check
  check (status in ('queued', 'parsing', 'complete', 'failed'));

-- An analysis has a finish time exactly when it has stopped. A queued or parsing
-- run has not finished; a complete or failed one has. Stating it as an
-- equivalence means a half-finished row cannot be written in either direction.
alter table public.analyses
  add constraint analyses_finished_at_check
  check ((status in ('complete', 'failed')) = (finished_at is not null));

-- A reason exists only for a failure. A completed analysis carrying an error
-- message is a contradiction the interface would have to render.
alter table public.analyses
  add constraint analyses_error_check
  check (error is null or status = 'failed');

