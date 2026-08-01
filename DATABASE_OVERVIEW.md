# MFK — Macca's Family Kitchen
## V2.0 · Sprint 1 · Task 1 — Database Foundation

### What this migration does

This is a **non-destructive V2 foundation**. It keeps the live V1 recipe and category tables working while adding the data structures required for:

- structured recipe ingredients
- recipe ownership
- individual family favourites
- cook history and notes
- serving-size scaling
- Friday/Saturday weekly meal planning
- recipe, leftovers, takeaway, eating out, free-night and custom meal entries
- persistent Woolworths and Fruit & Veg lists
- manual and meal-plan-generated shopping items

### Key design decisions

| Area | Decision |
|---|---|
| Existing recipes | Kept intact; migrate gradually |
| Recipe owner | Family member record, optionally linked to a login |
| Favourites | Per family member |
| Servings | Numeric base serving count |
| Ingredients | Quantity + unit + canonical ingredient + shop |
| Meal period | Any start/end dates; supports Friday–Friday or Saturday–Saturday |
| Shopping | Two persistent shared lists |
| Manual items | Preserved when meal-generated items are rebuilt |
| Public access | Recipes and structured recipe ingredients remain readable |
| Private data | Plans, shopping and cook notes require login |

### Relationship map

```text
family_members
 ├── recipes.owner_member_id
 ├── recipe_favourites
 ├── recipe_cook_logs
 └── meal_plans.planned_by_member_id

recipes
 ├── recipe_ingredients ── ingredients
 ├── recipe_favourites ── family_members
 ├── recipe_cook_logs
 └── meal_plan_days

meal_plans
 ├── meal_plan_days
 └── shopping_items

shopping_lists
 └── shopping_items ── ingredients
```

### Serving scaling

The app will use:

```text
scaled quantity = base quantity × requested servings ÷ base servings
```

Rounding is an application-layer rule, not a database mutation. The master recipe quantity stays unchanged.

### Safe migration approach

Current recipes keep their existing JSON ingredient lines. V2 structured rows can be added recipe-by-recipe. This means:

1. V1 stays usable.
2. V2 can be built in parallel.
3. Recipes can be converted gradually.
4. No recipe data needs to be deleted or rewritten in bulk.