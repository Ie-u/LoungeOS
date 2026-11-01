import Link from 'next/link'
import AppShell from '@/components/app-shell'
import { getStaffContext } from '@/lib/supabase/staff-context'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to view integrations</h1><Link className="primary-button full" href="/login">Continue to sign in</Link></div></main>
  if (!['owner', 'admin'].includes(context.profile.role)) return <main className="center"><div className="setup-card"><h1>Integrations are restricted</h1><p>Only the owner or an admin can review integration readiness.</p></div></main>

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const publicHttps = appUrl.startsWith('https://')
  const serviceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const darajaFields: Array<[string, boolean]> = [
    ['NEXT_PUBLIC_APP_URL (public HTTPS)', publicHttps],
    ['SUPABASE_SERVICE_ROLE_KEY (server only)', serviceKey],
    ['MPESA_CONSUMER_KEY', Boolean(process.env.MPESA_CONSUMER_KEY)],
    ['MPESA_CONSUMER_SECRET', Boolean(process.env.MPESA_CONSUMER_SECRET)],
    ['MPESA_SHORTCODE', Boolean(process.env.MPESA_SHORTCODE)],
    ['MPESA_PASSKEY', Boolean(process.env.MPESA_PASSKEY)],
    ['MPESA_TRANSACTION_TYPE (defaults to CustomerPayBillOnline)', true],
  ]
  const c2bFields: Array<[string, boolean]> = [
    ['NEXT_PUBLIC_APP_URL (public HTTPS)', publicHttps],
    ['SUPABASE_SERVICE_ROLE_KEY (server only)', serviceKey],
    ['MPESA_SHORTCODE', Boolean(process.env.MPESA_SHORTCODE)],
    ['MPESA_C2B_CALLBACK_TOKEN (64–128 hex characters)', /^[a-f0-9]{64,128}$/i.test(process.env.MPESA_C2B_CALLBACK_TOKEN ?? '')],
    ['MPESA_PAYBILL_NUMBER or MPESA_TILL_NUMBER', Boolean(process.env.MPESA_PAYBILL_NUMBER || process.env.MPESA_TILL_NUMBER)],
  ]
  const stkReady = darajaFields.every(([, ready]) => ready)
  const c2bReady = c2bFields.every(([, ready]) => ready)

  return <AppShell profile={context.profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">BUSINESS CONTROL</p><h1>Integrations</h1><p>Check server configuration and provider setup without exposing credential values.</p></div><span className="page-count">{context.profile.role}</span></header>
    <section className="panel admin-panel">
      <div className="panel-head"><div><p className="eyebrow">SAFARICOM DARAjA</p><h2>M-Pesa STK Push</h2></div><span className={`state ${stkReady ? 'active' : 'ending_soon'}`}>{stkReady ? `configured · ${process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox'}` : 'configuration needed'}</span></div>
      <p className="panel-copy">Set the listed values in the server-side environment for the LoungeOS deployment, then redeploy. Saved values are never returned to this page.</p>
      <ul className="integration-checklist">{darajaFields.map(([label, ready]) => <li key={label}><span>{label}</span><b className={`state ${ready ? 'active' : 'ending_soon'}`}>{ready ? 'present' : 'missing'}</b></li>)}</ul>
      <p className="footnote">Payment confirmation requires a public HTTPS callback URL. Keep sandbox mode until Daraja credentials and callback behavior have been tested.</p>
    </section>
    <section className="panel admin-panel">
      <div className="panel-head"><div><p className="eyebrow">PAYBILL / TILL</p><h2>C2B and manual receipt review</h2></div><span className={`state ${c2bReady ? 'active' : 'ending_soon'}`}>{c2bReady ? 'server configuration present' : 'configuration needed'}</span></div>
      <ul className="integration-checklist">{c2bFields.map(([label, ready]) => <li key={label}><span>{label}</span><b className={`state ${ready ? 'active' : 'ending_soon'}`}>{ready ? 'present' : 'missing'}</b></li>)}</ul>
      <p className="panel-copy">Register these exact URLs in the Daraja portal after the app is deployed:</p>
      <code className="callback-url">{appUrl || 'https://your-loungeos-domain'}/api/mpesa/c2b/&lt;token&gt;/validation</code>
      <code className="callback-url">{appUrl || 'https://your-loungeos-domain'}/api/mpesa/c2b/&lt;token&gt;/confirmation</code>
      <p className="footnote">Replace &lt;token&gt; with the value of MPESA_C2B_CALLBACK_TOKEN. Treat this token as a secret and never include it in screenshots or public logs.</p>
      <Link className="text-link" href="/orders#payment-reconciliation">Open payment reconciliation →</Link>
    </section>
    <section className="panel admin-panel">
      <div className="panel-head"><div><p className="eyebrow">AUTHENTICATION EMAIL</p><h2>Staff invitations and email OTP</h2></div><span className="state ending_soon">delivery not verified</span></div>
      <p className="panel-copy">The repository does not contain SMTP credentials or a live email provider status. Supabase’s default email service is restricted to organization team addresses; configure custom SMTP in Supabase Auth for staff invitations, recovery, and OTP delivery.</p>
      <p className="panel-copy">For six-digit codes, set the Supabase Auth Magic Link email template to include <code>{'{{ .Token }}'}</code>. The new code entry screen uses Supabase Auth and does not create or store OTPs.</p>
      <a className="text-link" href="https://supabase.com/dashboard/project/zokwnbqjreojwmobkcla/auth/smtp/settings" target="_blank" rel="noreferrer">Open Supabase Auth SMTP settings →</a>
    </section>
    <section className="panel admin-panel">
      <div className="panel-head"><div><p className="eyebrow">SECURE CONFIGURATION</p><h2>Update or rotate provider credentials</h2></div></div>
      <p className="notice role-notice">LoungeOS currently reads integration credentials from server-only deployment environment variables. It has no server-side secret vault or deployment-environment management API, so this page intentionally does not accept keys it cannot store and rotate securely. Update these values in your deployment provider’s secret settings and redeploy; never paste them into browser settings or source control.</p>
      <div className="integration-status-list"><p><span>Scheduled in-app operations alerts</span><b className="state active">active in Supabase</b></p><p><span>External SMS / email / push alerts</span><b className="state ending_soon">not configured</b></p></div>
      <Link className="text-link" href="/admin#business-settings">Open business settings →</Link>
    </section>
  </main></AppShell>
}
