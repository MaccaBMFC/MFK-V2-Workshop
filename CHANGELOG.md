# MFK Changelog

## v1.3.0 RC3 — Cooking & Shopping Intelligence

### Added
- Explicit Supabase session persistence and automatic token refresh.
- Automatic session restoration when MFK opens.
- Authentication state listener for sign-in, sign-out and token refresh.
- Account & Sync panel in Settings.
- Deliberate Settings-based Sign in and Sign out controls.
- App-cache refresh control.

### Smart Shopping
- Quantities are consolidated before rounding.
- Whole shopping items round upward.
- Bay leaves, cloves, eggs, tins and similar units display as whole amounts.
- Cups, tablespoons and teaspoons display with ¼, ½ and ¾ characters.
- Unit synonyms are normalised before duplicate merging.
- Ingredient names are canonicalised for more reliable consolidation.
- Grams and millilitres round upward to practical shopping increments.

### Retained
- Supabase-backed Cooking Intelligence from RC2.
- Resume Later, Resume Cooking, Finish and Stop.
- Weekly Planner, Shopping, Recipe Manager, Cook Mode and Analytics.