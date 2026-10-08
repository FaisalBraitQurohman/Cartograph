-- Cartograph schema, first migration.
--
-- Tenancy is the database's job. Every domain table carries the Clerk
-- organization id of the team that owns it, and a policy — not the application
-- — decides who may see a row. The predicate reads the organization off the
-- signed-in token, so the same query returns different rows as the caller
-- switches organization. No table is readable without a policy on it.

-- Row-level security is on by default, not per table.
--
-- A table with RLS enabled and no policy returns nothing, which is visible. A
-- table where someone forgot to enable it returns everything, silently. This
-- trigger makes the second case impossible: every table created in `public`
-- gets RLS enabled, and if that can't happen the CREATE TABLE fails.
--
-- Defined here, in a migration, so the guarantee lives in version control
-- rather than in a copy the dashboard installed. It replaces that copy.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      -- No exception handler: if this fails, the CREATE TABLE fails with it.
      execute format(
        'alter table if exists %s enable row level security',
        cmd.object_identity
      );
    end if;
  end loop;
end;
$function$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

-- The tenant registry.
--
-- Its id is the Clerk organization id (`org_...`) — the value the session token
-- carries. Nothing in Postgres creates these rows yet; they are seeded, and a
-- sync from Clerk arrives with the feature that needs it.
--
-- The spec calls for eight domain tables, each owning its rows through a
-- foreign key to an organization. That foreign key needs something to point
-- at, and organizations live in Clerk, so this table exists to be that target.
-- Deleting a row here removes everything that belongs to it.
create table public.organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

-- One repository. Public only, so no token is ever stored.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null
    references public.organizations (id) on delete cascade,
  name text not null,
  repo_url text not null,
  created_at timestamptz not null default now()
);

-- One run of the parser over a project. `status` is the state the dashboard
-- shows for it.
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null
    references public.organizations (id) on delete cascade,
  project_id uuid not null
    references public.projects (id) on delete cascade,
  status text not null
    constraint analyses_status_check
    check (status in ('queued', 'running', 'complete', 'failed')),
  created_at timestamptz not null default now()
);

-- One parsed source file, keyed by its path relative to the repository root.
--
-- The fan-in and fan-out counts are stored rather than derived on read because
-- the map asks for them constantly and they are arithmetic over a list the
-- parser already holds — the same numbers the graph would compute.
create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null
    references public.organizations (id) on delete cascade,
  analysis_id uuid not null
    references public.analyses (id) on delete cascade,
  path text not null,
  language text,
  fan_in integer not null default 0,
  fan_out integer not null default 0,
  created_at timestamptz not null default now(),
  constraint files_analysis_path_key unique (analysis_id, path)
);

-- One import, re-export, dynamic import or `require()` — the lines of the map.
--
-- Both ends are real files. A specifier that could not be resolved is not an
-- edge; it is a line in the coverage report. Drawing a line to a file that may
-- or may not be the right one is the failure this product exists to avoid.
create table public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null
    references public.organizations (id) on delete cascade,
  analysis_id uuid not null
    references public.analyses (id) on delete cascade,
  from_file_id uuid not null
    references public.files (id) on delete cascade,
  to_file_id uuid not null
    references public.files (id) on delete cascade,
  kind text not null
    constraint edges_kind_check
    check (kind in ('import', 're-export', 'dynamic', 'require')),
  specifier text,
  created_at timestamptz not null default now()
);

-- A framework route, recovered from syntax. Both columns are required: the
-- method and the full path, or nothing. A guessed route is as wrong as an
-- invented edge.
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null
    references public.organizations (id) on delete cascade,
  analysis_id uuid not null
    references public.analyses (id) on delete cascade,
  file_id uuid not null
    references public.files (id) on delete cascade,
  method text not null
    constraint routes_method_check
    check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')),
  path text not null,
  created_at timestamptz not null default now()
);

-- The explanation cache. One row per file, because the cache is the point:
-- asking twice must not call the model twice. `model` records what wrote it.
create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null
    references public.organizations (id) on delete cascade,
  analysis_id uuid not null
    references public.analyses (id) on delete cascade,
  file_id uuid not null
    references public.files (id) on delete cascade,
  body text not null,
  model text not null,
  created_at timestamptz not null default now(),
  constraint explanations_file_id_key unique (file_id)
);

