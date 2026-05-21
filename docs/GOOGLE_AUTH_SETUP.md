# Google Auth Setup (Ramos James Law)

The case tracker only allows Google sign-in for `@ramosjames.com` accounts.

Admins (assigned automatically on sign-in):

- `david@ramosjames.com`
- `jon@ramosjames.com`

Other `@ramosjames.com` users get their role from the matching `contacts` row (by email).

## Fix: Supabase redirects to the wrong URL

If Google sign-in sends you to `localhost`, an old Vercel URL, or somewhere other than your app, Supabase is **ignoring** `redirectTo` and using **Site URL** instead. That happens when the callback URL is not on the allowlist.

### Supabase → Authentication → URL Configuration

1. **Site URL** — set to where the app actually runs:
   - Local: `http://localhost:3000`
   - Production: `https://your-production-domain.com` (no trailing slash)

2. **Redirect URLs** — add every origin you use, with a wildcard (required for `?next=` query params):

   ```
   http://localhost:3000/**
   https://your-production-domain.com/**
   ```

   Without the `/**` wildcard, `http://localhost:3000/auth/callback?next=/cases` may be rejected and Supabase falls back to Site URL only (`/auth/callback` on the wrong host).

3. In **Vercel** (or your host), set:

   ```
   NEXT_PUBLIC_SITE_URL=https://your-production-domain.com
   ```

   The app uses this for OAuth `redirectTo` in production so it matches the allowlist even behind proxies.

### Google Cloud Console (different from app callback)

Google’s **Authorized redirect URI** must be your **Supabase** callback, not the Next.js app:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Find the exact value under Supabase → Authentication → Providers → Google.

## 1. Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. **APIs & Services → Credentials** → OAuth client ID (Web application).
4. **Authorized redirect URIs:** `https://<project-ref>.supabase.co/auth/v1/callback`
5. Copy Client ID and Client secret into Supabase.

## 2. Supabase Dashboard

1. **Authentication → Providers → Google** — enable and paste Google credentials.
2. **Authentication → URL Configuration** — Site URL and Redirect URLs as above.

## 3. Environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Use your real production URL for `NEXT_PUBLIC_SITE_URL` when deployed.

## 4. Verify

1. Open the login page — it should show which origin sign-in will return to.
2. Sign in with Google.
3. You should land on `https://your-domain.com/auth/callback` (then the app home page), not another host.
