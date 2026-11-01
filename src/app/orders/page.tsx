import AppShell from '@/components/app-shell'
import OrderManager, { type LoungeOrder, type OrderProduct } from './order-manager'
import { getStaffContext } from '@/lib/supabase/staff-context'
import type { C2bTransaction, PaybillClaim } from './payment-controls'

export const dynamic = 'force-dynamic'
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to manage orders</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>

  const { supabase, profile } = context
  const canOperate = ['owner', 'admin', 'manager', 'cashier'].includes(profile.role)
  const canReviewPayments = ['owner', 'admin', 'manager'].includes(profile.role)
  const paybillNumber = process.env.MPESA_PAYBILL_NUMBER
  const tillNumber = process.env.MPESA_TILL_NUMBER
  const canPaybill = Boolean(paybillNumber || tillNumber)
  const paymentDestinations = [paybillNumber ? `Paybill ${paybillNumber}` : '', tillNumber ? `Till ${tillNumber}` : ''].filter(Boolean).join(' or ')
  const params = await searchParams
  const orderId = typeof params.order === 'string' && /^[0-9a-f-]{36}$/i.test(params.order) ? params.order : null
  let orderQuery = supabase.from('lounge_orders').select('id, payment_reference, table_label, total_cents, payment_status, status, created_at, lounge_order_items(name, quantity, unit_price_cents, line_total_cents)').order('created_at', { ascending: false }).limit(orderId ? 1 : 100)
  if (orderId) orderQuery = orderQuery.eq('id', orderId)
  const [{ data: orderData, error }, { data: sessionData }] = await Promise.all([
    orderQuery,
    supabase.from('session_board').select('id, table_label, option_name').eq('status', 'active').order('started_at', { ascending: false }),
  ])
  const [claimResult, attemptResult, c2bResult] = await Promise.all([
    canOperate ? supabase.from('paybill_claims').select('id,order_id,amount_cents,provider_receipt,status,created_at,review_reason,lounge_orders(table_label,payment_reference)').eq('status', 'pending').order('created_at').limit(50) : Promise.resolve({ data: [] }),
    canOperate && (orderData ?? []).length ? supabase.from('payment_attempts').select('order_id,status,created_at').in('order_id', (orderData ?? []).map((order) => order.id)).order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    canReviewPayments ? supabase.from('mpesa_c2b_transactions').select('id,transaction_id,bill_reference,amount_cents,transacted_at,status,received_at,matched_order_id').in('status', ['unmatched','matched','ambiguous']).order('received_at').limit(100) : Promise.resolve({ data: [] }),
  ])
  const { data: productData } = canOperate
    ? await supabase.from('inventory_items').select('id, name, sale_price_cents, unit, track_inventory').eq('is_available', true).not('sale_price_cents', 'is', null).order('name').limit(200)
    : { data: [] }
  const latestStatus = new Map<string, string>()
  for (const attempt of attemptResult.data ?? []) if (!latestStatus.has(attempt.order_id)) latestStatus.set(attempt.order_id, attempt.status)
  const orders = ((orderData ?? []).map((order) => ({ ...order, latest_payment_status: latestStatus.get(order.id) })) as LoungeOrder[])

  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">SALES / SERVICE</p><h1>Orders</h1><p>Record catalog-priced items against an active session or a table.</p></div><span className="page-count">{orderId ? 'Selected order' : `${orders.length} recent`}</span></header>
    {canPaybill && <p className="notice">Pay to <b>{paymentDestinations}</b>. Use the order reference shown in the receipt field as the account/reference where supported. Confirm receipt against the official M-Pesa statement before approving a claim.</p>}
    <section className="panel">
      {error ? <p className="notice error">Could not load orders. Check the database migration state, then refresh.</p> : <OrderManager orders={orders} sessions={sessionData ?? []} products={(productData ?? []) as OrderProduct[]} canOperate={canOperate} claims={(claimResult.data ?? []) as PaybillClaim[]} c2bTransactions={(c2bResult.data ?? []) as C2bTransaction[]} canReviewPayments={canReviewPayments} canPaybill={canPaybill} />}
    </section>
    <p className="footnote">M-Pesa STK orders settle only through a correlated Safaricom callback. Paybill/Till claims require a manager to verify the official transaction record.</p>
  </main></AppShell>
}
