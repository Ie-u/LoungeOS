'use server'

import { createClient as createSupabaseJsClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getStaffContext } from '@/lib/supabase/staff-context'
import { darajaTimestamp, normalizeKenyanPhone } from '@/lib/mpesa/format'

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseJsClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function appUrl() {
  const value = process.env.NEXT_PUBLIC_APP_URL
  return value?.replace(/\/$/, '') || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null)
}

function asString(value: FormDataEntryValue | null, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

export async function startMpesaStk(orderId: string, rawPhone: string) {
  const context = await getStaffContext()
  if (!context || !['owner', 'admin', 'manager', 'cashier'].includes(context.profile.role)) return { error: 'Cashier access is required.' }
  const normalizedPhone = normalizeKenyanPhone(rawPhone)
  if (!normalizedPhone) return { error: 'Enter a Kenyan mobile number, such as 0712345678 or 254712345678.' }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return { error: 'Select a valid order.' }
  const app = appUrl()
  const service = serviceClient()
  const consumer = process.env.MPESA_CONSUMER_KEY
  const secret = process.env.MPESA_CONSUMER_SECRET
  const shortcode = process.env.MPESA_SHORTCODE
  const passkey = process.env.MPESA_PASSKEY
  const mode = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox'
  if (!app || !service || !consumer || !secret || !shortcode || !passkey) return { error: 'M-Pesa STK is not configured. Set the server-only Daraja credentials and public app URL first.' }

  const { data: order, error: orderError } = await context.supabase.from('lounge_orders')
    .select('id,payment_reference,total_cents,status,payment_status').eq('id', orderId).maybeSingle()
  if (orderError || !order || order.status !== 'open' || order.payment_status !== 'unpaid') return { error: 'That order is no longer open for payment.' }
  if (Number(order.total_cents) < 100 || Number(order.total_cents) % 100 !== 0) return { error: 'STK Push requires an order total of at least KES 1 in whole shillings.' }
  const { data: pending } = await service.from('payment_attempts').select('id').eq('order_id', orderId).eq('status', 'pending').limit(1).maybeSingle()
  if (pending) return { error: 'An M-Pesa payment request is already pending for this order. Wait for its result before retrying.' }

  const callbackToken = randomBytes(32).toString('hex')
  const { data: attempt, error: insertError } = await service.from('payment_attempts').insert({
    order_id: orderId, expected_amount_cents: Number(order.total_cents), phone_number: normalizedPhone,
    callback_token: callbackToken, requested_by: context.userId,
  }).select('id').single()
  if (insertError || !attempt) return { error: insertError?.code === '23505' ? 'Another payment request or receipt is awaiting resolution for this order.' : 'Could not create a secure payment request. Try again.' }

  try {
    const base = mode === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
    const authResponse = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${consumer}:${secret}`).toString('base64')}` }, cache: 'no-store', signal: AbortSignal.timeout(15000),
    })
    if (!authResponse.ok) throw new Error('oauth')
    const { access_token: token } = await authResponse.json() as { access_token?: string }
    if (!token) throw new Error('oauth')
    const timestamp = darajaTimestamp()
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64')
    const response = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode, Password: password, Timestamp: timestamp,
        TransactionType: process.env.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: Number(order.total_cents) / 100, PartyA: normalizedPhone, PartyB: shortcode,
        PhoneNumber: normalizedPhone, CallBackURL: `${app}/api/mpesa/callback/${callbackToken}`,
        AccountReference: order.payment_reference, TransactionDesc: 'LoungeOS order payment',
      }),
    })
    const result = await response.json() as { ResponseCode?: string; MerchantRequestID?: string; CheckoutRequestID?: string }
    if (!response.ok || result.ResponseCode !== '0' || !result.CheckoutRequestID) throw new Error('stk')
    const { error: updateError } = await service.from('payment_attempts').update({ merchant_request_id: result.MerchantRequestID, checkout_request_id: result.CheckoutRequestID }).eq('id', attempt.id)
    if (updateError) throw new Error('save')
    revalidatePath('/orders')
    return { success: 'STK request sent. The customer must approve the prompt on their phone; the order changes to paid only after Safaricom confirms it.' }
  } catch {
    await service.from('payment_attempts').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', attempt.id)
    return { error: 'Safaricom did not accept the request. Check Daraja settings and try again.' }
  }
}

