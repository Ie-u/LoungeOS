'use client'

import Image from 'next/image'
import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { StaffProfile } from '@/lib/supabase/staff-context'
import { saveOwnerProfile } from './actions'

export default function OwnerProfile({ profile }: { profile: StaffProfile }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setMessage(''); setFailed(false)
    try {
      const form = new FormData(event.currentTarget)
      const displayName = String(form.get('display_name') ?? '').trim()
      const image = form.get('avatar')
      if (displayName.length < 1 || displayName.length > 100) throw new Error('Display name must be between 1 and 100 characters.')
      let avatarPath: string | undefined
      if (image instanceof File && image.size > 0) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) throw new Error('Choose a JPG, PNG, or WebP image.')
        if (image.size > 2 * 1024 * 1024) throw new Error('Profile images must be 2 MB or smaller.')
        avatarPath = `${profile.user_id}/avatar`
        const { error } = await createClient().storage.from('staff-avatars').upload(avatarPath, image, {
          upsert: true, contentType: image.type, cacheControl: '3600',
        })
        if (error) throw new Error('Image upload failed. Check that the owner profile migration has been applied and try again.')
      }
      const result = await saveOwnerProfile(displayName, avatarPath)
      if (result.error) throw new Error(result.error)
      setMessage(result.success ?? 'Profile saved.')
      router.refresh()
    } catch (cause) {
      setFailed(true)
      setMessage(cause instanceof Error ? cause.message : 'Profile could not be saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel admin-panel owner-profile-panel" id="owner-profile">
    <div className="panel-head"><div><p className="eyebrow">OWNER ACCOUNT</p><h2>Profile and dashboard</h2></div></div>
    <p className="panel-copy">Update the name shown across the dashboard and upload a private profile picture. Profile images are visible only to the signed-in owner.</p>
    <form className="owner-profile-form" onSubmit={save}>
      <span className="owner-profile-avatar">{profile.avatar_path
        ? <Image src={`/api/owner/avatar?v=${encodeURIComponent(profile.updated_at ?? '')}`} alt="Current owner profile" width={76} height={76} unoptimized />
        : profile.display_name.trim().charAt(0).toUpperCase()}</span>
      <div className="owner-profile-fields">
        <label>Display name<input name="display_name" maxLength={100} defaultValue={profile.display_name} required /></label>
        <label>Profile picture<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" /></label>
        <small>JPG, PNG, or WebP · up to 2 MB · stored in a private bucket</small>
      </div>
      <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
    </form>
    {message && <p className={`notice ${failed ? 'error' : 'success-notice'}`} role="status">{message}</p>}
  </section>
}
