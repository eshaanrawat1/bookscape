import type { ReactNode } from 'react'

interface SectionHeaderProps {
  title: string
  subtitle?: string
  className?: string
  // Whatever sits opposite the title: a "See all", a year picker.
  children?: ReactNode
}

function SectionHeader({ title, subtitle, className = 'shelfHeader', children }: SectionHeaderProps) {
  return (
    <header className={className}>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </header>
  )
}

export default SectionHeader
