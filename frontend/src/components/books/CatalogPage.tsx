import type { ReactNode } from 'react'
import EmptyState from '../ui/EmptyState.jsx'
import type { Book } from '../../types.js'

interface CatalogPageProps {
  books: Book[]
  emptyTitle: string
  emptyMessage: string
  className?: string
  children: ReactNode
}

function CatalogPage({ books, emptyTitle, emptyMessage, className, children }: CatalogPageProps) {
  return (
    <div className={['stack', className].filter(Boolean).join(' ')}>
      {books.length > 0 ? children : <EmptyState title={emptyTitle} message={emptyMessage} />}
    </div>
  )
}

export default CatalogPage
