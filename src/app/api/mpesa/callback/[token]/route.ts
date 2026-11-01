import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ ok: false }, { status: 404 })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ ok: false }, { status: 503 })
  try {
    const payload = await request.json() as { Body?: { stkCallback?: { CheckoutRequestID?: string; ResultCode?: number; CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: string | number }> } } } }
    const callback = payload.Body?.stkCallback
    if (!callback?.CheckoutRequestID || !Number.isInteger(callback.ResultCode)) return NextResponse.json({ ok: false }, { status: 400 })
    const items = callback.CallbackMetadata?.Item ?? []
    const value = (name: string) => items.find((item) => item.Name === name)?.Value
    const amount = value('Amount')
    const receipt = value('MpesaReceiptNumber')
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data, error } = await supabase.rpc('apply_mpesa_stk_callback', {
      p_callback_token: token,
      p_checkout_request_id: callback.CheckoutRequestID,
      p_result_code: callback.ResultCode,
      p_receipt: typeof receipt === 'string' ? receipt : null,
      p_amount_cents: typeof amount === 'number' ? Math.round(amount * 100) : null,
    })
    if (error || data !== true) return NextResponse.json({ ok: false }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}
