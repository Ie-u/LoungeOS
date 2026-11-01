'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type InventoryItem = { id: string; name: string; unit: string; quantity: number; reorder_level: number; updated_at: string }
export type StockMovement = { id: number; item_id: string; quantity_delta: number; reason: string; created_at: string; inventory_items: { name: string; unit: string } | null }

function Quantity({ value, unit }: { value: number; unit: string }) {
  return <>{Number(value).toLocaleString('en-KE', { maximumFractionDigits: 3 })} {unit}</>
}

export default function InventoryManager({ items, movements, canManage }: { items: InventoryItem[]; movements: StockMovement[]; canManage: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get('name') ?? '').trim()
    const unit = String(form.get('unit') ?? '').trim()
    const quantity = Number(form.get('quantity'))
    const reorderLevel = Number(form.get('reorder_level'))
    if (!name || !unit || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(reorderLevel) || reorderLevel < 0) {
      setError(true); setMessage('Enter an item name, unit, and valid stock quantities.'); return
    }
    setBusy(true); setMessage('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('create_inventory_item', {
      p_name: name, p_unit: unit, p_initial_quantity: quantity, p_reorder_level: reorderLevel,
    })
    setBusy(false)
    if (rpcError) { setError(true); setMessage(rpcError.message.includes('Owner or admin') ? 'Only an owner or admin can add stock items.' : 'The stock item could not be saved. Check for a duplicate item name.'); return }
    setError(false); setMessage('Stock item added.'); formElement.reset(); router.refresh()
  }

  async function adjustStock(itemId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const delta = Number(form.get('quantity_delta'))
    const reason = String(form.get('reason') ?? '').trim()
    if (!Number.isFinite(delta) || delta === 0 || !reason) {
      setError(true); setMessage('Enter a nonzero quantity change and its reason.'); return
    }
    setBusy(true); setMessage('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('adjust_inventory_stock', {
      p_item_id: itemId, p_quantity_delta: delta, p_reason: reason,
    })
    setBusy(false)
    if (rpcError) { setError(true); setMessage(rpcError.message.includes('below zero') ? 'That change would take stock below zero.' : 'The stock adjustment could not be saved. Check the reason and staff role.'); return }
    setError(false); setMessage('Stock movement recorded.'); formElement.reset(); router.refresh()
  }

  return <>
    {canManage && <form className="operation-form" onSubmit={createItem}>
      <div className="form-intro"><p className="eyebrow">STOCK REGISTER</p><h2>Add an inventory item</h2><p>Every starting balance is stored as an auditable stock movement.</p></div>
      <div className="form-grid inventory-create-grid">
        <label>Item name<input name="name" maxLength={100} placeholder="e.g. Coconut charcoal" required /></label>
        <label>Unit<input name="unit" maxLength={32} placeholder="pieces, kg, packs" required /></label>
        <label>Current quantity<input name="quantity" type="number" min="0" step="0.001" defaultValue="0" required /></label>
        <label>Low stock alert at<input name="reorder_level" type="number" min="0" step="0.001" defaultValue="0" required /></label>
      </div>
      <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : '＋ Add stock item'}</button>
    </form>}
    {!canManage && <p className="notice role-notice">Inventory changes require owner or admin access. Cashier accounts can view stock levels.</p>}
    {message && <p className={`notice ${error ? 'error' : 'success-notice'}`} role="status">{message}</p>}

    <div className="inventory-section-head"><div><p className="eyebrow">ON HAND</p><h2>Stock items <span className="count">{items.length}</span></h2></div></div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Item</th><th>Available</th><th>Reorder at</th><th>Stock health</th><th>Updated</th>{canManage && <th>Record movement</th>}</tr></thead><tbody>
      {items.map((item) => <tr key={item.id}>
        <td><b>{item.name}</b></td>
        <td><Quantity value={item.quantity} unit={item.unit} /></td>
        <td><Quantity value={item.reorder_level} unit={item.unit} /></td>
        <td><span className={`state ${Number(item.quantity) <= Number(item.reorder_level) ? 'overdue' : 'active'}`}>{Number(item.quantity) <= Number(item.reorder_level) ? 'low stock' : 'in stock'}</span></td>
        <td>{new Date(item.updated_at).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}</td>
        {canManage && <td><form className="inline-adjust" onSubmit={(event) => adjustStock(item.id, event)}><input aria-label={`Quantity change for ${item.name}`} name="quantity_delta" type="number" step="0.001" placeholder="+ / −" required /><input aria-label={`Reason for ${item.name} adjustment`} name="reason" maxLength={200} placeholder="Reason" required /><button disabled={busy}>Save</button></form></td>}
      </tr>)}
      {items.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="table-empty">No stock items yet.</td></tr>}
    </tbody></table></div>

    <div className="inventory-section-head movement-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>Recent stock movements</h2></div></div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Item</th><th>Change</th><th>Reason</th><th>Recorded</th></tr></thead><tbody>
      {movements.map((movement) => <tr key={movement.id}><td>{movement.inventory_items?.name ?? 'Inventory item'}</td><td className={Number(movement.quantity_delta) < 0 ? 'negative-quantity' : 'positive-quantity'}>{Number(movement.quantity_delta) > 0 ? '+' : ''}<Quantity value={movement.quantity_delta} unit={movement.inventory_items?.unit ?? ''} /></td><td>{movement.reason}</td><td>{new Date(movement.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}</td></tr>)}
      {movements.length === 0 && <tr><td colSpan={4} className="table-empty">Stock adjustments will be listed here.</td></tr>}
    </tbody></table></div>
  </>
}
