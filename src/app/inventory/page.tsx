import AppShell from '@/components/app-shell'
import InventoryManager, { type InventoryItem, type StockMovement } from './inventory-manager'
import { getStaffContext } from '@/lib/supabase/staff-context'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to view inventory</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>

  const { supabase, profile } = context
  const canView = ['owner', 'admin', 'cashier'].includes(profile.role)
  const canManage = ['owner', 'admin'].includes(profile.role)
  const [{ data: itemData, error }, { data: movementData }] = await Promise.all([
    canView ? supabase.from('inventory_items').select('id, name, unit, quantity, reorder_level, updated_at').order('name') : Promise.resolve({ data: [], error: null }),
    canView ? supabase.from('inventory_movements').select('id, item_id, quantity_delta, reason, created_at, inventory_items(name, unit)').order('created_at', { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
  ])

  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">SUPPLIES / CONTROL</p><h1>Inventory</h1><p>Track on-hand stock and keep a record of every movement.</p></div><span className="page-count">{itemData?.length ?? 0} items</span></header>
    <section className="panel">
      {error ? <p className="notice error">Could not load inventory. Check the database migration and access permissions.</p> : <InventoryManager items={(itemData ?? []) as InventoryItem[]} movements={(movementData ?? []) as StockMovement[]} canManage={canManage} />}
    </section>
  </main></AppShell>
}
