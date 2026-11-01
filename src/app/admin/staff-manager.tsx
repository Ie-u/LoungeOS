'use client'

import { FormEvent, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { inviteStaff, sendStaffRecovery } from './actions'
import SessionPresets, { type SessionOption } from './session-presets'
import type { StaffProfile } from '@/lib/supabase/staff-context'

export type StaffRow = StaffProfile & { created_at: string; email: string | null; email_confirmed_at: string | null }
export type BusinessSettings = {
  business_name: string | null
  venue_latitude: number | null
  venue_longitude: number | null
  geofence_radius_m: number | null
  max_location_accuracy_m: number | null
  session_alert_minutes: number | null
  low_stock_alert_enabled: boolean
}
export type AuditRow = { id: number; entity_type: string; action: string; created_at: string }
type IntegrationStatus = { stkReady: boolean; stkMode: string; manualPaymentsReady: boolean; c2bReady: boolean; staffProvisioningReady: boolean }
const roleOptions = ['owner', 'admin', 'manager', 'cashier', 'attendant', 'flavor_specialist'] as const

export default function StaffManager({
  profile, staff, settings, audit, canEditSettings, integrations, sessionOptions,
}: { profile: StaffProfile; staff: StaffRow[]; settings: BusinessSettings | null; audit: AuditRow[]; canEditSettings: boolean; integrations: IntegrationStatus; sessionOptions: SessionOption[] }) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const inviteSubmitting = useRef(false)

  async function submitInvite(form: FormData) {
    if (inviteSubmitting.current) return
    inviteSubmitting.current = true
    startTransition(async () => {
      try {
        const result = await inviteStaff(form)
        setError(Boolean(result.error)); setMessage(result.error ?? result.success ?? 'Invitation could not be completed.')
      } catch {
        setError(true); setMessage('The invitation request failed unexpectedly. Check your connection and Supabase Auth logs before retrying.')
      } finally {
        inviteSubmitting.current = false
        router.refresh()
      }
    })
  }

  async function updateStaff(userId: string, patch: { role?: string; is_active?: boolean }) {
    setMessage('')
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.from('staff_profiles').update(patch).eq('user_id', userId)
      if (updateError) { setError(true); setMessage('That staff change was denied or could not be saved. Check your role and try again.'); return }
      setError(false); setMessage('Staff access updated and recorded.'); router.refresh()
    } catch {
      setError(true); setMessage('The staff change failed unexpectedly. Check your connection and try again.')
    }
  }

  async function recover(userId: string) {
    if (busy) return
    startTransition(async () => {
      try {
        const result = await sendStaffRecovery(userId)
        setError(Boolean(result.error)); setMessage(result.error ?? result.success ?? 'Recovery email could not be sent.')
      } catch {
        setError(true); setMessage('The recovery request failed unexpectedly. Check Supabase Auth email settings and logs.')
      }
    })
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const numeric = (key: string) => {
      const value = String(values.get(key) ?? '').trim()
      return value ? Number(value) : null
    }
    const payload = {
      business_name: String(values.get('business_name') ?? '').trim() || null,
      venue_latitude: numeric('venue_latitude'), venue_longitude: numeric('venue_longitude'),
      geofence_radius_m: numeric('geofence_radius_m'), max_location_accuracy_m: numeric('max_location_accuracy_m'),
      session_alert_minutes: numeric('session_alert_minutes'), low_stock_alert_enabled: values.get('low_stock_alert_enabled') === 'on',
    }
    if ((payload.venue_latitude === null) !== (payload.venue_longitude === null)
      || [payload.venue_latitude, payload.venue_longitude, payload.geofence_radius_m, payload.max_location_accuracy_m, payload.session_alert_minutes].some((value) => value !== null && !Number.isFinite(value))) {
      setError(true); setMessage('Enter both venue coordinates or leave both empty, and use valid numeric limits.'); return
    }
    const supabase = createClient()
    const { error: updateError } = await supabase.from('business_settings').update(payload).eq('singleton', true)
    if (updateError) { setError(true); setMessage('Settings were not saved. Check that the owner or admin role is active.'); return }
    setError(false); setMessage('Business settings saved.'); router.refresh()
  }

  return <>
    {message && <p className={`notice ${error ? 'error' : 'success-notice'}`} role="status">{message}</p>}
    <section className="panel admin-panel">
      <div className="panel-head"><div><p className="eyebrow">TEAM ACCESS</p><h2 id="staff-accounts">Staff accounts <span className="count">{staff.length}</span></h2></div></div>
      <p className="panel-copy">Invite staff by email, assign the least access they need, and deactivate access without deleting their history. Invitations and password recovery depend on Supabase email delivery being configured.</p>
      <form className="operation-form" action={submitInvite}>
        <div className="form-grid"><label>Name<input name="display_name" autoComplete="name" maxLength={100} required /></label><label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label><label>Role<select name="role" defaultValue="attendant">{roleOptions.filter((role) => profile.role === 'owner' || (profile.role === 'admin' ? !['owner', 'admin'].includes(role) : ['cashier', 'attendant', 'flavor_specialist'].includes(role))).map((role) => <option key={role} value={role}>{role.replace('_', ' ')}</option>)}</select></label></div>
        <button className="primary-button" disabled={busy}>{busy ? 'Sending invite…' : '＋ Invite staff'}</button>
      </form>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Staff member</th><th>Email</th><th>Role</th><th>Account setup</th><th>Actions</th></tr></thead><tbody>
        {staff.map((member) => {
          const self = member.user_id === profile.user_id
          const assignable = profile.role === 'owner' ? roleOptions : profile.role === 'admin' ? roleOptions.filter((role) => !['owner', 'admin'].includes(role)) : roleOptions.filter((role) => ['manager', 'cashier', 'attendant', 'flavor_specialist'].includes(role))
          return <tr key={member.user_id}><td><b>{member.display_name}</b><small className="table-subline">{self ? 'You' : `Added ${new Date(member.created_at).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}`}</small></td><td>{member.email ?? 'Email unavailable'}</td>
            <td><select aria-label={`Role for ${member.display_name}`} value={member.role} disabled={self || busy || (profile.role === 'manager' && ['owner', 'admin'].includes(member.role))} onChange={(event) => updateStaff(member.user_id, { role: event.target.value })}>{roleOptions.map((role) => <option key={role} value={role} disabled={!assignable.includes(role)}>{role.replace('_', ' ')}</option>)}</select></td>
            <td><span className={`state ${member.is_active && member.email_confirmed_at ? 'active' : 'ending_soon'}`}>{!member.is_active ? 'deactivated' : member.email_confirmed_at ? 'email confirmed' : 'setup pending · email not confirmed'}</span></td>
            <td>{self ? '—' : <div className="row-actions"><button onClick={() => recover(member.user_id)} disabled={busy || !member.is_active}>Send recovery</button><button className={member.is_active ? 'end-button' : ''} onClick={() => updateStaff(member.user_id, { is_active: !member.is_active })} disabled={busy}>{member.is_active ? 'Deactivate' : 'Reactivate'}</button></div>}</td>
          </tr>
        })}
        {staff.length === 0 && <tr><td colSpan={5} className="table-empty">No staff profiles are available.</td></tr>}
      </tbody></table></div>
      <p className="footnote">No password or PIN is displayed or stored by staff management. Role and access changes are audited by PostgreSQL.</p>
    </section>

    {canEditSettings && <SessionPresets options={sessionOptions} />}

    <section className="panel admin-panel">
      <div className="panel-head"><div><p className="eyebrow">INTEGRATIONS</p><h2>Connection readiness</h2></div></div>
      <div className="integration-status-list">
        <p><span>Daraja STK</span><b className={`state ${integrations.stkReady ? 'active' : 'ending_soon'}`}>{integrations.stkReady ? `configured · ${integrations.stkMode}` : 'credentials and callback URL needed'}</b></p>
        <p><span>Paybill / Till claims</span><b className={`state ${integrations.manualPaymentsReady ? 'active' : 'ending_soon'}`}>{integrations.manualPaymentsReady ? 'destination configured · review required' : 'business number needed'}</b></p>
        <p><span>Daraja C2B confirmation</span><b className={`state ${integrations.c2bReady ? 'active' : 'ending_soon'}`}>{integrations.c2bReady ? 'server setup present · register URLs in Daraja' : 'callback token, URL, and shortcode needed'}</b></p>
        <p><span>Staff invitations and recovery</span><b className={`state ${integrations.staffProvisioningReady ? 'active' : 'ending_soon'}`}>{integrations.staffProvisioningReady ? 'server setup present · email delivery must be checked' : 'server key and public app URL needed'}</b></p>
        <p><span>Scheduled in-app alerts</span><b className="state active">database job active · every minute</b></p>
        <p><span>External SMS, email, or push</span><b className="state ending_soon">provider not configured</b></p>
      </div>
      <p className="footnote">Readiness shows whether required environment values exist. It does not verify live provider credentials or email delivery. Never enter secret keys in the browser.</p>
    </section>

    <section className="panel admin-panel">
      <div className="panel-head"><div><p className="eyebrow">BUSINESS CONTROL</p><h2 id="business-settings">Venue and operating rules</h2></div><span className={`state ${settings?.venue_latitude != null && settings?.geofence_radius_m != null ? 'active' : 'ending_soon'}`}>{settings?.venue_latitude != null && settings?.geofence_radius_m != null ? 'venue configured' : 'attendance setup needed'}</span></div>
      <p className="panel-copy">Set the actual lounge location and GPS tolerance before check-in is enabled. GPS is an operational signal, not proof that a person is physically present.</p>
      {canEditSettings ? <form className="operation-form" onSubmit={saveSettings}>
        <div className="form-grid"><label>Business name<input name="business_name" maxLength={120} defaultValue={settings?.business_name ?? ''} /></label><label>Venue latitude<input name="venue_latitude" type="number" step="any" min="-90" max="90" defaultValue={settings?.venue_latitude ?? ''} /></label><label>Venue longitude<input name="venue_longitude" type="number" step="any" min="-180" max="180" defaultValue={settings?.venue_longitude ?? ''} /></label><label>Permitted radius (metres)<input name="geofence_radius_m" type="number" min="10" max="5000" defaultValue={settings?.geofence_radius_m ?? ''} /></label><label>Maximum GPS accuracy error (metres)<input name="max_location_accuracy_m" type="number" min="5" max="1000" defaultValue={settings?.max_location_accuracy_m ?? ''} /></label><label>Session alert lead time (minutes)<input name="session_alert_minutes" type="number" min="1" max="60" defaultValue={settings?.session_alert_minutes ?? ''} /></label></div>
        <label className="check-field"><input name="low_stock_alert_enabled" type="checkbox" defaultChecked={settings?.low_stock_alert_enabled ?? false} /> Enable low-stock alerts after a threshold is configured for each item</label>
        <button className="primary-button">Save settings</button>
      </form> : <p className="notice role-notice">Venue settings and global operating rules require owner or admin access. They have not been guessed or pre-filled.</p>}
    </section>

    <section className="panel admin-panel">
      <div className="panel-head"><div><p className="eyebrow">ACCOUNTABILITY</p><h2 id="recent-audit">Recent audit activity</h2></div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Event</th><th>Record</th><th>Time</th></tr></thead><tbody>{audit.map((row) => <tr key={row.id}><td>{row.action.replaceAll('_', ' ')}</td><td>{row.entity_type.replaceAll('_', ' ')}</td><td>{new Date(row.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}</td></tr>)}{audit.length === 0 && <tr><td colSpan={3} className="table-empty">No audit events have been recorded yet.</td></tr>}</tbody></table></div>
    </section>
  </>
}
