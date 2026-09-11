import BookGrid from '../components/BookGrid.jsx'
import useCatalogBooks from '../hooks/useCatalogBooks.js'

interface BooksReadViewProps {
  // '' is all time, matching the stats page's year filter.
  year: string
}

// The "See all" behind the stats page's Books read row. Same /stats payload the
// stats page itself reads, asked for one key — the endpoint returns every book
// in the year rather than a capped page, so the grid is the whole shelf.
function BooksReadView({ year }: BooksReadViewProps) {
  const { books, loading, error } = useCatalogBooks(
    year ? `/stats?year=${encodeURIComponent(year)}` : '/stats',
    'Could not load the books you have read.',
  )

  return (
    <div className="stack">
      {loading ? (
        <div className="emptyState">
          <p>Loading books read…</p>
        </div>
      ) : error ? (
        <div className="emptyState">
          <h2>Could not load books read</h2>
          <p>{error}</p>
        </div>
      ) : books.length > 0 ? (
        <BookGrid books={books} />
      ) : (
        <div className="emptyState">
          <h2>No books read</h2>
          <p>{year ? `Nothing finished in ${year} yet.` : "You haven't finished a book yet."}</p>
        </div>
      )}
    </div>
  )
}

export default BooksReadView
