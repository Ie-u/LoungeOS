'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type StaffNotification = { id: string; event_type: string; entity_type: string; entity_id: string; title: string; message: string; created_at: string; read_at: string | null }

export default function NotificationManager({ notifications }: { notifications: StaffNotification[] }) {
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [busy, startTransition] = useTransition()
  const unread = notifications.filter((item) => !item.read_at)

  function markRead(ids: string[]) {
    if (!ids.length) return
    startTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase.from('staff_notifications').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null)
      setMessage(error ? 'Could not update notification status.' : 'Notifications marked as read.')
      if (!error) router.refresh()
    })
  }

  return <>
    <div className="panel-head notification-toolbar"><div><p className="eyebrow">OPERATIONS ALERTS</p><h2>{unread.length} unread</h2></div><button disabled={busy || unread.length === 0} onClick={() => markRead(unread.map((item) => item.id))}>{busy ? 'Updating…' : 'Mark all as read'}</button></div>
    {message && <p role="status" className="notice">{message}</p>}
    {notifications.length === 0 ? <div className="empty"><span>♢</span><b>No notifications</b><p>Scheduled session and configured low-stock alerts will appear here.</p></div> : <ul className="notification-list">{notifications.map((item) => <li key={item.id} className={item.read_at ? 'notification-read' : 'notification-unread'}>
      <div className="notification-copy"><span className="eyebrow">{item.event_type.replaceAll('_', ' ')}</span><b>{item.title}</b><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}</small></div>
      {!item.read_at && <button disabled={busy} onClick={() => markRead([item.id])}>Mark read</button>}
    </li>)}</ul>}
  </>
}
