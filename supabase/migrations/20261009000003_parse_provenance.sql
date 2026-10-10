-- Parse provenance, and what the map needs from a file.
--
-- The first migration gave `files` a path, a language and two counts. That is
-- enough to draw a graph of names and is not enough to draw this one: the map
-- groups by folder, the detail pane reports how long a file is, and a later phase
-- has to know whether a file on disk is the file that was parsed. All three come
-- from the parse and none of them survived into the table.
--
-- `folder` in particular is not a convenience. Folding directories into nodes is
-- the map's whole structure, and a graph built from paths alone has to re-derive
-- the folder of every file by string surgery — a second answer to a question the
-- parser already answered.

-- Applied as `parse_provenance`, version 20261009070508.
--
-- Two statements in here were written wrong and corrected before this file was
-- applied. Both are left as they are now, because the wrong version is the
-- instructive one:
--
--   The backfill took the last path segment instead of everything before it, which
--   filed `src/app/page.tsx` under `page.tsx`. Caught by reading the three seeded
--   rows back rather than by the migration succeeding.
--
--   The stage constraint was added before the seeded analyses were given a stage, so
--   it was rejected against three rows that already existed. A constraint is checked
--   against the rows that are already there, not only the ones written after it.

alter table public.files
  add column if not exists folder text,
  add column if not exists lines integer,
  add column if not exists module_id text,
  add column if not exists sha256 text,
  add column if not exists is_entry_point boolean not null default false;

-- The parser guarantees a folder on every file it reports. Stated as a constraint
-- rather than as a default, because a file with no folder is a parse that did not
-- run and the map must not be able to draw it.
alter table public.files
  add constraint files_folder_check check (folder is not null);

-- Backfill from the three seeded rows, which predate the column.
--
-- `regexp_replace(path, '/[^/]*$', '')` strips the last segment and keeps everything
-- before it, which is the folder. Reading it the other way round — taking the last
-- segment — gives the file name, and a `src/app/page.tsx` filed under `page.tsx` is
-- a folder value that no amount of downstream care can recover from.
update public.files
   set folder = case
     when path like '%/%' then regexp_replace(path, '/[^/]*$', '')
     else '.'
   end
 where folder is null;

alter table public.files
  alter column folder set not null;

-- An import edge carries the line it was written on, which is what makes an edge
-- clickable back to the code that created it. Nullable because the column is new
-- and the seeded edges predate it.
alter table public.edges
  add column if not exists line integer;

-- One repository per organization.
--
-- The pipeline treats "paste this URL" as "show me this repository", so two rows
-- for one repository would mean two maps that disagree with each other and no way
-- to say which is current. The constraint is on (organization_id, repo_url) rather
-- than on the repository's name because the URL is what identifies it — `vuejs/devtools`
-- and `https://github.com/vuejs/devtools` are the same repository, and only one
-- form is canonicalised before this constraint is ever consulted.
create unique index projects_org_repo_url_key
  on public.projects (organization_id, repo_url);

-- The stage a run is in, and what it is doing.
--
-- `stage` is a position in a fixed list rather than free text, so the interface
-- renders a known set and cannot show a stage nobody defined. `stage_message` is
-- free text because the useful thing to say while parsing is a file count, and a
-- count is not one of a fixed list.
--
-- `stage_at` is when the stage last moved. A run with no queue and no timeout can
-- die without writing anything, and this is what lets a dashboard tell "working" from
-- "abandoned" — a row still claiming to be parsing three minutes after it last moved
-- is not working.
alter table public.analyses
  add column if not exists stage text,
  add column if not exists stage_at timestamptz,
  add column if not exists stage_message text;

alter table public.analyses
  add constraint analyses_stage_check
  check (stage is null or stage in (
    'fetching', 'selecting', 'parsing', 'storing', 'done', 'failed'
  ));

-- The six seeded rows predate the stage column, and a constraint is checked against
-- the rows that already exist rather than only against the ones written after it.
--
-- Derived from status rather than guessed at: a complete run was in done, a failed one
-- was in failed, and a run still going gets the stage its status implies. The queued
-- rows have no archive yet, so fetching is the honest stage for them rather than the
-- one their status names.
update public.analyses
   set stage = case status
         when 'complete' then 'done'
         when 'failed' then 'failed'
         when 'parsing' then 'parsing'
         else 'fetching'
       end,
       stage_at = coalesce(finished_at, created_at);

