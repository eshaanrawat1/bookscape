import { useMemo } from 'react'
import BookGrid from '../components/books/BookGrid.jsx'
import CatalogPage from '../components/books/CatalogPage.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { selectStats } from '../selectors.js'

interface BooksReadViewProps {
  // '' is all time, matching the stats page's year filter.
  year: string
}

function BooksReadView({ year }: BooksReadViewProps) {
  const { books: allBooks } = useLibraryData()
  const books = useMemo(() => selectStats(allBooks, year ? Number(year) : null).books, [allBooks, year])

  return (
    <CatalogPage
      books={books}
      emptyTitle="No books read"
      emptyMessage={year ? `Nothing finished in ${year} yet.` : "You haven't finished a book yet."}
    >
      <BookGrid books={books} />
    </CatalogPage>
  )
}

export default BooksReadView
