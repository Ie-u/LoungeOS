'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type ActiveSession = { id: string; table_label: string; option_name: string }
type OrderItem = { name: string; quantity: number; unit_price_cents: number; line_total_cents: number }
export type LoungeOrder = { id: string; table_label: string; total_cents: number; payment_status: string; status: string; created_at: string; lounge_order_items: OrderItem[] }

const currency = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' })
const formatMoney = (cents: number) => currency.format(Number(cents || 0) / 100)

export default function OrderManager({ orders, sessions, canOperate }: { orders: LoungeOrder[]; sessions: ActiveSession[]; canOperate: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submittedForm = event.currentTarget
    const form = new FormData(submittedForm)
    const amount = Number(String(form.get('unit_price')).replace(',', '.'))
    const quantity = Number(form.get('quantity'))
    const unitPrice = Math.round(amount * 100)
    const name = String(form.get('item_name') ?? '').trim()
    if (!name || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(quantity) || quantity < 1) {
      setError(true); setMessage('Enter an item, a whole-number quantity, and a valid price.'); return
    }
    setBusy(true); setMessage('')
    const sessionId = String(form.get('session_id') ?? '')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('create_lounge_order', {
      p_session_id: sessionId || null,
      p_table_label: String(form.get('table_label') ?? '').trim() || null,
      p_items: [{ name, quantity, unit_price_cents: unitPrice }],
    })
    setBusy(false)
    if (rpcError) { setError(true); setMessage(rpcError.message.includes('Cashier') ? 'Your staff role cannot create orders.' : 'Order could not be saved. Check the table or session and try again.'); return }
    setError(false); setMessage('Order recorded.'); submittedForm.reset(); router.refresh()
  }

  async function updateOrder(orderId: string, action: 'paid' | 'cancel') {
    setBusy(true); setMessage('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc(action === 'paid' ? 'mark_lounge_order_paid' : 'cancel_lounge_order', { p_order_id: orderId })
    setBusy(false)
    if (rpcError) { setError(true); setMessage(action === 'paid' ? 'Only an open unpaid order can be marked paid.' : 'Only an open unpaid order can be cancelled.'); return }
    setError(false); setMessage(action === 'paid' ? 'Payment recorded by staff.' : 'Order cancelled.'); router.refresh()
  }

  return <>
    {canOperate && <form className="operation-form order-form" onSubmit={createOrder}>
      <div className="form-intro"><p className="eyebrow">NEW ORDER</p><h2>Record an order</h2><p>Amounts are entered in KES. The total is calculated and stored by the database.</p></div>
      <div className="form-grid">
        <label>Active session <select name="session_id" defaultValue=""><option value="">Choose a session (optional)</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.table_label} · {session.option_name}</option>)}</select></label>
        <label>Table or customer label <input name="table_label" maxLength={32} placeholder="e.g. T-04" /></label>
        <label>Item or service <input name="item_name" maxLength={100} placeholder="e.g. Mint tea" required /></label>
        <label>Quantity <input name="quantity" type="number" min="1" max="1000" step="1" defaultValue="1" required /></label>
        <label>Unit price (KES) <input name="unit_price" type="number" min="0" step="0.01" placeholder="0.00" required /></label>
      </div>
      <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : '＋ Record order'}</button>
    </form>}
    {!canOperate && <p className="notice role-notice">Owner, admin, or cashier access is required to create or update orders.</p>}
    {message && <p className={`notice ${error ? 'error' : 'success-notice'}`} role="status">{message}</p>}
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Payment</th><th>Created</th><th>Actions</th></tr></thead><tbody>
      {orders.map((order) => <tr key={order.id}>
        <td><b>{order.table_label}</b><small className="table-subline">{order.status}</small></td>
        <td>{order.lounge_order_items?.map((item) => `${item.quantity} × ${item.name}`).join(', ') || 'No items'}</td>
        <td className="money-cell">{formatMoney(order.total_cents)}</td>
        <td><span className={`state ${order.payment_status === 'paid' ? 'active' : order.payment_status === 'cancelled' ? 'ended' : 'ending_soon'}`}>{order.payment_status}</span></td>
        <td>{new Date(order.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}</td>
        <td>{canOperate && order.status === 'open' && order.payment_status === 'unpaid' ? <div className="row-actions"><button onClick={() => updateOrder(order.id, 'paid')} disabled={busy}>Record payment</button><button className="end-button" onClick={() => updateOrder(order.id, 'cancel')} disabled={busy}>Cancel</button></div> : '—'}</td>
      </tr>)}
      {orders.length === 0 && <tr><td colSpan={6} className="table-empty">No orders recorded yet.</td></tr>}
    </tbody></table></div>
  </>
}
