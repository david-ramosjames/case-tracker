# Ramos James Law Case Tracker

A standalone Next.js app for attorney pipeline forecasting, quarterly goals, case notes, snapshots, and data-quality alerts.

This app is intentionally separate from DocketFlow. Shared case/user data should remain the source of truth in the existing Supabase project; tracker-specific tables should reference shared cases by `case_id`.

## Getting Started

```bash
npm install
npm run dev
```

Create `.env.local` from `.env.example` with the Supabase project credentials.

## Sign-in (Google)

All pages require Google sign-in with a `@ramosjames.com` account. See [docs/GOOGLE_AUTH_SETUP.md](docs/GOOGLE_AUTH_SETUP.md) for Supabase and Google Cloud configuration.

- **Admins:** `david@ramosjames.com`, `jon@ramosjames.com`
- **Everyone else** at `@ramosjames.com` gets attorney access

## Data Source

The app reads from Supabase through `src/lib/data/repository.ts`, which exports the service layer in `src/lib/supabase/services.ts`.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for provisioning user roles on first Google sign-in

Current service functions:

- `getCases()`
- `getCaseById()`
- `getUsers()`
- `getTrackerEntryByCaseId()`
- `updateTrackerEntry()`
- `createTrackerComment()`
- `getCaseComments()`
- `getCaseActivity()`
- `createSnapshot()`
- `getAttorneyGoals()`
- `getSettings()`