-- A finished run carries a stage, a running one may not. Without this a row can say
-- `parsing` and carry a `finished_at`, and the dashboard has to decide which of the
-- two it believes.
alter table public.analyses
  add constraint analyses_stage_terminal_check
  check (stage is not null or status not in ('complete', 'failed'));

-- How much of the repository the graph actually covers.
--
-- The coverage banner cannot be computed from the files table: "how much did the
-- parser miss" is a fact about imports that were *not* resolved, and an unresolved
-- import is deliberately not an edge. Storing only the resolved graph would make a
-- thirty-percent-complete parse look complete, which is the one thing this table
-- exists to prevent.
--
-- Every count is an import statement the parser saw, so they sum. `files_found` and
-- `files_parsed` are file counts rather than import counts and are kept apart from
-- the rest for that reason.
create table public.coverage (
  analysis_id uuid primary key
    references public.analyses (id) on delete cascade,
  organization_id text not null
    references public.organizations (id) on delete cascade,
  files_found integer not null default 0,
  files_parsed integer not null default 0,
  files_skipped integer not null default 0,
  distinct_folders integer not null default 0,
  imports_total integer not null default 0,
  imports_resolved integer not null default 0,
  imports_outside integer not null default 0,
  imports_excluded integer not null default 0,
  imports_unresolved integer not null default 0,
  -- The share of imports that became edges, as a fraction of all imports seen.
  -- Stored rather than derived on read because the banner needs it on a page that
  -- must not query the import table to draw one line of text.
  resolved_fraction double precision
    generated always as (
      case when imports_total = 0 then null
      else imports_resolved::double precision / imports_total
      end
    ) stored,
  created_at timestamptz not null default now(),
  constraint coverage_files_check
    check (files_found = files_parsed + files_skipped),
  constraint coverage_imports_check
    check (imports_total = imports_resolved + imports_outside
                           + imports_excluded + imports_unresolved)
);

create index coverage_organization_id_idx on public.coverage (organization_id);

-- One policy per table, and the same sentence three times. The predicate is on
-- `organization_id`, the column this table carries itself, rather than a join
-- through to the analysis — so a row cannot be written for an analysis belonging to
-- another team even though both exist and the foreign key would accept it.
create policy coverage_tenant on public.coverage
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

-- Imports that did not become edges, with the reason each one failed.
--
-- This is the loud report the project asks for. A barrel-file repository that lost
-- its edges would otherwise render a clean, confident, wrong picture, and nothing
-- in `edges` records that anything went missing.
create table public.unresolved_imports (
  id bigint generated always as identity primary key,
  analysis_id uuid not null
    references public.analyses (id) on delete cascade,
  organization_id text not null
    references public.organizations (id) on delete cascade,
  file_path text not null,
  specifier text not null,
  kind text not null
    constraint unresolved_imports_kind_check
    check (kind in ('resolved', 'outside', 'excluded', 'unresolved')),
  reason text not null,
  line integer not null,
  import_kind text not null
    constraint unresolved_imports_import_kind_check
    check (import_kind in ('import', 're-export', 'dynamic')),
  created_at timestamptz not null default now()
);

create index unresolved_imports_analysis_id_idx on public.unresolved_imports (analysis_id);
create index unresolved_imports_organization_id_idx on public.unresolved_imports (organization_id);

create policy unresolved_imports_tenant on public.unresolved_imports
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

-- Files the parser found and did not parse, with the reason.
--
-- Distinct from `unresolved_imports`: this is a file that never became a node, while
-- that is an import that never became an edge. Both are how a reader learns the
-- graph is partial.
create table public.skipped_files (
  id bigint generated always as identity primary key,
  analysis_id uuid not null
    references public.analyses (id) on delete cascade,
  organization_id text not null
    references public.organizations (id) on delete cascade,
  path text not null,
  entry_kind text not null
    constraint skipped_files_kind_check check (entry_kind in ('file', 'directory')),
  reason text not null,
  created_at timestamptz not null default now()
);

create index skipped_files_analysis_id_idx on public.skipped_files (analysis_id);
create index skipped_files_organization_id_idx on public.skipped_files (organization_id);

create policy skipped_files_tenant on public.skipped_files
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

-- Row-level security is already on for the three tables above, by the event trigger
-- in the first migration. The policies are what turn "enabled and empty" into
-- "yours".
