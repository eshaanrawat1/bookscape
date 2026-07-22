import { useState } from 'react'
import { X, RefreshCcw } from 'lucide-react'
import { apiFetch } from '../api.js'

function ScraperDialog({ onClose, onSuccess }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setError('Please enter a URL.')
      return
    }
    if (!trimmedUrl.includes('/book/show/')) {
      setError('Please enter a valid Goodreads book URL (e.g., containing /book/show/).')
      return
    }

    setLoading(true)
    setError(null)
    setStatusMessage('Connecting to Goodreads...')

    // Set up status intervals to give the user a sense of progress during the wait
    const progressSteps = [
      { delay: 3000, message: 'Downloading book page...' },
      { delay: 8000, message: 'Extracting book metadata...' },
      { delay: 13000, message: 'Fetching similar books...' },
      { delay: 18000, message: 'Downloading cover image...' },
      { delay: 23000, message: 'Analyzing cover colors and gradients...' },
      { delay: 28000, message: 'Saving book to library...' }
    ]

    const timers = progressSteps.map(step => 
      setTimeout(() => setStatusMessage(step.message), step.delay)
    )

    try {
      const res = await apiFetch('/scrape-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl }),
      })
      timers.forEach(clearTimeout)
      if (res.ok && res.book) {
        onSuccess(res.book)
      } else {
        setError('Failed to import book details.')
      }
    } catch (err) {
      timers.forEach(clearTimeout)
      setError(err.message || 'An error occurred while importing the book.')
    } finally {
      setLoading(false)
      setStatusMessage('')
    }
  }

  return (
    <div className="dialogScrim" onClick={onClose}>
      <article className="bookDialog paperGrain scraperDialog" onClick={(e) => e.stopPropagation()}>
        <button className="dialogIconButton dialogClose" onClick={onClose} aria-label="Close dialog">
          <X />
        </button>
        
        <h2>Add Book to Library</h2>
        <p className="dialogAuthor" style={{ marginBottom: '1.5rem' }}>
          Enter a Goodreads URL to crawl and import it into your Bookscape library.
        </p>

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
              disabled={loading}
              placeholder="https://www.goodreads.com/book/show/..."
              className="scraperInput"
              required
            />
          </div>

          {error && (
            <p className="scraperError">
              {error}
            </p>
          )}

          {loading && (
            <div className="scraperStatus">
              <RefreshCcw className="syncIcon spinning" />
              <span className="scraperStatusText">
                {statusMessage}
              </span>
            </div>
          )}

          <div className="scraperButtons">
            <button
              type="button"
              className="secondaryButton"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primaryButton"
              disabled={loading}
            >
              {loading ? 'Importing...' : 'Import'}
            </button>
          </div>
        </form>
      </article>
    </div>
  )
}

export default ScraperDialog
