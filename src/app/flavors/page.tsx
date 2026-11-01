import AppShell from '@/components/app-shell'
import { getStaffContext } from '@/lib/supabase/staff-context'
import FlavorManager, { type FlavorItem, type FlavorSession, type FlavorStaff, type FlavorTask } from './flavor-manager'

export const dynamic = 'force-dynamic'

export default async function FlavorsPage() {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in to view flavor tasks</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>
  if (!['owner', 'admin', 'manager', 'flavor_specialist'].includes(context.profile.role)) return <main className="center"><div className="setup-card"><h1>Flavor work is restricted</h1><p>Your role does not have access to flavor preparation.</p></div></main>
  const { supabase, profile, userId } = context
  const canAssign = ['owner', 'admin', 'manager'].includes(profile.role)
  const [{ data: itemData }, { data: taskData, error }, { data: staffData }, { data: sessionData }] = await Promise.all([
    supabase.from('inventory_items').select('id, name, unit, quantity, reorder_level, is_available').eq('category', 'flavor').order('name'),
    supabase.from('flavor_tasks').select('id, inventory_item_id, session_id, assigned_to, status, quantity_used, preparation_note, created_at, completed_at').order('created_at', { ascending: false }).limit(100),
    canAssign ? supabase.from('staff_profiles').select('user_id, display_name').eq('role', 'flavor_specialist').eq('is_active', true).order('display_name') : Promise.resolve({ data: [] }),
    supabase.from('session_board').select('id, table_label, option_name').eq('status', 'active').order('started_at', { ascending: false }).limit(100),
  ])
  const items = (itemData ?? []) as FlavorItem[]
  const tasks = (taskData ?? []) as FlavorTask[]
  const sessions = (sessionData ?? []) as FlavorSession[]
  const staff = [...((staffData ?? []) as FlavorStaff[]), { user_id: profile.user_id, display_name: profile.display_name }]

  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">SHISHA SERVICE</p><h1>Flavor preparation</h1><p>Prepare assigned flavors, track availability, and record actual stock use.</p></div><span className="page-count">{tasks.filter((task) => ['queued', 'preparing'].includes(task.status)).length} in queue</span></header>
    {error && <p className="notice error">Flavor tasks could not be loaded. Check the staff access and flavor workflow migration.</p>}
    <FlavorManager userId={userId} items={items} staff={staff} sessions={sessions} tasks={tasks} canAssign={canAssign} />
  </main></AppShell>
}
