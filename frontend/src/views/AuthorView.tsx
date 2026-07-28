import BookCover from '../components/BookCover.jsx'
import BookGrid from '../components/BookGrid.jsx'
import useAuthorBooks from '../hooks/useAuthorBooks.js'

interface AuthorViewProps {
  author: string
}

function AuthorView({ author }: AuthorViewProps) {
  const { books, loading, error } = useAuthorBooks(author)
  const heroBook = books[0] || null

  return (
    <div className="stack authorPage">
      <section className="authorHeroPanel paperGrain">
        <div className="finishedDialogTop authorDialogTop">
          <div className="finishedCoverColumn">
            <div className="finishedCoverWrap">
              {heroBook ? (
                <BookCover book={heroBook} glow />
              ) : (
                <div className="authorCoverFallback">
                  <span>{author ? author.charAt(0).toUpperCase() : '?'}</span>
                </div>
              )}
            </div>
            <div className="finishedPages">
              <strong>{books.length}</strong>
              <span>Books found</span>
            </div>
          </div>

          <div className="finishedCopy">
            <div className="finishedHeader">
              <div>
                <h2>{author || 'Author'}</h2>
                <p>Books we have by this author, including co-written titles.</p>
              </div>
            </div>

            <p className="authorSummary">
              This page gathers every matching title from the catalog and gives you a clean shelf just like the finished-books view.
            </p>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="emptyState">
          <p>Loading author books…</p>
        </div>
      ) : error ? (
        <div className="emptyState">
          <h2>Could not load author</h2>
          <p>{error}</p>
        </div>
      ) : books.length > 0 ? (
        <section className="authorBooksSection">
          <div className="shelfHeader">
            <div>
              <h2>All books</h2>
              <p>Every title in the catalog matched to this author.</p>
            </div>
          </div>
          <BookGrid books={books} />
        </section>
      ) : (
        <div className="emptyState">
          <h2>No books found</h2>
          <p>We couldn't find any titles in the catalog for this author.</p>
        </div>
      )}
    </div>
  )
}

export default AuthorView
