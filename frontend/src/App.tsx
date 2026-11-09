import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Menu, Plus, Upload, Download, ArrowLeft } from 'lucide-react'

import { apiFetch, BOOTSTRAP_RETRIES, BOOTSTRAP_RETRY_DELAY_MS } from './api.js'
import {
  sleep,
  loadBootstrapData,
  nextCollectionName,
  drilldownView,
  drilldownValue,
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
import type { Book, Collection, CsvAction, DrilldownKind } from './types.js'

const CSV_FILTERS = [{ name: 'CSV', extensions: ['csv'] }]
const CSV_TOAST_KEY = 'csv'

interface Drilldown {
  // Where Back lands when there's no history.
  fallback: string
  meta: (value: string) => { title: string; subtitle?: string }
  render: (value: string) => ReactNode
}

// Pages with a Back link, keyed by the prefix of their view id.
const DRILLDOWNS: Record<DrilldownKind, Drilldown> = {
  author: {
    fallback: 'library',
    meta: (author) => ({ title: author || 'Author' }),
    render: (author) => <AuthorView author={author} />,
  },
  series: {
    fallback: 'library',
    meta: (series) => ({ title: series || 'Series' }),
    render: (series) => <SeriesView series={series} />,
  },
  genre: {
    fallback: 'library',
    meta: (genre) => ({ title: genre || 'Genre' }),
    render: (genre) => <GenreView genre={genre} />,
  },
  'books-read': {
    fallback: 'stats',
    meta: (year) => ({
      title: 'Books read',
      subtitle: year ? `Everything you finished in ${year}.` : "Everything you've ever finished.",
    }),
    render: (year) => <BooksReadView year={year} />,
  },
}

const drilldownFor = (view: string): Drilldown | undefined => DRILLDOWNS[view.split(':')[0] as DrilldownKind]

export default function App() {
  const { showToast, showError } = useToast()
  const [view, setView] = useState('reading-now')
  const [previousView, setPreviousView] = useState('reading-now')
  const [mobileNav, setMobileNav] = useState(false)
  const [selected, setSelected] = useState<Selected | null>(null)

  const [books, setBooks] = useState<Book[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [goalTarget, setGoalTarget] = useState(0)
  const [loading, setLoading] = useState(true)
  const [csvBusy, setCsvBusy] = useState<CsvAction | null>(null)
  const [showScraperDialog, setShowScraperDialog] = useState(false)
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

  function applyBootstrapData(data: Awaited<ReturnType<typeof loadBootstrapData>>) {
    setBooks(data.books)
    setCollections(data.collections)
    setGoalTarget(data.goalTarget)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      let lastError: unknown = null
      try {
        for (let attempt = 0; attempt <= BOOTSTRAP_RETRIES; attempt += 1) {
          try {
            const data = await loadBootstrapData()
            if (cancelled) return

            applyBootstrapData(data)
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

  async function reloadAppData(): Promise<void> {
    applyBootstrapData(await loadBootstrapData())
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

  const readingGoal = useReadingGoal(finished, goalTarget, setGoalTarget, loading)

  const activeCollection = view.startsWith('collection:')
    ? collections.find((c) => `collection:${c.id}` === view)
    : null
  const activeDrilldown = drilldownFor(view)
  const meta: { title: string; subtitle?: string } | undefined = activeCollection
    ? { title: activeCollection.name, subtitle: 'Kept together on purpose.' }
    : activeDrilldown
      ? activeDrilldown.meta(drilldownValue(view))
      : viewMeta[view]

  const openBookDialog = (book: Book) =>
    setSelected((prev) => ({ book, isNavigation: prev !== null }))

  // Hopping between drilldowns keeps the original return target, so Back leaves the drilldown.
  const openDrilldown = (kind: DrilldownKind, value: string) => {
    if (!value.trim() && kind !== 'books-read') return
    setPreviousView((current) => (DRILLDOWNS[kind] === activeDrilldown ? current : view))
    setSelected(null)
    setMobileNav(false)
    setView(drilldownView(kind, value))
  }
  const goBack = () => {
    if (!activeDrilldown) return
    setView(drilldownFor(previousView) === activeDrilldown ? activeDrilldown.fallback : previousView)
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
    const data = await apiFetch<{ id?: number; collections: Collection[] }>(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    setCollections(data.collections)
    return data
  }

  async function createCollection(): Promise<Collection | undefined> {
    const { id, collections: next } = await sendCollections('/collections', 'POST', {
      name: nextCollectionName(collections),
    })
    setView(`collection:${id}`)
    return next.find((collection) => collection.id === id)
  }

  async function updateCollection(collectionId: number, fields: { name?: string; icon?: string }): Promise<void> {
    await sendCollections(`/collections/${collectionId}`, 'PATCH', fields)
  }

  async function deleteCollection(collection: Collection): Promise<void> {
    await sendCollections(`/collections/${collection.id}`, 'DELETE')
    if (view === `collection:${collection.id}`) {
      setView('library')
    }
  }

  async function addBookToCollection(collectionId: number, bookId: string): Promise<void> {
    await sendCollections(`/collections/${collectionId}/books`, 'POST', { book_id: bookId })
  }

  async function removeBookFromCollection(collectionId: number, bookId: string): Promise<void> {
    await sendCollections(`/collections/${collectionId}/books/${bookId}`, 'DELETE')
  }

  async function importCsv() {
    if (csvBusy) return
    setCsvBusy('import')
    try {
      const { open } = await import('@tauri-apps/api/dialog')
      const path = await open({ multiple: false, filters: CSV_FILTERS })
      if (typeof path !== 'string') return
      const { imported, skipped } = await apiFetch<{ imported: number; skipped: { row: number; reason: string }[] }>(
        '/csv/import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        },
      )
      await reloadAppData()
      const skippedNote = skipped.length
        ? ` Skipped ${skipped.length} (row ${skipped[0].row}: ${skipped[0].reason}).`
        : ''
      showToast(`Imported ${imported} books from CSV.${skippedNote}`, { key: CSV_TOAST_KEY })
    } catch (err) {
      showError(err, 'Could not import the CSV.', CSV_TOAST_KEY)
    } finally {
      setCsvBusy(null)
    }
  }

  async function exportCsv() {
    if (csvBusy) return
    setCsvBusy('export')
    try {
      const { save } = await import('@tauri-apps/api/dialog')
      const path = await save({ defaultPath: 'bookscape-library.csv', filters: CSV_FILTERS })
      if (!path) return
      const { exported } = await apiFetch<{ exported: number }>('/csv/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      showToast(`Exported ${exported} books to CSV.`, { key: CSV_TOAST_KEY })
    } catch (err) {
      showError(err, 'Could not export the CSV.', CSV_TOAST_KEY)
    } finally {
      setCsvBusy(null)
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
    addBookToCollection,
    removeBookFromCollection,
    createCollection,
    updateCollection,
    deleteCollection,
  }

  const navigation = {
    onOpen: openBookDialog,
    onOpenDrilldown: openDrilldown,
    onOpenWantToRead: openWantToRead,
    onEditReadingGoal: () => setShowGoalDialog(true),
  }

  // Built only while the palette is open; several entries close over changing CSV state.
  const commands = showPalette
    ? buildCommands({
      collections,
      csvBusy,
      goTo,
      onAddBook: openScraperDialog,
      onNewCollection: async () => { await createCollection() },
      onRefresh: reloadAppData,
      onImportCsv: importCsv,
      onExportCsv: exportCsv,
    })
    : []

  return (
    <LibraryDataContext.Provider value={libraryData}>
      <NavigationContext.Provider value={navigation}>
        <div className="appRoot">
          <div className="iconPill">
            <button className="iconPillButton" aria-label="Import from CSV" title="Import from CSV" onClick={importCsv} disabled={csvBusy !== null}>
              <Upload className={csvBusy === 'import' ? 'syncIcon spinning' : 'syncIcon'} />
            </button>
            <button className="iconPillButton" aria-label="Export to CSV" title="Export to CSV" onClick={exportCsv} disabled={csvBusy !== null}>
              <Download className={csvBusy === 'export' ? 'syncIcon spinning' : 'syncIcon'} />
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
                    {activeDrilldown && (
                      <button type="button" className="kickerLink" onClick={goBack}>
                        <ArrowLeft size={14} />
                        Back
                      </button>
                    )}
                    <h1>{meta?.title}</h1>
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
              onSuccess={(book) => {
                setShowScraperDialog(false)
                applyBook(book)
                setSelected({ book })
              }}
            />
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

  const drilldown = drilldownFor(view)
  if (drilldown) return drilldown.render(drilldownValue(view))

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
      return null
  }
}
