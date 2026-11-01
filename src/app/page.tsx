import { createClient } from '@/lib/supabase/server'
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
  const supabase = await createClient()
  if (!supabase) return <SetupNotice />
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) return <Login />

  const { data: profile } = await supabase.from('staff_profiles').select('display_name, role').eq('user_id', claims.sub).maybeSingle()
  const { data: sessions, error } = await supabase
    .from('session_board')
    .select('id, table_label, option_name, started_at, ends_at, status, timing_status')
    .neq('status', 'ended')
    .order('ends_at')
  const { data: options } = await supabase.from('shisha_options').select('id, name, duration_minutes').eq('is_available', true).order('name')

  const rows = (sessions ?? []) as LoungeSession[]
  const overdue = rows.filter((s) => s.timing_status === 'overdue').length
  const ending = rows.filter((s) => s.timing_status === 'ending_soon').length
  const canOperate = ['owner', 'admin', 'cashier'].includes(profile?.role ?? '')
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Africa/Nairobi' }).format(new Date()).toUpperCase()

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">L</span><span>Lounge<span className="brand-light">OS</span><small>BY CYNUX PRODUCTION</small></span></div>
      <nav><a className="nav-active" href="#overview">▦ <span>Overview</span></a><a href="#sessions">◷ <span>Sessions</span></a><a className="nav-muted">▤ <span>Orders</span></a><a className="nav-muted">◈ <span>Inventory</span></a><a className="nav-muted">▥ <span>Reports</span></a></nav>
      <div className="sidebar-bottom"><span className="avatar">{(profile?.display_name ?? 'S').slice(0, 1).toUpperCase()}</span><span className="staff"><b>{profile?.display_name ?? 'Staff member'}</b><small>{profile?.role ?? 'attendant'}</small></span><form action="/auth/signout" method="post"><button className="icon-button" title="Sign out" aria-label="Sign out">↪</button></form></div>
    </aside>
    <section className="content" id="overview">
      <header className="topbar"><div><p className="eyebrow">OPERATIONS / OVERVIEW</p><h1>Good shift, {profile?.display_name?.split(' ')[0] ?? 'team'} <span>✦</span></h1></div><div className="live-pill"><i /> LIVE OPERATIONS</div></header>
      <div className="date-strip">{dateLabel} <span>·</span> LOUNGE OPERATIONS</div>
      <section className="stats">
        <article><span>ACTIVE SESSIONS</span><strong>{rows.length.toString().padStart(2, '0')}</strong><small>Across the lounge</small><b className="stat-icon">◷</b></article>
        <article><span>ENDING SOON</span><strong>{ending.toString().padStart(2, '0')}</strong><small>Next 10 minutes</small><b className="stat-icon warn">⌛</b></article>
        <article><span>OVERDUE</span><strong>{overdue.toString().padStart(2, '0')}</strong><small>Need attention</small><b className="stat-icon danger">!</b></article>
        <article><span>SHIFT REVENUE</span><strong>—</strong><small>Orders milestone</small><b className="stat-icon">↗</b></article>
      </section>
      <section className="panel" id="sessions">
        <div className="panel-head"><div><p className="eyebrow">RIGHT NOW</p><h2>Live sessions <span className="count">{rows.length}</span></h2></div><a href="#new-session" className="primary-button">＋ Start session</a></div>
        {error ? <p className="notice error">Could not load sessions. Check your database migration and staff permissions.</p> : rows.length === 0 ? <div className="empty"><span>◷</span><b>No active sessions yet</b><p>When a session starts, its live timer will appear here.</p></div> : null}
        {!error && <div id="new-session"><h3 className="action-heading">Session controls</h3><SessionActions options={options ?? []} sessions={rows.map((s) => ({ id: s.id, table_label: s.table_label, option_name: s.option_name, ends_at: s.ends_at, timing_status: s.timing_status }))} canOperate={canOperate} /></div>}
      </section>
      <p className="footnote">Session timing is calculated from database timestamps. Last refreshed {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
    </section>
  </main>
}

function SetupNotice() {
  return <main className="center"><div className="setup-card"><div className="brand-mark">L</div><p className="eyebrow">LOUNGEOS · CYNUX PRODUCTION</p><h1>Connect your development database</h1><p>Add the Supabase project URL and publishable key to <code>.env.local</code>, then run the initial migration.</p><div className="setup-step">1 <span>Copy <code>.env.example</code> to <code>.env.local</code></span></div><div className="setup-step">2 <span>Run <code>npm run dev</code></span></div></div></main>
}

function Login() {
  return <main className="center"><div className="setup-card"><div className="brand-mark">L</div><p className="eyebrow">CYNUX PRODUCTION</p><h1>Welcome to LoungeOS</h1><p>Sign in with your staff account to manage lounge operations.</p><form action="/auth/login" method="get"><button className="primary-button full">Continue to staff sign in →</button></form></div></main>
}
