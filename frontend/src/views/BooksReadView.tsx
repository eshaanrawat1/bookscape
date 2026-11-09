import BookGrid from '../components/books/BookGrid.jsx'
import CatalogPage from '../components/books/CatalogPage.jsx'
import useCatalogBooks from '../hooks/useCatalogBooks.js'

interface BooksReadViewProps {
  // '' is all time, matching the stats page's year filter.
  year: string
}

// The "See all" behind the stats page's Books read row. Same /stats payload the
// stats page itself reads, asked for one key — the endpoint returns every book
// in the year rather than a capped page, so the grid is the whole shelf.
function BooksReadView({ year }: BooksReadViewProps) {
  const catalog = useCatalogBooks(
    year ? `/stats?year=${encodeURIComponent(year)}` : '/stats',
    'Could not load the books you have read.',
  )

  return (
    <CatalogPage
      {...catalog}
      loadingMessage="Loading books read…"
      errorTitle="Could not load books read"
      emptyTitle="No books read"
      emptyMessage={year ? `Nothing finished in ${year} yet.` : "You haven't finished a book yet."}
    >
      <BookGrid books={catalog.books} />
    </CatalogPage>
  )
}

export default BooksReadView
