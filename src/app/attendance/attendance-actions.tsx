'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type AttendanceEvent = { id: string; staff_id: string; event_type: 'check_in' | 'check_out'; recorded_at: string; latitude: number; longitude: number; accuracy_m: number; distance_m: number }
export type AttendanceRequest = { id: string; staff_id: string; event_type: 'check_in' | 'check_out'; requested_at: string; reason: string; status: string; review_reason: string | null; created_at: string }
export type StaffName = { user_id: string; display_name: string }

export default function AttendanceActions({
  userId, events, requests, staffNames, configured, canReview,
}: { userId: string; events: AttendanceEvent[]; requests: AttendanceRequest[]; staffNames: StaffName[]; configured: boolean; canReview: boolean }) {
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const mine = events.filter((event) => event.staff_id === userId).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]
  const eventType = mine?.event_type === 'check_in' ? 'check_out' : 'check_in'

  function locate(): Promise<{ latitude: number; longitude: number; accuracy: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('This device does not provide location. Request a manager review instead.')); return }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
        (failure) => reject(new Error(failure.code === failure.PERMISSION_DENIED
          ? 'Location permission was denied. You can request a manager review and explain why.'
          : failure.code === failure.TIMEOUT
            ? 'Location could not be determined in time. Move to an open area or request a manager review.'
            : 'Location is unavailable. Try again outdoors or request a manager review.')),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      )
    })
  }

  async function recordAttendance() {
    setBusy(true); setMessage('Requesting device location…'); setIsError(false)
    try {
      const location = await locate()
      const supabase = createClient()
      const { error } = await supabase.from('staff_attendance').insert({
        staff_id: userId, event_type: eventType, latitude: location.latitude, longitude: location.longitude,
        accuracy_m: location.accuracy, distance_m: 0,
      })
      if (error) throw new Error(error.message.includes('not configured')
        ? 'Attendance is not enabled yet. Ask an owner to set the actual venue location and GPS limits.'
        : error.message.includes('accuracy')
          ? 'GPS accuracy is too low. Move to an open area and retry, or request manager review.'
          : error.message.includes('outside')
            ? 'The location is outside the configured premises or too close to its edge. If GPS is wrong, request manager review.'
            : error.message.includes('alternate')
              ? 'A check-in or check-out is already recorded for this shift. Ask a manager to review the timeline.'
              : 'Attendance could not be recorded. Check your access and try again.')
      setMessage(eventType === 'check_in' ? 'Check-in recorded with location accuracy details.' : 'Check-out recorded with location accuracy details.')
      router.refresh()
    } catch (failure) {
      setIsError(true); setMessage(failure instanceof Error ? failure.message : 'Location could not be verified. Request a manager review if needed.')
    } finally { setBusy(false) }
  }

  async function requestReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    const submittedForm = event.currentTarget
    const form = new FormData(submittedForm)
    const requestedLocalTime = String(form.get('requested_at') ?? '')
    const requestedAt = new Date(requestedLocalTime)
    const reason = String(form.get('reason') ?? '').trim()
    if (Number.isNaN(requestedAt.getTime()) || reason.length < 8) {
      setBusy(false); setIsError(true); setMessage('Choose the shift time and explain the exception in at least 8 characters.'); return
    }
    const supabase = createClient()
    const { error } = await supabase.from('attendance_exceptions').insert({
      staff_id: userId, requested_by: userId, event_type: String(form.get('event_type')),
      requested_at: requestedAt.toISOString(), reason,
    })
    setBusy(false)
    if (error) { setIsError(true); setMessage('The manager review request could not be saved. Check the requested time and your account.') ; return }
    setIsError(false); setMessage('Review request sent. The original attendance history remains unchanged.'); submittedForm.reset(); router.refresh()
  }

  async function review(requestId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    const form = new FormData(event.currentTarget)
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const status = submitter instanceof HTMLButtonElement ? submitter.value : ''
    const reason = String(form.get('review_reason') ?? '').trim()
    if (status !== 'approved' && status !== 'rejected') { setBusy(false); setIsError(true); setMessage('Choose an attendance review decision.'); return }
    if (reason.length < 8) { setBusy(false); setIsError(true); setMessage('Enter an explanation of at least 8 characters.'); return }
    const supabase = createClient()
    const { error } = await supabase.from('attendance_exceptions').update({ status, reviewed_by: userId, reviewed_at: new Date().toISOString(), review_reason: reason }).eq('id', requestId)
    setBusy(false)
    if (error) { setIsError(true); setMessage('That review could not be saved. It may already have been resolved.') ; return }
    setIsError(false); setMessage('Attendance review recorded. The original event history was preserved.'); router.refresh()
  }

  const nameFor = (id: string) => staffNames.find((staff) => staff.user_id === id)?.display_name ?? 'Staff member'

  return <>
    {message && <p className={`notice ${isError ? 'error' : 'success-notice'}`} role="status">{message}</p>}
    <section className="panel attendance-check">
      <div className="panel-head"><div><p className="eyebrow">SHIFT ATTENDANCE</p><h2>{eventType === 'check_in' ? 'Start your shift' : 'End your shift'}</h2></div><span className={`state ${configured ? 'active' : 'ending_soon'}`}>{configured ? 'premises rule active' : 'venue setup required'}</span></div>
      <p className="panel-copy">Your device will share its current GPS location and accuracy with LoungeOS to check the configured venue radius. GPS can be imprecise or spoofed and is not proof of presence. Only request location when you are ready to record your own shift event.</p>
      <button type="button" className="primary-button" onClick={recordAttendance} disabled={busy || !configured}>{busy ? 'Checking location…' : eventType === 'check_in' ? 'Check in at the lounge' : 'Check out'}</button>
      {!configured && <p className="notice role-notice">The owner or admin must enter the venue coordinates, permitted radius, and maximum GPS accuracy before check-in works.</p>}
    </section>

    <section className="panel attendance-check">
      <div className="panel-head"><div><p className="eyebrow">LOCATION OR DEVICE EXCEPTION</p><h2>Request manager review</h2></div></div>
      <p className="panel-copy">Use this if location permission is unavailable, GPS is inaccurate, or an attendance event needs correction. A manager must review it with a reason. The system never rewrites the original event.</p>
      <form className="form-grid" onSubmit={requestReview}>
        <label>Event<select name="event_type"><option value="check_in">Check-in</option><option value="check_out">Check-out</option></select></label>
        <label>Requested shift time<input name="requested_at" type="datetime-local" required /></label>
        <label className="wide-field">Reason<textarea name="reason" minLength={8} maxLength={500} rows={3} placeholder="Explain what prevented a normal GPS check-in or why the time needs review." required /></label>
        <button className="primary-button" disabled={busy}>Submit for review</button>
      </form>
    </section>

    {canReview && <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">MANAGER ACTION</p><h2>Pending attendance reviews</h2></div><span className="count">{requests.filter((request) => request.status === 'pending').length}</span></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Staff</th><th>Requested event</th><th>Reason</th><th>Decision and explanation</th></tr></thead><tbody>
        {requests.filter((request) => request.status === 'pending').map((request) => <tr key={request.id}><td>{nameFor(request.staff_id)}</td><td>{request.event_type.replace('_', ' ')}<small className="table-subline">{new Date(request.requested_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</small></td><td>{request.reason}</td><td><form className="review-form" onSubmit={(event) => review(request.id, event)}><input name="review_reason" minLength={8} maxLength={500} placeholder="Review reason" required /><button name="decision" value="approved" className="primary-button" disabled={busy}>Approve</button><button name="decision" value="rejected" className="end-button" disabled={busy}>Reject</button></form></td></tr>)}
        {requests.every((request) => request.status !== 'pending') && <tr><td colSpan={4} className="table-empty">No attendance reviews need attention.</td></tr>}
      </tbody></table></div>
    </section>}

    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">ORIGINAL EVENT LOG</p><h2>Recent attendance</h2></div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Staff</th><th>Event</th><th>Recorded at</th><th>Location accuracy</th><th>Distance</th></tr></thead><tbody>{events.map((item) => <tr key={item.id}><td>{nameFor(item.staff_id)}</td><td>{item.event_type.replace('_', ' ')}</td><td>{new Date(item.recorded_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</td><td>{Math.round(Number(item.accuracy_m))} m</td><td>{Math.round(Number(item.distance_m))} m</td></tr>)}{events.length === 0 && <tr><td colSpan={5} className="table-empty">No GPS attendance events are recorded yet.</td></tr>}</tbody></table></div>
    </section>
  </>
}
