import { createClient } from '@/lib/supabase/server'

export type StaffProfile = {
  user_id: string
  display_name: string
  role: 'owner' | 'admin' | 'cashier' | 'attendant'
}

export async function getStaffContext() {
  const supabase = await createClient()
  if (!supabase) return null

  const { data: auth } = await supabase.auth.getClaims()
  const userId = auth?.claims?.sub
  if (!userId) return null

  const { data: profile, error } = await supabase
    .from('staff_profiles')
    .select('user_id, display_name, role')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !profile) return null
  return { supabase, userId, profile: profile as StaffProfile }
}