-- What sort of thing a file is. Convention answers this for most files; the
-- model is only asked about the ones convention could not name, which is why
-- `source` is recorded — a label the model chose is not the same claim as one
-- read off the path.
create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null
    references public.organizations (id) on delete cascade,
  analysis_id uuid not null
    references public.analyses (id) on delete cascade,
  file_id uuid not null
    references public.files (id) on delete cascade,
  role text not null,
  source text not null
    constraint file_roles_source_check
    check (source in ('convention', 'ai')),
  created_at timestamptz not null default now(),
  constraint file_roles_file_id_key unique (file_id)
);

-- A repository-level observation worth surfacing, such as a utility forty
-- files depend on. It may point at a file or stand on its own.
create table public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null
    references public.organizations (id) on delete cascade,
  analysis_id uuid not null
    references public.analyses (id) on delete cascade,
  file_id uuid
    references public.files (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);
-- The predicate every policy uses, in one place.
--
-- It reads the organization off the signed-in token — no table lookup, no call
-- to the identity provider at query time. When there is no token, or the token
-- carries no organization, this is null and `organization_id = null` matches
-- nothing, so an unauthenticated request sees zero rows rather than an error.
--
-- `stable` plus the `(select ...)` wrapper in the policies below means the
-- token is parsed once per statement, not once per row.
create or replace function public.current_organization_id()
returns text
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    nullif(auth.jwt() ->> 'org_id', ''),
    nullif(auth.jwt() -> 'o' ->> 'id', '')
  );
$function$;

-- Foreign keys are not indexed automatically, and both the policy predicate
-- and every `on delete cascade` walk them.
create index projects_organization_id_idx
  on public.projects (organization_id);
create index analyses_organization_id_idx
  on public.analyses (organization_id);
create index analyses_project_id_idx
  on public.analyses (project_id);
create index files_organization_id_idx
  on public.files (organization_id);
create index files_analysis_id_idx
  on public.files (analysis_id);
create index edges_organization_id_idx
  on public.edges (organization_id);
create index edges_analysis_id_idx
  on public.edges (analysis_id);
create index edges_from_file_id_idx
  on public.edges (from_file_id);
create index edges_to_file_id_idx
  on public.edges (to_file_id);
create index routes_organization_id_idx
  on public.routes (organization_id);
create index routes_analysis_id_idx
  on public.routes (analysis_id);
create index routes_file_id_idx
  on public.routes (file_id);
create index explanations_organization_id_idx
  on public.explanations (organization_id);
create index explanations_analysis_id_idx
  on public.explanations (analysis_id);
create index file_roles_organization_id_idx
  on public.file_roles (organization_id);
create index file_roles_analysis_id_idx
  on public.file_roles (analysis_id);
create index insights_organization_id_idx
  on public.insights (organization_id);
create index insights_analysis_id_idx
  on public.insights (analysis_id);
create index insights_file_id_idx
  on public.insights (file_id);

-- One policy per table, and it is the same sentence nine times: a row is yours
-- if its organization is the one on your token. `for all` covers read, insert,
-- update and delete, and with no separate `with check` the same predicate also
-- guards what you may write — so a row cannot be created into, or moved to,
-- another organization.
--
-- RLS is already enabled on all nine by the event trigger above; the policies
-- are what turn "enabled and empty" into "yours".
create policy organizations_tenant on public.organizations
  for all to authenticated
  using (id = (select public.current_organization_id()))
  with check (id = (select public.current_organization_id()));

create policy projects_tenant on public.projects
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

create policy analyses_tenant on public.analyses
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

create policy files_tenant on public.files
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

create policy edges_tenant on public.edges
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

create policy routes_tenant on public.routes
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

create policy explanations_tenant on public.explanations
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

create policy file_roles_tenant on public.file_roles
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

create policy insights_tenant on public.insights
  for all to authenticated
  using (organization_id = (select public.current_organization_id()))
  with check (organization_id = (select public.current_organization_id()));

