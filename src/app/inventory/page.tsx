import AppShell from '@/components/app-shell'
import { getStaffContext } from '@/lib/supabase/staff-context'
import InventoryManager, { type InventoryItem, type StockMovement } from './inventory-manager'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to view inventory</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>

  const { supabase, profile } = context
  const canView = ['owner', 'admin', 'manager', 'cashier', 'flavor_specialist'].includes(profile.role)
  const canManage = ['owner', 'admin', 'manager'].includes(profile.role)
  const canCreate = ['owner', 'admin'].includes(profile.role)
  const canEditCatalog = ['owner', 'admin'].includes(profile.role)
  const itemFields = 'id, name, unit, quantity, reorder_level, updated_at, category, is_available, sale_price_cents, track_sales, track_inventory'
  
  const [{ data: itemData, error }, { data: movementData }] = await Promise.all([
    canView ? supabase.from('inventory_items').select(itemFields).order('name') : Promise.resolve({ data: [], error: null }),
    canView ? supabase.from('inventory_movements').select('id, item_id, quantity_delta, reason, created_at, inventory_items(name, unit)').order('created_at', { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
  ])
  
  const { data: costData, error: costError } = canEditCatalog 
    ? await supabase.rpc('get_admin_inventory_costs') 
    : { data: [], error: null }
    
  const costs = new Map((costData ?? []).map((item) => [item.id, item.unit_cost_cents]))
  const inventoryItems = (itemData ?? []).map((item) => ({ ...item, unit_cost_cents: costs.get(item.id) ?? null }))

  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">SUPPLIES / CONTROL</p><h1>Inventory</h1><p>Track on-hand stock and keep a record of every movement.</p></div><span className="page-count">{itemData?.length ?? 0} items</span></header>
    {canEditCatalog && costError && <p className="notice error">Private product costs could not be loaded due to a database error.</p>}
    <section className="panel">
    {error ? <p className="notice error">Could not load inventory. Check the database migration and access permissions.</p> : <InventoryManager items={inventoryItems as InventoryItem[]} movements={(movementData ?? []) as StockMovement[]} canManage={canManage} canCreate={canCreate} canEditCatalog={canEditCatalog} />}
    </section>
  </main></AppShell>
}
