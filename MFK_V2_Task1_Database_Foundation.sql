-- =====================================================================
-- MFK — MACCA'S FAMILY KITCHEN
-- V2.0 / SPRINT 1 / TASK 1
-- DATABASE FOUNDATION
--
-- Safe migration:
--   • Keeps the existing public.recipes and public.categories tables.
--   • Adds V2 columns to recipes without removing V1 fields.
--   • Creates structured ingredients, planning, shopping, favourites,
--     family members and cooking-history tables.
--
-- In Supabase SQL Editor, run this WITHOUT automatic RLS modification.
-- This script enables and configures Row Level Security itself.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. SHARED UPDATED-AT TRIGGER
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. FAMILY MEMBERS
--
-- A family member may optionally be linked to a Supabase login later.
-- This lets Ben, Tom, Cam, Jess and Macca exist as owners/favourites
-- even before each person has their own account.
-- ---------------------------------------------------------------------

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  avatar_emoji text not null default '👤',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_family_members_updated_at on public.family_members;
create trigger trg_family_members_updated_at
before update on public.family_members
for each row execute function public.set_updated_at();

-- Seed the agreed family names. Change or add names later in Settings.
insert into public.family_members (display_name, avatar_emoji, sort_order)
values
  ('Macca', '👨‍🍳', 10),
  ('Jess',  '👩‍🍳', 20),
  ('Ben',   '🧑',   30),
  ('Tom',   '🧑',   40),
  ('Cam',   '🧑',   50)
on conflict (display_name) do nothing;

-- ---------------------------------------------------------------------
-- 3. EXTEND THE EXISTING RECIPES TABLE
--
-- Existing V1 columns such as "serves" and JSON ingredient lines remain.
-- V2 can migrate recipes gradually instead of breaking the live app.
-- ---------------------------------------------------------------------

alter table public.recipes
  add column if not exists owner_member_id uuid
    references public.family_members(id) on delete set null,
  add column if not exists base_servings numeric(8,2),
  add column if not exists photo_url text,
  add column if not exists source_name text,
  add column if not exists source_type text
    check (source_type is null or source_type in
      ('family_original','family_adaptation','classic','other')),
  add column if not exists is_archived boolean not null default false;

-- Where an old recipe has a simple numeric "serves" value, copy it into
-- base_servings. Non-numeric values remain untouched for manual review.
update public.recipes
set base_servings = trim(serves)::numeric
where base_servings is null
  and serves is not null
  and trim(serves) ~ '^[0-9]+([.][0-9]+)?$';

-- ---------------------------------------------------------------------
-- 4. MASTER INGREDIENT LIBRARY
--
-- One canonical ingredient name throughout MFK.
-- default_destination:
--   woolworths | fruit_veg
-- ---------------------------------------------------------------------

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as
    (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  default_destination text not null default 'woolworths'
    check (default_destination in ('woolworths','fruit_veg')),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name)
);

drop trigger if exists trg_ingredients_updated_at on public.ingredients;
create trigger trg_ingredients_updated_at
before update on public.ingredients
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 5. STRUCTURED RECIPE INGREDIENTS
--
-- quantity is numeric so servings can scale.
-- display_quantity is optional for quantities that are not naturally
-- numeric, such as "to taste", "a splash", or "as needed".
-- ---------------------------------------------------------------------

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete restrict,
  quantity numeric(12,4),
  display_quantity text,
  unit text,
  preparation text,
  destination_override text
    check (destination_override is null or destination_override in
      ('woolworths','fruit_veg')),
  is_optional boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (quantity is not null or display_quantity is not null)
);

create index if not exists idx_recipe_ingredients_recipe
  on public.recipe_ingredients(recipe_id, sort_order);

create index if not exists idx_recipe_ingredients_ingredient
  on public.recipe_ingredients(ingredient_id);

drop trigger if exists trg_recipe_ingredients_updated_at
  on public.recipe_ingredients;
create trigger trg_recipe_ingredients_updated_at
before update on public.recipe_ingredients
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6. FAMILY FAVOURITES
-- ---------------------------------------------------------------------

create table if not exists public.recipe_favourites (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  family_member_id uuid not null
    references public.family_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recipe_id, family_member_id)
);

-- ---------------------------------------------------------------------
-- 7. COOKING HISTORY / COOK NOTES
-- ---------------------------------------------------------------------

