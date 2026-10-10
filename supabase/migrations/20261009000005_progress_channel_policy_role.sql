-- Not role-restricted, on purpose.
--
-- The policy in the previous migration read:
--
--   create policy analysis_progress_subscribe on realtime.messages
--     for select to authenticated using (...)
--
-- and it never applied. `realtime.authorize()` sets the session role from the
-- token's own `role` claim before it evaluates the policy, and a Clerk token has no
-- such claim - it carries Clerk's, not Supabase's. The policy was therefore evaluated
-- as `anon`, did not apply, and the browser's socket came back CHANNEL_ERROR.
--
-- The symptom was a progress page that said "Live: no" for the whole run. Nothing was
-- wrong with the run or the publisher; a probe showed the service key subscribing and
-- sending fine, and a client with no token being refused. The refusal was correct and
-- so was the failure - the browser's token was arriving, and being evaluated as
-- anonymous, which the role restriction turned into a denial.
--
-- The role was never the control. Tenancy is: the organization in the topic compared
-- against the organization on the caller's token. That is the check below and it is
-- unchanged.
--
-- Read back after this change, by setting the role and the claims the way
-- realtime.authorize() does and selecting from realtime.messages:
--
--   own organization, role anon           -> rows
--   own organization, role authenticated  -> rows
--   no organization on the token          -> 0 rows
--   another organization, either role     -> 0 rows
--
-- The last two are the ones that matter, and neither depends on the role. A request
-- with no organization reads nothing whichever role it arrives as, so dropping the
-- role restriction gives up nothing.
--
-- The alternative is to add `{"role": "authenticated"}` to the Clerk session token so
-- the token looks like a Supabase one. That works too, and is the more conventional
-- integration - but it puts a Supabase-shaped claim on a Clerk-issued token for the
-- sake of a role gate that was never doing any work. If that claim is ever wanted for
-- another reason, add it back and this policy can be restricted again.
drop policy if exists analysis_progress_subscribe on realtime.messages;

create policy analysis_progress_subscribe on realtime.messages
  for select
  using (
    split_part(realtime.topic(), ':', 1) = 'analysis'
    and split_part(realtime.topic(), ':', 2)
      = (select public.current_organization_id())
  );