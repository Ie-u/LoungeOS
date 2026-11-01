'use client'

import { FormEvent, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type LoginMode = 'otp' | 'password'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<LoginMode>('otp')
  const [email, setEmail] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (seconds <= 0) return
    const timeout = window.setTimeout(() => setSeconds((remaining) => Math.max(0, remaining - 1)), 1000)
    return () => window.clearTimeout(timeout)
  }, [seconds])

  function finishSignIn() {
    router.replace('/')
    router.refresh()
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || seconds > 0) return
    setBusy(true); setError(''); setMessage('')
    const normalizedEmail = email.trim().toLowerCase()
    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: false },
      })
      if (authError) {
        setError('We could not start email sign-in. Check the email provider setup or wait before requesting another code.')
      } else {
        setEmail(normalizedEmail)
        setCodeSent(true)
        setMessage('If a LoungeOS staff account is registered for this email, a sign-in code has been sent. Check your inbox.')
        setSeconds(60)
      }
    } catch {
      setError('We could not start email sign-in. Check your connection and try again later.')
    } finally { setBusy(false) }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const token = String(form.get('code') ?? '').trim()
    if (!/^\d{6,10}$/.test(token)) {
      setError('Enter the verification code from the email.')
      setBusy(false)
      return
    }
    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
      if (authError || !data.user) {
        setError('That code could not be verified. It may be incorrect or expired; request a new code and try again.')
        return
      }
      const { data: profile, error: profileError } = await supabase.from('staff_profiles').select('is_active').eq('user_id', data.user.id).maybeSingle()
      if (profileError || !profile?.is_active) {
        await supabase.auth.signOut()
        setError('This verified account does not have active LoungeOS staff access. Contact the owner or manager.')
        return
      }
      finishSignIn()
    } catch {
      setError('We could not complete sign-in. Request another code and try again.')
    } finally { setBusy(false) }
  }

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const normalizedEmail = String(form.get('email') ?? '').trim().toLowerCase()
    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password: String(form.get('password') ?? '') })
      if (authError || !data.user) { setError('Sign in failed. Check your email and password.'); return }
      const { data: profile, error: profileError } = await supabase.from('staff_profiles').select('is_active').eq('user_id', data.user.id).maybeSingle()
      if (profileError || !profile?.is_active) {
        await supabase.auth.signOut()
        setError('This account does not have active LoungeOS staff access. Contact the owner or manager.')
        return
      }
      finishSignIn()
    } catch {
      setError('Sign in failed unexpectedly. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  return <main className="center"><div className="setup-card login-card">
    <Link href="/" className="login-logo" aria-label="LoungeOS home"><Image src="/loungeos-neon-logo.png" alt="LoungeOS by Cynux Production" width={1280} height={1280} priority sizes="(max-width: 480px) 320px, 360px" /></Link>
    <p className="eyebrow">STAFF ACCESS</p><h1>Welcome to LoungeOS</h1>
    <p>Sign in with a one-time email code or your existing password.</p>
    <div className="login-mode-switch" role="group" aria-label="Sign-in method">
      <button type="button" className={mode === 'otp' ? 'active' : ''} onClick={() => { setMode('otp'); setError(''); setMessage('') }}>Email code</button>
      <button type="button" className={mode === 'password' ? 'active' : ''} onClick={() => { setMode('password'); setError(''); setMessage('') }}>Password</button>
    </div>
    {mode === 'otp' && !codeSent && <form className="operation-form" onSubmit={requestCode}>
      <label>Email address<input autoComplete="email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></label>
      <button className="primary-button full" disabled={busy || seconds > 0}>{busy ? 'Sending code…' : seconds > 0 ? `Try again in ${seconds}s` : 'Send sign-in code'}</button>
    </form>}
    {mode === 'otp' && codeSent && <form className="operation-form" onSubmit={verifyCode}>
      <p className="login-email-hint">Enter the code sent to <b>{email}</b>.</p>
      <label>Email verification code<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required /></label>
      <button className="primary-button full" disabled={busy}>{busy ? 'Verifying…' : 'Verify and sign in'}</button>
      <button className="text-button" type="button" disabled={busy || seconds > 0} onClick={() => { setCodeSent(false); setError(''); setMessage('') }}>{seconds > 0 ? `Resend code in ${seconds}s` : 'Request a new code'}</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => { setCodeSent(false); setEmail(''); setError(''); setMessage('') }}>Use another email</button>
    </form>}
    {mode === 'password' && <form className="operation-form" onSubmit={signInWithPassword}>
      <label>Email address<input autoComplete="username" name="email" type="email" maxLength={254} required /></label>
      <label>Password<input autoComplete="current-password" name="password" type="password" required /></label>
      <button className="primary-button full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in with password'}</button>
    </form>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <p className="footnote">Email delivery depends on the Supabase Auth email provider. If no code arrives, contact your manager; do not keep requesting codes.</p>
  </div></main>
}
