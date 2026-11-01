'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import type { StaffProfile } from '@/lib/supabase/staff-context'

const sections = [
  { href: '/', label: 'Overview', icon: '▦' },
  { href: '/sessions', label: 'Sessions', icon: '◷' },
  { href: '/orders', label: 'Orders', icon: '▤' },
  { href: '/inventory', label: 'Inventory', icon: '◈' },
  { href: '/reports', label: 'Reports', icon: '▥' },
]

export default function AppShell({ profile, children }: { profile: StaffProfile; children: ReactNode }) {
  const pathname = usePathname()
  const initial = profile.display_name.trim().charAt(0).toUpperCase() || 'S'

  return <div className="shell">
    <aside className="sidebar">
      <Link className="brand-logo" href="/" aria-label="LoungeOS home">
        <Image src="/loungeos-neon-logo.png" alt="LoungeOS by Cynux Production" width={1280} height={1280} priority sizes="(max-width: 720px) 140px, 210px" />
      </Link>
      <nav aria-label="Main navigation">
        {sections.map((section) => <Link
          key={section.href}
          href={section.href}
          className={pathname === section.href ? 'nav-active' : ''}
          aria-current={pathname === section.href ? 'page' : undefined}
        ><span className="nav-icon" aria-hidden="true">{section.icon}</span><span>{section.label}</span></Link>)}
      </nav>
      <div className="sidebar-bottom">
        <span className="avatar" aria-hidden="true">{initial}</span>
        <span className="staff"><b>{profile.display_name}</b><small>{profile.role}</small></span>
        <form action="/auth/signout" method="post"><button className="icon-button" title="Sign out" aria-label="Sign out">↪</button></form>
      </div>
    </aside>
    <div className="app-main">{children}</div>
  </div>
}
