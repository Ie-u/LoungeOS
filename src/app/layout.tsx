import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LoungeOS · Cynux Production',
  description: 'Lounge session and operations management.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
