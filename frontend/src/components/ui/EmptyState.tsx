interface EmptyStateProps {
  title?: string
  message?: string
  className?: string
}

// The placeholder standing in for a page's content: still loading, failed, or
// nothing to show.
function EmptyState({ title, message, className }: EmptyStateProps) {
  return (
    <div className={['emptyState', className].filter(Boolean).join(' ')}>
      {title && <h2>{title}</h2>}
      {message && <p>{message}</p>}
    </div>
  )
}

export default EmptyState
