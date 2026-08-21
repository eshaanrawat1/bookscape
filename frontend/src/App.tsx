import { useState, useEffect } from 'react'
import { Menu, Plus, File, Upload, Download, ArrowLeft } from 'lucide-react'

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
  seriesViewId,
  seriesNameFromView,
  genreViewId,
  genreNameFromView,
} from './utils.js'
import { viewMeta, shortcutLabel } from './constants.js'
import { buildCommands } from './commands.js'

// Context
import { LibraryDataContext, useLibraryData } from './context/LibraryDataContext.jsx'
import { NavigationContext } from './context/NavigationContext.jsx'
import { useToast } from './context/ToastContext.jsx'

// Hooks
import useAppHotkeys from './hooks/useAppHotkeys.js'

// Components
import Sidebar from './components/Sidebar.jsx'
import BookDialogStage, { type Selected } from './components/BookDialogStage.jsx'
import ScraperDialog from './components/ScraperDialog.jsx'
import SettingsDialog from './components/SettingsDialog.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import BookGrid from './components/BookGrid.jsx'

// Views
import ReadingNow from './views/ReadingNow.jsx'
import LibraryView from './views/LibraryView.jsx'
import SearchView from './views/SearchView.jsx'
import StatsView from './views/StatsView.jsx'
import AuthorView from './views/AuthorView.jsx'
import SeriesView from './views/SeriesView.jsx'
import GenreView from './views/GenreView.jsx'
import CollectionView from './views/CollectionView.jsx'
import type { Book, Collection, GenreSection, RawBookPayload, RawList, SyncPullResult, SyncPushResult } from './types.js'

