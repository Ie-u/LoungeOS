import { isAuthorizedC2bCallbackToken } from '@/lib/mpesa/callback-auth'
import { NextResponse } from 'next/server'

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[a-f0-9]{64,128}$/i.test(token) || !isAuthorizedC2bCallbackToken(token)) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Rejected' }, { status: 404 })
  }
  // LoungeOS accepts the provider's validation request, then records the
  // authoritative confirmation for order matching and manager reconciliation.
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
}
