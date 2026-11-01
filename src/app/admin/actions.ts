'use server'

import { createClient as createSupabaseJsClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { getStaffContext } from '@/lib/supabase/staff-context'

const roles = ['owner', 'admin', 'manager', 'cashier', 'attendant', 'flavor_specialist'] as const
type StaffRole = typeof roles[number]

function validRole(value: FormDataEntryValue | null): value is StaffRole {
  return typeof value === 'string' && roles.includes(value as StaffRole)
}

function appUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  if (process.env.NODE_ENV === 'development') return 'http://localhost:3000'
  return null
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createSupabaseJsClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function inviteStaff(formData: FormData) {
  const context = await getStaffContext()
  if (!context || !['owner', 'admin', 'manager'].includes(context.profile.role)) return { error: 'Staff management access is required.' }

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const displayName = String(formData.get('display_name') ?? '').trim()
  const role = formData.get('role')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || displayName.length < 1 || displayName.length > 100 || !validRole(role)) {
    return { error: 'Enter a valid email, name, and staff role.' }
  }
  if (context.profile.role === 'manager' && !['cashier', 'attendant', 'flavor_specialist'].includes(role)) {
    return { error: 'Managers can invite cashiers, attendants, or flavor specialists.' }
  }
  if (context.profile.role === 'admin' && ['owner', 'admin'].includes(role)) {
    return { error: 'Only the owner can grant owner or admin access.' }
  }
  const baseUrl = appUrl()
  if (!baseUrl) return { error: 'Set NEXT_PUBLIC_APP_URL to the deployed LoungeOS address before sending invitations.' }
  const service = adminClient()
  if (!service) return { error: 'Staff invitations need the server-only SUPABASE_SERVICE_ROLE_KEY environment setting.' }

  const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: displayName },
    redirectTo: `${baseUrl}/auth/callback`,
  })
  if (error || !data.user) return { error: 'The invitation could not be sent. Check the email provider settings or whether this address already has an account.' }

  const { error: profileError } = await context.supabase.from('staff_profiles')
    .update({ display_name: displayName, role })
    .eq('user_id', data.user.id)
  revalidatePath('/admin')
  if (profileError) return { error: 'The invite email was sent, but the requested role could not be assigned. The new account remains an attendant until a manager updates it.' }
  const { error: auditError } = await service.from('audit_events').insert({
    actor_id: context.userId, entity_type: 'staff_profile', entity_id: data.user.id,
    action: 'staff_invitation_sent', after_data: { role },
  })
  if (auditError) return { error: 'The invite was sent and the role was assigned, but the invitation audit record could not be saved. Review the audit log.' }
  return { success: `Invitation sent to ${email}.` }
}

export async function sendStaffRecovery(userId: string) {
  const context = await getStaffContext()
  if (!context || !['owner', 'admin', 'manager'].includes(context.profile.role)) return { error: 'Staff management access is required.' }
  if (!/^[0-9a-f-]{36}$/i.test(userId) || userId === context.userId) return { error: 'Choose another staff account.' }
  const baseUrl = appUrl()
  if (!baseUrl) return { error: 'Set NEXT_PUBLIC_APP_URL to the deployed LoungeOS address before sending recovery email.' }
  const service = adminClient()
  if (!service) return { error: 'Account recovery needs the server-only SUPABASE_SERVICE_ROLE_KEY environment setting.' }
  const { data: userData, error: userError } = await service.auth.admin.getUserById(userId)
  if (userError || !userData.user?.email) return { error: 'Could not find an email address for this staff account.' }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return { error: 'Supabase public connection settings are missing.' }
  const mailer = createSupabaseJsClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await mailer.auth.resetPasswordForEmail(userData.user.email, {
    redirectTo: `${baseUrl}/auth/callback?next=/auth/update-password`,
  })
  if (error) return { error: 'Recovery email could not be sent. Check Supabase email provider settings.' }
  const { error: auditError } = await service.from('audit_events').insert({
    actor_id: context.userId, entity_type: 'staff_profile', entity_id: userId,
    action: 'password_recovery_sent', after_data: {},
  })
  if (auditError) return { error: 'Recovery email was sent, but its audit record could not be saved. Review the audit log.' }
  return { success: 'Password recovery email sent. LoungeOS never displays or stores the existing password.' }
}
