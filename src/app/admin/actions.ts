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

  const emailValue = formData.get('email')
  const nameValue = formData.get('display_name')
  const email = typeof emailValue === 'string' ? emailValue.trim().toLowerCase() : ''
  const displayName = typeof nameValue === 'string' ? nameValue.trim() : ''
  const role = formData.get('role')
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || displayName.length < 1 || displayName.length > 100 || !validRole(role)) {
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

  let existingAuthUser: Awaited<ReturnType<typeof service.auth.admin.getUserById>>['data']['user'] | null = null
  for (let page = 1; page <= 100; page += 1) {
    const { data: usersPage, error: listError } = await service.auth.admin.listUsers({ page, perPage: 1000 })
    if (listError) return { error: 'Could not check for an existing account. No invitation was sent; check the Supabase Auth service and try again.' }
    existingAuthUser = usersPage.users.find((user) => user.email?.toLowerCase() === email) ?? null
    if (existingAuthUser || usersPage.users.length < 1000) break
  }
  if (existingAuthUser) {
    const { data: existingProfile } = await service.from('staff_profiles')
      .select('is_active').eq('user_id', existingAuthUser.id).maybeSingle()
    if (existingProfile && !existingProfile.is_active) {
      return { error: 'This email belongs to a deactivated staff account. Reactivate that account in the roster instead of creating another one.' }
    }
    if (existingProfile) {
      return { error: existingAuthUser.email_confirmed_at
        ? 'This staff account already exists. Use Send recovery in the roster if the person cannot sign in.'
        : 'This account already has a pending email setup. Use Send recovery in the roster to send a fresh secure setup link.' }
    }
    return { error: 'This email is already linked to a Supabase account but has no LoungeOS staff profile. No role was assigned; ask the owner to review that account.' }
  }

  const inviteStartedAt = Date.now()
  const inviteAttempt = crypto.randomUUID()
  const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: displayName, loungeos_invite_attempt: inviteAttempt },
    redirectTo: `${baseUrl}/auth/callback?next=/auth/update-password`,
  })
  if (error || !data.user) {
    // The auth trigger can create a profile before the SMTP send completes.
    // Delete only the exact unconfirmed user created by this failed attempt.
    let removedPartialInvite = false
    for (let page = 1; page <= 100 && !removedPartialInvite; page += 1) {
      const { data: usersPage, error: listError } = await service.auth.admin.listUsers({ page, perPage: 1000 })
      if (listError) break
      const partial = usersPage.users.find((user) => user.email?.toLowerCase() === email
        && user.user_metadata?.loungeos_invite_attempt === inviteAttempt
        && !user.email_confirmed_at
        && Date.parse(user.created_at) >= inviteStartedAt - 5000)
      if (partial) {
        const { error: deleteError } = await service.auth.admin.deleteUser(partial.id)
        removedPartialInvite = !deleteError
        break
      }
      if (usersPage.users.length < 1000) break
    }
    const detail = error?.message.toLowerCase() ?? ''
    if (detail.includes('email address not authorized')) return { error: 'Supabase rejected this recipient because the project is using its restricted default email service. Configure custom SMTP in Supabase Auth before inviting staff.' }
    if (detail.includes('rate limit')) return { error: 'Supabase email rate limit reached. Wait before retrying; no invitation was sent.' }
    return { error: removedPartialInvite
      ? 'Supabase Auth could not deliver the invitation. The incomplete Auth account and staff profile were removed; check Supabase Auth email/SMTP settings and logs.'
      : 'Supabase Auth could not confirm delivery. No invitation was recorded as successful. Check Supabase Auth email/SMTP settings and logs before retrying.' }
  }

  const { error: profileError } = await context.supabase.from('staff_profiles')
    .update({ display_name: displayName, role })
    .eq('user_id', data.user.id)
  revalidatePath('/admin')
  if (profileError) return { error: 'The invitation email was sent, but the role could not be assigned. The account remains an attendant; update its role in the roster before it starts work.' }
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
  const { data: targetProfile, error: profileLookupError } = await service.from('staff_profiles')
    .select('is_active').eq('user_id', userId).maybeSingle()
  if (profileLookupError || !targetProfile) return { error: 'That account is not present in the LoungeOS staff roster.' }
  if (!targetProfile.is_active) return { error: 'This staff account is deactivated. Reactivate it before sending a recovery link.' }
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

export async function saveOwnerProfile(displayName: string, avatarPath?: string) {
  const context = await getStaffContext()
  if (!context || context.profile.role !== 'owner') return { error: 'Only the active owner can change this profile.' }
  const name = displayName.trim()
  if (name.length < 1 || name.length > 100) return { error: 'Display name must be between 1 and 100 characters.' }
  const patch: { display_name: string; avatar_path?: string } = { display_name: name }
  if (avatarPath !== undefined) {
    if (avatarPath !== `${context.userId}/avatar`) return { error: 'The selected profile image path is invalid.' }
    patch.avatar_path = avatarPath
  }
  const { error } = await context.supabase.from('staff_profiles').update(patch).eq('user_id', context.userId)
  if (error) return { error: 'Profile changes were not saved. Check that the latest owner profile migration is applied.' }
  revalidatePath('/')
  revalidatePath('/admin')
  return { success: 'Owner profile saved.' }
}
