interface EmptyStateProps {
  title?: string
  message?: string
  className?: string
}

function EmptyState({ title, message, className }: EmptyStateProps) {
  return (
    <div className={['emptyState', className].filter(Boolean).join(' ')}>
      {title && <h2>{title}</h2>}
      {message && <p>{message}</p>}
    </div>
  )
}

export default EmptyState
