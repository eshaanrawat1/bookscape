import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus, X } from 'lucide-react'
import useModalLayer from '../hooks/useModalLayer.js'
import { createHighlight } from '../hooks/useHighlights.js'
import { useToast } from '../context/ToastContext.jsx'
import type { Book, RawHighlightGroup } from '../types.js'

interface HighlightDialogProps {
  book: Book
  onClose: () => void
  // Handed the book's refreshed group so a caller already showing the list can
  // patch it in place. The book dialog, which has no list to patch, omits it.
  onCreated?: (group: RawHighlightGroup) => void
}

const onlyDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6)

// Always scoped to a book it was opened from — the book dialog's highlight
// button, or the Highlights page with a book already selected — so there is no
// picker step and nothing to go back to.
function HighlightDialog({ book, onClose, onCreated }: HighlightDialogProps) {
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [page, setPage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Holds unsaved text, so it mutes the app chords; Escape is swallowed while a
  // save is in flight rather than closing over a write that may still land.
  useModalLayer({ onEscape: saving ? undefined : onClose, blocksHotkeys: true })

  const pageNumber = Number(page) || 0
  const valid = text.trim().length > 0

  const stepPage = (delta: number) => {
    setPage(String(Math.max(0, pageNumber + delta)))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const group = await createHighlight(book.id, text.trim(), pageNumber)
      onCreated?.(group)
      showToast('Highlight saved.', { key: `highlight:${book.id}` })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the highlight.')
    } finally {
      setSaving(false)
    }
  }

  // Portalled to the body because the book dialog is one of its callers, and
  // that card animates in on a transform — a stacking context a fixed-position
  // scrim rendered inside it could not escape.
  return createPortal(
    <div
      className="dialogScrim highlightDialogScrim"
      onClick={(event) => {
        // A portal still bubbles through the React tree, so without this a
        // click on this scrim would reach the book dialog's scrim behind it and
        // close that too.
        event.stopPropagation()
        if (!saving) onClose()
      }}
    >
      <article
        className="bookDialog scraperDialog highlightDialog"
        role="dialog"
        aria-modal="true"
        aria-label={`New highlight from ${book.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="dialogIconButton dialogClose"
          onClick={onClose}
          disabled={saving}
          aria-label="Close dialog"
        >
          <X />
        </button>

        <h2>{book.title}</h2>
        {book.author ? <p className="dialogAuthor">{book.author}</p> : null}

        <form onSubmit={handleSubmit} className="scraperForm">
          <div className="scraperField">
            <label htmlFor="highlight-text" className="scraperLabel">New highlight</label>
            <textarea
              id="highlight-text"
              className="scraperInput highlightTextarea"
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={saving}
              autoFocus
              rows={6}
              placeholder="Paste your highlight"
            />
          </div>

          <div className="scraperField">
            <label htmlFor="highlight-page" className="scraperLabel">Page (optional)</label>
            <div className="highlightPageRow">
              <button
                type="button"
                className="highlightStepButton"
                onClick={() => stepPage(-1)}
                disabled={saving || pageNumber <= 0}
                aria-label="Decrease page"
              >
                <Minus />
              </button>
              <input
                id="highlight-page"
                type="text"
                inputMode="numeric"
                className="scraperInput highlightPageInput"
                value={page}
                onChange={(event) => setPage(onlyDigits(event.target.value))}
                onFocus={(event) => event.currentTarget.select()}
                disabled={saving}
                placeholder="0"
                aria-label="Page"
              />
              <button
                type="button"
                className="highlightStepButton"
                onClick={() => stepPage(1)}
                disabled={saving}
                aria-label="Increase page"
              >
                <Plus />
              </button>
            </div>
          </div>

          {error && <p className="scraperError">{error}</p>}

          <div className="scraperButtons">
            <button type="button" className="secondaryButton" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={saving || !valid}>
              {saving ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      </article>
    </div>,
    document.body,
  )
}

export default HighlightDialog
