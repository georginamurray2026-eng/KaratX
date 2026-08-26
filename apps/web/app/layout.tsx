import type { ReactNode } from 'react'

export const metadata = {
  title: 'KaratX',
  description: 'XAU/USD market intelligence. Never places trades.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
