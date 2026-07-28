import BookGrid from '../components/BookGrid.jsx'
import useGenreBooks from '../hooks/useGenreBooks.js'

interface GenreViewProps {
  genre: string
}

function GenreView({ genre }: GenreViewProps) {
  const { books, loading, error } = useGenreBooks(genre)
  return (
    <div className="stack">
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
        <BookGrid books={books} />
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
