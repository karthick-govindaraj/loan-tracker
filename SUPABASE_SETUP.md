# Supabase setup

1. In the Supabase SQL Editor, run [`supabase.sql`](./supabase.sql).
2. Open **Project Settings → API Keys** and copy the `sb_publishable_...` key.
3. Replace `PASTE_SUPABASE_PUBLISHABLE_KEY_HERE` in [`supabase-config.js`](./supabase-config.js). A publishable key is designed for browser use; never paste a database password, secret key, or service-role key here.
4. In **Authentication → URL Configuration**, set the Site URL to the deployed Vercel URL and add local/deployment redirect URLs that will open email sign-in links.
5. Keep the Email authentication provider enabled, then redeploy.

On the first successful sign-in, an existing `loan-freedom-v1` browser record is copied to Supabase and removed locally. After that, loan data loads from and saves to the signed-in user's protected Supabase row.
