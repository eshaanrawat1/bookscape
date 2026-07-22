import { useState, useEffect } from 'react'
import { Menu, RefreshCcw, Plus, Trash2 } from 'lucide-react'

// API & Utilities
import { apiFetch, postJsonWithFallback, BOOTSTRAP_RETRIES, BOOTSTRAP_RETRY_DELAY_MS } from './api.js'
import {
  sleep,
  loadBootstrapData,
  collectionIdFromName,
  mapReadingLists,
  nextCollectionName,
  normaliseBook,
  resolveSavedWantToReadBook,
  authorViewId,
  authorNameFromView,
  genreViewId,
  genreNameFromView,
} from './utils.js'
import { viewMeta } from './constants.js'

// Components
import Sidebar from './components/Sidebar.jsx'
import BookDialog from './components/BookDialog.jsx'
import FinishedBookDialog from './components/FinishedBookDialog.jsx'
import ScraperDialog from './components/ScraperDialog.jsx'
import BookGrid from './components/BookGrid.jsx'

// Views
import ReadingNow from './views/ReadingNow.jsx'
import LibraryView from './views/LibraryView.jsx'
import SearchView from './views/SearchView.jsx'
import StatsView from './views/StatsView.jsx'
import AuthorView from './views/AuthorView.jsx'
import GenreView from './views/GenreView.jsx'
import CollectionView from './views/CollectionView.jsx'

