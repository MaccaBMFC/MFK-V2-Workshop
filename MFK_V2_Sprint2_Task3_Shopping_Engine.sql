-- =====================================================================
-- MFK V2 — SPRINT 2 TASK 3
-- SHOPPING ENGINE + PANTRY DESTINATION
--
-- Run in Supabase SQL Editor.
-- Choose "Run without automatic RLS changes".
-- =====================================================================

-- 1. Allow Pantry as an ingredient destination.
alter table public.ingredients
drop constraint if exists ingredients_default_destination_check;

alter table public.ingredients
add constraint ingredients_default_destination_check
check (default_destination in ('woolworths','fruit_veg','pantry'));

-- 2. Allow Pantry as a recipe-specific destination override.
alter table public.recipe_ingredients
drop constraint if exists recipe_ingredients_destination_override_check;

alter table public.recipe_ingredients
add constraint recipe_ingredients_destination_override_check
check (
  destination_override is null
  or destination_override in ('woolworths','fruit_veg','pantry')
);

-- 3. Allow Pantry as a permanent shopping list destination.
alter table public.shopping_lists
drop constraint if exists shopping_lists_destination_check;

alter table public.shopping_lists
add constraint shopping_lists_destination_check
check (destination in ('woolworths','fruit_veg','pantry'));

-- 4. Create the permanent Pantry list.
insert into public.shopping_lists (destination, display_name, icon)
values ('pantry','Pantry / Staples','🥫')
on conflict (destination) do update
set display_name=excluded.display_name,
    icon=excluded.icon;

-- 5. Recreate the expanded ingredient view so Pantry resolves cleanly.
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