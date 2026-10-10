-- The progress channel: one per analysis, published by a trigger, policed for the
-- organization that owns it.
--
-- The spec asks for progress "updated live" and "driven from the database, not
-- from the browser polling". Two things have to exist before a page can subscribe,
-- and neither of them is the page:
--
--   1. Something in the database has to publish when the stage moves. Polling from
--      the browser would need a timer, and a timer is a guess about when to give
--      up. A publish is a fact.
--
--   2. The channel has to be declared before anything can publish to it.
--      Publishing to an unregistered channel does not error - it goes nowhere, and
--      the symptom is a progress page that simply never updates. That failure is
--      worth naming because it looks exactly like a broken page.

-- The publication is what carries an insert in realtime.messages out to whoever is
-- listening. On this project it existed but had no tables in it, so nothing could
-- have been published no matter what the trigger did.
--
-- A publication can only be changed by its owner, and the error if it is already a
-- member is the whole point of checking rather than assuming.
do $$
begin
  if not exists (
    select 1
    from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    where p.pubname = 'supabase_realtime'
      and pr.prrelid = 'realtime.messages'::regclass
  ) then
    alter publication supabase_realtime add table realtime.messages;
  end if;
end $$;

-- Who may listen.
--
-- realtime.messages has row-level security enabled and, before this, no policy at
-- all. RLS enabled with no policy returns nothing, so this is the statement that
-- makes the stream readable rather than the one that restricts it - but it is also
-- the restriction, because it names one organization and the topic carries another.
--
-- The topic is `analysis:<organization id>:<analysis id>`. Splitting it back apart
-- is how the predicate checks it. An organization id is `org_...` and an analysis id
-- is a uuid, so neither contains a colon and the second segment is exactly the
-- organization. A channel for somebody else's analysis fails this predicate, which
-- is the same answer their rows give.
create policy analysis_progress_subscribe on realtime.messages
  for select to authenticated
  using (
    split_part(realtime.topic(), ':', 1) = 'analysis'
    and split_part(realtime.topic(), ':', 2)
      = (select public.current_organization_id())
  );

-- Publish from a trigger on our own table.
--
-- THIS IS NOT DONE, and the reason is worth reading before anyone tries it again.
--
-- The spec asks for exactly this: a trigger on `analyses`, firing when the stage
-- moves, calling `realtime.send`. It was written, applied, and it publishes nothing
-- on this project.
--
--   `realtime.messages` is partitioned by `inserted_at` and has no partitions at
--   all. Every `realtime.send()` fails with "no partition of relation messages
--   found for row". The function catches `WHEN OTHERS` and raises only a WARNING,
--   so a publish that cannot happen is indistinguishable from one that did - the
--   trigger "works", the page never updates, and nothing anywhere reports an error.
--   There is no logical replication slot either, so nothing is reading the WAL.
--
-- Client-to-client broadcast over the same service does work. So the publisher is
-- `lib/realtime/publish-progress.mts`, in the process that is already running the
-- analysis, and this stays unwritten.
--
-- What is left here is the part that does work and the part that must: the
-- publication and the policy. The page still never polls, the database is still
-- the record, and nothing on screen moves unless the run really moved.
--
-- To finish this properly the partitions have to exist. That is Supabase's own
-- maintenance creating daily partitions for `realtime.messages`, and it is not
-- happening on this project. The version of this file to apply once it does is in
-- the git history of this comment.
--
-- For reference, what the trigger was:
--
--   create function public.publish_analysis_stage() returns trigger
--   language plpgsql security definer set search_path = '' as $$
--   begin
--     if new.stage is distinct from old.stage then
--       perform realtime.send(
--         jsonb_build_object('analysis_id', new.id, 'stage', new.stage,
--                             'message', new.stage_message),
--         'progress', 'analysis:' || new.organization_id || ':' || new.id, true);
--     end if;
--     return null;
--   end $$;
--
--   create trigger analyses_publish_stage after update of stage on public.analyses
--     for each row execute function public.publish_analysis_stage();
--
-- Guarded on the stage actually differing, because `writeStage` updates the row on
-- every stage and an unguarded trigger would publish the same stage twice. And
-- carrying only the stage and its message rather than the row, so the page has
-- nothing to filter and nothing to interpret.