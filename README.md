# LoungeOS

Lounge session and operations management by Cynux Production.

## Stack

LoungeOS uses Next.js App Router with TypeScript for a responsive staff dashboard and server rendered session view. Supabase provides PostgreSQL, Auth, and row-level security; database timestamps make session timing persistent and PostgreSQL serializes simultaneous extensions.

## Local setup

1. Install Node.js 20 or newer and npm.
2. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable key from the project Connect dialog. Never add a service role key or database password to frontend code.
3. Install dependencies with `npm install`.
4. Apply the migration with the Supabase CLI: `npx supabase link --project-ref <project-ref>` then `npx supabase db push`. Review migrations before applying them to any non-development database.
5. Run `npm run dev` and open `http://localhost:3000`.

The app uses email/password Supabase Auth. New staff default to attendant. Assign the first owner/admin deliberately in the Supabase SQL editor, after verifying the user's UUID:

```sql
update public.staff_profiles
set role = 'owner'
where user_id = '<verified-auth-user-uuid>';
```

Do not grant owner status based on user metadata, email domain, or client-supplied values.

## Development and checks

- `npm run dev` starts the development server.
- `npm run lint` checks source code.
- `npm test` runs session timing unit tests.
- `npm run build` creates a production build.

Apply all schema changes as files under `supabase/migrations/`. The seed file contains only fictional catalog data.

## Security checklist

- [x] Supabase Auth handles staff sign in; no credentials are stored in source.
- [x] All application tables enable RLS; session actions are role gated in database policies.
- [x] The session board derives active, ending-soon, and overdue status from PostgreSQL timestamps.
- [x] Session start, extension, and end events are written to an audit table.
- [x] Frontend configuration uses a publishable key; no service role key or database password is used.
- [ ] Restrict Supabase Auth sign-up to intended staff onboarding before production.
- [ ] Review RLS and database security advisors before production deployment.
- [ ] Configure production redirect URLs, backups, and staff provisioning before launch.

## First milestone scope

This first milestone includes staff authentication, roles, a live session dashboard, session start/extend/end actions, database-derived timing status, catalog options, RLS policies, audit events, and timing unit tests. Assigned-attendant workflows, billing, inventory, reports, and end-to-end authorization tests are the next implementation steps.
