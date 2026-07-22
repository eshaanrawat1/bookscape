import { useRef, useEffect } from 'react'
import { Search } from 'lucide-react'
import BookGrid from '../components/BookGrid.jsx'

function SearchView({ draft, query, results, loading, error, onDraftChange, onSearch, onOpen, onOpenAuthor }) {
  const inputRef = useRef(null)

  const submitSearch = async (event) => {
    event.preventDefault()
    await onSearch(draft)
  }

  if (loading) {
    return (
      <div className="stack">
        <SearchHeader draft={draft} onDraftChange={onDraftChange} onSubmit={submitSearch} inputRef={inputRef} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="stack">
        <SearchHeader draft={draft} onDraftChange={onDraftChange} onSubmit={submitSearch} inputRef={inputRef} />
        <SearchLanding title="Could not search books" body={error} />
      </div>
    )
  }

  if (!query) {
    return (
      <div className="stack">
        <SearchHeader draft={draft} onDraftChange={onDraftChange} onSubmit={submitSearch} inputRef={inputRef} />
        <SearchLanding
          title=""
          body="Type a title or author, then press Enter."
          emptyText="Search for a book to see results here."
        />
      </div>
    )
  }

  return (
    <div className="stack">
      <SearchHeader draft={draft} onDraftChange={onDraftChange} onSubmit={submitSearch} inputRef={inputRef} />
      {results.length > 0 ? (
        <BookGrid books={results} onOpen={onOpen} onOpenAuthor={onOpenAuthor} />
      ) : (
        <SearchLanding title="No results found" body="Try a different title, author, or a broader term." />
      )}
    </div>
  )
}

function SearchHeader({ draft, onDraftChange, onSubmit, inputRef }) {
  useEffect(() => {
    inputRef?.current?.focus()
    inputRef?.current?.select?.()
  }, [])

  return (
    <form className="pageSearchHeader" onSubmit={onSubmit}>
      <div className="pageSearchField">
        <Search />
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder=""
          aria-label="Search books"
        />
      </div>
    </form>
  )
}

function SearchLanding({ title, body, emptyText }) {
  return (
    <div className="searchLanding">
      <div className="searchHeader">
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {emptyText ? (
        <div className="emptyState">
          <p>{emptyText}</p>
        </div>
      ) : null}
    </div>
  )
}

export default SearchView
