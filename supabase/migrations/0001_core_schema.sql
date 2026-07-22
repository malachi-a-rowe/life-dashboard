-- Life Dashboard — core schema
-- Moves state out of a single localStorage JSON blob (ld_v10) and into real
-- tables so a server can query, index and write them.
--
-- Every table is owned by a user and protected by row-level security: a row is
-- only ever visible to the account that created it.

-- ─────────────────────────── helpers ───────────────────────────

create extension if not exists "pgcrypto";

-- Applies the standard "only the owner can touch this row" policy set.
create or replace function apply_owner_rls(tbl regclass) returns void as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('drop policy if exists "owner_all" on %s', tbl);
  execute format($f$
    create policy "owner_all" on %s
      for all
      using (user_id = auth.uid())
      with check (user_id = auth.uid())
  $f$, tbl);
end;
$$ language plpgsql;

create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────── profile ───────────────────────────

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  body_weight numeric,
  theme       text default 'field',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table profiles enable row level security;
drop policy if exists "own_profile" on profiles;
create policy "own_profile" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
drop trigger if exists profiles_touch on profiles;
create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_at();

-- ─────────────────────────── finance ───────────────────────────

create table if not exists accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  type        text not null default 'Cash',      -- Cash | Credit Card | Investment | Loan
  start_bal   numeric not null default 0,
  sort_order  int  not null default 0,           -- mirrors the tracker's ordering
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);
select apply_owner_rls('accounts');
drop trigger if exists accounts_touch on accounts;
create trigger accounts_touch before update on accounts
  for each row execute function touch_updated_at();

create table if not exists transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  occurred_on      date not null,
  account          text not null,
  description      text not null default '',
  category         text not null default 'Other',
  kind             text not null default 'Expense',  -- Expense | Income | Transfer | Adjustment
  amount           numeric not null,
  transfer_account text,                              -- destination when kind = Transfer
  bucket           text,                              -- savings bucket tag
  entry_seq        bigserial,                         -- preserves entry order for reconciliation
  external_id      text,                              -- Plaid/CSV dedupe key
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
select apply_owner_rls('transactions');
drop trigger if exists transactions_touch on transactions;
create trigger transactions_touch before update on transactions
  for each row execute function touch_updated_at();

create index if not exists transactions_user_date on transactions (user_id, occurred_on desc);
create index if not exists transactions_user_seq  on transactions (user_id, entry_seq);
create unique index if not exists transactions_external
  on transactions (user_id, external_id) where external_id is not null;

create table if not exists savings_buckets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  goal        numeric not null default 0,
  start_amt   numeric not null default 0,
  manual_current numeric not null default 0,   -- used only when no tagged transfers exist
  monthly     numeric not null default 0,
  is_percent  boolean not null default false,
  started_on  date,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);
select apply_owner_rls('savings_buckets');

create table if not exists budgets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text not null,
  planned    numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, category)
);
select apply_owner_rls('budgets');

-- The three-tier zero-based plan keeps its shape as JSON: it is edited as a
-- whole and never queried field-by-field.
create table if not exists finance_plans (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table finance_plans enable row level security;
drop policy if exists "own_finance_plan" on finance_plans;
create policy "own_finance_plan" on finance_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────── fitness ───────────────────────────

create table if not exists workouts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  performed_on date not null default current_date,
  name        text not null default '',
  program     text,
  phase       text,
  week        int,
  duration_min int,
  notes       text default '',
  warm_done   boolean default false,
  cool_done   boolean default false,
  mobility_done boolean default false,
  created_at  timestamptz not null default now()
);
select apply_owner_rls('workouts');
create index if not exists workouts_user_date on workouts (user_id, performed_on desc);

create table if not exists workout_sets (
  id          uuid primary key default gen_random_uuid(),
  workout_id  uuid not null references workouts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  exercise    text not null,
  block       text,
  set_index   int not null,
  reps        text,
  duration    text,
  weight      numeric,
  rpe         numeric,
  completed   boolean not null default false
);
select apply_owner_rls('workout_sets');
create index if not exists workout_sets_lookup on workout_sets (user_id, exercise, workout_id);

create table if not exists personal_records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  metric     text not null,          -- bench | squat | dead | push | pull | sit | run5k | swim
  current_val numeric,
  goal_val   numeric,
  unit       text,
  achieved_on date,
  updated_at timestamptz not null default now(),
  unique (user_id, metric)
);
select apply_owner_rls('personal_records');

create table if not exists plan_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  program    text,
  phase_idx  int not null default 0,
  week       int not null default 1,
  day_idx    int not null default 0,
  updated_at timestamptz not null default now()
);
alter table plan_state enable row level security;
drop policy if exists "own_plan_state" on plan_state;
create policy "own_plan_state" on plan_state
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────── habits & goals ───────────────────────────

create table if not exists habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  cadence     text not null default 'daily',
  sort_order  int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
select apply_owner_rls('habits');

create table if not exists habit_logs (
  id        uuid primary key default gen_random_uuid(),
  habit_id  uuid not null references habits(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  logged_on date not null,
  done      boolean not null default true,
  unique (habit_id, logged_on)
);
select apply_owner_rls('habit_logs');
create index if not exists habit_logs_user_date on habit_logs (user_id, logged_on desc);

create table if not exists goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  area        text,
  name        text not null,
  target      text,
  due_on      date,
  progress    numeric default 0,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
select apply_owner_rls('goals');

-- ─────────────────────────── migration landing pad ───────────────────────────

-- The existing single-blob sync target. Kept so the current app keeps working
-- while data is copied across; drop it once the migration is verified.
create table if not exists dashboard (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table dashboard enable row level security;
drop policy if exists "own_dashboard" on dashboard;
create policy "own_dashboard" on dashboard
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