export default function App() {
  const [view, setView] = useState('reading-now')
  const [previousView, setPreviousView] = useState('reading-now')
  const [mobileNav, setMobileNav] = useState(false)
  const [selected, setSelected] = useState(null)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [statsSummary, setStatsSummary] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState(null)
  const [statsYear, setStatsYear] = useState('')
  const [statsMonth, setStatsMonth] = useState('')
  const [authorBooks, setAuthorBooks] = useState([])
  const [authorLoading, setAuthorLoading] = useState(false)
  const [authorError, setAuthorError] = useState(null)
  const [genreBooks, setGenreBooks] = useState([])
  const [genreLoading, setGenreLoading] = useState(false)
  const [genreError, setGenreError] = useState(null)

  // Live data from the API
  const [books, setBooks] = useState([])
  const [collections, setCollections] = useState([])
  const [wantToReadBookIds, setWantToReadBookIds] = useState([])
  const [wantToReadBooks, setWantToReadBooks] = useState([])
  const [globalLibrary, setGlobalLibrary] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(null)
  const [showScraperDialog, setShowScraperDialog] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let lastError = null
      try {
        for (let attempt = 0; attempt <= BOOTSTRAP_RETRIES; attempt += 1) {
          try {
            const data = await loadBootstrapData()
            if (cancelled) return

            setBooks(data.books.map(normaliseBook))
            setCollections(mapReadingLists(data.lists))
            setWantToReadBookIds(data.wantToReadBookIds)
            setWantToReadBooks(data.wantToReadBooks.map(normaliseBook))
            setGlobalLibrary(data.globalLibrary)
            setError(null)
            return
          } catch (err) {
            lastError = err
            if (attempt < BOOTSTRAP_RETRIES) {
              await sleep(BOOTSTRAP_RETRY_DELAY_MS)
            }
          }
        }

        if (!cancelled) {
          setError(lastError?.message || 'Could not load books.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (view !== 'stats') return
    let cancelled = false

    async function loadStats() {
      setStatsLoading(true)
      try {
        const params = new URLSearchParams()
        if (statsYear) params.set('year', statsYear)
        if (statsMonth) params.set('month', statsMonth)
        const suffix = params.toString() ? `?${params.toString()}` : ''
        const data = await apiFetch(`/stats${suffix}`)
        if (cancelled) return
        setStatsSummary(data)
        setStatsError(null)
      } catch (err) {
        if (!cancelled) setStatsError(err.message || 'Could not load stats.')
      } finally {
        if (!cancelled) setStatsLoading(false)
      }
    }

    loadStats()
    return () => { cancelled = true }
  }, [view, statsYear, statsMonth])

  useEffect(() => {
    if (!view.startsWith('author:')) {
      setAuthorBooks([])
      setAuthorError(null)
      setAuthorLoading(false)
      return undefined
    }

    const authorName = authorNameFromView(view)
    if (!authorName) {
      setAuthorBooks([])
      setAuthorError('Could not load author books.')
      setAuthorLoading(false)
      return undefined
    }

    let cancelled = false
    setAuthorLoading(true)
    setAuthorError(null)

    async function loadAuthorBooks() {
      try {
        const data = await apiFetch(`/author-books?author=${encodeURIComponent(authorName)}`)
        if (cancelled) return
        setAuthorBooks((data.books || []).map(normaliseBook))
      } catch (err) {
        if (!cancelled) {
          setAuthorBooks([])
          setAuthorError(err.message || 'Could not load author books.')
        }
      } finally {
        if (!cancelled) setAuthorLoading(false)
      }
    }

    loadAuthorBooks()
    return () => {
      cancelled = true
    }
  }, [view])

  useEffect(() => {
    if (!view.startsWith('genre:')) {
      setGenreBooks([])
      setGenreError(null)
      setGenreLoading(false)
      return undefined
    }

    const genreName = genreNameFromView(view)
    if (!genreName) {
      setGenreBooks([])
      setGenreError('Could not load genre books.')
      setGenreLoading(false)
      return undefined
    }

    let cancelled = false
    setGenreLoading(true)
    setGenreError(null)

    async function loadGenreBooks() {
      try {
        const data = await apiFetch(`/genre-books?genre=${encodeURIComponent(genreName)}&limit=100`)
        if (cancelled) return
        setGenreBooks((data.books || []).map(normaliseBook))
      } catch (err) {
        if (!cancelled) {
          setGenreBooks([])
          setGenreError(err.message || 'Could not load genre books.')
        }
      } finally {
        if (!cancelled) setGenreLoading(false)
      }
    }

    loadGenreBooks()
    return () => {
      cancelled = true
    }
  }, [view])

  async function reloadAppData() {
    const data = await loadBootstrapData()

    setBooks(data.books.map(normaliseBook))
    setCollections(mapReadingLists(data.lists))
    setWantToReadBookIds(data.wantToReadBookIds)
    setWantToReadBooks(data.wantToReadBooks.map(normaliseBook))
    setGlobalLibrary(data.globalLibrary)
  }

  // Derived views from live books
  const bookById = new Map(books.map((b) => [b.id, b]))
  const booksByIds = (ids) => ids.map((id) => bookById.get(id)).filter(Boolean)
  const currentlyReading = books.filter((b) => b.status === 'reading')
  const wantToRead = wantToReadBooks
  const finished = books.filter((b) => b.status === 'done')

  const activeCollection = view.startsWith('collection:')
    ? collections.find((c) => `collection:${c.id}` === view)
    : null
  const activeAuthorName = authorNameFromView(view)
  const activeGenreName = genreNameFromView(view)
  const meta = activeCollection
    ? activeCollection
    : view.startsWith('author:')
      ? { title: activeAuthorName || 'Author', subtitle: 'Every book we have by this author.' }
      : view.startsWith('genre:')
        ? { title: activeGenreName || 'Genre', subtitle: 'Top books in this genre.' }
        : viewMeta[view]

  const openBookDialog = (book) => setSelected({ book, variant: 'standard' })
  const openFinishedBookDialog = (book) => setSelected({ book, variant: 'finished', preferLiveStatus: true })
  
  const openAuthorPage = (author) => {
    const cleanAuthor = String(author || '').trim()
    if (!cleanAuthor) return
    setPreviousView((current) => (view.startsWith('author:') ? current : view))
    setSelected(null)
    setMobileNav(false)
    setView(authorViewId(cleanAuthor))
  }
  const goBackFromAuthor = () => {
    setView(previousView && !previousView.startsWith('author:') ? previousView : 'library')
    setMobileNav(false)
  }
  const openGenrePage = (genre) => {
    const cleanGenre = String(genre || '').trim()
    if (!cleanGenre) return
    setPreviousView((current) => (view.startsWith('genre:') ? current : view))
    setSelected(null)
    setMobileNav(false)
    setView(genreViewId(cleanGenre))
  }
  const goBackFromGenre = () => {
    setView(previousView && !previousView.startsWith('genre:') ? previousView : 'library')
    setMobileNav(false)
  }

  async function runSearch(rawQuery = searchDraft) {
    const nextQuery = String(rawQuery || '').trim()
    setSearchDraft(nextQuery)
    setSearchQuery(nextQuery)
    setView('search')

    if (!nextQuery) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    setSearchLoading(true)
    setSearchError(null)
    try {
      const data = await apiFetch(`/search?q=${encodeURIComponent(nextQuery)}&limit=24`)
      setSearchResults((data.results || []).map(normaliseBook))
    } catch (err) {
      setSearchError(err.message || 'Could not search books.')
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  async function createCollection() {
    const name = nextCollectionName(collections)
    const data = await apiFetch('/reading-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const nextCollections = mapReadingLists(data.lists || [])
    setCollections(nextCollections)
    setView(`collection:${collectionIdFromName(name)}`)
    return name
  }

  async function renameCollection(collection, name) {
    const data = await apiFetch(`/reading-lists/${collectionIdFromName(collection.name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const nextCollections = mapReadingLists(data.lists || [])
    setCollections(nextCollections)
    const oldView = `collection:${collection.id}`
    const newView = `collection:${collectionIdFromName(name)}`
    if (view === oldView) setView(newView)
    return name
  }

  async function deleteCollection(collection) {
    const data = await apiFetch(`/reading-lists/${collectionIdFromName(collection.name)}`, {
      method: 'DELETE',
    })
    const nextCollections = mapReadingLists(data.lists || [])
    setCollections(nextCollections)
    if (view === `collection:${collection.id}`) {
      setView('library')
    }
  }

  async function addBookToCollection(collectionName, bookId) {
    const data = await apiFetch(`/reading-lists/${collectionIdFromName(collectionName)}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: bookId }),
    })
    setCollections(mapReadingLists(data.lists || []))
  }

  async function removeBookFromCollection(collectionName, bookId) {
    const data = await apiFetch(
      `/reading-lists/${collectionIdFromName(collectionName)}/books/${bookId}`,
      {
        method: 'DELETE',
      }
    )
    setCollections(mapReadingLists(data.lists || []))
  }

  async function toggleBookWantToRead(bookId, isSaved) {
    const data = await apiFetch(
      isSaved ? `/want-to-read-books/${bookId}` : '/want-to-read-books',
      {
        method: isSaved ? 'DELETE' : 'POST',
        headers: isSaved ? undefined : { 'Content-Type': 'application/json' },
        body: isSaved ? undefined : JSON.stringify({ book_id: bookId }),
      }
    )
    setWantToReadBookIds(data.book_ids || [])
    setWantToReadBooks((data.books || []).map(normaliseBook))
    await reloadAppData()
  }

  async function syncFromObsidian() {
    if (syncing) return
    setSyncing(true)
    setSyncError(null)
    try {
      await postJsonWithFallback('/sync/obsidian')
      await reloadAppData()
    } catch (err) {
      setSyncError(err.message || 'Could not sync from Obsidian.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="appRoot">
      <div className="hearthShell">
        <Sidebar
          active={view}
          collections={collections}
          onCreateCollection={createCollection}
          onRenameCollection={renameCollection}
          onSync={syncFromObsidian}
          onAddBook={() => setShowScraperDialog(true)}
          onSelect={(nextView) => {
            setView(nextView)
            setMobileNav(false)
          }}
        />

        {mobileNav && (
          <div className="mobileScrim" onClick={() => setMobileNav(false)}>
            <div className="mobileDrawer" onClick={(event) => event.stopPropagation()}>
              <Sidebar
                active={view}
                collections={collections}
                onCreateCollection={createCollection}
                onRenameCollection={renameCollection}
                onSync={syncFromObsidian}
                onAddBook={() => setShowScraperDialog(true)}
                onSelect={(nextView) => {
                  setView(nextView)
                  setMobileNav(false)
                }}
              />
            </div>
          </div>
        )}

        <main className="contentPane">
          <header className="topBar">
            <div className="titleGroup">
              <button className="mobileMenuButton" onClick={() => setMobileNav(true)} aria-label="Open menu">
                <Menu />
              </button>
              <div>
                <h1>{meta?.title || meta?.name}</h1>
                <p>{meta?.subtitle || meta?.description}</p>
              </div>
            </div>
            <div className="topBarActions">
              {view === 'reading-now' && (
                <button
                  type="button"
                  className="syncButton"
                  onClick={syncFromObsidian}
                  disabled={syncing}
                  aria-label="Sync from Obsidian"
                  title="Sync from Obsidian"
                >
                  <RefreshCcw className={syncing ? 'syncIcon spinning' : 'syncIcon'} />
                  <span>{syncing ? 'Syncing' : 'Sync'}</span>
                </button>
              )}
              {view === 'library' && (
                <button
                  type="button"
                  className="syncButton"
                  onClick={() => setShowScraperDialog(true)}
                  aria-label="Add Book by URL"
                  title="Add Book by URL"
                >
                  <Plus />
                  <span>Add Book</span>
                </button>
              )}
              {activeCollection && (
                <button
                  type="button"
                  className="deleteCollectionButton"
                  aria-label={`Delete ${activeCollection.name}`}
                  title={`Delete ${activeCollection.name}`}
                  onClick={() => deleteCollection(activeCollection)}
                >
                  <Trash2 />
                </button>
              )}
            </div>
            {syncError && (
              <p className="topBarNotice syncErrorNotice">{syncError}</p>
            )}
          </header>

          <div className="mainContent">
            {loading ? (
              <div className="emptyState"><p>Loading your books…</p></div>
            ) : error ? (
              <div className="emptyState"><h2>Could not load books</h2><p>{error}</p></div>
            ) : (
              <ViewContent
                view={view}
                activeCollection={activeCollection}
                onOpen={openBookDialog}
                onOpenAuthor={openAuthorPage}
                onOpenReadingNow={openFinishedBookDialog}
                onOpenSidebar={() => setMobileNav(true)}
                onSelectView={setView}
                onGoBackFromAuthor={goBackFromAuthor}
                onSearch={runSearch}
                onRemoveFromCollection={removeBookFromCollection}
                collections={collections}
                books={books}
                booksByIds={booksByIds}
                currentlyReading={currentlyReading}
                wantToRead={wantToRead}
                finished={finished}
                searchDraft={searchDraft}
                searchQuery={searchQuery}
                searchResults={searchResults}
                searchLoading={searchLoading}
                searchError={searchError}
                setSearchDraft={setSearchDraft}
                globalLibrary={globalLibrary}
                authorBooks={authorBooks}
                authorLoading={authorLoading}
                authorError={authorError}
                genreBooks={genreBooks}
                genreLoading={genreLoading}
                genreError={genreError}
                onOpenGenre={openGenrePage}
                onGoBackFromGenre={goBackFromGenre}
                statsSummary={statsSummary}
                statsLoading={statsLoading}
                statsError={statsError}
                statsYear={statsYear}
                statsMonth={statsMonth}
                setStatsYear={setStatsYear}
                setStatsMonth={setStatsMonth}
                onOpenStatsBook={openBookDialog}
              />
            )}
          </div>
        </main>
      </div>

      {selected && (
        selected.variant === 'finished' ? (
          <FinishedBookDialog
            key={selected.book.id || selected.book.uid}
            book={selected.book}
            preferLiveStatus={selected.preferLiveStatus}
            onClose={() => setSelected(null)}
            onOpenAuthor={openAuthorPage}
          />
        ) : (
          <BookDialog
            key={selected.book.id || selected.book.uid}
            book={selected.book}
            collections={collections}
            savedWantToReadBook={resolveSavedWantToReadBook(selected.book, wantToReadBooks)}
            onAddToCollection={addBookToCollection}
            onClose={() => setSelected(null)}
            onOpen={openBookDialog}
            onOpenAuthor={openAuthorPage}
            onToggleWantToRead={toggleBookWantToRead}
          />
        )
      )}
      {showScraperDialog && (
        <ScraperDialog
          onClose={() => setShowScraperDialog(false)}
          onSuccess={async (newBook) => {
            setShowScraperDialog(false)
            await reloadAppData()
            setSelected({ book: normaliseBook(newBook), variant: 'standard' })
          }}
        />
      )}
    </div>
  )
}

function ViewContent({
  view,
  activeCollection,
  onOpen,
  onOpenAuthor,
  onOpenReadingNow,
  onOpenSidebar,
  onSelectView,
  onGoBackFromAuthor,
  onSearch,
  onRemoveFromCollection,
  collections,
  booksByIds,
  currentlyReading,
  wantToRead,
  finished,
  searchDraft,
  searchQuery,
  searchResults,
  searchLoading,
  searchError,
  setSearchDraft,
  globalLibrary,
  authorBooks,
  authorLoading,
  authorError,
  genreBooks,
  genreLoading,
  genreError,
  onOpenGenre,
  onGoBackFromGenre,
  statsSummary,
  statsLoading,
  statsError,
  statsYear,
  statsMonth,
  setStatsYear,
  setStatsMonth,
  onOpenStatsBook,
}) {
  if (activeCollection) {
    return (
      <CollectionView
        activeCollection={activeCollection}
        booksByIds={booksByIds}
        onOpen={onOpen}
        onOpenAuthor={onOpenAuthor}
        onRemoveFromCollection={onRemoveFromCollection}
      />
    )
  }

  switch (view) {
    case 'reading-now':
      return (
        <ReadingNow
          currentlyReading={currentlyReading}
          wantToRead={wantToRead}
          collections={collections}
          booksByIds={booksByIds}
          onOpen={onOpen}
          onOpenAuthor={onOpenAuthor}
          onOpenReadingNow={onOpenReadingNow}
        />
      )
    case 'library':
      return (
        <LibraryView
          globalLibrary={globalLibrary}
          onOpen={onOpen}
          onOpenAuthor={onOpenAuthor}
          onOpenGenre={onOpenGenre}
        />
      )
    case 'search':
      return (
        <SearchView
          draft={searchDraft}
          query={searchQuery}
          results={searchResults}
          loading={searchLoading}
          error={searchError}
          onDraftChange={setSearchDraft}
          onSearch={onSearch}
          onOpen={onOpen}
          onOpenAuthor={onOpenAuthor}
          onOpenSidebar={onOpenSidebar}
          onGoLibrary={() => onSelectView('library')}
        />
      )
    case 'stats':
      return (
        <StatsView
          summary={statsSummary}
          loading={statsLoading}
          error={statsError}
          year={statsYear}
          month={statsMonth}
          onYearChange={setStatsYear}
          onMonthChange={setStatsMonth}
          onOpen={onOpenStatsBook}
          onOpenAuthor={onOpenAuthor}
        />
      )
    case 'want-to-read':
      return <BookGrid books={wantToRead} onOpen={onOpen} onOpenAuthor={onOpenAuthor} />
    case 'finished':
      return <BookGrid books={finished} onOpen={onOpen} onOpenAuthor={onOpenAuthor} />
    default:
      if (view.startsWith('author:')) {
        return (
          <AuthorView
            author={authorNameFromView(view)}
            books={authorBooks}
            loading={authorLoading}
            error={authorError}
            onOpen={onOpen}
            onOpenAuthor={onOpenAuthor}
            onBack={onGoBackFromAuthor}
          />
        )
      }
      if (view.startsWith('genre:')) {
        return (
          <GenreView
            genre={genreNameFromView(view)}
            books={genreBooks}
            loading={genreLoading}
            error={genreError}
            onOpen={onOpen}
            onOpenAuthor={onOpenAuthor}
            onBack={onGoBackFromGenre}
          />
        )
      }
      return null
  }
}
