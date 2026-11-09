import { useMemo } from 'react'
import BookGrid from '../components/books/BookGrid.jsx'
import CatalogPage from '../components/books/CatalogPage.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { selectGenreBooks } from '../selectors.js'

interface GenreViewProps {
  genre: string
}

function GenreView({ genre }: GenreViewProps) {
  const { books: allBooks } = useLibraryData()
  const books = useMemo(() => selectGenreBooks(allBooks, genre), [allBooks, genre])
  return (
    <CatalogPage
      books={books}
      emptyTitle="No books found"
      emptyMessage="We couldn't find any titles in the catalog for this genre."
    >
      <BookGrid books={books} />
    </CatalogPage>
  )
}

export default GenreView
