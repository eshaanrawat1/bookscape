import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCcw, X } from 'lucide-react'
import useModalLayer from '../../hooks/useModalLayer.js'

interface DialogProps {
  label: string
  className?: string
  scrimClassName?: string
  role?: 'dialog' | 'alertdialog'
  // A write is in flight: Escape, the scrim and the close button are all held back.
  busy?: boolean
  // Escapes the book dialog's transformed stacking context, which would trap a fixed scrim.
  portal?: boolean
  showClose?: boolean
  // Mutes app-wide chords; on by default for unsaved input and destructive confirms.
  blocksHotkeys?: boolean
  onClose: () => void
  children: ReactNode
}

type DialogCloseProps = Pick<DialogProps, 'onClose'>

function Dialog({
  label,
  className,
  scrimClassName,
  role = 'dialog',
  busy = false,
  portal = false,
  showClose = true,
  blocksHotkeys = true,
  onClose,
  children,
}: DialogProps) {
  useModalLayer({ onEscape: busy ? undefined : onClose, blocksHotkeys })

  const dialog = (
    <div
      className={['dialogScrim', scrimClassName].filter(Boolean).join(' ')}
      onClick={(event) => {
        // Portals still bubble through the React tree; this stops the click reaching the book dialog's scrim.
        event.stopPropagation()
        if (!busy) onClose()
      }}
    >
      <article
        className={['bookDialog', className].filter(Boolean).join(' ')}
        role={role}
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {showClose && (
          <button
            type="button"
            className="dialogIconButton dialogClose"
            onClick={onClose}
            disabled={busy}
            aria-label="Close dialog"
          >
            <X />
          </button>
        )}
        {children}
      </article>
    </div>
  )

  return portal ? createPortal(dialog, document.body) : dialog
}

function DialogStatus({ children }: { children: ReactNode }) {
  return (
    <div className="scraperStatus">
      <RefreshCcw className="syncIcon spinning" />
      <span className="scraperStatusText">{children}</span>
    </div>
  )
}

export { DialogStatus }
export type { DialogProps, DialogCloseProps }
export default Dialog
