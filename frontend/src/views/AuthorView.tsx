import { BookList, BookListRow } from '../components/books/BookList.jsx'
import CatalogPage from '../components/books/CatalogPage.jsx'
import useAuthorBooks from '../hooks/useAuthorBooks.js'
import type { Book } from '../types.js'

interface AuthorViewProps {
  author: string
}

function genreLine(book: Book): string {
  return (book.genres.length ? book.genres : book.genre ? [book.genre] : []).join(' · ')
}

function AuthorView({ author }: AuthorViewProps) {
  const catalog = useAuthorBooks(author)

  return (
    <CatalogPage
      {...catalog}
      className="authorPage"
      loadingMessage="Loading author books…"
      errorTitle="Could not load author"
      emptyTitle="No books found"
      emptyMessage="We couldn't find any titles in the catalog for this author."
    >
      <BookList title="All books" caption="Every title matched to this author">
        {catalog.books.map((book) => (
          <BookListRow key={book.id} book={book} subtitle={genreLine(book)} />
        ))}
      </BookList>
    </CatalogPage>
  )
}

export default AuthorView
