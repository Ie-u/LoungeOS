'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type FlavorItem = { id: string; name: string; unit: string; quantity: number; reorder_level: number; is_available: boolean }
export type FlavorStaff = { user_id: string; display_name: string }
export type FlavorSession = { id: string; table_label: string; option_name: string }
export type FlavorTask = { id: string; inventory_item_id: string; session_id: string | null; assigned_to: string; status: 'queued' | 'preparing' | 'ready' | 'cancelled'; quantity_used: number; preparation_note: string | null; created_at: string; completed_at: string | null }

export default function FlavorManager({
  userId, items, staff, sessions, tasks, canAssign,
}: { userId: string; items: FlavorItem[]; staff: FlavorStaff[]; sessions: FlavorSession[]; tasks: FlavorTask[]; canAssign: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const itemName = (id: string) => items.find((item) => item.id === id)?.name ?? 'Flavor'
  const itemUnit = (id: string) => items.find((item) => item.id === id)?.unit ?? ''
  const staffName = (id: string) => staff.find((member) => member.user_id === id)?.display_name ?? (id === userId ? 'You' : 'Staff member')
  const sessionName = (id: string | null) => sessions.find((session) => session.id === id)?.table_label ?? 'Unlinked task'

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    const submittedForm = event.currentTarget
    const data = new FormData(submittedForm)
    const sessionId = String(data.get('session_id') ?? '')
    const quantityUsed = Number(data.get('quantity_used'))
    const supabase = createClient()
    const { error } = await supabase.from('flavor_tasks').insert({
      inventory_item_id: String(data.get('inventory_item_id')), assigned_to: String(data.get('assigned_to')),
      session_id: sessionId || null, created_by: userId, quantity_used: quantityUsed,
      preparation_note: String(data.get('preparation_note') ?? '').trim() || null,
    })
    setBusy(false)
    if (error) { setIsError(true); setMessage(error.message.includes('flavor') ? 'Choose an available flavor and an active flavor specialist.' : 'Could not assign this preparation task. Check the selected staff, session, and stock item.'); return }
    setIsError(false); setMessage('Flavor task assigned.'); submittedForm.reset(); router.refresh()
  }

  async function updateTask(task: FlavorTask, status: 'preparing' | 'ready' | 'cancelled') {
    setBusy(true); setMessage('')
    const supabase = createClient()
    const { error } = await supabase.from('flavor_tasks').update({ status }).eq('id', task.id)
    setBusy(false)
    if (error) { setIsError(true); setMessage(error.message.includes('stock') ? 'Available flavor stock is too low to record this usage.' : 'The task update was rejected. It may already be complete or no longer assigned to you.'); return }
    setIsError(false); setMessage(status === 'ready' && Number(task.quantity_used) > 0 ? 'Task completed and the recorded flavor amount was deducted from stock.' : `Task marked ${status}.`); router.refresh()
  }

  async function completeTask(task: FlavorTask, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const quantityUsed = Number(new FormData(event.currentTarget).get('quantity_used'))
    if (!Number.isFinite(quantityUsed) || quantityUsed < 0) { setIsError(true); setMessage('Enter a valid flavor amount.'); return }
    setBusy(true); setMessage('')
    const supabase = createClient()
    const { error } = await supabase.from('flavor_tasks').update({ status: 'ready', quantity_used: quantityUsed }).eq('id', task.id)
    setBusy(false)
    if (error) { setIsError(true); setMessage(error.message.includes('stock') ? 'Available flavor stock is too low to record this usage.' : 'The task update was rejected. It may already be complete or no longer assigned to you.'); return }
    setIsError(false); setMessage(quantityUsed > 0 ? 'Task completed and recorded flavor usage was deducted from stock.' : 'Task completed without a stock deduction.'); router.refresh()
  }

  return <>
    {message && <p className={`notice ${isError ? 'error' : 'success-notice'}`} role="status">{message}</p>}
    {canAssign && <section className="panel flavor-panel">
      <div className="panel-head"><div><p className="eyebrow">SERVICE PREPARATION</p><h2>Assign a flavor task</h2></div></div>
      {staff.length === 0 || items.filter((item) => item.is_available).length === 0 ? <p className="notice role-notice">Add an available item in the Shisha flavor category and invite a flavor specialist before assigning work.</p> : <form className="form-grid" onSubmit={assign}>
        <label>Flavor<select name="inventory_item_id" required defaultValue=""><option value="" disabled>Select flavor</option>{items.filter((item) => item.is_available).map((item) => <option key={item.id} value={item.id}>{item.name} · {Number(item.quantity)} {item.unit} available</option>)}</select></label>
        <label>Assign to<select name="assigned_to" required defaultValue=""><option value="" disabled>Select specialist</option>{staff.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label>
        <label>Session (optional)<select name="session_id" defaultValue=""><option value="">No session link</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.table_label} · {session.option_name}</option>)}</select></label>
        <label>Expected flavor stock amount to deduct<input name="quantity_used" type="number" min="0" step="0.001" defaultValue="0" required /></label>
        <label className="wide-field">Preparation notes<input name="preparation_note" maxLength={500} placeholder="Optional service notes" /></label>
        <p className="footnote wide-field">Stock is reduced only when a specialist marks the task ready and an amount above zero was recorded.</p>
        <button className="primary-button" disabled={busy}>Assign preparation</button>
      </form>}
    </section>}

    <section className="panel flavor-panel">
      <div className="panel-head"><div><p className="eyebrow">FLAVOR CATALOGUE</p><h2>Availability <span className="count">{items.length}</span></h2></div><Link className="text-link" href="/inventory">View inventory</Link></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Flavor</th><th>On hand</th><th>Reorder level</th><th>Availability</th></tr></thead><tbody>{items.map((item) => {const low = Number(item.quantity) <= Number(item.reorder_level); return <tr key={item.id}><td><b>{item.name}</b></td><td>{Number(item.quantity).toLocaleString('en-KE', { maximumFractionDigits: 3 })} {item.unit}</td><td>{Number(item.reorder_level).toLocaleString('en-KE', { maximumFractionDigits: 3 })} {item.unit}</td><td><span className={`state ${!item.is_available ? 'ended' : low ? 'overdue' : 'active'}`}>{!item.is_available ? 'unavailable' : low ? 'low stock' : 'available'}</span></td></tr>})}{items.length === 0 && <tr><td colSpan={4} className="table-empty">No shisha flavors are configured yet.</td></tr>}</tbody></table></div>
    </section>

    <section className="panel flavor-panel">
      <div className="panel-head"><div><p className="eyebrow">PREPARATION QUEUE</p><h2>{canAssign ? 'Assigned flavor tasks' : 'My assigned tasks'} <span className="count">{tasks.filter((task) => ['queued', 'preparing'].includes(task.status)).length}</span></h2></div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Flavor</th><th>Session</th><th>Assigned specialist</th><th>Use recorded</th><th>Status</th><th>Action</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td><b>{itemName(task.inventory_item_id)}</b><small className="table-subline">{task.preparation_note || 'No preparation note'}</small></td><td>{task.session_id ? <Link href="/sessions">{sessionName(task.session_id)}</Link> : 'No session'}</td><td>{staffName(task.assigned_to)}</td><td>{task.status === 'preparing' && task.assigned_to === userId ? <input form={`finish-${task.id}`} name="quantity_used" type="number" min="0" step="0.001" defaultValue={task.quantity_used} aria-label="Actual flavor amount used" /> : <>{Number(task.quantity_used).toLocaleString('en-KE', { maximumFractionDigits: 3 })} {itemUnit(task.inventory_item_id)}</>}</td><td><span className={`state ${task.status === 'ready' ? 'active' : task.status === 'cancelled' ? 'ended' : task.status === 'preparing' ? 'ending_soon' : ''}`}>{task.status}</span></td><td>{task.status === 'queued' && task.assigned_to === userId && <button disabled={busy} onClick={() => updateTask(task, 'preparing')}>Start prep</button>}{task.status === 'preparing' && task.assigned_to === userId && <form id={`finish-${task.id}`} className="inline-task-form" onSubmit={(event) => completeTask(task, event)}><button className="primary-button" disabled={busy}>Mark ready</button></form>}{canAssign && ['queued', 'preparing'].includes(task.status) && <button className="end-button" disabled={busy} onClick={() => updateTask(task, 'cancelled')}>Cancel</button>}{task.status === 'ready' ? <small className="table-subline">{task.completed_at ? new Date(task.completed_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) : 'Completed'}</small> : null}</td></tr>)}{tasks.length === 0 && <tr><td colSpan={6} className="table-empty">No preparation tasks are waiting.</td></tr>}</tbody></table></div>
    </section>
  </>
}
