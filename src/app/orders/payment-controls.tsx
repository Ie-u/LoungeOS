'use client'

import { useState, useTransition } from 'react'
import { startMpesaStk, submitPaybillClaim, reviewPaybillClaim } from './payment-actions'

export type PaybillClaim = { id: string; order_id: string; amount_cents: number; provider_receipt: string; status: string; created_at: string; review_reason: string | null }
const money = (cents: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(cents / 100)

export function PaymentControls({ orderId, reference, canPaybill }: { orderId: string; reference: string; canPaybill: boolean }) {
  const [phone, setPhone] = useState('')
  const [receipt, setReceipt] = useState('')
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, startTransition] = useTransition()
  function stk() { startTransition(async () => { const result = await startMpesaStk(orderId, phone); setIsError(!('success' in result)); setMessage(result.success ?? result.error ?? 'Payment request failed.') }) }
  function paybill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget); data.set('order_id', orderId)
    startTransition(async () => { const result = await submitPaybillClaim(data); setIsError(!('success' in result)); setMessage(result.success ?? result.error ?? 'Could not submit receipt.'); if ('success' in result) setReceipt('') })
  }
  return <div className="payment-controls">
    <label>Customer phone <input type="tel" autoComplete="tel" placeholder="07… or 254…" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
    <button type="button" disabled={busy || !phone.trim()} onClick={stk}>{busy ? 'Sending…' : 'Request M-Pesa STK'}</button>
    {canPaybill && <form onSubmit={paybill} className="paybill-claim-form"><label>M-Pesa receipt<input value={receipt} onChange={(e) => setReceipt(e.target.value.toUpperCase())} maxLength={32} minLength={4} required placeholder={`Paybill/Till · ${reference}`} /></label><button type="submit" disabled={busy || !receipt.trim()}>Submit for review</button></form>}
    {message && <small className={isError ? 'payment-error' : 'payment-success'} role="status">{message}</small>}
  </div>
}

export function PaybillReviewQueue({ claims, canReview }: { claims: PaybillClaim[]; canReview: boolean }) {
  const [message, setMessage] = useState('')
  const [busy, startTransition] = useTransition()
  function review(id: string, approve: boolean) {
    const reason = window.prompt(approve ? 'Explain how you verified the receipt and amount:' : 'Explain why this receipt was rejected:')
    if (!reason || reason.trim().length < 5) return
    startTransition(async () => {
      const result = await reviewPaybillClaim(id, approve, reason)
      setMessage(result.success ?? result.error ?? 'Review failed.')
      if ('success' in result) window.location.reload()
    })
  }
  if (!claims.length) return null
  return <section className="payment-review"><h3>Paybill/Till receipts awaiting review <span>{claims.length}</span></h3>
    <p>Verify the receipt in the official M-Pesa statement or business account before approving. A receipt code alone is not payment proof.</p>
    {message && <p role="status">{message}</p>}
    <ul>{claims.map((claim) => <li key={claim.id}><span><b>{claim.provider_receipt}</b> · {money(Number(claim.amount_cents))} · {new Date(claim.created_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span>
      {canReview ? <span className="row-actions"><button disabled={busy} onClick={() => review(claim.id, true)}>Approve verified payment</button><button className="end-button" disabled={busy} onClick={() => review(claim.id, false)}>Reject</button></span> : <small>Manager review required</small>}</li>)}</ul>
  </section>
}
