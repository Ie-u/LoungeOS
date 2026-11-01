'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type Expense = { id: string; category: string; description: string; amount_cents: number; incurred_at: string }
const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' })

export default function Expenses({ items, userId }: { items: Expense[]; userId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    const submittedForm = event.currentTarget
    const form = new FormData(submittedForm)
    const amount = Number(form.get('amount_kes'))
    const category = String(form.get('category') ?? '').trim()
    const description = String(form.get('description') ?? '').trim()
    const localDate = String(form.get('incurred_at') ?? '')
    const occurred = new Date(localDate)
    const amountCents = Math.round(amount * 100)
    if (!category || category.length > 60 || !description || description.length > 300 || !Number.isSafeInteger(amountCents) || amountCents <= 0 || Number.isNaN(occurred.getTime())) {
      setBusy(false); setIsError(true); setMessage('Enter a category, description, valid date, and amount above zero.'); return
    }
    const supabase = createClient()
    const { error } = await supabase.from('business_expenses').insert({
      category, description, amount_cents: amountCents, incurred_at: occurred.toISOString(), recorded_by: userId,
    })
    setBusy(false)
    if (error) { setIsError(true); setMessage('Expense could not be saved. Owner or admin access is required.') ; return }
    setIsError(false); setMessage('Expense recorded and added to the audit trail.'); submittedForm.reset(); router.refresh()
  }

  return <section className="panel report-detail">
    <div className="panel-head"><div><p className="eyebrow">OPERATING COSTS</p><h2>Recorded expenses</h2></div><span className="count">{items.length}</span></div>
    <p className="panel-copy">Expenses are append-only. Correct a mistake with a clearly described reversal record; LoungeOS does not rewrite financial history.</p>
    <form className="form-grid expense-form" onSubmit={addExpense}>
      <label>Category<input name="category" maxLength={60} placeholder="e.g. Utilities" required /></label>
      <label>Description<input name="description" maxLength={300} placeholder="What was paid for?" required /></label>
      <label>Amount (KES)<input name="amount_kes" type="number" min="0.01" step="0.01" required /></label>
      <label>Expense date and time<input name="incurred_at" type="datetime-local" required /></label>
      <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : '＋ Record expense'}</button>
    </form>
    {message && <p className={`notice ${isError ? 'error' : 'success-notice'}`} role="status">{message}</p>}
    <div className="table-scroll"><table className="data-table"><thead><tr><th>When</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{new Date(item.incurred_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</td><td>{item.category}</td><td>{item.description}</td><td className="money-cell">{money.format(Number(item.amount_cents) / 100)}</td></tr>)}{items.length === 0 && <tr><td colSpan={4} className="table-empty">No expenses have been entered for this period.</td></tr>}</tbody></table></div>
  </section>
}
