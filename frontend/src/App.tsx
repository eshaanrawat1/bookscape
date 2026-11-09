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
  booksReadViewId,
  booksReadYearFromView,
  errorMessage,
} from './utils.js'
import { viewMeta, shortcutLabel } from './constants.js'
import { buildCommands } from './commands.js'

// Context
import { LibraryDataContext, useLibraryData } from './context/LibraryDataContext.jsx'
import { NavigationContext } from './context/NavigationContext.jsx'
import { useToast } from './context/ToastContext.jsx'

// Hooks
import useAppHotkeys from './hooks/useAppHotkeys.js'
import useReadingGoal from './hooks/useReadingGoal.js'

// Components
import Sidebar from './components/sidebar/Sidebar.jsx'
import EmptyState from './components/ui/EmptyState.jsx'
import BookDialogStage, { type Selected } from './components/dialogs/BookDialogStage.jsx'
import ScraperDialog from './components/dialogs/ScraperDialog.jsx'
import SettingsDialog from './components/dialogs/SettingsDialog.jsx'
import ReadingGoalDialog from './components/dialogs/ReadingGoalDialog.jsx'
import CommandPalette from './components/dialogs/CommandPalette.jsx'
import BookGrid from './components/books/BookGrid.jsx'

// Views
import ReadingNow from './views/ReadingNow.jsx'
import LibraryView from './views/LibraryView.jsx'
import SearchView from './views/SearchView.jsx'
import StatsView from './views/StatsView.jsx'
import HighlightsView from './views/HighlightsView.jsx'
import AuthorView from './views/AuthorView.jsx'
import SeriesView from './views/SeriesView.jsx'
import GenreView from './views/GenreView.jsx'
import BooksReadView from './views/BooksReadView.jsx'
import CollectionView from './views/CollectionView.jsx'
import type { Book, Collection, GenreSection, RawBookPayload, RawList, VaultAction } from './types.js'

// The pages with a Back link, and where it lands with nothing to go back to.
// Books read is reached from the stats page, so it falls back there rather than
// to the library the others return to.
const DRILLDOWNS = [
  { prefix: 'author:', fallback: 'library' },
  { prefix: 'series:', fallback: 'library' },
  { prefix: 'genre:', fallback: 'library' },
  { prefix: 'books-read:', fallback: 'stats' },
]

const drilldownFor = (view: string) => DRILLDOWNS.find(({ prefix }) => view.startsWith(prefix))

