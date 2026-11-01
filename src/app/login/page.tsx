'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const form = new FormData(event.currentTarget)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) })
    if (error) { setError('Sign in failed. Check your email and password.'); setBusy(false); return }
    router.replace('/')
  }
  return <main className="center"><form className="setup-card" onSubmit={signIn}><Link href="/" className="brand-mark">L</Link><p className="eyebrow">STAFF ACCESS</p><h1>Welcome back</h1><p>Sign in to your lounge workspace.</p><label>Email address<input autoComplete="username" name="email" type="email" required /></label><label>Password<input autoComplete="current-password" name="password" type="password" required /></label>{error && <p className="notice error">{error}</p>}<button className="primary-button full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></main>
}
