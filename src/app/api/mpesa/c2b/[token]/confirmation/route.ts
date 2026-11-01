import { createClient } from '@supabase/supabase-js'
import { isAuthorizedC2bCallbackToken } from '@/lib/mpesa/callback-auth'
import { darajaTransactedAt, kesToCents } from '@/lib/mpesa/format'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[a-f0-9]{64,128}$/i.test(token) || !isAuthorizedC2bCallbackToken(token)) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Rejected' }, { status: 404 })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Temporarily unavailable' }, { status: 503 })
  try {
    const payload = await request.json() as { TransID?: string; TransAmount?: string | number; BillRefNumber?: string; TransTime?: string }
    const transactionId = String(payload.TransID ?? '').trim()
    const amountCents = kesToCents(payload.TransAmount)
    const billReference = String(payload.BillRefNumber ?? '').trim().slice(0, 100)
    if (!/^[A-Za-z0-9]{4,40}$/.test(transactionId) || amountCents === null) {
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid transaction data' }, { status: 400 })
    }
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data, error } = await supabase.rpc('accept_mpesa_c2b_confirmation', {
      p_transaction_id: transactionId,
      p_bill_reference: billReference,
      p_amount_cents: amountCents,
      p_transacted_at: darajaTransactedAt(payload.TransTime),
    })
    if (error || data !== true) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Unable to record confirmation' }, { status: 503 })
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid request' }, { status: 400 })
  }
}
