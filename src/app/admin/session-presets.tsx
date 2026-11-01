'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type SessionOption = { id: string; name: string; duration_minutes: number; price_cents: number; is_available: boolean }
const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' })

export default function SessionPresets({ options }: { options: SessionOption[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  async function save(event: FormEvent<HTMLFormElement>, optionId?: string) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get('name') ?? '').trim()
    const duration = Number(form.get('duration_minutes'))
    const price = Math.round(Number(form.get('price_kes')) * 100)
    if (name.length < 1 || name.length > 80 || !Number.isInteger(duration) || duration < 15 || duration > 360 || !Number.isSafeInteger(price) || price < 0) {
      setError(true); setMessage('Enter a preset name, duration from 15 to 360 minutes, and a valid non-negative KES price.'); return
    }
    setBusy(true)
    const supabase = createClient()
    const payload = { name, duration_minutes: duration, price_cents: price }
    const result = optionId
      ? await supabase.from('shisha_options').update(payload).eq('id', optionId)
      : await supabase.from('shisha_options').insert(payload)
    setBusy(false)
    if (result.error) { setError(true); setMessage('Preset was not saved. Check the name is unique and your owner/admin access is active.'); return }
    setError(false); setMessage(optionId ? 'Session preset saved.' : 'Session preset added.'); if (!optionId) formElement.reset(); router.refresh()
  }
  async function setAvailable(option: SessionOption) {
    setBusy(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.from('shisha_options').update({ is_available: !option.is_available }).eq('id', option.id)
    setBusy(false)
    setError(Boolean(updateError)); setMessage(updateError ? 'Availability could not be changed.' : `Preset ${option.is_available ? 'paused' : 'made available'}.`); router.refresh()
  }
  return <section className="panel admin-panel">
    <div className="panel-head"><div><p className="eyebrow">SESSION OPTIONS</p><h2>Presets & pricing</h2></div><span className="page-count">{options.length} presets</span></div>
    <p className="panel-copy">Changes affect new sessions. Active sessions keep their database-recorded end time.</p>
    {message && <p className={`notice ${error ? 'error' : 'success-notice'}`} role="status">{message}</p>}
    <div className="session-preset-list">{options.map((option) => <form className="operation-form session-preset-row" key={option.id} onSubmit={(event) => save(event, option.id)}>
      <label>Preset name<input name="name" defaultValue={option.name} maxLength={80} required /></label>
      <label>Minutes<input name="duration_minutes" type="number" min="15" max="360" step="1" defaultValue={option.duration_minutes} required /></label>
      <label>Price (KES)<input name="price_kes" type="number" min="0" step="0.01" defaultValue={option.price_cents / 100} required /></label>
      <span>{money.format(option.price_cents / 100)}</span>
      <button disabled={busy}>Save</button><button type="button" className={option.is_available ? 'end-button' : ''} disabled={busy} onClick={() => setAvailable(option)}>{option.is_available ? 'Pause' : 'Enable'}</button>
    </form>)}</div>
    <form className="operation-form session-preset-row new-preset-form" onSubmit={(event) => save(event)}>
      <label>New preset<input name="name" maxLength={80} required placeholder="e.g. Premium 90 min" /></label>
      <label>Minutes<input name="duration_minutes" type="number" min="15" max="360" step="1" required defaultValue="60" /></label>
      <label>Price (KES)<input name="price_kes" type="number" min="0" step="0.01" required /></label>
      <button className="primary-button" disabled={busy}>＋ Add preset</button>
    </form>
  </section>
}
