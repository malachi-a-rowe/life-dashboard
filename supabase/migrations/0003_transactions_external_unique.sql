-- The transactions upsert needs (user_id, external_id) as an ON CONFLICT target.
-- A partial unique index (… where external_id is not null) can't be used for
-- ON CONFLICT, so replace it with a full unique constraint. Every migrated and
-- Plaid-imported row sets external_id, so nulls aren't a concern in practice.

drop index if exists transactions_external;

alter table transactions drop constraint if exists transactions_user_external_key;
alter table transactions add  constraint transactions_user_external_key
  unique (user_id, external_id);
