import { ArrowLeft } from 'lucide-react'
import BookGrid from '../components/BookGrid.jsx'

function GenreView({ genre, books, loading, error, onOpen, onOpenAuthor, onBack }) {
  return (
    <div className="stack">
      <div className="shelfHeader">
        <button type="button" className="secondaryButton" onClick={onBack}>
          <ArrowLeft size={18} />
          Back to Library
        </button>
      </div>

      {loading ? (
        <div className="emptyState">
          <p>Loading genre books…</p>
        </div>
      ) : error ? (
        <div className="emptyState">
          <h2>Could not load genre</h2>
          <p>{error}</p>
        </div>
      ) : books.length > 0 ? (
        <BookGrid books={books} onOpen={onOpen} onOpenAuthor={onOpenAuthor} />
      ) : (
        <div className="emptyState">
          <h2>No books found</h2>
          <p>We couldn't find any titles in the catalog for this genre.</p>
        </div>
      )}
    </div>
  )
}

export default GenreView
