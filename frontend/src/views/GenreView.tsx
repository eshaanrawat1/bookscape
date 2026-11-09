import BookGrid from '../components/books/BookGrid.jsx'
import CatalogPage from '../components/books/CatalogPage.jsx'
import useGenreBooks from '../hooks/useGenreBooks.js'

interface GenreViewProps {
  genre: string
}

function GenreView({ genre }: GenreViewProps) {
  const catalog = useGenreBooks(genre)
  return (
    <CatalogPage
      {...catalog}
      loadingMessage="Loading genre books…"
      errorTitle="Could not load genre"
      emptyTitle="No books found"
      emptyMessage="We couldn't find any titles in the catalog for this genre."
    >
      <BookGrid books={catalog.books} />
    </CatalogPage>
  )
}

export default GenreView
