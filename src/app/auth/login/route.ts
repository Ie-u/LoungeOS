import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  if (!supabase) return NextResponse.redirect(new URL('/', request.url))
  const { data } = await supabase.auth.getClaims()
  if (data?.claims) return NextResponse.redirect(new URL('/', request.url))
  return NextResponse.redirect(new URL('/login', request.url))
}
