import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  return (
    <div className="dialogScrim" onClick={() => { if (!busy) onCancel() }}>
      <article
        className="bookDialog paperGrain confirmDialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="dialogIconButton dialogClose"
          onClick={onCancel}
          disabled={busy}
          aria-label="Close dialog"
        >
          <X />
        </button>

        <h2>{title}</h2>
        <p className="dialogDescription">{message}</p>

        {error && <p className="scraperError">{error}</p>}

        <div className="scraperButtons">
          <button type="button" className="secondaryButton" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="primaryButton dangerButton" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </article>
    </div>
  )
}

export default ConfirmDialog
