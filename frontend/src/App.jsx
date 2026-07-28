import { useState, useEffect } from 'react'
import { Menu, RefreshCcw, Plus, Trash2, File, ArrowLeft } from 'lucide-react'

// API & Utilities
import { apiFetch, BOOTSTRAP_RETRIES, BOOTSTRAP_RETRY_DELAY_MS } from './api.js'
import {
  sleep,
  loadBootstrapData,
  collectionIdFromName,
  mapReadingLists,
  nextCollectionName,
  normaliseBook,
  authorViewId,
  authorNameFromView,
  genreViewId,
  genreNameFromView,
} from './utils.js'
import { viewMeta } from './constants.js'

// Context
import { LibraryDataContext, useLibraryData } from './context/LibraryDataContext.jsx'
import { NavigationContext } from './context/NavigationContext.jsx'

// Components
import Sidebar from './components/Sidebar.jsx'
import BookDialog from './components/BookDialog.jsx'
import FinishedBookDialog from './components/FinishedBookDialog.jsx'
import ScraperDialog from './components/ScraperDialog.jsx'
import SettingsDialog from './components/SettingsDialog.jsx'
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

  // Live data from the API
  const [books, setBooks] = useState([])
  const [collections, setCollections] = useState([])
  const [wantToReadBooks, setWantToReadBooks] = useState([])
  const [globalLibrary, setGlobalLibrary] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(null)
  const [showScraperDialog, setShowScraperDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
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

  async function reloadAppData() {
    const data = await loadBootstrapData()

    setBooks(data.books.map(normaliseBook))
    setCollections(mapReadingLists(data.lists))
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
    setWantToReadBooks((data.books || []).map(normaliseBook))
    await reloadAppData()
  }

  async function syncFromObsidian() {
    if (syncing) return
    setSyncing(true)
    setSyncError(null)
    try {
      await apiFetch('/sync/obsidian', { method: 'POST' })
      await reloadAppData()
    } catch (err) {
      setSyncError(err.message || 'Could not sync from Obsidian.')
    } finally {
      setSyncing(false)
    }
  }

  const libraryData = {
    books,
    collections,
    wantToReadBooks,
    globalLibrary,
    currentlyReading,
    wantToRead,
    finished,
    booksByIds,
    addBookToCollection,
    removeBookFromCollection,
    toggleBookWantToRead,
    createCollection,
    renameCollection,
  }

  const navigation = {
    onOpen: openBookDialog,
    onOpenAuthor: openAuthorPage,
    onOpenGenre: openGenrePage,
    onOpenReadingNow: openFinishedBookDialog,
  }

  return (
    <LibraryDataContext.Provider value={libraryData}>
      <NavigationContext.Provider value={navigation}>
        <div className="appRoot">
          <div className="iconPill">
            <button className="iconPillButton" aria-label="Obsidian Vault" onClick={() => setShowSettingsDialog(true)}>
              <File />
            </button>
            <button className="iconPillButton" aria-label="Sync" onClick={syncFromObsidian} disabled={syncing}>
              <RefreshCcw className={syncing ? 'syncIcon spinning' : 'syncIcon'} />
            </button>
            <button className="iconPillButton" aria-label="Add Book" onClick={() => setShowScraperDialog(true)}>
              <Plus />
            </button>
            {activeCollection && (
              <button
                className="iconPillButton"
                aria-label={`Delete ${activeCollection.name}`}
                onClick={() => deleteCollection(activeCollection)}
              >
                <Trash2 />
              </button>
            )}
          </div>
          <div className="hearthShell">
            <Sidebar
              active={view}
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
                    {view.startsWith('genre:') && (
                      <button type="button" className="kickerLink" onClick={goBackFromGenre}>
                        <ArrowLeft size={14} />
                        Library
                      </button>
                    )}
                    {view.startsWith('author:') && (
                      <button type="button" className="kickerLink" onClick={goBackFromAuthor}>
                        <ArrowLeft size={14} />
                        Library
                      </button>
                    )}
                    <h1>{meta?.title || meta?.name}</h1>
                    <p>{meta?.subtitle || meta?.description}</p>
                  </div>
                </div>
                <div className="topBarActions" />
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
                  <ViewContent view={view} />
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
              />
            ) : (
              <BookDialog
                key={selected.book.id || selected.book.uid}
                book={selected.book}
                onClose={() => setSelected(null)}
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
          {showSettingsDialog && (
            <SettingsDialog onClose={() => setShowSettingsDialog(false)} onDataChanged={reloadAppData} />
          )}
        </div>
      </NavigationContext.Provider>
    </LibraryDataContext.Provider>
  )
}

function ViewContent({ view }) {
  const { collections, wantToRead, finished } = useLibraryData()
  const activeCollection = view.startsWith('collection:')
    ? collections.find((c) => `collection:${c.id}` === view)
    : null

  if (activeCollection) {
    return <CollectionView activeCollection={activeCollection} />
  }

  switch (view) {
    case 'reading-now':
      return <ReadingNow />
    case 'library':
      return <LibraryView />
    case 'search':
      return <SearchView />
    case 'stats':
      return <StatsView />
    case 'want-to-read':
      return <BookGrid books={wantToRead} />
    case 'finished':
      return <BookGrid books={finished} />
    default:
      if (view.startsWith('author:')) {
        return <AuthorView author={authorNameFromView(view)} />
      }
      if (view.startsWith('genre:')) {
        return <GenreView genre={genreNameFromView(view)} />
      }
      return null
  }
}
