import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCcw, X } from 'lucide-react'
import useModalLayer from '../../hooks/useModalLayer.js'

interface DialogProps {
  // Read out as the dialog's name, since most of these have no visible title
  // tied to them by id.
  label: string
  className?: string
  scrimClassName?: string
  role?: 'dialog' | 'alertdialog'
  // A write is in flight. Every way out is held back — Escape, the scrim and
  // the close button — rather than closing over something that may still land.
  busy?: boolean
  // For a dialog opened from inside another one: the book dialog's card animates
  // in on a transform, a stacking context a fixed-position scrim rendered inside
  // it could not escape.
  portal?: boolean
  showClose?: boolean
  // Mutes the app-wide chords. On by default because most of these hold unsaved
  // input or a destructive confirm.
  blocksHotkeys?: boolean
  onClose: () => void
  children: ReactNode
}

// What every dialog's caller hands it, for props interfaces to extend.
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
        // A portal still bubbles through the React tree, so without this a click
        // on this scrim would reach the book dialog's scrim behind it and close
        // that too.
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