export default function App() {
  const { showToast } = useToast()
  const [view, setView] = useState('reading-now')
  const [previousView, setPreviousView] = useState('reading-now')
  const [mobileNav, setMobileNav] = useState(false)
  const [selected, setSelected] = useState<Selected | null>(null)

  // Live data from the API
  const [books, setBooks] = useState<Book[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [wantToReadBooks, setWantToReadBooks] = useState<Book[]>([])
  const [globalLibrary, setGlobalLibrary] = useState<GenreSection[]>([])
  const [dataVersion, setDataVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [vaultBusy, setVaultBusy] = useState<'push' | 'pull' | null>(null)
  const [showScraperDialog, setShowScraperDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
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
    // Views that fetch their own books watch this rather than these lists, so
    // one reload refreshes the whole app rather than only the shelves.
    setDataVersion((version) => version + 1)
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
  const activeSeriesName = seriesNameFromView(view)
  const activeGenreName = genreNameFromView(view)
  const meta: { title?: string; subtitle?: string; name?: string; description?: string } | undefined = activeCollection
    ? activeCollection
    : view.startsWith('author:')
      ? { title: activeAuthorName || 'Author' }
      : view.startsWith('series:')
        ? { title: activeSeriesName || 'Series' }
        : view.startsWith('genre:')
          ? { title: activeGenreName || 'Genre' }
          : viewMeta[view]

  const openBookDialog = (book: Book) =>
    setSelected((prev) => ({ book, isNavigation: prev !== null }))

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
  const openSeriesPage = (series: string) => {
    const cleanSeries = String(series || '').trim()
    if (!cleanSeries) return
    setPreviousView((current) => (view.startsWith('series:') ? current : view))
    setSelected(null)
    setMobileNav(false)
    setView(seriesViewId(cleanSeries))
  }
  const goBackFromSeries = () => {
    setView(previousView && !previousView.startsWith('series:') ? previousView : 'library')
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
  // 'want-to-read' is a sidebar destination rather than a drilldown, so this
  // doesn't touch previousView — the back arrows belong to the author/series/
  // genre pages, and landing here should leave their return target alone.
  const openWantToRead = () => {
    setView('want-to-read')
    setMobileNav(false)
  }

  // The generic jump used by the sidebar, the ⌘1–⌘6 chords and every palette
  // navigate command. Like the sidebar it is a top-level destination rather
  // than a drilldown, so it leaves previousView alone; it does dismiss whatever
  // is open on top, since arriving at a new view behind a dialog reads as the
  // shortcut having done nothing.
  const goTo = (viewId: string) => {
    setShowPalette(false)
    setSelected(null)
    setMobileNav(false)
    setView(viewId)
  }

  const openScraperDialog = () => {
    setShowPalette(false)
    setShowScraperDialog(true)
  }

  useAppHotkeys({
    onTogglePalette: () => setShowPalette((open) => !open),
    onAddBook: openScraperDialog,
    onNavigate: goTo,
  })

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

  // Both vault actions say "your library" where the per-book buttons in the
  // book dialog name the book. They land in the same corner now, and "Pushed to
  // vault." from two places that sync very different amounts of data was the
  // one genuine ambiguity in moving these out of their own surfaces.
  async function pushToVault() {
    if (vaultBusy) return
    setVaultBusy('push')
    try {
      await apiFetch<SyncPushResult>('/sync/obsidian/push', { method: 'POST' })
      showToast('Pushed your library to the vault.', { key: 'vault:library' })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not push to Obsidian vault.', {
        tone: 'error',
        key: 'vault:library',
      })
    } finally {
      setVaultBusy(null)
    }
  }

  async function pullFromVault() {
    if (vaultBusy) return
    setVaultBusy('pull')
    try {
      await apiFetch<SyncPullResult>('/sync/obsidian', { method: 'POST' })
      await reloadAppData()
      showToast('Pulled your library from the vault.', { key: 'vault:library' })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not pull from Obsidian vault.', {
        tone: 'error',
        key: 'vault:library',
      })
    } finally {
      setVaultBusy(null)
    }
  }

  const libraryData = {
    collections,
    wantToReadBooks,
    globalLibrary,
    currentlyReading,
    wantToRead,
    finished,
    booksByIds,
    dataVersion,
    refreshLibrary: reloadAppData,
    addBookToCollection,
    removeBookFromCollection,
    toggleBookWantToRead,
    createCollection,
    renameCollection,
    deleteCollection,
  }

  const navigation = {
    onOpen: openBookDialog,
    onOpenAuthor: openAuthorPage,
    onOpenSeries: openSeriesPage,
    onOpenGenre: openGenrePage,
    onOpenWantToRead: openWantToRead,
    goTo,
  }

  // Only assembled while the palette is on screen — several entries close over
  // vault state that changes underneath it.
  const commands = showPalette
    ? buildCommands({
      collections,
      vaultBusy,
      goTo,
      onAddBook: openScraperDialog,
      onNewCollection: async () => { await createCollection() },
      onRefresh: reloadAppData,
      onVaultSettings: () => setShowSettingsDialog(true),
      onPush: pushToVault,
      onPull: pullFromVault,
    })
    : []

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
            <button
              className="iconPillButton"
              aria-label="Add Book"
              title={`Add Book (${shortcutLabel('N')})`}
              onClick={openScraperDialog}
            >
              <Plus />
            </button>
          </div>
          <div className="hearthShell">
            <Sidebar active={view} onSelect={goTo} />

            {mobileNav && (
              <div className="mobileScrim" onClick={() => setMobileNav(false)}>
                <div className="mobileDrawer" onClick={(event) => event.stopPropagation()}>
                  <Sidebar active={view} onSelect={goTo} />
                </div>
              </div>
            )}

            <main className="contentPane">
              <header className="topBar" data-tauri-drag-region>
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
                    {view.startsWith('series:') && (
                      <button type="button" className="kickerLink" onClick={goBackFromSeries}>
                        <ArrowLeft size={14} />
                        Back
                      </button>
                    )}
                    <h1>{meta?.title || meta?.name}</h1>
                    <p>{meta?.subtitle || meta?.description}</p>
                  </div>
                </div>
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
            <BookDialogStage selected={selected} onClose={() => setSelected(null)} />
          )}
          {showScraperDialog && (
            <ScraperDialog
              onClose={() => setShowScraperDialog(false)}
              onSuccess={async (newBook) => {
                setShowScraperDialog(false)
                await reloadAppData()
                setSelected({ book: normaliseBook(newBook) })
              }}
            />
          )}
          {showSettingsDialog && (
            <SettingsDialog onClose={() => setShowSettingsDialog(false)} />
          )}
          {/* Last, so it registers above the other dialogs on the escape stack. */}
          {showPalette && (
            <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />
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
      if (view.startsWith('series:')) {
        return <SeriesView series={seriesNameFromView(view)} />
      }
      if (view.startsWith('genre:')) {
        return <GenreView genre={genreNameFromView(view)} />
      }
      return null
  }
}
