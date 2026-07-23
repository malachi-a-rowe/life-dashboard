-- Constraints the migrate function relies on for idempotent upserts.
-- Separate migration so the core schema stays untouched.

alter table habits drop constraint if exists habits_user_name_key;
alter table habits add  constraint habits_user_name_key unique (user_id, name);

alter table goals drop constraint if exists goals_user_name_key;
alter table goals add  constraint goals_user_name_key unique (user_id, name);
