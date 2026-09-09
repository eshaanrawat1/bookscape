import { useEffect, useRef, type FormEvent, type RefObject } from 'react'
import { ChevronRight, Clock, Search, X } from 'lucide-react'
import BookCover from '../components/BookCover.jsx'
import BookGrid from '../components/BookGrid.jsx'
import { formatCompactNumber } from '../utils.js'
import useSearch from '../hooks/useSearch.js'
import useRecentSearches from '../hooks/useRecentSearches.js'
import useListNavigation from '../hooks/useListNavigation.js'
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
  const { recents, addRecent, removeRecent, clearRecents } = useRecentSearches()
  const { onOpen } = useNavigation()
  const inputRef = useRef<HTMLInputElement>(null)
  const draftQuery = draft.trim()
  const submittedQuery = query.trim()
  const hasSubmittedResults = Boolean(draftQuery && draftQuery === submittedQuery)
  const showPreview = Boolean(draftQuery && draftQuery !== submittedQuery && (previewLoading || previewResults.length > 0))

  const search = async (rawQuery: string) => {
    addRecent(rawQuery)
    await runSearch(rawQuery)
  }

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault()
    await search(draft)
  }

  // Opening a book from the preview is a finished search too — it just ends in
  // the dialog rather than in the grid, so the row it leaves behind is the book
  // you landed on rather than the half-typed string that found it.
  const openBook = (book: Book) => {
    addRecent(book.title)
    onOpen(book)
  }

  const header = (
    <SearchHeader
      draft={draft}
      previewResults={previewResults}
      previewLoading={previewLoading}
      showPreview={showPreview}
      onDraftChange={setDraft}
      onSubmit={submitSearch}
      onOpen={openBook}
      inputRef={inputRef}
    />
  )

  if (loading) {
    return <div className="stack">{header}</div>
  }

  if (error) {
    return (
      <div className="stack">
        {header}
        <SearchLanding title="Could not search books" body={error} />
      </div>
    )
  }

  if (hasSubmittedResults) {
    return (
      <div className="stack">
        {header}
        {results.length > 0 ? (
          <BookGrid books={results} />
        ) : (
          <SearchLanding title="No results found" body="Try a different title, author, or a broader term." />
        )}
      </div>
    )
  }

  // Recents hold the space under the field for as long as nothing better is
  // there to fill it — an empty field, or a draft the preview has not answered
  // yet — so the page is never a lone search bar over blank paper.
  return (
    <div className="stack">
      {header}
      {!showPreview ? (
        <RecentSearches
          recents={recents}
          onSelect={search}
          onRemove={removeRecent}
          onClear={clearRecents}
        />
      ) : null}
    </div>
  )
}

interface RecentSearchesProps {
  recents: string[]
  onSelect: (query: string) => void
  onRemove: (query: string) => void
  onClear: () => void
}

function RecentSearches({ recents, onSelect, onRemove, onClear }: RecentSearchesProps) {
  if (recents.length === 0) return null

  return (
    <section className="recentSearches">
      <div className="recentSearchesHeader">
        <h2>Recent searches</h2>
        <button type="button" className="recentSearchesClear" onClick={onClear}>
          Clear all
        </button>
      </div>
      <ul className="recentSearchList">
        {recents.map((entry) => (
          // The row and its dismiss are siblings rather than nested: one button
          // inside another is not something the browser will let you click.
          <li key={entry} className="recentSearchRow">
            <button type="button" className="recentSearchItem" onClick={() => onSelect(entry)}>
              <Clock />
              <span className="recentSearchQuery">{entry}</span>
            </button>
            <button
              type="button"
              className="recentSearchRemove"
              aria-label={`Remove ${entry} from recent searches`}
              onClick={() => onRemove(entry)}
            >
              <X />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface SearchHeaderProps {
  draft: string
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

  // -1 so nothing is highlighted until the user actually arrows into the list —
  // a bare Enter has always meant "search the full catalog" and still does.
  const { activeIndex, setActiveIndex, handleKeyDown } = useListNavigation(
    showPreview ? previewResults.length : 0,
    {
      initialIndex: -1,
      onSelect: (index) => onOpen?.(previewResults[index]),
    },
  )

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
          onKeyDown={handleKeyDown}
          placeholder="Search for a book, author, or genre…"
          aria-label="Search books"
          aria-expanded={showPreview}
          aria-autocomplete="list"
          aria-controls="searchPreviewPanel"
          aria-activedescendant={activeIndex >= 0 ? `searchPreviewItem-${activeIndex}` : undefined}
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
          activeIndex={activeIndex}
          onHover={setActiveIndex}
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
  activeIndex: number
  onHover: (index: number) => void
  onOpen?: (book: Book) => void
  onSubmit: (event: FormEvent) => void
}

function SearchPreviewDropdown({
  results,
  loading,
  activeIndex,
  onHover,
  onOpen,
  onSubmit,
}: SearchPreviewDropdownProps) {
  return (
    <div className="searchPreviewPanel" id="searchPreviewPanel" role="listbox" aria-label="Search suggestions">
      {loading && results.length === 0 ? <div className="searchPreviewStatus">Searching books...</div> : null}
      {results.map((book, index) => (
        <button
          key={book.id}
          type="button"
          id={`searchPreviewItem-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'searchPreviewItem active' : 'searchPreviewItem'}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => onHover(index)}
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
}

function SearchLanding({ title, body }: SearchLandingProps) {
  return (
    <div className="searchLanding">
      <div className="searchHeader">
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </div>
  )
}

export default SearchView
