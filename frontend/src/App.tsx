import { useCallback, useEffect, useMemo, useState } from 'react'
import { Menu, Plus, File, Upload, Download, ArrowLeft } from 'lucide-react'

import { apiFetch, BOOTSTRAP_RETRIES, BOOTSTRAP_RETRY_DELAY_MS } from './api.js'
import {
  sleep,
  loadBootstrapData,
  mapCollections,
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
import { selectShelves } from './selectors.js'

import { LibraryDataContext, useLibraryData } from './context/LibraryDataContext.jsx'
import { NavigationContext } from './context/NavigationContext.jsx'
import { useToast } from './context/ToastContext.jsx'

import useAppHotkeys from './hooks/useAppHotkeys.js'
import useReadingGoal from './hooks/useReadingGoal.js'

import Sidebar from './components/sidebar/Sidebar.jsx'
import EmptyState from './components/ui/EmptyState.jsx'
import BookDialogStage, { type Selected } from './components/dialogs/BookDialogStage.jsx'
import ScraperDialog from './components/dialogs/ScraperDialog.jsx'
import SettingsDialog from './components/dialogs/SettingsDialog.jsx'
import ReadingGoalDialog from './components/dialogs/ReadingGoalDialog.jsx'
import CommandPalette from './components/dialogs/CommandPalette.jsx'
import BookGrid from './components/books/BookGrid.jsx'

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
import type { Book, Collection, RawCollection, VaultAction } from './types.js'

// Pages with a Back link and where it lands when there's no history.
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

  const [books, setBooks] = useState<Book[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [vaultBusy, setVaultBusy] = useState<VaultAction | null>(null)
  const [showScraperDialog, setShowScraperDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showGoalDialog, setShowGoalDialog] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Temporary A/B of the active-nav style (⌥⌘G); delete this and the loser's CSS once picked.
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

            setBooks(data.books)
            setCollections(data.collections)
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

  async function reloadAppData(): Promise<Book[]> {
    const data = await loadBootstrapData()

    setBooks(data.books)
    setCollections(data.collections)
    return data.books
  }

  const applyBook = useCallback((book: Book) => {
    setBooks((current) => (
      current.some((item) => item.id === book.id)
        ? current.map((item) => (item.id === book.id ? book : item))
        : [...current, book]
    ))
  }, [])

  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books])
  const booksByIds = useCallback(
    (ids: string[]): Book[] => ids.map((id) => bookById.get(id)).filter((b): b is Book => Boolean(b)),
    [bookById],
  )
  const { currentlyReading, wantToRead, finished, dnf } = useMemo(() => selectShelves(books), [books])

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

  // Hopping between drilldowns keeps the original return target, so Back leaves the drilldown.
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
  // A sidebar destination, not a drilldown, so previousView stays untouched.
  const openWantToRead = () => {
    setView('want-to-read')
    setMobileNav(false)
  }

  // Top-level jump: leaves previousView alone but dismisses anything open on top.
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

  // Every collection route answers with the full list, ids only, so this is
  // cheap and leaves nothing to merge.
  async function sendCollections(path: string, method: string, body?: object) {
    const data = await apiFetch<{ id?: number; collections?: RawCollection[] }>(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const next = mapCollections(data.collections)
    setCollections(next)
    return { createdId: String(data.id ?? ''), next }
  }

  async function createCollection(): Promise<Collection | undefined> {
    const { createdId, next } = await sendCollections('/collections', 'POST', {
      name: nextCollectionName(collections),
    })
    setView(`collection:${createdId}`)
    return next.find((collection) => collection.id === createdId)
  }

  async function renameCollection(collection: Collection, name: string): Promise<void> {
    await sendCollections(`/collections/${collection.id}`, 'PATCH', { name })
  }

  async function setCollectionIcon(collection: Collection, icon: string): Promise<void> {
    await sendCollections(`/collections/${collection.id}`, 'PATCH', { icon })
  }

  async function deleteCollection(collection: Collection): Promise<void> {
    await sendCollections(`/collections/${collection.id}`, 'DELETE')
    if (view === `collection:${collection.id}`) {
      setView('library')
    }
  }

  async function addBookToCollection(collectionId: string, bookId: string): Promise<void> {
    await sendCollections(`/collections/${collectionId}/books`, 'POST', { book_id: bookId })
  }

  async function removeBookFromCollection(collectionId: string, bookId: string): Promise<void> {
    await sendCollections(`/collections/${collectionId}/books/${bookId}`, 'DELETE')
  }

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
    books,
    collections,
    currentlyReading,
    wantToRead,
    finished,
    dnf,
    readingGoal,
    booksByIds,
    applyBook,
    refreshLibrary: reloadAppData,
    addBookToCollection,
    removeBookFromCollection,
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

  // Built only while the palette is open; several entries close over changing vault state.
  const commands = showPalette
    ? buildCommands({
      collections,
      vaultBusy,
      goTo,
      onAddBook: openScraperDialog,
      onNewCollection: async () => { await createCollection() },
      onRefresh: async () => { await reloadAppData() },
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
              onSuccess={(newBook) => {
                const book = normaliseBook(newBook)
                setShowScraperDialog(false)
                applyBook(book)
                setSelected({ book })
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
