import AppShell from '@/components/app-shell'
import { getStaffContext } from '@/lib/supabase/staff-context'
import NotificationManager, { type StaffNotification } from './notification-manager'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to view notifications</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>
  const { supabase, profile } = context
  const { data, error } = await supabase.from('staff_notifications')
    .select('id,event_type,entity_type,entity_id,title,message,created_at,read_at')
    .order('created_at', { ascending: false }).limit(100)
  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">OPERATIONS / ALERTS</p><h1>Notifications</h1><p>Scheduled shift and inventory alerts for your staff account.</p></div></header>
    <section className="panel">
      {error ? <p className="notice error">Notifications could not be loaded. Check the scheduled alerts migration and your access permissions.</p> : <NotificationManager notifications={(data ?? []) as StaffNotification[]} />}
    </section>
    <p className="footnote">Session and low-stock alerts are generated in the database once a minute and remain available when you return. External SMS, email, or push delivery is separate and not configured.</p>
  </main></AppShell>
}
