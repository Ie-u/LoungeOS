'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type InventoryItem = { id: string; name: string; unit: string; quantity: number; reorder_level: number; updated_at: string; category: string; is_available: boolean; sale_price_cents: number | null; unit_cost_cents: number | null; track_sales: boolean; track_inventory: boolean }
export type StockMovement = { id: number; item_id: string; quantity_delta: number; reason: string; created_at: string; inventory_items: { name: string; unit: string }[] | null }

function Quantity({ value, unit }: { value: number; unit: string }) {
  return <>{Number(value).toLocaleString('en-KE', { maximumFractionDigits: 3 })} {unit}</>
}
const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' })
const formatMoney = (cents: number | null) => cents === null ? 'Not configured' : money.format(Number(cents) / 100)

export default function InventoryManager({ items, movements, canManage, canCreate, canEditCatalog }: { items: InventoryItem[]; movements: StockMovement[]; canManage: boolean; canCreate: boolean; canEditCatalog: boolean }) {
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
    const category = String(form.get('category') ?? 'supply')
    const priceText = String(form.get('sale_price_kes') ?? '').trim()
    const costText = String(form.get('unit_cost_kes') ?? '').trim()
    const salePrice = priceText ? Math.round(Number(priceText) * 100) : null
    const unitCost = costText ? Math.round(Number(costText) * 100) : null
    const trackSales = form.get('track_sales') === 'on'
    const trackInventory = form.get('track_inventory') === 'on'
    if (!name || !unit || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(reorderLevel) || reorderLevel < 0
      || (salePrice !== null && (!Number.isSafeInteger(salePrice) || salePrice < 0))
      || (unitCost !== null && (!Number.isSafeInteger(unitCost) || unitCost < 0))
      || (trackSales && salePrice === null)) {
      setError(true); setMessage('Enter an item name, unit, and valid stock quantities.'); return
    }
    setBusy(true); setMessage('')
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) { setBusy(false); setError(true); setMessage('Your sign-in expired. Sign in again before changing inventory.'); return }
    const { error: rpcError } = await supabase.from('inventory_items').insert({
      name, unit, quantity, reorder_level: reorderLevel, category, created_by: auth.user.id,
      sale_price_cents: salePrice, unit_cost_cents: unitCost, track_sales: trackSales, track_inventory: trackInventory,
    })
    setBusy(false)
    if (rpcError) { setError(true); setMessage(rpcError.message.includes('access') ? 'Your role cannot add stock items.' : 'The stock item could not be saved. Check for a duplicate item name.'); return }
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

  async function setAvailability(item: InventoryItem) {
    setBusy(true); setMessage('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.from('inventory_items').update({ is_available: !item.is_available }).eq('id', item.id)
    setBusy(false)
    if (rpcError) { setError(true); setMessage('Catalogue availability could not be changed. Check owner or admin access.'); return }
    setError(false); setMessage(`${item.name} marked ${item.is_available ? 'unavailable' : 'available'}.`); router.refresh()
  }

  async function updateProduct(item: InventoryItem, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const values = new FormData(formElement)
    const priceText = String(values.get('sale_price_kes') ?? '').trim()
    const costText = String(values.get('unit_cost_kes') ?? '').trim()
    const toCents = (value: string) => value ? Math.round(Number(value) * 100) : null
    const price = toCents(priceText)
    const cost = toCents(costText)
    const trackSales = values.get('track_sales') === 'on'
    const trackInventory = values.get('track_inventory') === 'on'
    if ((price !== null && (!Number.isSafeInteger(price) || price < 0)) || (cost !== null && (!Number.isSafeInteger(cost) || cost < 0)) || (trackSales && price === null)) {
      setError(true); setMessage('Enter valid KES values and set a sale price before enabling sales for this product.'); return
    }
    setBusy(true); setMessage('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('inventory_items').update({
      sale_price_cents: price, unit_cost_cents: cost, track_sales: trackSales, track_inventory: trackInventory,
    }).eq('id', item.id)
    setBusy(false)
    if (updateError) { setError(true); setMessage('Product settings were not saved. Check owner or admin access and the supplied prices.'); return }
    setError(false); setMessage(`${item.name} product settings saved and audited.`); router.refresh()
  }

  return <>
    {canCreate && <form className="operation-form" onSubmit={createItem}>
      <div className="form-intro"><p className="eyebrow">STOCK REGISTER</p><h2>Add an inventory item</h2><p>Every starting balance is stored as an auditable stock movement.</p></div>
      <div className="form-grid inventory-create-grid">
        <label>Item name<input name="name" maxLength={100} placeholder="e.g. Coconut charcoal" required /></label>
        <label>Category<select name="category" defaultValue="supply"><option value="supply">Supply</option><option value="flavor">Shisha flavor</option><option value="equipment">Equipment</option><option value="other">Other</option></select></label>
        <label>Unit<input name="unit" maxLength={32} placeholder="pieces, kg, packs" required /></label>
        <label>Current quantity<input name="quantity" type="number" min="0" step="0.001" defaultValue="0" required /></label>
        <label>Low stock alert at<input name="reorder_level" type="number" min="0" step="0.001" defaultValue="0" required /></label>
        <label>Sale price (KES)<input name="sale_price_kes" type="number" min="0" step="0.01" placeholder="Leave blank until configured" /></label>
        <label>Unit cost (KES, optional)<input name="unit_cost_kes" type="number" min="0" step="0.01" placeholder="Leave blank until known" /></label>
        <label className="check-field"><input name="track_sales" type="checkbox" /> Available for sale</label>
        <label className="check-field"><input name="track_inventory" type="checkbox" /> Deduct stock when paid</label>
      </div>
      <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : '＋ Add stock item'}</button>
    </form>}
    {!canManage && <p className="notice role-notice">Your role can view stock levels. Managers and owners record stock movements.</p>}
    {canManage && !canCreate && <p className="notice role-notice">Managers can adjust recorded stock. Owners and admins manage the stock catalogue.</p>}
    {message && <p className={`notice ${error ? 'error' : 'success-notice'}`} role="status">{message}</p>}

    <div className="inventory-section-head"><div><p className="eyebrow">ON HAND</p><h2>{items.length > 0 && items.every((item) => item.category === 'flavor') ? 'Flavor stock' : 'Stock items'} <span className="count">{items.length}</span></h2></div></div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Item</th><th>On hand</th><th>Reorder at</th><th>Stock health</th><th>Availability</th>{canEditCatalog && <th>Product rules</th>}<th>Updated</th>{canManage && <th>Record movement</th>}</tr></thead><tbody>
      {items.map((item) => <tr key={item.id}>
        <td><b>{item.name}</b><small className="table-subline">{item.category}</small></td>
        <td><Quantity value={item.quantity} unit={item.unit} /></td>
        <td><Quantity value={item.reorder_level} unit={item.unit} /></td>
        <td><span className={`state ${Number(item.quantity) <= Number(item.reorder_level) ? 'overdue' : 'active'}`}>{Number(item.quantity) <= Number(item.reorder_level) ? 'low stock' : 'in stock'}</span></td>
        <td>{canEditCatalog ? <button className={item.is_available ? 'end-button' : ''} disabled={busy} onClick={() => setAvailability(item)}>{item.is_available ? 'Set unavailable' : 'Set available'}</button> : <span className={`state ${item.is_available ? 'active' : 'ended'}`}>{item.is_available ? 'available' : 'unavailable'}</span>}</td>
        {canEditCatalog && <td><form className="catalog-edit" onSubmit={(event) => updateProduct(item, event)}><small>Sell: {formatMoney(item.sale_price_cents)} · Cost: {formatMoney(item.unit_cost_cents)}</small><input name="sale_price_kes" type="number" min="0" step="0.01" aria-label={`Sale price for ${item.name}`} defaultValue={item.sale_price_cents === null ? '' : item.sale_price_cents / 100} placeholder="Sale KES"/><input name="unit_cost_kes" type="number" min="0" step="0.01" aria-label={`Unit cost for ${item.name}`} defaultValue={item.unit_cost_cents === null ? '' : item.unit_cost_cents / 100} placeholder="Cost KES"/><label><input name="track_sales" type="checkbox" defaultChecked={item.track_sales}/> Sell</label><label><input name="track_inventory" type="checkbox" defaultChecked={item.track_inventory}/> Deduct stock</label><button disabled={busy}>Save</button></form></td>}
        <td>{new Date(item.updated_at).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}</td>
        {canManage && <td><form className="inline-adjust" onSubmit={(event) => adjustStock(item.id, event)}><input aria-label={`Quantity change for ${item.name}`} name="quantity_delta" type="number" step="0.001" placeholder="+ / −" required /><input aria-label={`Reason for ${item.name} adjustment`} name="reason" maxLength={200} placeholder="Reason" required /><button disabled={busy}>Save</button></form></td>}
      </tr>)}
      {items.length === 0 && <tr><td colSpan={6 + Number(canManage) + Number(canEditCatalog)} className="table-empty">No stock items yet.</td></tr>}
    </tbody></table></div>

    <div className="inventory-section-head movement-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>Recent stock movements</h2></div></div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Item</th><th>Change</th><th>Reason</th><th>Recorded</th></tr></thead><tbody>
      {movements.map((movement) => { const item = movement.inventory_items?.[0]; return <tr key={movement.id}><td>{item?.name ?? 'Inventory item'}</td><td className={Number(movement.quantity_delta) < 0 ? 'negative-quantity' : 'positive-quantity'}>{Number(movement.quantity_delta) > 0 ? '+' : ''}<Quantity value={movement.quantity_delta} unit={item?.unit ?? ''} /></td><td>{movement.reason}</td><td>{new Date(movement.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}</td></tr>})}
      {movements.length === 0 && <tr><td colSpan={4} className="table-empty">Stock adjustments will be listed here.</td></tr>}
    </tbody></table></div>
  </>
}
