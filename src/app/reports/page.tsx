import AppShell from '@/components/app-shell'
import { getStaffContext } from '@/lib/supabase/staff-context'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>
type OrderSummary = { total_cents: number; payment_status: string; status: string }

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function localDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function nairobiStart(date: string) { return new Date(`${date}T00:00:00+03:00`).toISOString() }
function nextDate(date: string) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

const currency = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' })
const money = (cents: number) => currency.format(Number(cents || 0) / 100)

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to view reports</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>

  const { supabase, profile } = context
  const canView = ['owner', 'admin', 'cashier'].includes(profile.role)
  const params = await searchParams
  const today = localDate(new Date())
  const monthStart = `${today.slice(0, 7)}-01`
  const from = validDate(typeof params.from === 'string' ? params.from : undefined) ? String(params.from) : monthStart
  const to = validDate(typeof params.to === 'string' ? params.to : undefined) ? String(params.to) : today
  const fromIso = nairobiStart(from)
  const toIso = nairobiStart(nextDate(to))

  const [{ data: orderData, error: orderError }, { data: sessionData, error: sessionError }, { data: movementData }] = await Promise.all([
    canView ? supabase.from('lounge_orders').select('total_cents, payment_status, status').gte('created_at', fromIso).lt('created_at', toIso).limit(5000) : Promise.resolve({ data: [], error: null }),
    canView ? supabase.from('lounge_sessions').select('id, status').gte('started_at', fromIso).lt('started_at', toIso).limit(5000) : Promise.resolve({ data: [], error: null }),
    canView ? supabase.from('inventory_movements').select('id').gte('created_at', fromIso).lt('created_at', toIso).limit(5000) : Promise.resolve({ data: [], error: null }),
  ])
  const orders = (orderData ?? []) as OrderSummary[]
  const paidOrders = orders.filter((order) => order.payment_status === 'paid')
  const openOrders = orders.filter((order) => order.status === 'open' && order.payment_status === 'unpaid')
  const cancelledOrders = orders.filter((order) => order.status === 'cancelled')
  const paidTotal = paidOrders.reduce((sum, order) => sum + Number(order.total_cents), 0)
  const outstandingTotal = openOrders.reduce((sum, order) => sum + Number(order.total_cents), 0)
  const reportError = orderError || sessionError

  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">OPERATIONS / PERFORMANCE</p><h1>Reports</h1><p>Sales and activity totals for the selected dates.</p></div></header>
    {!canView ? <section className="panel"><p className="notice role-notice">Owner, admin, or cashier access is required to view operating totals.</p></section> : <>
      <section className="panel report-filter-panel"><form className="report-filter" method="get"><label>From<input name="from" type="date" defaultValue={from} /></label><label>To<input name="to" type="date" defaultValue={to} /></label><button className="primary-button">Apply dates</button></form><p className="report-period">Report period: {from} to {to}</p></section>
      {reportError && <p className="notice error">Some report data could not be loaded. Check the database migration and permissions.</p>}
      <section className="stats report-stats" aria-label="Report summary">
        <article><span>PAYMENTS RECORDED</span><strong className="report-value">{money(paidTotal)}</strong><small>{paidOrders.length} paid orders</small><b className="stat-icon">↗</b></article>
        <article><span>UNPAID ORDERS</span><strong className="report-value">{money(outstandingTotal)}</strong><small>{openOrders.length} open orders</small><b className="stat-icon warn">◷</b></article>
        <article><span>SESSIONS STARTED</span><strong>{sessionData?.length ?? 0}</strong><small>{sessionData?.filter((session) => session.status === 'ended').length ?? 0} ended in this period</small><b className="stat-icon">◷</b></article>
        <article><span>STOCK MOVEMENTS</span><strong>{movementData?.length ?? 0}</strong><small>{cancelledOrders.length} cancelled orders</small><b className="stat-icon report">◈</b></article>
      </section>
      <section className="panel report-detail"><div className="panel-head"><div><p className="eyebrow">PAYMENT DETAIL</p><h2>Order summary</h2></div></div>
        <div className="report-total-row"><span>Recorded paid orders</span><b>{paidOrders.length}</b><strong>{money(paidTotal)}</strong></div>
        <div className="report-total-row"><span>Open and unpaid</span><b>{openOrders.length}</b><strong>{money(outstandingTotal)}</strong></div>
        <div className="report-total-row"><span>Cancelled orders</span><b>{cancelledOrders.length}</b><strong>Excluded from totals</strong></div>
      </section>
      <p className="footnote">Revenue includes only orders marked paid by authorized staff. This app does not process or verify electronic payments.</p>
    </>}
  </main></AppShell>
}