export async function submitPaybillClaim(formData: FormData) {
  const context = await getStaffContext()
  if (!context || !['owner', 'admin', 'manager', 'cashier'].includes(context.profile.role)) return { error: 'Cashier access is required.' }
  if (!process.env.MPESA_PAYBILL_NUMBER && !process.env.MPESA_TILL_NUMBER) return { error: 'Paybill/Till instructions are not configured yet.' }
  const orderId = asString(formData.get('order_id'), 36)
  const receipt = asString(formData.get('receipt'), 32).toUpperCase()
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^[A-Z0-9]{4,32}$/.test(receipt)) return { error: 'Enter a valid order and M-Pesa receipt code.' }
  const { data: order } = await context.supabase.from('lounge_orders').select('id,total_cents,status,payment_status').eq('id', orderId).maybeSingle()
  if (!order || order.status !== 'open' || order.payment_status !== 'unpaid') return { error: 'That order is no longer open for payment.' }
  const { error } = await context.supabase.from('paybill_claims').insert({ order_id: orderId, amount_cents: order.total_cents, provider_receipt: receipt, submitted_by: context.userId })
  if (error) return { error: error.code === '23505' ? error.message.includes('Another payment request') ? 'Another payment request or receipt is awaiting resolution for this order.' : 'That M-Pesa receipt has already been submitted.' : 'Could not submit the receipt for review.' }
  revalidatePath('/orders')
  return { success: 'Receipt submitted for manager verification. The order remains unpaid until approved.' }
}

export async function reviewPaybillClaim(claimId: string, approve: boolean, reason: string) {
  const context = await getStaffContext()
  if (!context || !['owner', 'admin', 'manager'].includes(context.profile.role)) return { error: 'Manager access is required to verify payment claims.' }
  if (!/^[0-9a-f-]{36}$/i.test(claimId) || reason.trim().length < 5 || reason.trim().length > 300) return { error: 'Provide a review explanation between 5 and 300 characters.' }
  const { error } = await context.supabase.rpc('review_paybill_claim', { p_claim_id: claimId, p_approve: approve, p_reason: reason.trim() })
  if (error) return { error: error.message.includes('Payment claim') ? 'This claim has already been reviewed.' : error.message.includes('STK request') ? 'An STK request is still pending. Wait for its result before approving this receipt.' : error.message.includes('Daraja C2B') ? 'This receipt is already in the Daraja C2B queue. Reconcile it there instead.' : 'The claim could not be reviewed.' }
  revalidatePath('/orders')
  return { success: approve ? 'Receipt verified and order marked paid.' : 'Claim rejected with the explanation recorded.' }
}

export async function reviewMpesaC2bTransaction(transactionId: string, paymentReference: string, approve: boolean, reason: string) {
  const context = await getStaffContext()
  if (!context || !['owner', 'admin', 'manager'].includes(context.profile.role)) return { error: 'Manager access is required to reconcile M-Pesa confirmations.' }
  if (!/^[A-Za-z0-9]{4,40}$/.test(transactionId) || paymentReference.trim().length > 40 || reason.trim().length < 5 || reason.trim().length > 300) {
    return { error: 'Enter an order reference when approving and an explanation between 5 and 300 characters.' }
  }
  const { error } = await context.supabase.rpc('review_mpesa_c2b_transaction', {
    p_transaction_id: transactionId, p_payment_reference: paymentReference.trim(), p_approve: approve, p_reason: reason.trim(),
  })
  if (error) return { error: error.message.includes('open unpaid order') ? 'The order reference was not found or its amount does not match the provider confirmation.' : error.message.includes('STK request') ? 'An STK request is still pending. Wait for its result before reconciling this C2B transaction.' : 'The M-Pesa transaction could not be reconciled.' }
  revalidatePath('/orders')
  return { success: approve ? 'Provider-confirmed transaction reconciled and order marked paid.' : 'Transaction rejected with the explanation recorded.' }
}
