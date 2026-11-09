import { useMemo } from 'react'
import { BookList, BookListRow } from '../components/books/BookList.jsx'
import CatalogPage from '../components/books/CatalogPage.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { selectAuthorBooks } from '../selectors.js'

interface AuthorViewProps {
  author: string
}

function AuthorView({ author }: AuthorViewProps) {
  const { books: allBooks } = useLibraryData()
  const books = useMemo(() => selectAuthorBooks(allBooks, author), [allBooks, author])

  return (
    <CatalogPage
      books={books}
      className="authorPage"
      emptyTitle="No books found"
      emptyMessage="We couldn't find any titles in the catalog for this author."
    >
      <BookList title="All books" caption="Every title matched to this author">
        {books.map((book) => (
          <BookListRow key={book.id} book={book} subtitle={book.genres.join(' · ')} />
        ))}
      </BookList>
    </CatalogPage>
  )
}

export default AuthorView
