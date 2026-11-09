import { useState, type ReactNode } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { apiFetch, apiFetchStream } from '../../api.js'
import Dialog, { DialogStatus, type DialogCloseProps } from './Dialog.jsx'
import type { RawBookPayload } from '../../types.js'
import { errorMessage } from '../../utils.js'

const GOODREADS_URL = 'https://www.goodreads.com/'

interface ScraperDialogProps extends DialogCloseProps {
  onSuccess: (book: RawBookPayload) => void
}

interface PreviewEvent {
  stage: 'installing_browser' | 'fetching_page' | 'fetching_similar' | 'duplicate' | 'preview' | 'error'
  message?: string
  book?: RawBookPayload
}

interface ConfirmResponse {
  ok: boolean
  book?: RawBookPayload
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'fetching'; message: string }
  | { kind: 'duplicate'; existing: RawBookPayload }
  | { kind: 'preview'; book: RawBookPayload }
  | { kind: 'saving'; book: RawBookPayload }
  | { kind: 'success'; book: RawBookPayload }
  | { kind: 'error'; message: string }

function bookMeta(book: RawBookPayload): string {
  const parts: string[] = []
  const genres = Array.isArray(book.genres) ? book.genres.filter(Boolean) : []
  if (genres[0]) parts.push(String(genres[0]))
  const pages = Number(book.page_count)
  if (Number.isFinite(pages) && pages > 0) parts.push(`${pages} pp`)
  return parts.join(' · ')
}

interface PreviewCardProps {
  book: RawBookPayload
  meta?: string
  // Replaces the title and author, for a card that is announcing something.
  children?: ReactNode
}

function PreviewCard({ book, meta, children }: PreviewCardProps) {
  return (
    <div className="scraperPreviewCard">
      {book.image_url ? (
        <img src={String(book.image_url)} alt="" className="scraperPreviewCover" />
      ) : (
        <div className="scraperPreviewCover scraperPreviewCoverPlaceholder">Cover</div>
      )}
      <div className="scraperPreviewInfo">
        {children ?? (
          <>
            <p className="scraperPreviewTitle">{String(book.title || 'Untitled')}</p>
            <p className="scraperPreviewAuthor">{String(book.author || '')}</p>
            {meta !== undefined && <p className="scraperPreviewMeta">{meta}</p>}
          </>
        )}
      </div>
    </div>
  )
}

function ScraperDialog({ onClose, onSuccess }: ScraperDialogProps) {
  const [url, setUrl] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })

  const busy = stage.kind === 'fetching' || stage.kind === 'saving'

  const runPreview = async (targetUrl: string, force: boolean) => {
    setStage({ kind: 'fetching', message: 'Connecting to Goodreads…' })
    try {
      let settled = false
      for await (const event of apiFetchStream<PreviewEvent>('/scrape-book/preview', { url: targetUrl, force })) {
        if (event.stage === 'duplicate' && event.book) {
          setStage({ kind: 'duplicate', existing: event.book })
          settled = true
          break
        }
        if (event.stage === 'preview' && event.book) {
          setStage({ kind: 'preview', book: event.book })
          settled = true
          break
        }
        if (event.stage === 'error') {
          setStage({ kind: 'error', message: event.message || 'Something went wrong while importing the book.' })
          settled = true
          break
        }
        setStage({ kind: 'fetching', message: event.message || 'Working…' })
      }
      if (!settled) {
        setStage({ kind: 'error', message: 'The scraper stopped responding unexpectedly.' })
      }
    } catch (err) {
      setStage({ kind: 'error', message: errorMessage(err, 'An error occurred while importing the book.') })
    }
  }

  const confirmImport = async (book: RawBookPayload) => {
    setStage({ kind: 'saving', book })
    try {
      const res = await apiFetch<ConfirmResponse>('/scrape-book/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book }),
      })
      if (res.ok && res.book) {
        setStage({ kind: 'success', book: res.book })
      } else {
        setStage({ kind: 'error', message: 'Failed to save the book to your library.' })
      }
    } catch (err) {
      setStage({ kind: 'error', message: errorMessage(err, 'An error occurred while saving the book.') })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setStage({ kind: 'error', message: 'Please enter a URL.' })
      return
    }
    if (!trimmedUrl.includes('/book/show/')) {
      setStage({ kind: 'error', message: 'Please enter a valid Goodreads book URL (e.g., containing /book/show/).' })
      return
    }
    await runPreview(trimmedUrl, false)
  }

  const reset = () => setStage({ kind: 'idle' })

  // The webview would navigate away from the app if it followed the href itself,
  // so hand the URL to the system browser instead.
  const openGoodreads = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      const { open } = await import('@tauri-apps/api/shell')
      await open(GOODREADS_URL)
    } catch {
      window.open(GOODREADS_URL, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <Dialog label="Add Book to Library" className="scraperDialog" busy={busy} onClose={onClose}>
      <h2>Add Book to Library</h2>
      <p className="dialogAuthor" style={{ marginBottom: '1.5rem' }}>
        Enter a Goodreads URL to import it into your Bookscape library
        <a
          href={GOODREADS_URL}
          onClick={openGoodreads}
          className="scraperIntroLink"
          title="Open Goodreads"
          aria-label="Open Goodreads in your browser"
        >
          <ExternalLink />
        </a>
      </p>

      {stage.kind === 'idle' || stage.kind === 'error' || stage.kind === 'fetching' ? (
        <form onSubmit={handleSubmit} className="scraperForm">
          <div className="scraperField">
            <label htmlFor="goodreads-url" className="scraperLabel">
              Goodreads Book URL
            </label>
            <input
              id="goodreads-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              placeholder="https://www.goodreads.com/book/show/..."
              className="scraperInput"
              required
            />
          </div>

          {stage.kind === 'error' && <p className="scraperError">{stage.message}</p>}

          {stage.kind === 'fetching' && (
            <DialogStatus>{stage.message}</DialogStatus>
          )}

          <div className="scraperButtons">
            <button type="button" className="secondaryButton" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={busy}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>
      ) : null}

      {stage.kind === 'duplicate' && (
        <div className="scraperForm">
          <PreviewCard book={stage.existing} />
          <p className="scraperError" style={{ color: 'var(--muted-foreground)' }}>
            Already in your library.
          </p>
          <div className="scraperButtons">
            <button type="button" className="secondaryButton" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primaryButton" onClick={() => runPreview(url.trim(), true)}>
              Add anyway
            </button>
          </div>
        </div>
      )}

      {(stage.kind === 'preview' || stage.kind === 'saving') && (
        <div className="scraperForm">
          <PreviewCard book={stage.book} meta={bookMeta(stage.book)} />

          {stage.kind === 'saving' && (
            <DialogStatus>Saving to your library…</DialogStatus>
          )}

          <div className="scraperButtons">
            <button type="button" className="secondaryButton" onClick={reset} disabled={stage.kind === 'saving'}>
              Cancel
            </button>
            <button
              type="button"
              className="primaryButton"
              onClick={() => confirmImport(stage.book)}
              disabled={stage.kind === 'saving'}
            >
              {stage.kind === 'saving' ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'success' && (
        <div className="scraperForm">
          <PreviewCard book={stage.book}>
            <p className="scraperPreviewTitle">Added to your library</p>
            <button
              type="button"
              className="scraperViewLink"
              onClick={() => onSuccess(stage.book)}
            >
              View in library <ChevronRight size={16} />
            </button>
          </PreviewCard>
          <div className="scraperButtons">
            <button type="button" className="primaryButton" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export default ScraperDialog
