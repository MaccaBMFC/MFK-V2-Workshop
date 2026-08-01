-- =====================================================================
-- MFK V1.2 — KITCHEN ASSISTANT
-- COOKING JOURNAL AND ANALYTICS
--
-- Run in Supabase SQL Editor.
-- Choose "Run without automatic RLS changes".
-- =====================================================================

alter table public.recipe_cook_logs
  add column if not exists rating smallint,
  add column if not exists family_reaction text;

alter table public.recipe_cook_logs
drop constraint if exists recipe_cook_logs_rating_check;

alter table public.recipe_cook_logs
add constraint recipe_cook_logs_rating_check
check (rating is null or rating between 1 and 5);

create index if not exists idx_recipe_cook_logs_cooked_on
  on public.recipe_cook_logs(cooked_on desc);