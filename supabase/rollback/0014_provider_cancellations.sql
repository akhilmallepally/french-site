-- rollback/0014_provider_cancellations.sql
-- WARNING: deletes the record of provider cancellations (which subscriptions still had to be
-- cancelled in Dodo). Check first that none is pending:
--   select provider_subscription_id from public.provider_cancellations where done_at is null;
-- The webhook code from Prompt 84 needs this table: undo it only together with that code.

begin;

drop table if exists public.provider_cancellations;

commit;
