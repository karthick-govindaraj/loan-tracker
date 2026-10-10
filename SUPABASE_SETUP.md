# Supabase setup

1. In the Supabase SQL Editor, run [`supabase.sql`](./supabase.sql).
2. Open **Project Settings → API Keys** and copy the `sb_publishable_...` key.
3. Replace `PASTE_SUPABASE_PUBLISHABLE_KEY_HERE` in [`supabase-config.js`](./supabase-config.js). A publishable key is designed for browser use; never paste a database password, secret key, or service-role key here.
4. Redeploy the static site. Supabase Authentication does not need to be configured.

On the first load, an existing `loan-freedom-v1` browser record is copied to the shared Supabase row and removed locally. After that, loan data loads from and saves to Supabase without sign-in.

## Privacy warning

This is intentionally an unauthenticated shared row. Anyone who discovers the project URL and publishable key can read or change the tracker data through the Supabase API. Keep personal identifiers out of the tracker and add authentication later if it becomes publicly discoverable or is used by more than one person.
