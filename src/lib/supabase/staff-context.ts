import { createClient } from '@/lib/supabase/server'

export type StaffProfile = {
  user_id: string
  display_name: string
  avatar_path?: string | null
  role: 'owner' | 'admin' | 'manager' | 'cashier' | 'attendant' | 'flavor_specialist'
  is_active: boolean
  updated_at?: string
}

export async function getStaffContext() {
  const supabase = await createClient()
  if (!supabase) return null

  const { data: auth } = await supabase.auth.getClaims()
  const userId = auth?.claims?.sub
  if (!userId) return null

  const { data: profile, error } = await supabase
    .from('staff_profiles')
    .select('user_id, display_name, avatar_path, role, is_active, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !profile || !profile.is_active) return null
  return { supabase, userId, profile: profile as StaffProfile }
}
