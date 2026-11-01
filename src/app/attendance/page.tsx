import AppShell from '@/components/app-shell'
import { getStaffContext } from '@/lib/supabase/staff-context'
import AttendanceActions, { type AttendanceEvent, type AttendanceRequest, type StaffName } from './attendance-actions'

export const dynamic = 'force-dynamic'

export default async function AttendancePage() {
  const context = await getStaffContext()
  if (!context) return <main className="center"><div className="setup-card"><h1>Sign in for attendance</h1><a className="primary-button full" href="/login">Continue to sign in</a></div></main>
  const { supabase, profile, userId } = context
  const canReview = ['owner', 'admin', 'manager'].includes(profile.role)
  const [{ data: eventRows, error: eventsError }, { data: requestRows, error: requestsError }, { data: roster }, { data: settings }] = await Promise.all([
    supabase.from('staff_attendance').select('id, staff_id, event_type, recorded_at, latitude, longitude, accuracy_m, distance_m').order('recorded_at', { ascending: false }).limit(200),
    supabase.from('attendance_exceptions').select('id, staff_id, event_type, requested_at, reason, status, review_reason, created_at').order('created_at', { ascending: false }).limit(100),
    canReview ? supabase.from('staff_profiles').select('user_id, display_name') : Promise.resolve({ data: [] }),
    supabase.from('business_settings').select('venue_latitude, venue_longitude, geofence_radius_m, max_location_accuracy_m').eq('singleton', true).maybeSingle(),
  ])
  const events = (eventRows ?? []) as AttendanceEvent[]
  const requests = (requestRows ?? []) as AttendanceRequest[]
  const staffNames = new Map<string, string>([[profile.user_id, profile.display_name], ...((roster ?? []) as StaffName[]).map((staff) => [staff.user_id, staff.display_name] as [string, string])])
  const isConfigured = settings?.venue_latitude != null && settings?.venue_longitude != null
    && settings?.geofence_radius_m != null && settings?.max_location_accuracy_m != null

  return <AppShell profile={profile}><main className="content">
    <header className="page-heading"><div><p className="eyebrow">PEOPLE / SHIFT RECORDS</p><h1>Attendance</h1><p>Record your own shift events and review exceptions through a manager.</p></div></header>
    {(eventsError || requestsError) && <p className="notice error">Attendance records could not be loaded. Check the access migration and your staff role.</p>}
    <AttendanceActions userId={userId} events={events} requests={requests} staffNames={[...staffNames].map(([staffId, displayName]) => ({ user_id: staffId, display_name: displayName }))} configured={Boolean(isConfigured)} canReview={canReview} />
  </main></AppShell>
}
