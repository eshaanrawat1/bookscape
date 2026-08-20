import useModalLayer from '../hooks/useModalLayer.js'

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
  // Escape still gets swallowed while the delete is in flight — it just does
  // nothing, rather than falling through to whatever is behind this.
  useModalLayer({ onEscape: busy ? undefined : onCancel, blocksHotkeys: true })

  return (
    <div className="dialogScrim" onClick={() => { if (!busy) onCancel() }}>
      <article
        className="bookDialog paperGrain confirmDialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="confirmTitle">{title}</h2>
        <p className="confirmMessage">{message}</p>

        {error && <p className="confirmError">{error}</p>}

        <div className="confirmActions">
          <button type="button" className="secondaryButton confirmButton" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="primaryButton confirmButton dangerButton"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </article>
    </div>
  )
}

export default ConfirmDialog
