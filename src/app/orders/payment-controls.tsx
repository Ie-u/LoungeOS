'use client'

import { useState, useTransition } from 'react'
import { startMpesaStk, submitPaybillClaim, reviewPaybillClaim, reviewMpesaC2bTransaction } from './payment-actions'

export type PaybillClaim = { id: string; order_id: string; amount_cents: number; provider_receipt: string; status: string; created_at: string; review_reason: string | null; lounge_orders: { table_label: string; payment_reference: string } | { table_label: string; payment_reference: string }[] | null }
export type C2bTransaction = { id: string; transaction_id: string; bill_reference: string; amount_cents: number; transacted_at: string | null; status: string; received_at: string; matched_order_id: string | null }
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

export function C2bReviewQueue({ transactions }: { transactions: C2bTransaction[] }) {
  const [message, setMessage] = useState('')
  const [busy, startTransition] = useTransition()
  function review(transaction: C2bTransaction, approve: boolean) {
    const reference = approve
      ? window.prompt('Verify this credit in the official M-Pesa account, then enter the exact LoungeOS order reference:', transaction.bill_reference)
      : transaction.bill_reference
    if (reference === null) return
    const reason = window.prompt(approve ? 'Explain how you verified the provider credit and matching amount:' : 'Explain why this transaction was rejected:')
    if (!reason || reason.trim().length < 5) return
    startTransition(async () => {
      const result = await reviewMpesaC2bTransaction(transaction.transaction_id, reference, approve, reason)
      setMessage(result.success ?? result.error ?? 'Reconciliation failed.')
      if ('success' in result) window.location.reload()
    })
  }
  if (!transactions.length) return null
  return <section className="payment-review"><h3>Daraja C2B confirmations <span>{transactions.length}</span></h3>
    <p>These are callback records. Confirm each credit in the official M-Pesa account before reconciling; the callback alone does not settle an order.</p>
    {message && <p role="status">{message}</p>}
    <ul>{transactions.map((transaction) => <li key={transaction.id}>
      <span><b>{transaction.transaction_id}</b> · {money(Number(transaction.amount_cents))}<small className="table-subline">Reference: {transaction.bill_reference || 'missing'} · {transaction.status} · Received {new Date(transaction.received_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</small></span>
      <span className="row-actions"><button disabled={busy} onClick={() => review(transaction, true)}>Match and verify</button><button className="end-button" disabled={busy} onClick={() => review(transaction, false)}>Reject</button></span>
    </li>)}</ul>
  </section>
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
    <ul>{claims.map((claim) => { const order = Array.isArray(claim.lounge_orders) ? claim.lounge_orders[0] : claim.lounge_orders; return <li key={claim.id}><span><b>{claim.provider_receipt}</b> · {money(Number(claim.amount_cents))} · {new Date(claim.created_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}<small className="table-subline">Order {order?.payment_reference ?? claim.order_id} · Table {order?.table_label ?? '—'}</small></span>
      {canReview ? <span className="row-actions"><button disabled={busy} onClick={() => review(claim.id, true)}>Approve verified payment</button><button className="end-button" disabled={busy} onClick={() => review(claim.id, false)}>Reject</button></span> : <small>Manager review required</small>}</li>})}</ul>
  </section>
}
