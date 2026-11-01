import Link from 'next/link'
import AppShell from '@/components/app-shell'
import { getStaffContext } from '@/lib/supabase/staff-context'
import SessionActions from './sessions/actions'

type LoungeSession = {
  id: string
  table_label: string
  option_name: string
  started_at: string
  ends_at: string
  timing_status: 'active' | 'ending_soon' | 'overdue' | 'ended'
}

export const dynamic = 'force-dynamic'

export default async function Home() {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to LoungeOS</h1><p>Use your staff account to open the operations dashboard.</p><Link className="primary-button full" href="/login">Continue to sign in</Link></div></main>

  const { supabase, profile } = context
  const dateParts = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const today = `${dateParts.find((part) => part.type === 'year')?.value}-${dateParts.find((part) => part.type === 'month')?.value}-${dateParts.find((part) => part.type === 'day')?.value}`
  const dayStart = new Date(`${today}T00:00:00+03:00`).toISOString()
  const [{ data: sessions, error }, { data: paidToday }] = await Promise.all([
    supabase.from('session_board').select('id, table_label, option_name, started_at, ends_at, timing_status').neq('status', 'ended').order('ends_at').limit(100),
    supabase.from('lounge_orders').select('total_cents').eq('payment_status', 'paid').gte('created_at', dayStart).limit(2000),
  ])
  const rows = (sessions ?? []) as LoungeSession[]
  const overdue = rows.filter((session) => session.timing_status === 'overdue').length
  const endingSoon = rows.filter((session) => session.timing_status === 'ending_soon').length
  const shiftRevenue = (paidToday ?? []).reduce((sum, order) => sum + Number(order.total_cents), 0)
  const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 })
  const canOperate = ['owner', 'admin', 'cashier'].includes(profile.role)
  const dateLabel = new Intl.DateTimeFormat('en-KE', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Africa/Nairobi' }).format(new Date()).toUpperCase()

  return <AppShell profile={profile}>
    <main className="content" id="overview">
      <header className="topbar">
        <div><p className="eyebrow">OPERATIONS / OVERVIEW</p><h1>Good shift, {profile.display_name.split(' ')[0]} <span>✦</span></h1></div>
        <div className="live-pill"><i /> LIVE OPERATIONS</div>
      </header>
      <div className="date-strip">{dateLabel} <span>·</span> LOUNGE OPERATIONS</div>
      <section className="stats" aria-label="Live operations summary">
        <article><span>ACTIVE SESSIONS</span><strong>{rows.length.toString().padStart(2, '0')}</strong><small>Across the lounge</small><b className="stat-icon">◷</b></article>
        <article><span>ENDING SOON</span><strong>{endingSoon.toString().padStart(2, '0')}</strong><small>Next 10 minutes</small><b className="stat-icon warn">⌛</b></article>
        <article><span>OVERDUE</span><strong>{overdue.toString().padStart(2, '0')}</strong><small>Need attention</small><b className="stat-icon danger">!</b></article>
        <article><span>PAID TODAY</span><strong className="metric-money">{money.format(shiftRevenue / 100)}</strong><small>Confirmed by lounge staff</small><b className="stat-icon report">↗</b></article>
      </section>
      <section className="panel" id="sessions">
        <div className="panel-head"><div><p className="eyebrow">RIGHT NOW</p><h2>Live sessions <span className="count">{rows.length}</span></h2></div><Link href="/sessions#new-session" className="primary-button">＋ Start session</Link></div>
        {error ? <p className="notice error">Could not load sessions. Check the migration status and your staff permissions.</p> : rows.length === 0 ? <div className="empty"><span>◷</span><b>No active sessions yet</b><p>Start a session to see its timer and status here.</p></div> : null}
        {!error && <div className="session-list">{rows.slice(0, 5).map((session) => <article className="session-row" key={session.id}>
          <span className="table-icon">{session.table_label}</span>
          <span className="session-name"><b>{session.option_name}</b><small>Ends {new Date(session.ends_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })}</small></span>
          <span className={`state ${session.timing_status}`}>{session.timing_status.replace('_', ' ')}</span>
        </article>)}</div>}
        {!canOperate && <p className="notice role-notice">Your attendant account can view assigned sessions. Owner, admin, or cashier access is required to start or change a session.</p>}
      </section>
      <section className="quick-links" aria-label="Operations shortcuts">
        <Link href="/orders"><span>▤</span><b>Record an order</b><small>Link a charge to a table</small></Link>
        <Link href="/inventory"><span>◈</span><b>Update stock</b><small>Log a stock movement</small></Link>
        <Link href="/reports"><span>▥</span><b>View reports</b><small>Review daily totals</small></Link>
      </section>
      <p className="footnote">Session timing comes from PostgreSQL and refreshes every 30 seconds.</p>
    </main>
  </AppShell>
}
