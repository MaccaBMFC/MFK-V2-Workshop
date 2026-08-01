-- MFK V2 Sprint 2 Task 1
alter table public.meal_plans
drop constraint if exists meal_plans_preferred_start_day_check;

alter table public.meal_plans
add constraint meal_plans_preferred_start_day_check
check (preferred_start_day in ('friday','saturday'));
