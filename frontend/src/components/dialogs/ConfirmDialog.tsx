import Dialog, { type DialogProps } from './Dialog.jsx'

interface ConfirmDialogProps extends Pick<DialogProps, 'busy'> {
  title: string
  message: string
  confirmLabel?: string
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog label={title} className="confirmDialog" role="alertdialog" busy={busy} showClose={false} onClose={onCancel}>
      <h2 className="confirmTitle">{title}</h2>
      <p className="confirmMessage">{message}</p>

      {error && <p className="confirmError">{error}</p>}

      <div className="confirmActions">
        <button type="button" className="secondaryButton confirmButton" onClick={onCancel} disabled={busy}>
          Cancel
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
    </Dialog>
  )
}

export default ConfirmDialog
