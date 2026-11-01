'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(false); setMessage('')
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    const confirmation = String(form.get('confirmation') ?? '')
    if (password.length < 12 || password !== confirmation) {
      setError(true); setMessage('Use at least 12 characters and enter the same password twice.'); setBusy(false); return
    }
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) { setError(true); setMessage('The recovery link is invalid or expired. Request a new one from your manager.'); return }
    setMessage('Password updated. You can continue to LoungeOS.')
    router.replace('/')
  }

  return <main className="center"><form className="setup-card login-card" onSubmit={update}>
    <p className="eyebrow">ACCOUNT RECOVERY</p><h1>Set a new password</h1><p>Your new password is handled by Supabase Auth and is never shown to staff managers.</p>
    <label>New password<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
    <label>Confirm new password<input name="confirmation" type="password" minLength={12} autoComplete="new-password" required /></label>
    {message && <p className={`notice ${error ? 'error' : 'success-notice'}`} role="status">{message}</p>}
    <button className="primary-button full" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
  </form></main>
}
