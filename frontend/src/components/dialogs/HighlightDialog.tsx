import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import Dialog, { type DialogCloseProps } from './Dialog.jsx'
import { createHighlight } from '../../hooks/useHighlights.js'
import { useToast } from '../../context/ToastContext.jsx'
import type { BookProps, Highlight } from '../../types.js'
import { errorMessage } from '../../utils.js'

interface HighlightDialogProps extends BookProps, DialogCloseProps {
  // Gets the refreshed list so a caller showing it can swap it in.
  onCreated?: (highlights: Highlight[]) => void
}

const onlyDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6)

function HighlightDialog({ book, onClose, onCreated }: HighlightDialogProps) {
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [page, setPage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      onCreated?.(await createHighlight(book.id, text.trim(), pageNumber))
      showToast('Highlight saved.', { key: `highlight:${book.id}` })
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not save the highlight.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      label={`New highlight from ${book.title}`}
      className="scraperDialog highlightDialog"
      scrimClassName="highlightDialogScrim"
      busy={saving}
      portal
      onClose={onClose}
    >
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
    </Dialog>
  )
}

export default HighlightDialog
