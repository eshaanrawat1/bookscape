import type { ReactNode } from 'react'
import EmptyState from '../ui/EmptyState.jsx'
import type { CatalogBooks } from '../../types.js'

interface CatalogPageProps extends CatalogBooks {
  loadingMessage: string
  errorTitle: string
  emptyTitle: string
  emptyMessage: string
  className?: string
  children: ReactNode
}

function CatalogPage({
  books,
  loading,
  error,
  loadingMessage,
  errorTitle,
  emptyTitle,
  emptyMessage,
  className,
  children,
}: CatalogPageProps) {
  return (
    <div className={['stack', className].filter(Boolean).join(' ')}>
      {loading ? (
        <EmptyState message={loadingMessage} />
      ) : error ? (
        <EmptyState title={errorTitle} message={error} />
      ) : books.length > 0 ? (
        children
      ) : (
        <EmptyState title={emptyTitle} message={emptyMessage} />
      )}
    </div>
  )
}

export default CatalogPage
