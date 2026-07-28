import { useEffect, useRef, type FormEvent, type RefObject } from 'react'
import { ChevronRight, Search, X } from 'lucide-react'
import BookCover from '../components/BookCover.jsx'
import BookGrid from '../components/BookGrid.jsx'
import { formatCompactNumber } from '../utils.js'
import useSearch from '../hooks/useSearch.js'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book } from '../types.js'

function SearchView() {
  const {
    draft,
    query,
    results,
    loading,
    error,
    previewResults,
    previewLoading,
    setDraft,
    runSearch,
  } = useSearch()
  const { onOpen } = useNavigation()
  const inputRef = useRef<HTMLInputElement>(null)
  const draftQuery = draft.trim()
  const submittedQuery = query.trim()
  const hasSubmittedResults = Boolean(draftQuery && draftQuery === submittedQuery)
  const showPreview = Boolean(draftQuery && draftQuery !== submittedQuery && (previewLoading || previewResults.length > 0))

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault()
    await runSearch(draft)
  }

  if (loading) {
    return (
      <div className="stack">
        <SearchHeader draft={draft} onDraftChange={setDraft} onSubmit={submitSearch} inputRef={inputRef} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="stack">
        <SearchHeader
          draft={draft}
          query={query}
          previewResults={previewResults}
          previewLoading={previewLoading}
          showPreview={showPreview}
          onDraftChange={setDraft}
          onSubmit={submitSearch}
          onOpen={onOpen}
          inputRef={inputRef}
        />
        <SearchLanding title="Could not search books" body={error} />
      </div>
    )
  }

  if (hasSubmittedResults) {
    return (
      <div className="stack">
        <SearchHeader
          draft={draft}
          query={query}
          previewResults={previewResults}
          previewLoading={previewLoading}
          showPreview={showPreview}
          onDraftChange={setDraft}
          onSubmit={submitSearch}
          onOpen={onOpen}
          inputRef={inputRef}
        />
        {results.length > 0 ? (
          <BookGrid books={results} />
        ) : (
          <SearchLanding title="No results found" body="Try a different title, author, or a broader term." />
        )}
      </div>
    )
  }

  return (
    <div className="stack">
      <SearchHeader
        draft={draft}
        query={query}
        previewResults={previewResults}
        previewLoading={previewLoading}
        showPreview={showPreview}
        onDraftChange={setDraft}
        onSubmit={submitSearch}
        onOpen={onOpen}
        inputRef={inputRef}
      />
      {!draftQuery ? (
        <SearchLanding
          title=""
          body="Type a title or author, then press Enter."
          emptyText="Search for a book to see results here."
        />
      ) : !showPreview ? (
        <SearchLanding title="" body="Press Enter to search the full catalog." />
      ) : null}
    </div>
  )
}

interface SearchHeaderProps {
  draft: string
  query?: string
  previewResults?: Book[]
  previewLoading?: boolean
  showPreview?: boolean
  onDraftChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onOpen?: (book: Book) => void
  inputRef: RefObject<HTMLInputElement>
}

function SearchHeader({
  draft,
  previewResults = [],
  previewLoading = false,
  showPreview = false,
  onDraftChange,
  onSubmit,
  onOpen,
  inputRef,
}: SearchHeaderProps) {
  useEffect(() => {
    inputRef?.current?.focus()
    inputRef?.current?.select?.()
  }, [])

  const clearSearch = () => {
    onDraftChange('')
    inputRef.current?.focus?.()
  }

  return (
    <div className="pageSearchHeader">
      <form className="pageSearchField" onSubmit={onSubmit}>
        <Search />
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder=""
          aria-label="Search books"
          aria-expanded={showPreview}
          aria-autocomplete="list"
        />
        {draft.trim() ? (
          <button
            type="button"
            className="searchClearButton"
            aria-label="Clear search"
            onClick={clearSearch}
          >
            <X />
          </button>
        ) : null}
      </form>
      {showPreview ? (
        <SearchPreviewDropdown
          results={previewResults}
          loading={previewLoading}
          onOpen={onOpen}
          onSubmit={onSubmit}
        />
      ) : null}
    </div>
  )
}

interface SearchPreviewDropdownProps {
  results: Book[]
  loading: boolean
  onOpen?: (book: Book) => void
  onSubmit: (event: FormEvent) => void
}

function SearchPreviewDropdown({ results, loading, onOpen, onSubmit }: SearchPreviewDropdownProps) {
  return (
    <div className="searchPreviewPanel" role="listbox" aria-label="Search suggestions">
      {loading && results.length === 0 ? <div className="searchPreviewStatus">Searching books...</div> : null}
      {results.map((book) => (
        <button
          key={book.id}
          type="button"
          className="searchPreviewItem"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpen?.(book)}
        >
          <div className="searchPreviewCover">
            <BookCover book={book} />
          </div>
          <div className="searchPreviewCopy">
            <strong>{book.title}</strong>
            {book.author ? <span>{book.author}</span> : null}
            <p>{previewMeta(book)}</p>
          </div>
          <ChevronRight className="searchPreviewChevron" />
        </button>
      ))}
      <button type="button" className="searchPreviewFooter" onClick={onSubmit}>
        Press Enter to see all results
      </button>
    </div>
  )
}

function previewMeta(book: Book): string {
  const parts: string[] = []
  if (book.genre) parts.push(book.genre)
  if (book.pages) parts.push(`${formatCompactNumber(book.pages)} pages`)
  return parts.join(' · ')
}

interface SearchLandingProps {
  title: string
  body: string
  emptyText?: string
}

function SearchLanding({ title, body, emptyText }: SearchLandingProps) {
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
