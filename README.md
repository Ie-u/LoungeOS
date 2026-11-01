# LoungeOS

Lounge session and operations management by Cynux Production. This repository continues the existing Next.js and Supabase application.

## Current capabilities

- Supabase authentication and least-privilege roles: owner, admin, manager, cashier, attendant, and flavor specialist.
- Database-authoritative shisha sessions with server-side start, extension, end, role checks, and audit records.
- Staff attendance with configurable geofence, GPS accuracy checks, and manager-reviewed exceptions that preserve the original event.
- Assigned flavor preparation tasks with inventory tracking and low-stock visibility.
- Multi-item orders priced from the database product catalogue, optional cost snapshots, stock deduction on verified payment, and append-only expenses.
- Reports for sales, orders, sessions, stock movements, expenses, and recorded margin estimates.
- Staff invitation/recovery flows, business profile and venue settings, access changes, and audit history.
- M-Pesa STK request and callback flow plus Paybill/Till receipt claims with manager review. Payment completion is evidence-based; a staff-entered receipt alone cannot mark an order paid.

## Local setup

1. Install Node.js 20 or newer and npm.
2. Copy `.env.example` to `.env.local`, then add the Supabase URL and publishable key from the project Connect dialog.
3. Install packages with `npm install`.
4. Run `npm run dev` and open `http://localhost:3000`.

The database migrations are tracked in `supabase/migrations`. They have been applied to the linked Supabase production project. For a fresh project, link the Supabase CLI and review/apply the migration history before use.

## Environment configuration

`SUPABASE_SERVICE_ROLE_KEY` is server-only and required for staff invitations, account recovery, and M-Pesa callbacks. `NEXT_PUBLIC_APP_URL` must be the public HTTPS LoungeOS URL in production.

Daraja settings are server-only: `MPESA_ENV`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, and `MPESA_TRANSACTION_TYPE`. Configure `MPESA_PAYBILL_NUMBER` or `MPESA_TILL_NUMBER` to display/enable manual payment claims. Use sandbox settings until Safaricom production credentials and the callback URL have been approved and verified. STK amounts must be whole KES. Never put server secrets in `NEXT_PUBLIC_*` variables.

Venue latitude/longitude and geofence radius must be configured by an owner/admin; no location is assumed. Configure Supabase Auth email delivery and allowed redirect URLs before staff invitations or recovery are used.

## Development checks

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`

## Deployment notes

- Disable public self sign-up and set production Auth redirect URLs.
- Enable Supabase leaked-password protection.
- Configure public HTTPS callback reachability and test Daraja sandbox success, failure, duplicate, and delayed callbacks before production.
- Confirm the business Paybill/Till, venue coordinates, staff roster, session presets, product catalogue, and finance policy with the owner.
- GPS is a location signal and not proof against spoofing. Payment claims require verification against the official provider account.
- Alerts requiring delivery while no staff dashboard is open need a configured background scheduler/notification provider; do not rely on a browser tab for production delivery.
