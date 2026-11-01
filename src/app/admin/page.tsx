import AppShell from '@/components/app-shell'
import { getStaffContext } from '@/lib/supabase/staff-context'
import StaffManager, { type AuditRow, type BusinessSettings, type StaffRow } from './staff-manager'
import type { SessionOption } from './session-presets'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to manage LoungeOS</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>
  if (!['owner', 'admin', 'manager'].includes(context.profile.role)) return <main className="center"><div className="setup-card"><h1>Staff management is restricted</h1><p>Your account does not have access to staff management.</p></div></main>

  const { supabase, profile } = context
  const canEditSettings = ['owner', 'admin'].includes(profile.role)
  const [{ data: staff, error: staffError }, { data: settings }, { data: audit }] = await Promise.all([
    supabase.from('staff_profiles').select('user_id, display_name, role, is_active, created_at').order('created_at'),
    supabase.from('business_settings').select('business_name, venue_latitude, venue_longitude, geofence_radius_m, max_location_accuracy_m, session_alert_minutes, low_stock_alert_enabled').eq('singleton', true).maybeSingle(),
    supabase.from('audit_events').select('id, entity_type, action, created_at').order('created_at', { ascending: false }).limit(50),
  ])
  const { data: optionData } = canEditSettings
    ? await supabase.from('shisha_options').select('id,name,duration_minutes,price_cents,is_available').order('name')
    : { data: [] }
  const callbackUrlReady = process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ?? false
  const darajaCredentialsConfigured = Boolean(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_SHORTCODE && process.env.MPESA_PASSKEY && process.env.SUPABASE_SERVICE_ROLE_KEY && callbackUrlReady)
  const integrations = {
    stkReady: darajaCredentialsConfigured,
    stkMode: process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox',
    manualPaymentsReady: Boolean(process.env.MPESA_PAYBILL_NUMBER || process.env.MPESA_TILL_NUMBER),
    c2bReady: Boolean(/^[a-f0-9]{64,128}$/i.test(process.env.MPESA_C2B_CALLBACK_TOKEN ?? '') && process.env.SUPABASE_SERVICE_ROLE_KEY && callbackUrlReady && process.env.MPESA_SHORTCODE && (process.env.MPESA_PAYBILL_NUMBER || process.env.MPESA_TILL_NUMBER)),
    staffProvisioningReady: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.NEXT_PUBLIC_APP_URL || process.env.NODE_ENV === 'development')),
  }

  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">BUSINESS CONTROL</p><h1>Staff & settings</h1><p>Control staff access, venue rules, and review operational changes.</p></div><span className="page-count">{profile.role}</span></header>
    {staffError && <p className="notice error">Could not load the staff roster. Check that the access migration has been applied.</p>}
    <StaffManager profile={profile} staff={(staff ?? []) as StaffRow[]} settings={settings as BusinessSettings | null} audit={(audit ?? []) as AuditRow[]} canEditSettings={canEditSettings} integrations={integrations} sessionOptions={(optionData ?? []) as SessionOption[]} />
  </main></AppShell>
}
