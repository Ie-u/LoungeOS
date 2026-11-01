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
- M-Pesa STK request and callback flow, Daraja C2B confirmation intake, Paybill/Till receipt claims, and a manager reconciliation queue for unmatched or ambiguous payments. Payment completion is evidence-based; a staff-entered receipt alone cannot mark an order paid.

## Local setup

1. Install Node.js 20 or newer and npm.
2. Copy `.env.example` to `.env.local`, then add the Supabase URL and publishable key from the project Connect dialog.
3. Install packages with `npm install`.
4. Run `npm run dev` and open `http://localhost:3000`.

The database migrations are tracked in `supabase/migrations`. They have been applied to the linked Supabase production project. For a fresh project, link the Supabase CLI and review/apply the migration history before use.

## Environment configuration

`SUPABASE_SERVICE_ROLE_KEY` is server-only and required for staff invitations, account recovery, and M-Pesa callbacks. `NEXT_PUBLIC_APP_URL` must be the public HTTPS LoungeOS URL in production.

### Supabase Auth email delivery

The repository includes local Auth email templates in `supabase/templates/` and references them from `supabase/config.toml`. The invite template sends a secure invitation link to `/auth/callback?next=/auth/update-password`; the Magic Link template sends the Supabase-generated one-time token for the email-code sign-in screen. Local template files do not change hosted Auth settings automatically.

For the hosted project, configure custom SMTP in Supabase Dashboard → Authentication → SMTP Settings, and copy the templates into Authentication → Email Templates. Supabase's default SMTP is restricted to project team addresses and is intended for development. Add the deployed `/auth/callback` URL to the Auth redirect allow-list. LoungeOS never creates, stores, or logs OTP codes. Supabase Auth applies its own email-send rate limits; the sign-in screen also waits 60 seconds before offering a resend.

Staff invitations are created through Supabase Auth before the assigned LoungeOS role is updated. Existing, unconfirmed, and deactivated accounts are detected and handled without creating a duplicate staff record. If Auth reports an invitation delivery failure after creating the unconfirmed account, LoungeOS removes that exact failed invite attempt when possible and never reports it as sent.

### Owner dashboard and profile

Owners get shortcuts to financial reports, staff, attendance exceptions, alerts, M-Pesa reconciliation, audit activity, inventory, flavor tasks, business settings, and integrations. The owner can change the display name and upload a JPG, PNG, or WebP profile image (maximum 2 MB). Images are stored in the private `staff-avatars` bucket; signed image delivery requires the owner's active session. The owner profile, storage policies, and dashboard changes are in migration `20261101233217_owner_profile_dashboard.sql`.

The Integrations area reports environment-variable readiness but does not accept secret values. Daraja secrets are currently read from the hosting provider's server-only environment. Rotate them there and redeploy; this project has no application secret vault or deployment-environment management API. Readiness does not replace a real provider sandbox test.

Daraja settings are server-only: `MPESA_ENV`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, and `MPESA_TRANSACTION_TYPE`. Configure `MPESA_PAYBILL_NUMBER` or `MPESA_TILL_NUMBER` to display/enable manual payment claims. For C2B confirmation intake, set `MPESA_C2B_CALLBACK_TOKEN` to at least 32 random bytes encoded as hex, then register the public HTTPS URLs `https://<app>/api/mpesa/c2b/<token>/validation` and `/confirmation` in Daraja. The callback path token is a server-side secret; do not publish it in logs or screenshots. Use sandbox settings until Safaricom production credentials and the callback URL have been approved and verified. STK amounts must be whole KES. Never put server secrets in `NEXT_PUBLIC_*` variables.

Venue latitude/longitude and geofence radius must be configured by an owner/admin; no location is assumed. Configure Supabase Auth email delivery and allowed redirect URLs before staff invitations or recovery are used.

## Development checks

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`

## Deployment notes

- Disable public self sign-up and set production Auth redirect URLs.
- Enable Supabase leaked-password protection.
- Configure public HTTPS callback reachability and test Daraja sandbox success, failure, duplicate, delayed, unmatched-reference, and amount-mismatch callbacks before production.
- Confirm the business Paybill/Till, venue coordinates, staff roster, session presets, product catalogue, and finance policy with the owner.
- GPS is a location signal and not proof against spoofing. Payment claims require verification against the official provider account.
- Session and configured low-stock alerts are generated by a Supabase database job once a minute and stored in each staff member’s notification feed. External SMS, email, or push delivery still needs a provider.
