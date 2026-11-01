import AppShell from '@/components/app-shell'
import OrderManager, { type LoungeOrder } from './order-manager'
import { getStaffContext } from '@/lib/supabase/staff-context'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to manage orders</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>

  const { supabase, profile } = context
  const canOperate = ['owner', 'admin', 'cashier'].includes(profile.role)
  const [{ data: orderData, error }, { data: sessionData }] = await Promise.all([
    supabase.from('lounge_orders').select('id, table_label, total_cents, payment_status, status, created_at, lounge_order_items(name, quantity, unit_price_cents, line_total_cents)').order('created_at', { ascending: false }).limit(100),
    supabase.from('session_board').select('id, table_label, option_name').eq('status', 'active').order('started_at', { ascending: false }),
  ])
  const orders = (orderData ?? []) as LoungeOrder[]

  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">SALES / SERVICE</p><h1>Orders</h1><p>Record charges against an active session or a table.</p></div><span className="page-count">{orders.length} recent</span></header>
    <section className="panel">
      {error ? <p className="notice error">Could not load orders. Apply the orders and inventory database migration, then refresh.</p> : <OrderManager orders={orders} sessions={sessionData ?? []} canOperate={canOperate} />}
    </section>
    <p className="footnote">Payments are recorded only when authorized staff confirm them. No payment processor is connected.</p>
  </main></AppShell>
}