create table if not exists public.recipe_cook_logs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  cooked_by_member_id uuid
    references public.family_members(id) on delete set null,
  cooked_on date not null default current_date,
  servings_cooked numeric(8,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recipe_cook_logs_recipe_date
  on public.recipe_cook_logs(recipe_id, cooked_on desc);

drop trigger if exists trg_recipe_cook_logs_updated_at
  on public.recipe_cook_logs;
create trigger trg_recipe_cook_logs_updated_at
before update on public.recipe_cook_logs
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 8. WEEKLY MEAL PLANS
--
-- A planning period can contain 7 or 8 calendar days. This supports the
-- family's practical Friday-to-Friday or Saturday-to-Saturday workflow.
-- ---------------------------------------------------------------------

create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  title text,
  start_date date not null,
  end_date date not null,
  preferred_start_day text not null default 'friday'
    check (preferred_start_day in ('friday','saturday')),
  status text not null default 'draft'
    check (status in ('draft','planned','completed','archived')),
  planned_by_member_id uuid
    references public.family_members(id) on delete set null,
  shopping_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (start_date, end_date)
);

drop trigger if exists trg_meal_plans_updated_at on public.meal_plans;
create trigger trg_meal_plans_updated_at
before update on public.meal_plans
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 9. MEALS ALLOCATED TO EACH DAY
--
-- meal_type:
--   recipe | leftovers | takeaway | eating_out | free_night | custom
-- ---------------------------------------------------------------------

create table if not exists public.meal_plan_days (
  id uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null
    references public.meal_plans(id) on delete cascade,
  meal_date date not null,
  meal_type text not null default 'recipe'
    check (meal_type in
      ('recipe','leftovers','takeaway','eating_out','free_night','custom')),
  recipe_id uuid references public.recipes(id) on delete set null,
  custom_meal_name text,
  planned_servings numeric(8,2),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meal_plan_id, meal_date),
  check (
    (meal_type = 'recipe' and recipe_id is not null)
    or
    (meal_type = 'custom' and custom_meal_name is not null)
    or
    (meal_type in ('leftovers','takeaway','eating_out','free_night'))
  )
);

create index if not exists idx_meal_plan_days_date
  on public.meal_plan_days(meal_date);

drop trigger if exists trg_meal_plan_days_updated_at
  on public.meal_plan_days;
create trigger trg_meal_plan_days_updated_at
before update on public.meal_plan_days
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 10. THE TWO PERSISTENT SHOPPING LISTS
-- ---------------------------------------------------------------------

create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  destination text not null unique
    check (destination in ('woolworths','fruit_veg')),
  display_name text not null,
  icon text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_shopping_lists_updated_at
  on public.shopping_lists;
create trigger trg_shopping_lists_updated_at
before update on public.shopping_lists
for each row execute function public.set_updated_at();

insert into public.shopping_lists (destination, display_name, icon)
values
  ('woolworths', 'Woolworths', '🛒'),
  ('fruit_veg',  'Fruit & Veg', '🥕')
on conflict (destination) do update
set display_name = excluded.display_name,
    icon = excluded.icon;

-- ---------------------------------------------------------------------
-- 11. SHOPPING ITEMS
--
-- source_type keeps manual additions safe when a meal plan is regenerated.
-- Generated items may point back to the meal plan and recipe ingredient.
-- ---------------------------------------------------------------------

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null
    references public.shopping_lists(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  item_name text not null,
  quantity numeric(12,4),
  display_quantity text,
  unit text,
  source_type text not null default 'manual'
    check (source_type in ('manual','meal_plan')),
  meal_plan_id uuid references public.meal_plans(id) on delete cascade,
  recipe_ingredient_id uuid
    references public.recipe_ingredients(id) on delete set null,
  is_checked boolean not null default false,
  checked_at timestamptz,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    source_type = 'manual'
    or (source_type = 'meal_plan' and meal_plan_id is not null)
  )
);

create index if not exists idx_shopping_items_list_checked
  on public.shopping_items(shopping_list_id, is_checked, sort_order);

create index if not exists idx_shopping_items_meal_plan
  on public.shopping_items(meal_plan_id)
  where meal_plan_id is not null;

drop trigger if exists trg_shopping_items_updated_at
  on public.shopping_items;
create trigger trg_shopping_items_updated_at
before update on public.shopping_items
for each row execute function public.set_updated_at();

-- Keep checked_at accurate.
create or replace function public.set_shopping_checked_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.is_checked = true and
     (old.is_checked = false or old.checked_at is null) then
    new.checked_at = now();
  elsif new.is_checked = false then
    new.checked_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shopping_items_checked_at
  on public.shopping_items;
create trigger trg_shopping_items_checked_at
before update of is_checked on public.shopping_items
for each row execute function public.set_shopping_checked_at();

-- ---------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY
--
-- Public read:
--   recipes/categories already use public read in V1.
--   structured ingredients must also be readable for recipe/cook screens.
--
-- Authenticated family:
--   full management of all MFK V2 data.
-- ---------------------------------------------------------------------