export default function App() {
  const { showToast, showError } = useToast()
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
  const [vaultBusy, setVaultBusy] = useState<VaultAction | null>(null)
  const [showScraperDialog, setShowScraperDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showGoalDialog, setShowGoalDialog] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Temporary: A/B for the active-nav treatment, ⌥⌘G to cycle. Deliberately
  // chorded with Alt, which useAppHotkeys drops on the floor. Delete this and
  // the loser's CSS block once we've picked one.
  const [navStyle, setNavStyle] = useState<'rail' | 'ember'>('rail')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || !(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 'g') return
      event.preventDefault()
      setNavStyle((current) => (current === 'rail' ? 'ember' : 'rail'))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
          setError(errorMessage(lastError, 'Could not load books.'))
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
  const dnf = books.filter((b) => b.status === 'dnf')

  // Progress against the goal is counted from `finished` rather than fetched,
  // so marking a book done moves the bar on the next render — the same list the
  // goal card draws its covers from.
  const readingGoal = useReadingGoal(finished)

  const activeCollection = view.startsWith('collection:')
    ? collections.find((c) => `collection:${c.id}` === view)
    : null
  const activeAuthorName = authorNameFromView(view)
  const activeSeriesName = seriesNameFromView(view)
  const activeGenreName = genreNameFromView(view)
  const activeBooksReadYear = booksReadYearFromView(view)
  const meta: { title?: string; subtitle?: string; name?: string } | undefined = activeCollection
    ? { ...activeCollection, subtitle: 'Kept together on purpose.' }
    : view.startsWith('author:')
      ? { title: activeAuthorName || 'Author' }
      : view.startsWith('series:')
        ? { title: activeSeriesName || 'Series' }
        : view.startsWith('genre:')
          ? { title: activeGenreName || 'Genre' }
          : view.startsWith('books-read:')
            ? {
              title: 'Books read',
              subtitle: activeBooksReadYear
                ? `Everything you finished in ${activeBooksReadYear}.`
                : "Everything you've ever finished.",
            }
            : viewMeta[view]

  const openBookDialog = (book: Book) =>
    setSelected((prev) => ({ book, isNavigation: prev !== null }))

  // Hopping between two pages of the same kind keeps the original return target,
  // so Back leaves the drilldown rather than walking back through it.
  const openDrilldown = (target: string) => {
    setPreviousView((current) => (drilldownFor(target) === drilldownFor(view) ? current : view))
    setSelected(null)
    setMobileNav(false)
    setView(target)
  }
  const openAuthorPage = (author: string) => {
    const cleanAuthor = String(author || '').trim()
    if (cleanAuthor) openDrilldown(authorViewId(cleanAuthor))
  }
  const openSeriesPage = (series: string) => {
    const cleanSeries = String(series || '').trim()
    if (cleanSeries) openDrilldown(seriesViewId(cleanSeries))
  }
  const openGenrePage = (genre: string) => {
    const cleanGenre = String(genre || '').trim()
    if (cleanGenre) openDrilldown(genreViewId(cleanGenre))
  }
  const openBooksReadPage = (year: string) => openDrilldown(booksReadViewId(year))
  const goBack = () => {
    const drilldown = drilldownFor(view)
    if (!drilldown) return
    setView(previousView && !previousView.startsWith(drilldown.prefix) ? previousView : drilldown.fallback)
    setMobileNav(false)
  }
  // 'want-to-read' is a sidebar destination rather than a drilldown, so this
  // doesn't touch previousView — the back arrows belong to the author/series/
  // genre pages, and landing here should leave their return target alone.
  const openWantToRead = () => {
    setView('want-to-read')
    setMobileNav(false)
  }

  // The generic jump used by the sidebar, the ⌘1–⌘7 chords and every palette
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

  async function setCollectionIcon(collection: Collection, icon: string): Promise<void> {
    const data = await apiFetch<{ lists?: RawList[] }>(
      `/reading-lists/${collectionIdFromName(collection.name)}/icon`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icon }),
      },
    )
    setCollections(mapReadingLists(data.lists || []))
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
      await apiFetch('/sync/obsidian/push', { method: 'POST' })
      showToast('Pushed your library to the vault.', { key: 'vault:library' })
    } catch (err) {
      showError(err, 'Could not push to Obsidian vault.', 'vault:library')
    } finally {
      setVaultBusy(null)
    }
  }

  async function pullFromVault() {
    if (vaultBusy) return
    setVaultBusy('pull')
    try {
      await apiFetch('/sync/obsidian', { method: 'POST' })
      await reloadAppData()
      showToast('Pulled your library from the vault.', { key: 'vault:library' })
    } catch (err) {
      showError(err, 'Could not pull from Obsidian vault.', 'vault:library')
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
    dnf,
    readingGoal,
    booksByIds,
    dataVersion,
    refreshLibrary: reloadAppData,
    addBookToCollection,
    removeBookFromCollection,
    toggleBookWantToRead,
    createCollection,
    renameCollection,
    setCollectionIcon,
    deleteCollection,
  }

  const navigation = {
    onOpen: openBookDialog,
    onOpenAuthor: openAuthorPage,
    onOpenSeries: openSeriesPage,
    onOpenGenre: openGenrePage,
    onOpenBooksRead: openBooksReadPage,
    onOpenWantToRead: openWantToRead,
    onEditReadingGoal: () => setShowGoalDialog(true),
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
          <div className="hearthShell" data-nav-style={navStyle}>
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
                    {drilldownFor(view) && (
                      <button type="button" className="kickerLink" onClick={goBack}>
                        <ArrowLeft size={14} />
                        Back
                      </button>
                    )}
                    <h1>{meta?.title || meta?.name}</h1>
                    <p>{meta?.subtitle}</p>
                  </div>
                </div>
              </header>

              <div className="mainContent">
                {loading ? (
                  <EmptyState message="Loading your books…" />
                ) : error ? (
                  <EmptyState title="Could not load books" message={error} />
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
          {showGoalDialog && (
            <ReadingGoalDialog onClose={() => setShowGoalDialog(false)} />
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
  const { collections, wantToRead, finished, dnf } = useLibraryData()
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
    case 'highlights':
      return <HighlightsView />
    case 'want-to-read':
      return <BookGrid books={wantToRead} />
    case 'finished':
      return <BookGrid books={finished} />
    case 'dnf':
      return <BookGrid books={dnf} />
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
      if (view.startsWith('books-read:')) {
        return <BooksReadView year={booksReadYearFromView(view)} />
      }
      return null
  }
}
