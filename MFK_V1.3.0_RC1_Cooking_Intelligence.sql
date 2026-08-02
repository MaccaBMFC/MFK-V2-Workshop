-- =====================================================================
-- MFK v1.3.0 RC1 — COOKING INTELLIGENCE
-- Persistent active cooking sessions in Supabase
-- Run WITHOUT automatic RLS changes.
-- =====================================================================

create table if not exists public.active_cook_sessions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  meal_plan_day_id uuid references public.meal_plan_days(id) on delete set null,
  servings numeric(8,2) not null check (servings > 0),
  current_step integer not null default 0 check (current_step >= 0),
  status text not null default 'active' check (status in ('active','paused','completed')),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id)
);

create index if not exists idx_active_cook_sessions_recipe on public.active_cook_sessions(recipe_id);
create index if not exists idx_active_cook_sessions_activity on public.active_cook_sessions(last_activity_at desc);

drop trigger if exists trg_active_cook_sessions_updated_at on public.active_cook_sessions;
create trigger trg_active_cook_sessions_updated_at
before update on public.active_cook_sessions
for each row execute function public.set_updated_at();

alter table public.active_cook_sessions enable row level security;

drop policy if exists "Users manage their own active cook session" on public.active_cook_sessions;
create policy "Users manage their own active cook session"
on public.active_cook_sessions for all
to authenticated
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

grant select, insert, update, delete on public.active_cook_sessions to authenticated;

-- v1.2 journal fields, safe to rerun.
alter table public.recipe_cook_logs
  add column if not exists rating smallint,
  add column if not exists family_reaction text;

alter table public.recipe_cook_logs drop constraint if exists recipe_cook_logs_rating_check;
alter table public.recipe_cook_logs add constraint recipe_cook_logs_rating_check
check (rating is null or rating between 1 and 5);