alter table public.family_members enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_favourites enable row level security;
alter table public.recipe_cook_logs enable row level security;
alter table public.meal_plans enable row level security;
alter table public.meal_plan_days enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;

-- FAMILY MEMBERS
drop policy if exists "Public can read family members"
  on public.family_members;
create policy "Public can read family members"
on public.family_members for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Authenticated users manage family members"
  on public.family_members;
create policy "Authenticated users manage family members"
on public.family_members for all
to authenticated
using (true)
with check (true);

-- INGREDIENTS
drop policy if exists "Public can read ingredients"
  on public.ingredients;
create policy "Public can read ingredients"
on public.ingredients for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Authenticated users manage ingredients"
  on public.ingredients;
create policy "Authenticated users manage ingredients"
on public.ingredients for all
to authenticated
using (true)
with check (true);

-- RECIPE INGREDIENTS
drop policy if exists "Public can read recipe ingredients"
  on public.recipe_ingredients;
create policy "Public can read recipe ingredients"
on public.recipe_ingredients for select
to anon, authenticated
using (true);

drop policy if exists "Authenticated users manage recipe ingredients"
  on public.recipe_ingredients;
create policy "Authenticated users manage recipe ingredients"
on public.recipe_ingredients for all
to authenticated
using (true)
with check (true);

-- FAVOURITES
drop policy if exists "Public can read recipe favourites"
  on public.recipe_favourites;
create policy "Public can read recipe favourites"
on public.recipe_favourites for select
to anon, authenticated
using (true);

drop policy if exists "Authenticated users manage recipe favourites"
  on public.recipe_favourites;
create policy "Authenticated users manage recipe favourites"
on public.recipe_favourites for all
to authenticated
using (true)
with check (true);

-- COOK LOGS: private to signed-in family accounts.
drop policy if exists "Authenticated users manage cook logs"
  on public.recipe_cook_logs;
create policy "Authenticated users manage cook logs"
on public.recipe_cook_logs for all
to authenticated
using (true)
with check (true);

-- PLANS
drop policy if exists "Authenticated users manage meal plans"
  on public.meal_plans;
create policy "Authenticated users manage meal plans"
on public.meal_plans for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users manage meal plan days"
  on public.meal_plan_days;
create policy "Authenticated users manage meal plan days"
on public.meal_plan_days for all
to authenticated
using (true)
with check (true);

-- SHOPPING
drop policy if exists "Authenticated users manage shopping lists"
  on public.shopping_lists;
create policy "Authenticated users manage shopping lists"
on public.shopping_lists for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users manage shopping items"
  on public.shopping_items;
create policy "Authenticated users manage shopping items"
on public.shopping_items for all
to authenticated
using (true)
with check (true);

-- ---------------------------------------------------------------------
-- 13. GRANTS
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select on public.family_members to anon, authenticated;
grant select on public.ingredients to anon, authenticated;
grant select on public.recipe_ingredients to anon, authenticated;
grant select on public.recipe_favourites to anon, authenticated;

grant insert, update, delete on public.family_members to authenticated;
grant insert, update, delete on public.ingredients to authenticated;
grant insert, update, delete on public.recipe_ingredients to authenticated;
grant insert, update, delete on public.recipe_favourites to authenticated;

grant select, insert, update, delete
  on public.recipe_cook_logs,
     public.meal_plans,
     public.meal_plan_days,
     public.shopping_lists,
     public.shopping_items
  to authenticated;

-- ---------------------------------------------------------------------
-- 14. HELPER VIEW FOR THE APP
--
-- Resolves each structured ingredient's final shopping destination.
-- ---------------------------------------------------------------------

create or replace view public.recipe_ingredients_expanded
with (security_invoker = true)
as
select
  ri.id,
  ri.recipe_id,
  ri.ingredient_id,
  i.name as ingredient_name,
  ri.quantity,
  ri.display_quantity,
  ri.unit,
  ri.preparation,
  coalesce(ri.destination_override, i.default_destination)
    as shopping_destination,
  ri.is_optional,
  ri.sort_order
from public.recipe_ingredients ri
left join public.ingredients i on i.id = ri.ingredient_id;

grant select on public.recipe_ingredients_expanded to anon, authenticated;

-- =====================================================================
-- COMPLETE
--
-- Expected tables:
--   family_members
--   ingredients
--   recipe_ingredients
--   recipe_favourites
--   recipe_cook_logs
--   meal_plans
--   meal_plan_days
--   shopping_lists
--   shopping_items
--
-- Existing recipes and categories remain in place.
-- =====================================================================