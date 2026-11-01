'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PaymentControls, PaybillReviewQueue, type PaybillClaim } from './payment-controls'

type ActiveSession = { id: string; table_label: string; option_name: string }
export type OrderProduct = { id: string; name: string; sale_price_cents: number; unit: string; track_inventory: boolean }
type DraftLine = { productId: string; quantity: number }
type OrderItem = { name: string; quantity: number; unit_price_cents: number; line_total_cents: number; unit_cost_cents: number | null }
export type LoungeOrder = { id: string; table_label: string; total_cents: number; payment_status: string; status: string; created_at: string; lounge_order_items: OrderItem[]; latest_payment_status?: string }

const currency = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' })
const formatMoney = (cents: number) => currency.format(Number(cents || 0) / 100)

export default function OrderManager({ orders, sessions, products, canOperate, claims, canReviewPayments, canPaybill }: { orders: LoungeOrder[]; sessions: ActiveSession[]; products: OrderProduct[]; canOperate: boolean; claims: PaybillClaim[]; canReviewPayments: boolean; canPaybill: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [lines, setLines] = useState<DraftLine[]>([{ productId: '', quantity: 1 }])
  const estimate = useMemo(() => lines.reduce((total, line) => total + (products.find((product) => product.id === line.productId)?.sale_price_cents ?? 0) * line.quantity, 0), [lines, products])

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submittedForm = event.currentTarget
    const form = new FormData(submittedForm)
    if (lines.length < 1 || lines.length > 20 || lines.some((line) => !line.productId || !Number.isFinite(line.quantity) || line.quantity < 0.001 || line.quantity > 1000 || Number(line.quantity.toFixed(3)) !== line.quantity)) {
      setError(true); setMessage('Choose a catalog item and a quantity between 0.001 and 1,000 using up to three decimal places.'); return
    }
    setBusy(true); setMessage('')
    const sessionId = String(form.get('session_id') ?? '')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('create_lounge_order', {
      p_session_id: sessionId || null,
      p_table_label: String(form.get('table_label') ?? '').trim() || null,
      p_items: lines.map((line) => ({ inventory_item_id: line.productId, quantity: line.quantity })),
    })
    setBusy(false)
    if (rpcError) { setError(true); setMessage(rpcError.message.includes('Cashier') ? 'Your staff role cannot create orders.' : 'Order could not be saved. Check the table or session and try again.'); return }
    setError(false); setMessage('Order recorded at the catalog prices confirmed by the database.'); submittedForm.reset(); setLines([{ productId: '', quantity: 1 }]); router.refresh()
  }

  async function cancelOrder(orderId: string) {
    setBusy(true); setMessage('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('cancel_lounge_order', { p_order_id: orderId })
    setBusy(false)
    if (rpcError) { setError(true); setMessage('Only an open unpaid order can be cancelled.'); return }
    setError(false); setMessage('Order cancelled.'); router.refresh()
  }

  return <>
    {canOperate && <form className="operation-form order-form" onSubmit={createOrder}>
      <div className="form-intro"><p className="eyebrow">NEW ORDER</p><h2>Record an order</h2><p>Amounts are entered in KES. The total is calculated and stored by the database.</p></div>
      <div className="form-grid">
        <label>Active session <select name="session_id" defaultValue=""><option value="">Choose a session (optional)</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.table_label} · {session.option_name}</option>)}</select></label>
        <label>Table or customer label <input name="table_label" maxLength={32} placeholder="e.g. T-04" /></label>
      </div>
      {products.length === 0 ? <p className="notice role-notice">No priced products are available. An owner or admin must configure items and prices in Inventory before a cashier can create an order.</p> : <div className="order-lines"><div className="order-lines-heading"><b>Items</b><button type="button" disabled={lines.length >= 20} onClick={() => setLines((current) => [...current, { productId: '', quantity: 1 }])}>＋ Add item</button></div>{lines.map((line, index) => <div className="order-line" key={index}>
        <label>Product<select value={line.productId} onChange={(event) => setLines((current) => current.map((candidate, row) => row === index ? { ...candidate, productId: event.target.value } : candidate))} required><option value="">Select from catalog</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.sale_price_cents)}</option>)}</select></label>
        <label>Quantity<input type="number" min="0.001" max="1000" step="0.001" value={line.quantity} onChange={(event) => setLines((current) => current.map((candidate, row) => row === index ? { ...candidate, quantity: Number(event.target.value) } : candidate))} required /></label>
        <span className="order-line-total">{formatMoney((products.find((product) => product.id === line.productId)?.sale_price_cents ?? 0) * line.quantity)}</span>
        <button type="button" className="remove-line" aria-label={`Remove item ${index + 1}`} disabled={lines.length <= 1} onClick={() => setLines((current) => current.filter((_, row) => row !== index))}>Remove</button>
      </div>)}<div className="order-estimate"><span>Estimated total</span><b>{formatMoney(estimate)}</b><small>Final total and unit prices are re-read and calculated in the database.</small></div></div>}
      <button className="primary-button" disabled={busy || products.length === 0}>{busy ? 'Saving…' : '＋ Record order'}</button>
    </form>}
    {!canOperate && <p className="notice role-notice">Owner, admin, or cashier access is required to create or update orders.</p>}
    {message && <p className={`notice ${error ? 'error' : 'success-notice'}`} role="status">{message}</p>}
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Payment</th><th>Created</th><th>Actions</th></tr></thead><tbody>
      {orders.map((order) => <tr key={order.id}>
        <td><b>{order.table_label}</b><small className="table-subline">{order.status}</small></td>
        <td>{order.lounge_order_items?.map((item) => `${item.quantity} × ${item.name}`).join(', ') || 'No items'}</td>
        <td className="money-cell">{formatMoney(order.total_cents)}</td>
        <td><span className={`state ${order.payment_status === 'paid' ? 'active' : order.payment_status === 'cancelled' ? 'ended' : 'ending_soon'}`}>{order.payment_status}</span>{order.latest_payment_status && <small className="table-subline">STK: {order.latest_payment_status.replace('_', ' ')}</small>}</td>
        <td>{new Date(order.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}</td>
        <td>{canOperate && order.status === 'open' && order.payment_status === 'unpaid' ? <><PaymentControls orderId={order.id} reference={`LO-${order.id.slice(0, 8).toUpperCase()}`} canPaybill={canPaybill} /><button className="end-button" onClick={() => cancelOrder(order.id)} disabled={busy}>Cancel order</button></> : '—'}</td>
      </tr>)}
      {orders.length === 0 && <tr><td colSpan={6} className="table-empty">No orders recorded yet.</td></tr>}
    </tbody></table></div>
    <PaybillReviewQueue claims={claims} canReview={canReviewPayments} />
  </>
}
