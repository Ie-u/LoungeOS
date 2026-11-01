import Link from 'next/link'
import AppShell from '@/components/app-shell'
import { getStaffContext } from '@/lib/supabase/staff-context'
import Expenses, { type Expense } from './expenses'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>
type LoungeReport = {
  gross_sales_cents: number; paid_order_count: number; open_order_total_cents: number; open_order_count: number
  cancelled_order_count: number; sessions_started: number; sessions_ended: number; stock_movement_count: number
  known_cost_cents: number | null; missing_cost_item_count: number | null; expense_total_cents: number | null; recorded_margin_cents: number | null
}
type PaidOrder = { id: string; table_label: string; total_cents: number; created_at: string; paid_at: string | null }

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function nairobiDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`
}
function nairobiStart(date: string) { return new Date(`${date}T00:00:00+03:00`).toISOString() }
function nextDate(date: string) { const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); return next.toISOString().slice(0, 10) }
const currency = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' })
const money = (cents: number | null | undefined) => cents === null || cents === undefined ? 'Not available' : currency.format(Number(cents) / 100)

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to view reports</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>
  const { supabase, profile, userId } = context
  const canView = ['owner', 'admin', 'manager', 'cashier'].includes(profile.role)
  const canSeeCosts = ['owner', 'admin'].includes(profile.role)
  const params = await searchParams
  const today = nairobiDate(new Date())
  const monthStart = `${today.slice(0, 7)}-01`
  const from = validDate(typeof params.from === 'string' ? params.from : undefined) ? String(params.from) : monthStart
  const to = validDate(typeof params.to === 'string' ? params.to : undefined) ? String(params.to) : today
  const fromIso = nairobiStart(from)
  const toIso = nairobiStart(nextDate(to))
  const toOrder = to < from
  const [{ data: reportData, error: reportError }, { data: orderData }, { data: expenseData, error: expenseError }] = await Promise.all([
    canView && !toOrder ? supabase.rpc('get_lounge_report', { p_from: fromIso, p_to: toIso }) : Promise.resolve({ data: [], error: null }),
    canView && !toOrder ? supabase.from('lounge_orders').select('id, table_label, total_cents, created_at, paid_at').eq('status', 'open').eq('payment_status', 'paid').gte('paid_at', fromIso).lt('paid_at', toIso).order('paid_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    canSeeCosts && !toOrder ? supabase.from('business_expenses').select('id, category, description, amount_cents, incurred_at').gte('incurred_at', fromIso).lt('incurred_at', toIso).order('incurred_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
  ])
  const report = (reportData?.[0] ?? null) as LoungeReport | null
  const paidOrders = (orderData ?? []) as PaidOrder[]
  const expenses = (expenseData ?? []) as Expense[]
  const reportErrorMessage = reportError || expenseError

  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">OPERATIONS / PERFORMANCE</p><h1>Reports</h1><p>Payments are counted by payment time; expenses by the date they were incurred.</p></div></header>
    {!canView ? <section className="panel"><p className="notice role-notice">Your role does not have access to financial or operational reports.</p></section> : <>
      <section className="panel report-filter-panel"><form className="report-filter" method="get"><label>From<input name="from" type="date" defaultValue={from} /></label><label>To<input name="to" type="date" defaultValue={to} /></label><button className="primary-button">Apply dates</button></form><p className="report-period">Report period: {from} to {to} · Africa/Nairobi</p></section>
      {toOrder && <p className="notice error">The end date must be on or after the start date.</p>}
      {reportErrorMessage && <p className="notice error">Some report data could not be loaded. Check the product and reporting migrations.</p>}
      <section className="stats report-stats" aria-label="Report summary">
        <article><span>PAID SALES</span><strong className="report-value">{money(report?.gross_sales_cents)}</strong><small>{report?.paid_order_count ?? 0} orders paid in this period</small><b className="stat-icon">↗</b></article>
        <article><span>OPEN & UNPAID</span><strong className="report-value">{money(report?.open_order_total_cents)}</strong><small>{report?.open_order_count ?? 0} orders created in this period</small><b className="stat-icon warn">◷</b></article>
        <article><span>SESSIONS STARTED</span><strong>{report?.sessions_started ?? 0}</strong><small>{report?.sessions_ended ?? 0} ended in this period</small><b className="stat-icon">◷</b></article>
        <article><span>STOCK MOVEMENTS</span><strong>{report?.stock_movement_count ?? 0}</strong><small>{report?.cancelled_order_count ?? 0} orders cancelled in this period</small><b className="stat-icon report">◈</b></article>
        {canSeeCosts && <article><span>RECORDED PRODUCT COSTS</span><strong className="report-value">{money(report?.known_cost_cents)}</strong><small>{report?.missing_cost_item_count ?? 0} paid order lines need a cost</small><b className="stat-icon warn">−</b></article>}
        {canSeeCosts && <article><span>RECORDED EXPENSES</span><strong className="report-value">{money(report?.expense_total_cents)}</strong><small>Entered for these dates</small><b className="stat-icon report">▤</b></article>}
        {canSeeCosts && <article><span>RECORDED OPERATING RESULT</span><strong className="report-value">{money(report?.recorded_margin_cents)}</strong><small>{report?.recorded_margin_cents === null ? 'Incomplete product cost data' : 'Estimate from entered product costs and expenses'}</small><b className="stat-icon">≈</b></article>}
      </section>
      <section className="panel report-detail"><div className="panel-head"><div><p className="eyebrow">PAYMENT DETAIL</p><h2>Reconciliation summary</h2></div><Link className="text-link" href="/orders">Open orders</Link></div>
        <div className="report-total-row"><span>Paid sales</span><b>{report?.paid_order_count ?? 0}</b><strong>{money(report?.gross_sales_cents)}</strong></div>
        <div className="report-total-row"><span>Open and unpaid</span><b>{report?.open_order_count ?? 0}</b><strong>{money(report?.open_order_total_cents)}</strong></div>
        <div className="report-total-row"><span>Cancelled orders</span><b>{report?.cancelled_order_count ?? 0}</b><strong>Excluded from sales</strong></div>
      </section>
      {canSeeCosts && <p className="notice role-notice report-caveat">The operating result is an estimate from saved product costs and entered expenses. Missing unit costs make it unavailable, and unrecorded expenses can make it inaccurate. Gross sales are not profit.</p>}
      <section className="panel report-detail"><div className="panel-head"><div><p className="eyebrow">TRANSACTION TRACE</p><h2>Recent paid orders</h2></div><span className="page-count">Latest {paidOrders.length} / max 100</span></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Order</th><th>Table</th><th>Paid at</th><th>Amount</th></tr></thead><tbody>{paidOrders.map((order) => <tr key={order.id}><td><Link className="text-link" href={`/orders?order=${order.id}`}>{order.id.slice(0, 8).toUpperCase()}</Link></td><td>{order.table_label}</td><td>{order.paid_at ? new Date(order.paid_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) : '—'}</td><td className="money-cell">{money(order.total_cents)}</td></tr>)}{paidOrders.length === 0 && <tr><td colSpan={4} className="table-empty">No paid orders are recorded for this period.</td></tr>}</tbody></table></div>
      </section>
      {canSeeCosts && <Expenses items={expenses} userId={userId} />}
      {!canSeeCosts && <p className="footnote">Cost of goods, expenses, and operating result are restricted to owners and admins. Paid sales reflect recorded order payments.</p>}
    </>}
  </main></AppShell>
}
