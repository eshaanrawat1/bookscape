import { useState, useEffect } from 'react'
import { Menu, Plus, Trash2, File, Upload, Download, ArrowLeft } from 'lucide-react'

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
import type { Book, Collection, GenreSection, RawBookPayload, RawList, SyncPullResult, SyncPushResult } from './types.js'

type Selected =
  | { book: Book; variant: 'standard' }
  | { book: Book; variant: 'finished'; preferLiveStatus: boolean }

export default function App() {
  const [view, setView] = useState('reading-now')
  const [previousView, setPreviousView] = useState('reading-now')
  const [mobileNav, setMobileNav] = useState(false)
  const [selected, setSelected] = useState<Selected | null>(null)

  // Live data from the API
  const [books, setBooks] = useState<Book[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [wantToReadBooks, setWantToReadBooks] = useState<Book[]>([])
  const [globalLibrary, setGlobalLibrary] = useState<GenreSection[]>([])
  const [loading, setLoading] = useState(true)
  const [vaultBusy, setVaultBusy] = useState<'push' | 'pull' | null>(null)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [showScraperDialog, setShowScraperDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let lastError: unknown = null
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
          setError(lastError instanceof Error ? lastError.message : 'Could not load books.')
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
  const booksByIds = (ids: string[]): Book[] =>
    ids.map((id) => bookById.get(id)).filter((b): b is Book => Boolean(b))
  const currentlyReading = books.filter((b) => b.status === 'reading')
  const wantToRead = wantToReadBooks
  const finished = books.filter((b) => b.status === 'done')

  const activeCollection = view.startsWith('collection:')
    ? collections.find((c) => `collection:${c.id}` === view)
    : null
  const activeAuthorName = authorNameFromView(view)
  const activeGenreName = genreNameFromView(view)
  const meta: { title?: string; subtitle?: string; name?: string; description?: string } | undefined = activeCollection
    ? activeCollection
    : view.startsWith('author:')
      ? { title: activeAuthorName || 'Author' }
      : view.startsWith('genre:')
        ? { title: activeGenreName || 'Genre' }
        : viewMeta[view]

  const openBookDialog = (book: Book) => setSelected({ book, variant: 'standard' })
  const openFinishedBookDialog = (book: Book) => setSelected({ book, variant: 'finished', preferLiveStatus: true })

  const openAuthorPage = (author: string) => {
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
  const openGenrePage = (genre: string) => {
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

  async function createCollection(): Promise<string> {
    const name = nextCollectionName(collections)
    const data = await apiFetch<{ lists?: RawList[] }>('/reading-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const nextCollections = mapReadingLists(data.lists || [])
    setCollections(nextCollections)
    setView(`collection:${collectionIdFromName(name)}`)
    return name
  }

  async function renameCollection(collection: Collection, name: string): Promise<string> {
    const data = await apiFetch<{ lists?: RawList[] }>(`/reading-lists/${collectionIdFromName(collection.name)}`, {
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

  async function deleteCollection(collection: Collection): Promise<void> {
    const data = await apiFetch<{ lists?: RawList[] }>(`/reading-lists/${collectionIdFromName(collection.name)}`, {
      method: 'DELETE',
    })
    const nextCollections = mapReadingLists(data.lists || [])
    setCollections(nextCollections)
    if (view === `collection:${collection.id}`) {
      setView('library')
    }
  }

  async function addBookToCollection(collectionName: string, bookId: string): Promise<void> {
    const data = await apiFetch<{ lists?: RawList[] }>(`/reading-lists/${collectionIdFromName(collectionName)}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: bookId }),
    })
    setCollections(mapReadingLists(data.lists || []))
  }

  async function removeBookFromCollection(collectionName: string, bookId: string): Promise<void> {
    const data = await apiFetch<{ lists?: RawList[] }>(
      `/reading-lists/${collectionIdFromName(collectionName)}/books/${bookId}`,
      {
        method: 'DELETE',
      }
    )
    setCollections(mapReadingLists(data.lists || []))
  }

  async function toggleBookWantToRead(bookId: string, isSaved: boolean): Promise<void> {
    const data = await apiFetch<{ books?: RawBookPayload[] }>(
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

  async function pushToVault() {
    if (vaultBusy) return
    setVaultBusy('push')
    setVaultError(null)
    try {
      await apiFetch<SyncPushResult>('/sync/obsidian/push', { method: 'POST' })
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Could not push to Obsidian vault.')
    } finally {
      setVaultBusy(null)
    }
  }

  async function pullFromVault() {
    if (vaultBusy) return
    setVaultBusy('pull')
    setVaultError(null)
    try {
      await apiFetch<SyncPullResult>('/sync/obsidian', { method: 'POST' })
      await reloadAppData()
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Could not pull from Obsidian vault.')
    } finally {
      setVaultBusy(null)
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
            <button className="iconPillButton" aria-label="Vault Settings" onClick={() => setShowSettingsDialog(true)}>
              <File />
            </button>
            <button className="iconPillButton" aria-label="Push to Vault" onClick={pushToVault} disabled={vaultBusy !== null}>
              <Upload className={vaultBusy === 'push' ? 'syncIcon spinning' : 'syncIcon'} />
            </button>
            <button className="iconPillButton" aria-label="Pull from Vault" onClick={pullFromVault} disabled={vaultBusy !== null}>
              <Download className={vaultBusy === 'pull' ? 'syncIcon spinning' : 'syncIcon'} />
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
                        Back
                      </button>
                    )}
                    {view.startsWith('author:') && (
                      <button type="button" className="kickerLink" onClick={goBackFromAuthor}>
                        <ArrowLeft size={14} />
                        Back
                      </button>
                    )}
                    <h1>{meta?.title || meta?.name}</h1>
                    <p>{meta?.subtitle || meta?.description}</p>
                  </div>
                </div>
                <div className="topBarActions" />
                {vaultError && (
                  <p className="topBarNotice syncErrorNotice">{vaultError}</p>
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
                key={selected.book.id}
                book={selected.book}
                preferLiveStatus={selected.preferLiveStatus}
                onClose={() => setSelected(null)}
              />
            ) : (
              <BookDialog
                key={selected.book.id}
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
            <SettingsDialog onClose={() => setShowSettingsDialog(false)} />
          )}
        </div>
      </NavigationContext.Provider>
    </LibraryDataContext.Provider>
  )
}

function ViewContent({ view }: { view: string }) {
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
