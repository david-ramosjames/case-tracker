# Google Auth Setup (Ramos James Law)

The case tracker only allows Google sign-in for `@ramosjames.com` accounts.

Admins (assigned automatically on sign-in):

- `david@ramosjames.com`
- `jon@ramosjames.com`

Everyone else with a `@ramosjames.com` Google account receives the `attorney` role.

## 1. Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project for the case tracker.
3. Go to **APIs & Services → Credentials**.
4. Create an **OAuth client ID** (Web application).
5. Add authorized redirect URIs:
   - `http://localhost:3000/auth/callback` (local dev)
   - `https://<your-production-domain>/auth/callback`
6. Copy the **Client ID** and **Client secret**.

Optional: restrict the OAuth client to the `ramosjames.com` Google Workspace domain in the Google admin console for extra protection. The app still enforces `@ramosjames.com` server-side.

## 2. Supabase Dashboard

1. Open your Supabase project → **Authentication → Providers**.
2. Enable **Google**.
3. Paste the Google **Client ID** and **Client secret**.
4. Go to **Authentication → URL Configuration**.
5. Set **Site URL** to your app URL (for example `http://localhost:3000`).
6. Add redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `https://<your-production-domain>/auth/callback`

## 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (required so first sign-in can create rows in `case_tracker_user_roles`)

## 4. SQL migrations

Run tracker SQL migrations in order, including:

- `supabase/sql/004_comment_author_name.sql`
- `supabase/sql/005_google_auth_admins.sql`

## 5. Verify

1. Run `npm run dev`.
2. Visit `http://localhost:3000` — you should be redirected to `/login`.
3. Sign in with a `@ramosjames.com` Google account.
4. Confirm the header shows your name and email.
5. Sign in as `david@ramosjames.com` or `jon@ramosjames.com` and confirm the **Admin** badge and **Settings** nav item appear.

## Security notes

- Non-`@ramosjames.com` accounts are signed out immediately after OAuth.
- API routes require a valid session; client-provided author names are ignored.
- Settings is limited to users with the `admin` role.
