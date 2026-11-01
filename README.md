# LoungeOS

Lounge session and operations management by Cynux Production.

## Stack

LoungeOS uses Next.js App Router with TypeScript for a responsive staff dashboard and server rendered session view. Supabase provides PostgreSQL, Auth, and row-level security; database timestamps make session timing persistent and PostgreSQL serializes simultaneous extensions.

## Current features

- Overview and session pages show active, ending-soon, overdue, and recently ended sessions.
- Owners, admins, and cashiers can start a session from one of the available shisha options, extend it, or end it. Attendants are view-only for sessions assigned to them.
- Orders can be recorded for an active session or a table label. Staff can record cash or other offline payment confirmation, or cancel an unpaid order. No payment processor is connected.
- Owners and admins can add inventory items and log stock increases or reductions with a reason. Low-stock levels and recent movements are visible to cashiers.
- Date-filtered reports show paid totals, unpaid orders, sessions started, cancelled orders, and stock movement counts. Amounts are displayed in Kenyan shillings.
- Sensitive session, order, inventory, and staff-role actions create audit events.

The orders UI currently records one line item per order. The database supports up to 20 item rows per order, so a multi-item order editor can be added without a schema redesign.

## Local setup

1. Install Node.js 20 or newer and npm.
2. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable key from the project Connect dialog. Never add a service role key or database password to frontend code.
3. Install dependencies with `npm install`.
4. Apply migrations with the Supabase CLI: `npx supabase link --project-ref <project-ref>` then `npx supabase db push`. Review migrations before applying them to any non-development database.
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

## Access model

New staff profiles default to `attendant`. Owners, admins, and cashiers may operate sessions and orders; only owners and admins can change roles or stock. Database functions enforce these role checks even if a client skips the UI. The existing development owner account was explicitly promoted during setup.

## Current milestone scope

The current milestone includes staff authentication and roles, session start/extend/end actions, orders and manual payment status, inventory and movement history, date-filtered operational reports, database-derived session timing, RLS policies, audit events, and session timing unit tests. Payment integration, multi-item order entry, assigned-attendant workflows, exports, end-to-end authorization tests, and production deployment hardening remain future work.
