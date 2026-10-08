-- Seed data.
--
-- Nothing creates any of this yet — the parser and the analysis form arrive in
-- later phases. So the dashboard has to be handed rows to prove what it does:
-- that it renders a repository, a state, a commit and two timestamps, and that
-- switching organization changes the list.
--
-- Five analyses for the first organization, covering every state the table can
-- show — queued, parsing, a failure carrying its reason, and two completions.
-- One for the second organization. The third is left empty, so the empty state
-- is reachable by switching to it rather than only existing in the code.
--
-- Idempotent: every row has a fixed id and is upserted, so re-running converges
-- instead of duplicating. Those ids never belong to a row the application
-- wrote, so an upsert here cannot clobber real data.

insert into public.organizations (id, name) values
  ('org_3KMc8nw67UKZpesNU9MCHJVscgI', 'My Organization'),
  ('org_3KMrgL4KDgdg286esGvGX9kCJoH', 'Second Team')
on conflict (id) do update set name = excluded.name;

-- Public repositories only; the URL is the whole input.
insert into public.projects (id, organization_id, name, repo_url) values
  ('11111111-1111-4111-8111-111111111111',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'shadcn-ui/ui', 'https://github.com/shadcn-ui/ui'),
  ('11111111-1111-4111-8111-111111111112',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'vercel/next.js', 'https://github.com/vercel/next.js'),
  ('11111111-1111-4111-8111-111111111113',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'tailwindlabs/tailwindcss',
   'https://github.com/tailwindlabs/tailwindcss'),
  ('22222222-2222-4222-8222-222222222222',
   'org_3KMrgL4KDgdg286esGvGX9kCJoH',
   'second-team/api', 'https://github.com/second-team/api')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  repo_url = excluded.repo_url;

insert into public.analyses
  (id, organization_id, project_id, status, commit_sha, created_at, finished_at, error)
values
  -- queued: submitted, no commit resolved yet, not finished.
  ('a1111111-1111-4111-8111-111111111114',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   '11111111-1111-4111-8111-111111111113',
   'queued', null, now() - interval '2 minutes', null, null),
  -- parsing: in flight, the commit is known, not finished.
  ('a1111111-1111-4111-8111-111111111112',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   '11111111-1111-4111-8111-111111111112',
   'parsing', 'a93be01', now() - interval '3 minutes', null, null),
  -- failed: stopped, with the reason the interface shows under the state.
  ('a1111111-1111-4111-8111-111111111113',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   '11111111-1111-4111-8111-111111111111',
   'failed', null, now() - interval '5 hours', now() - interval '5 hours',
   'Repository archive download timed out'),
  -- complete: the analysis the graph tables below hang off.
  ('a1111111-1111-4111-8111-111111111111',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   '11111111-1111-4111-8111-111111111111',
   'complete', '0c7d9e2',
   now() - interval '24 hours', now() - interval '24 hours', null),
  -- complete, older.
  ('a1111111-1111-4111-8111-111111111115',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   '11111111-1111-4111-8111-111111111112',
   'complete', '4f1c2a9',
   now() - interval '3 days', now() - interval '3 days', null),
  -- the second organization: one queued analysis.
  ('a2222222-2222-4222-8222-222222222222',
   'org_3KMrgL4KDgdg286esGvGX9kCJoH',
   '22222222-2222-4222-8222-222222222222',
   'queued', null, now() - interval '1 minute', null, null)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  project_id = excluded.project_id,
  status = excluded.status,
  commit_sha = excluded.commit_sha,
  created_at = excluded.created_at,
  finished_at = excluded.finished_at,
  error = excluded.error;

-- A few files and edges under the completed analysis, so the graph tables are
-- not empty shells and the fan-in/fan-out columns carry real numbers.
insert into public.files (id, organization_id, analysis_id, path, language, fan_in, fan_out) values
  ('f1111111-1111-4111-8111-111111111101',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111', 'src/app/page.tsx', 'tsx', 0, 2),
  ('f1111111-1111-4111-8111-111111111102',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111', 'src/lib/graph.ts', 'ts', 2, 1),
  ('f1111111-1111-4111-8111-111111111103',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111', 'src/lib/format.ts', 'ts', 1, 0)
on conflict (id) do nothing;

insert into public.edges (id, organization_id, analysis_id, from_file_id, to_file_id, kind, specifier) values
  ('e1111111-1111-4111-8111-111111111101',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111',
   'f1111111-1111-4111-8111-111111111101',
   'f1111111-1111-4111-8111-111111111102', 'import', '@/lib/graph'),
  ('e1111111-1111-4111-8111-111111111102',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111',
   'f1111111-1111-4111-8111-111111111101',
   'f1111111-1111-4111-8111-111111111103', 'import', '@/lib/format'),
  ('e1111111-1111-4111-8111-111111111103',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111',
   'f1111111-1111-4111-8111-111111111102',
   'f1111111-1111-4111-8111-111111111103', 'import', './format')
on conflict (id) do nothing;

insert into public.routes (id, organization_id, analysis_id, file_id, method, path) values
  ('c1111111-1111-4111-8111-111111111101',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111',
   'f1111111-1111-4111-8111-111111111101', 'GET', '/')
on conflict (id) do nothing;

insert into public.explanations (id, organization_id, analysis_id, file_id, body, model) values
  ('d1111111-1111-4111-8111-111111111101',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111',
   'f1111111-1111-4111-8111-111111111102',
   'Renders the map. Imports its layout maths from graph.ts and its number '
   || 'formatting from format.ts, and nothing imports it in turn.',
   'seed')
on conflict (id) do nothing;

insert into public.file_roles (id, organization_id, analysis_id, file_id, role, source) values
  ('b1111111-1111-4111-8111-111111111101',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111',
   'f1111111-1111-4111-8111-111111111101', 'route', 'convention'),
  ('b1111111-1111-4111-8111-111111111102',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111',
   'f1111111-1111-4111-8111-111111111102', 'utility', 'ai')
on conflict (id) do nothing;

insert into public.insights (id, organization_id, analysis_id, file_id, kind, title, body) values
  ('91111111-1111-4111-8111-111111111101',
   'org_3KMc8nw67UKZpesNU9MCHJVscgI',
   'a1111111-1111-4111-8111-111111111111',
   'f1111111-1111-4111-8111-111111111102', 'hub',
   'graph.ts is imported by 2 files',
   'A change here reaches both the page and the formatter.')
on conflict (id) do nothing;
