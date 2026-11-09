import { useState, type ReactNode } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { apiFetch, apiFetchStream } from '../../api.js'
import Dialog, { DialogStatus, type DialogCloseProps } from './Dialog.jsx'
import type { Book } from '../../types.js'
import { errorMessage } from '../../utils.js'

const GOODREADS_URL = 'https://www.goodreads.com/'

type CardBook = Pick<Book, 'title' | 'author' | 'image_url'>

// Not yet a Book: what the scraper found, sent back unchanged to save it. A duplicate carries only the card fields.
interface ScrapedBook extends CardBook {
  uid: string
  genres?: string[]
  page_count?: number
}

interface ScraperDialogProps extends DialogCloseProps {
  onSuccess: (book: Book) => void
}

interface PreviewEvent {
  stage: 'installing_browser' | 'fetching_page' | 'fetching_similar' | 'duplicate' | 'preview' | 'error'
  message?: string
  book?: ScrapedBook
}

interface ConfirmResponse {
  ok: boolean
  book?: Book
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'fetching'; message: string }
  | { kind: 'duplicate'; existing: ScrapedBook }
  | { kind: 'preview'; book: ScrapedBook }
  | { kind: 'saving'; book: ScrapedBook }
  | { kind: 'success'; book: Book }
  | { kind: 'error'; message: string }

function scrapedMeta(book: ScrapedBook): string {
  const parts: string[] = []
  if (book.genres?.[0]) parts.push(book.genres[0])
  if (book.page_count) parts.push(`${book.page_count} pp`)
  return parts.join(' · ')
}

interface PreviewCardProps {
  book: CardBook
  meta?: string
  // Replaces the title and author, for a card that is announcing something.
  children?: ReactNode
}

function PreviewCard({ book, meta, children }: PreviewCardProps) {
  return (
    <div className="scraperPreviewCard">
      {book.image_url ? (
        <img src={book.image_url} alt="" className="scraperPreviewCover" />
      ) : (
        <div className="scraperPreviewCover scraperPreviewCoverPlaceholder">Cover</div>
      )}
      <div className="scraperPreviewInfo">
        {children ?? (
          <>
            <p className="scraperPreviewTitle">{book.title || 'Untitled'}</p>
            <p className="scraperPreviewAuthor">{book.author}</p>
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

  const confirmImport = async (book: ScrapedBook) => {
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

  // The webview would navigate away on the href, so open the system browser instead.
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
          <PreviewCard book={stage.book} meta={scrapedMeta(stage.book)} />

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
