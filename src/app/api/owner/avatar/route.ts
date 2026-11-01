import { NextResponse } from 'next/server'
import { getStaffContext } from '@/lib/supabase/staff-context'

export const dynamic = 'force-dynamic'

export async function GET() {
  const context = await getStaffContext()
  if (!context || context.profile.role !== 'owner' || !context.profile.avatar_path) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const { data, error } = await context.supabase.storage.from('staff-avatars').createSignedUrl(context.profile.avatar_path, 300)
  if (error || !data?.signedUrl) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return new NextResponse(null, {
    status: 302,
    headers: { Location: data.signedUrl, 'Cache-Control': 'private, max-age=240', Vary: 'Cookie' },
  })
}
