import { useState, useEffect, useRef } from 'react'
import {
  BookOpen,
  Library,
  Bookmark,
  CheckCircle2,
  Flame,
  Plus,
  Search,
  Menu,
  Clock3,
  Star,
  X,
  RefreshCcw,
  Heart,
  FileText,
  MessageSquareText,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

const BASE = '/api'

async function apiFetch(path, options) {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    let detail = ''
    try {
      const payload = await res.json()
      detail = payload?.detail ? `: ${payload.detail}` : ''
    } catch {
      detail = ''
    }
    throw new Error(`API ${path} -> ${res.status}${detail}`)
  }
  return res.json()
}

function collectionIdFromName(name) {
  return encodeURIComponent(name)
}

function mapReadingLists(rawLists) {
  return rawLists.map((list) => ({
    id: collectionIdFromName(list.name),
    name: list.name,
    description: '',
    bookIds: (list.book_ids || []),
    books: (list.books || []).map(normaliseBook),
  }))
}

function nextCollectionName(collections) {
  const existing = new Set(collections.map((collection) => collection.name.trim().toLowerCase()))
  let index = 1
  while (existing.has(`collection ${index}`)) index += 1
  return `Collection ${index}`
}

function formatCompactNumber(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return '0'
  const compact = (divisor, suffix) => {
    const truncated = Math.floor((Math.abs(num) / divisor) * 10) / 10
    const text = truncated % 1 === 0 ? String(truncated.toFixed(0)) : String(truncated.toFixed(1))
    return `${num < 0 ? '-' : ''}${text}${suffix}`
  }
  if (num >= 1_000_000_000) return compact(1_000_000_000, 'B')
  if (num >= 1_000_000) return compact(1_000_000, 'M')
  if (num >= 1_000) return compact(1_000, 'K')
  return `${Math.round(num)}`
}

function rgbToHsl(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case rn:
        h = ((gn - bn) / delta) % 6
        break
      case gn:
        h = (bn - rn) / delta + 2
        break
      default:
        h = (rn - gn) / delta + 4
        break
    }
    h *= 60
    if (h < 0) h += 360
  }

  return [h, s, l]
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let [r1, g1, b1] = [0, 0, 0]

  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0]
  else if (hp < 2) [r1, g1, b1] = [x, c, 0]
  else if (hp < 3) [r1, g1, b1] = [0, c, x]
  else if (hp < 4) [r1, g1, b1] = [0, x, c]
  else if (hp < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]

  const m = l - c / 2
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ]
}

function buildHeroGlow(color, fallback = 'oklch(0.62 0.14 250)') {
  const raw = String(color || '').trim()
  const rgbMatch = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)$/i)
  if (rgbMatch) {
    const r = Math.min(255, Number(rgbMatch[1]))
    const g = Math.min(255, Number(rgbMatch[2]))
    const b = Math.min(255, Number(rgbMatch[3]))
    const [h, s, l] = rgbToHsl(r, g, b)
    const warmHue = l < 0.45 ? (h + 18) % 360 : h
    const vivid = hslToRgb(warmHue, Math.min(1, Math.max(0.65, s * 1.2)), Math.min(0.68, Math.max(0.44, l + 0.2)))
    const highlight = hslToRgb(warmHue, Math.min(1, Math.max(0.5, s * 0.95)), Math.min(0.84, Math.max(0.62, l + 0.34)))
    const shadow = hslToRgb(warmHue, Math.min(1, Math.max(0.5, s)), Math.max(0.18, l * 0.45))
    return [
      `radial-gradient(circle at 28% 26%, rgba(${vivid[0]}, ${vivid[1]}, ${vivid[2]}, 0.72), rgba(${vivid[0]}, ${vivid[1]}, ${vivid[2]}, 0) 60%)`,
      `radial-gradient(circle at 74% 70%, rgba(${highlight[0]}, ${highlight[1]}, ${highlight[2]}, 0.56), rgba(${highlight[0]}, ${highlight[1]}, ${highlight[2]}, 0) 68%)`,
      `radial-gradient(circle at 52% 78%, rgba(${shadow[0]}, ${shadow[1]}, ${shadow[2]}, 0.42), rgba(${shadow[0]}, ${shadow[1]}, ${shadow[2]}, 0) 72%)`,
    ].join(', ')
  }

  if (raw) return raw
  return fallback
}

function buildDialogGlow(color, fallback = 'oklch(0.62 0.14 250)') {
  const raw = String(color || '').trim()
  const rgbMatch = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)$/i)
  if (rgbMatch) {
    const r = Math.min(255, Number(rgbMatch[1]))
    const g = Math.min(255, Number(rgbMatch[2]))
    const b = Math.min(255, Number(rgbMatch[3]))
    const [h, s, l] = rgbToHsl(r, g, b)
    const warmHue = l < 0.45 ? (h + 14) % 360 : h
    const mid = hslToRgb(warmHue, Math.min(1, Math.max(0.45, s * 0.72)), Math.min(0.72, Math.max(0.46, l + 0.16)))
    const fade = hslToRgb(warmHue, Math.min(1, Math.max(0.35, s * 0.55)), Math.max(0.24, l * 0.52))
    return [
      `radial-gradient(circle at 22% 18%, rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, 0.38), rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, 0) 60%)`,
      `radial-gradient(circle at 78% 74%, rgba(${fade[0]}, ${fade[1]}, ${fade[2]}, 0.24), rgba(${fade[0]}, ${fade[1]}, ${fade[2]}, 0) 75%)`,
    ].join(', ')
  }

  if (raw) return raw
  return fallback
}

function normaliseBook(raw) {
  const totalPages = raw.reading_total_pages || raw.total_pages || 0
  const currentPage = raw.reading_current_page || raw.current_page || 0
  const progress =
    totalPages > 0 ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0

  const status = raw.reading_status || raw.status || 'not_started'
  const genres = Array.isArray(raw.genres) ? raw.genres.filter(Boolean) : []
  const primaryGenre = raw.genre || genres[0] || ''
  const rating = parseFloat(raw.avg_rating ?? raw.book_rating) || 0
  const pages = raw.page_count || raw.total_pages || raw.reading_total_pages || totalPages
  const reviewCount = parseInt(raw.review_count ?? raw.book_review_count ?? 0, 10) || 0
  const ratingCount = parseInt(raw.rating_count ?? raw.book_rating_count ?? 0, 10) || 0

  return {
    id: raw.id || raw.uid || '',
    catalogUid: raw.catalog_uid || raw.uid || '',
    title: raw.title || 'Untitled',
    author: raw.author || '',
    cover: raw.cover || raw.image_url || '',
    color: raw.color || raw.linked_catalog_book?.color || '',
    tint: '220 30% 45%', // neutral fallback tint — image_url is used for actual cover art
    genre: primaryGenre,
    genres,
    pages,
    totalPages,
    currentPage,
    startDate: raw.reading_start_date || raw.start_date || '',
    finishDate: raw.reading_finish_date || raw.finish_date || '',
    rating,
    reviewCount,
    ratingCount,
    progress,
    status,
    format: [], // not tracked in our dataset; omit audio badge
    blurb: raw.description || '',
    // keep raw fields for completeness
    _raw: raw,
  }
}

function getCatalogBookId(book) {
  const raw = book?._raw || book || {}
  const linked = raw.linked_catalog_book || {}
  return [
    raw.catalog_uid,
    book?.catalogUid,
    linked.uid,
    linked.id,
    raw.id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)[0] || ''
}

function normalizeIdentityText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function resolveSavedWantToReadBook(book, savedBooks) {
  const targetId = getCatalogBookId(book)
  if (!targetId) return null
  return (savedBooks || []).find((savedBook) => getCatalogBookId(savedBook) === targetId) || null
}

// ---------------------------------------------------------------------------
// Static navigation metadata (no data dependency)
// ---------------------------------------------------------------------------

const viewMeta = {
  'reading-now': { title: 'Reading Now', subtitle: 'Pick up where you left off.' },
  library: { title: 'Library', subtitle: 'Everything on your shelves.' },
  search: { title: 'Search', subtitle: 'Find a book by title or author.' },
  'want-to-read': { title: 'Want to Read', subtitle: 'Saved for a rainy day.' },
  finished: { title: 'Finished', subtitle: "Books you've loved and closed." },
}

const mainNav = [
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'search', label: 'Search', icon: SearchIcon },
]

const shelfNav = [
  { id: 'reading-now', label: 'Reading Now', icon: BookOpenIcon },
  { id: 'want-to-read', label: 'Want to Read', icon: BookmarkIcon },
  { id: 'finished', label: 'Finished', icon: CheckIcon },
]

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function App() {
  const [view, setView] = useState('reading-now')
  const [mobileNav, setMobileNav] = useState(false)
  const [selected, setSelected] = useState(null)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(null)

  // Live data from the API
  const [books, setBooks] = useState([])
  const [collections, setCollections] = useState([])
  const [wantToReadBookIds, setWantToReadBookIds] = useState([])
  const [wantToReadBooks, setWantToReadBooks] = useState([])
  const [globalLibrary, setGlobalLibrary] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showScraperDialog, setShowScraperDialog] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [myBooksRes, listsRes, wantToReadRes, globalRes] = await Promise.all([
          apiFetch('/my-books'),
          apiFetch('/reading-lists'),
          apiFetch('/want-to-read-books'),
          apiFetch('/global-library'),
        ])

        if (cancelled) return

        const normalisedBooks = (myBooksRes.books || []).map(normaliseBook)
        setBooks(normalisedBooks)

        setCollections(mapReadingLists(listsRes.lists || []))
        setWantToReadBookIds(wantToReadRes.book_ids || [])
        setWantToReadBooks((wantToReadRes.books || []).map(normaliseBook))
        setGlobalLibrary(globalRes.genres || [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  async function reloadAppData() {
    const [myBooksRes, listsRes, wantToReadRes, globalRes] = await Promise.all([
      apiFetch('/my-books'),
      apiFetch('/reading-lists'),
      apiFetch('/want-to-read-books'),
      apiFetch('/global-library'),
    ])

    const normalisedBooks = (myBooksRes.books || []).map(normaliseBook)
    setBooks(normalisedBooks)
    setCollections(mapReadingLists(listsRes.lists || []))
    setWantToReadBookIds(wantToReadRes.book_ids || [])
    setWantToReadBooks((wantToReadRes.books || []).map(normaliseBook))
    setGlobalLibrary(globalRes.genres || [])
  }

  // Derived views from live books
  const bookById = new Map(books.map((b) => [b.id, b]))
  const booksByIds = (ids) => ids.map((id) => bookById.get(id)).filter(Boolean)
  const currentlyReading = books.filter((b) => b.status === 'reading')
  const savedWantToReadIds = new Set(wantToReadBookIds)
  const wantToRead = wantToReadBooks
  const finished = books.filter((b) => b.status === 'done')
  const heroBook = currentlyReading[0] || books[0] || null

  const activeCollection = view.startsWith('collection:')
    ? collections.find((c) => `collection:${c.id}` === view)
    : null
  const meta = activeCollection ? activeCollection : viewMeta[view]
  const openBookDialog = (book) => setSelected({ book, variant: 'standard' })
  const openFinishedBookDialog = (book) => setSelected({ book, variant: 'finished', preferLiveStatus: true })

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
    setError(null)
    try {
      await apiFetch('/sync/obsidian?dry_run=false', {
        method: 'POST',
      })
      await reloadAppData()
    } catch (err) {
      setError(err.message || 'Could not sync from Obsidian.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className={'appRoot'}>
      <div className="hearthShell">
        <Sidebar
          active={view}
          collections={collections}
          onCreateCollection={createCollection}
          onRenameCollection={renameCollection}
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
                <MenuIcon />
              </button>
              <div>
                <h1>{meta.title || meta.name}</h1>
                <p>{meta.subtitle || meta.description}</p>
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
                  <SyncIcon spinning={syncing} />
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
                  <PlusIcon />
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
                    <TrashIcon />
                  </button>
              )}
            </div>
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
                onOpenReadingNow={openFinishedBookDialog}
                onOpenSidebar={() => setMobileNav(true)}
                onSelectView={setView}
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

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({ active, collections, onSelect, onCreateCollection, onRenameCollection }) {
  const [editingId, setEditingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [collectionError, setCollectionError] = useState('')
  const [saving, setSaving] = useState(false)

  const startRename = (collection) => {
    setEditingId(collection.id)
    setDraftName(collection.name)
    setCollectionError('')
  }

  const finishRename = async (collection) => {
    const clean = draftName.trim().replace(/\s+/g, ' ')
    if (clean === collection.name) {
      setEditingId(null)
      setCollectionError('')
      return
    }
    if (!clean) {
      setCollectionError('Collection name is required.')
      return
    }
    if (collections.some((item) => item.id !== collection.id && item.name.toLowerCase() === clean.toLowerCase())) {
      setCollectionError('Collection names must be unique.')
      return
    }

    setSaving(true)
    try {
      await onRenameCollection(collection, clean)
      setEditingId(null)
      setCollectionError('')
    } catch (err) {
      setCollectionError(err.message || 'Could not rename collection.')
    } finally {
      setSaving(false)
    }
  }

  const createCollection = async () => {
    setSaving(true)
    setCollectionError('')
    try {
      const createdName = await onCreateCollection()
      setEditingId(collectionIdFromName(createdName))
      setDraftName(createdName)
    } catch (err) {
      setCollectionError(err.message || 'Could not create collection.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="sidebar paperGrain">
      <div className="brand">
        <div className="brandMark">
          <FlameIcon />
        </div>
        <div>
          <p className="brandName">Bookscape</p>
          <p className="brandTag">your reading corner</p>
        </div>
      </div>

      <section className="navSection">
        <p className="sectionLabel">Home</p>
        {mainNav.map((item) => (
          <NavButton key={item.id} item={item} active={active === item.id} onSelect={onSelect} />
        ))}
      </section>

      <section className="navSection">
        <p className="sectionLabel">My Shelves</p>
        {shelfNav.map((item) => (
          <NavButton key={item.id} item={item} active={active === item.id} onSelect={onSelect} />
        ))}
      </section>

      <section className="navSection collectionsSection">
        <div className="sectionHeader">
          <p className="sectionLabel">Collections</p>
          <button className="plusButton" aria-label="New collection" onClick={createCollection} disabled={saving}>
            <PlusIcon />
          </button>
        </div>
        <div className="collectionList">
          {collections.map((collection) => {
            const id = `collection:${collection.id}`
            const isActive = active === id
            const isEditing = editingId === collection.id
            const bookCount = (collection.books?.length ?? collection.bookIds?.length ?? 0)
            return (
              <div
                key={collection.id}
                role="button"
                tabIndex={0}
                className={isActive ? 'collectionButton active' : 'collectionButton'}
                onClick={() => onSelect(id)}
                onKeyDown={(event) => {
                  if (isEditing) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(id)
                  }
                }}
              >
                <span className="collectionDot" />
                {isEditing ? (
                  <form
                    className="collectionEditForm"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onSubmit={(event) => {
                      event.preventDefault()
                      finishRename(collection)
                    }}
                  >
                    <input
                      className="collectionNameInput"
                      value={draftName}
                      autoFocus
                      disabled={saving}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={(event) => {
                        if (event.currentTarget.dataset.cancelRename === 'true') return
                        finishRename(collection)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.currentTarget.dataset.cancelRename = 'true'
                          setEditingId(null)
                          setCollectionError('')
                        }
                      }}
                      aria-label={`Rename ${collection.name}`}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="collectionNameButton"
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      startRename(collection)
                    }}
                  >
                    {collection.name}
                  </button>
                )}
                <span className="collectionCount">{`(${bookCount})`}</span>
              </div>
            )
          })}
        </div>
        {collectionError && <p className="collectionError">{collectionError}</p>}
      </section>
    </aside>
  )
}

function NavButton({ item, active, onSelect }) {
  const Icon = item.icon
  return (
    <button className={active ? 'navButton active' : 'navButton'} onClick={() => onSelect(item.id)}>
      <Icon />
      <span>{item.label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// View routing
// ---------------------------------------------------------------------------

function ViewContent({
  view,
  activeCollection,
  onOpen,
  onOpenReadingNow,
  onOpenSidebar,
  onSelectView,
  onSearch,
  onRemoveFromCollection,
  collections,
  books,
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
}) {
  if (activeCollection) {
    return (
      <BookGrid
        books={activeCollection.books?.length ? activeCollection.books : booksByIds(activeCollection.bookIds)}
        onOpen={onOpen}
        showRemoveButton
        removeLabel={activeCollection.name}
        onRemove={(bookId) => onRemoveFromCollection(activeCollection.name, bookId)}
      />
    )
  }

  if (view === 'reading-now') {
    return (
      <div className="stack">
        {currentlyReading.length > 0 && <ReadingNowHero books={currentlyReading} onOpen={onOpenReadingNow} />}
        <Shelf title="Up next" subtitle="Saved for the right moment." books={wantToRead.slice(0, 6)} onOpen={onOpen} />
        {collections
          .filter((collection) => (collection.books?.length || collection.bookIds?.length || 0) > 0)
          .map((collection) => (
            <Shelf
              key={collection.id}
              title={collection.name}
              subtitle="Collection"
              books={collection.books?.length ? collection.books : booksByIds(collection.bookIds)}
              onOpen={onOpen}
            />
          ))}
      </div>
    )
  }

  if (view === 'library') {
    if (!globalLibrary || globalLibrary.length === 0) {
      return <div className="emptyState"><p>Loading library...</p></div>
    }
    return (
      <div className="stack">
        {globalLibrary.map((genreSection) => (
          <Shelf
            key={genreSection.genre}
            title={genreSection.genre}
            books={genreSection.books}
            onOpen={onOpen}
          />
        ))}
      </div>
    )
  }

  if (view === 'search') {
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
        onOpenSidebar={onOpenSidebar}
        onGoLibrary={() => onSelectView('library')}
      />
    )
  }

  if (view === 'want-to-read') return <BookGrid books={wantToRead} onOpen={onOpen} />
  if (view === 'finished') return <BookGrid books={finished} onOpen={onOpen} />
  return null
}

// ---------------------------------------------------------------------------
// UI components (unchanged from original)
// ---------------------------------------------------------------------------

function ReadingNowHero({ books, onOpen }) {
  const [currentIndex, setCurrentIndex] = useState(0)

  if (!books || books.length === 0) return null

  // In case the list shrinks
  const safeIndex = currentIndex >= books.length ? 0 : currentIndex
  const book = books[safeIndex]

  const nextBook = () => setCurrentIndex((i) => (i + 1) % books.length)
  const prevBook = () => setCurrentIndex((i) => (i - 1 + books.length) % books.length)

  const pagesLeft = Math.round((book.pages * (100 - book.progress)) / 100)
  const heroGlowColor = buildHeroGlow(book.color || `hsl(${book.tint})`)

  return (
    <section className="heroCard paperGrain">
      <div className="heroGlow" style={{ '--hero-glow': heroGlowColor }} />
      <div className="heroInner">
        <button className="heroCover" onClick={() => onOpen(book)}>
          <BookCover book={book} glow />
        </button>
        <div className="heroCopy">
          <div className="heroHeader">
            <span className="pill">
              <ClockIcon />
              Continue reading
            </span>
            {books.length > 1 && (
              <div className="carouselControls">
                <button className="carouselButton" onClick={prevBook} aria-label="Previous book">
                  <ChevronLeftIcon />
                </button>
                <button className="carouselButton" onClick={nextBook} aria-label="Next book">
                  <ChevronRightIcon />
                </button>
              </div>
            )}
          </div>
          <h2>{book.title}</h2>
          <p className="bookMeta">
            {book.author} · {book.genre}
          </p>
          <p className="heroBlurb">{book.blurb}</p>
          <div className="progressBlock">
            <div>
              <span>{book.progress}%</span>
              <span>{pagesLeft} pages left</span>
            </div>
            <Progress value={book.progress} />
          </div>
        </div>
      </div>
    </section>
  )
}

function Shelf({ title, subtitle, books, onOpen }) {
  if (!books.length) return null

  return (
    <section className="shelf">
      <div className="shelfHeader">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button>See all</button>
      </div>
      <div className="shelfScroll">
        {books.map((book) => (
          <BookCard key={book.id} book={book} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

function BookGrid({ books, onOpen, showRemoveButton = false, removeLabel = '', onRemove }) {
  if (!books.length) {
    return (
      <div className="emptyState">
        <h2>Nothing on this shelf yet</h2>
        <p>Try a different shelf or search for a title you already love.</p>
      </div>
    )
  }

  return (
    <div className="bookGrid">
      {books.map((book) => (
        <BookCard
          key={book.id}
          book={book}
          onOpen={onOpen}
          showRemoveButton={showRemoveButton}
          removeLabel={removeLabel}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

function SearchView({ draft, query, results, loading, error, onDraftChange, onSearch, onOpen }) {
  const inputRef = useRef(null)

  const submitSearch = async (event) => {
    event.preventDefault()
    await onSearch(draft)
  }

  if (loading) {
    return (
      <div className="stack">
        <SearchHeader draft={draft} onDraftChange={onDraftChange} onSubmit={submitSearch} inputRef={inputRef} />
        <SearchLanding title={`Searching for “${query}”`} body="Finding matches across the catalog." />
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
      <SearchLanding
        title={`Results for “${query}”`}
        body={`${results.length} matching ${results.length === 1 ? 'book' : 'books'}`}
      />
      {results.length > 0 ? (
        <BookGrid books={results} onOpen={onOpen} />
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
        <SearchIcon />
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

function BookCard({ book, onOpen, showRemoveButton = false, removeLabel = '', onRemove }) {
  const card = (
    <button className="bookCard" onClick={() => onOpen(book)}>
      <div className="coverWrap">
        <BookCover book={book} />
        {book.progress > 0 && book.progress < 100 && (
          <div className="coverProgress">
            <Progress value={book.progress} />
          </div>
        )}
      </div>
      <strong>{book.title}</strong>
      <span>{book.author}</span>
    </button>
  )

  if (!showRemoveButton || !onRemove) return card

  return (
    <div className="bookCardWrap">
      {showRemoveButton && onRemove && (
        <button
          type="button"
          className="collectionRemoveButton"
          aria-label={`Remove ${book.title} from ${removeLabel || 'this collection'}`}
          title={`Remove from ${removeLabel || 'collection'}`}
          onClick={(event) => {
            event.stopPropagation()
            onRemove(book.id)
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <X />
        </button>
      )}
      {card}
    </div>
  )
}

function BookCover({ book, glow = false }) {
  const coverGlowColor = buildHeroGlow(book.color || `hsl(${book.tint})`)
  return (
    <div className={glow ? 'bookCover hasGlow' : 'bookCover'} style={{ '--cover-glow': coverGlowColor }}>
      {glow && <div className="coverGlow" />}
      <div className="coverImage">
        <div className="spineShadow" />
        <img src={book.cover} alt={`Cover of ${book.title} by ${book.author}`} />
        <div className="coverSheen" />
      </div>
    </div>
  )
}

function BookDialog({
  book,
  collections,
  savedWantToReadBook,
  onAddToCollection,
  onClose,
  onOpen,
  onToggleWantToRead,
}) {
  const [fullBook, setFullBook] = useState(null)
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [savingCollection, setSavingCollection] = useState('')
  const [savingToRead, setSavingToRead] = useState(false)
  const bookId = getCatalogBookId(book)

  useEffect(() => {
    let cancelled = false
    setFullBook(null)
    if (!bookId) return () => { cancelled = true }
    apiFetch(`/book/${bookId}`)
      .then((data) => {
        if (!cancelled && data) setFullBook({ ...normaliseBook(data), similar_books: data.similar_books || [] })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [bookId])

  const displayBook = fullBook ? { ...fullBook, ...book, similar_books: fullBook.similar_books || book.similar_books || [] } : book
  const similarBooks = displayBook.similar_books || []
  const dialogGenres = (displayBook.genres && displayBook.genres.length > 0)
    ? displayBook.genres.slice(0, 5)
    : (displayBook.genre ? [displayBook.genre] : [])
  const isFinishedBook = book.status === 'done' || displayBook.status === 'done'
  const savedWantToReadKey = getCatalogBookId(savedWantToReadBook)
  const isSavedToWantToRead = Boolean(savedWantToReadBook)

  if (isFinishedBook) {
    return (
      <FinishedBookDialog
        book={displayBook}
        onClose={onClose}
      />
    )
  }

  const handleSave = async () => {
    if (!bookId || savingToRead) return
    setSavingToRead(true)
    setActionMessage('')
    try {
      const nextSaved = !isSavedToWantToRead
      await onToggleWantToRead(isSavedToWantToRead ? savedWantToReadKey : bookId, isSavedToWantToRead)
      setActionMessage(nextSaved ? 'Saved to Want to read.' : 'Removed from Want to read.')
    } catch (err) {
      setActionMessage(err.message || 'Could not save this book.')
    } finally {
      setSavingToRead(false)
    }
  }

  const handleAddToCollection = async (collectionName) => {
    if (!bookId || !collectionName || savingCollection === collectionName) return
    setSavingCollection(collectionName)
    setActionMessage('')
    try {
      await onAddToCollection(collectionName, bookId)
      setCollectionMenuOpen(false)
      setActionMessage(`Added to ${collectionName}.`)
    } catch (err) {
      setActionMessage(err.message || 'Could not add this book.')
    } finally {
      setSavingCollection('')
    }
  }

  return (
    <div className="dialogScrim" onClick={onClose}>
      <article
        className="bookDialog paperGrain"
        style={{ '--dialog-glow': buildDialogGlow(displayBook.color || `hsl(${displayBook.tint})`) }}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="dialogClose" onClick={onClose} aria-label="Close details">
          <CloseIcon />
        </button>
        <div className="dialogTop">
          <div className="dialogCover">
            <BookCover book={displayBook} glow />
          </div>
          <div className="dialogCopy">
            <h2>{displayBook.title}</h2>
            <p className="dialogAuthor">{displayBook.author}</p>

            <div className="dialogStatsRow">
              {displayBook.rating > 0 && (
                <span className="dialogStatItem">
                  <StarMiniIcon />
                  <span>{displayBook.rating.toFixed(1)}{displayBook.ratingCount > 0 ? ` (${formatCompactNumber(displayBook.ratingCount)})` : ''}</span>
                </span>
              )}
              {displayBook.reviewCount > 0 && (
                <span className="dialogStatItem">
                  <ReviewIcon />
                  <span>{formatCompactNumber(displayBook.reviewCount)}</span>
                </span>
              )}
              {displayBook.pages > 0 && (
                <span className="dialogStatItem">
                  <PagesIcon />
                  <span>{formatCompactNumber(displayBook.pages)} pages</span>
                </span>
              )}
            </div>

            {dialogGenres.length > 0 && (
              <div className="dialogGenrePills" aria-label="Genres">
                {dialogGenres.map((genre) => (
                  <span key={genre} className="dialogGenrePill">
                    {genre}
                  </span>
                ))}
              </div>
            )}

            <p className="dialogBlurb">{displayBook.blurb || displayBook.description || 'A great read from your library.'}</p>

            <div className="dialogActionPanel">
              <div className="dialogActionRow">
                <div className={collectionMenuOpen ? 'collectionMenuAnchor open' : 'collectionMenuAnchor'}>
                  <button
                    type="button"
                    className="dialogIconButton dialogCollectionButton"
                    onClick={() => setCollectionMenuOpen((value) => !value)}
                    disabled={!collections.length || !bookId}
                    aria-label="Add to collections"
                    title="Add to collections"
                    aria-expanded={collectionMenuOpen}
                  >
                    <PlusIcon />
                  </button>
                  {collectionMenuOpen && collections.length > 0 && (
                    <div className="collectionPicker" role="menu" aria-label="Add to collection">
                      {collections.map((collection) => (
                        <button
                          key={collection.id}
                          type="button"
                          className="collectionPickerItem"
                          onClick={() => handleAddToCollection(collection.name)}
                          disabled={savingCollection === collection.name}
                        >
                          <span>{collection.name}</span>
                          {savingCollection === collection.name ? <span className="collectionPickerState">Adding…</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className={isSavedToWantToRead ? 'dialogIconButton dialogSaveButton saved' : 'dialogIconButton dialogSaveButton'}
                  onClick={handleSave}
                  disabled={!bookId || savingToRead}
                  aria-label={isSavedToWantToRead ? 'Remove from Want to read' : 'Save to Want to read'}
                  title={isSavedToWantToRead ? 'Remove from Want to read' : 'Save to Want to read'}
                >
                  <HeartIcon filled={isSavedToWantToRead} />
                </button>
              </div>

              {actionMessage && <p className="dialogActionMessage">{actionMessage}</p>}
            </div>
          </div>
        </div>

        {similarBooks.length > 0 && (
          <div className="dialogSimilar">
            <h3>Similar Books</h3>
            <div className="dialogSimilarScroll">
              {similarBooks.map((simRaw) => {
                const simBook = normaliseBook(simRaw)
                return (
                  <button key={simBook.id} className="similarCard" onClick={() => { if (onOpen) onOpen(simBook) }}>
                    <BookCover book={simBook} />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </article>
    </div>
  )
}

function FinishedBookDialog({ book, preferLiveStatus = false, onClose }) {
  const [record, setRecord] = useState(null)
  const [hydrated, setHydrated] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const saveTimerRef = useRef(null)
  const lastSavedRef = useRef('')
  const statusMenuRef = useRef(null)
  const bookId = book.id || book.uid || ''
  const baseRecord = {
    status: book.status || 'not_started',
    current_page: book.currentPage || book.pages || 0,
    total_pages: book.totalPages || book.pages || 0,
    start_date: book.startDate || '',
    finish_date: book.finishDate || '',
    notes: '',
  }

  useEffect(() => {
    let cancelled = false
    setHydrated(false)
    if (!bookId) {
      setRecord(baseRecord)
      lastSavedRef.current = JSON.stringify(baseRecord)
      setHydrated(true)
      return () => { cancelled = true }
    }

    apiFetch(`/finished-books/${bookId}`)
      .then((data) => {
        if (cancelled) return
        const next = data?.entry || {}
        const nextRecord = {
          ...baseRecord,
          ...next,
        }
        if (preferLiveStatus) {
          nextRecord.status = baseRecord.status
        }
        setRecord(nextRecord)
        lastSavedRef.current = JSON.stringify(nextRecord)
        setHydrated(true)
      })
      .catch(() => {
        if (!cancelled) {
          const nextRecord = { ...baseRecord }
          if (preferLiveStatus) {
            nextRecord.status = baseRecord.status
          }
          setRecord(nextRecord)
          lastSavedRef.current = JSON.stringify(nextRecord)
          setHydrated(true)
        }
      })

    return () => { cancelled = true }
  }, [bookId, baseRecord.current_page, baseRecord.total_pages, baseRecord.start_date, baseRecord.finish_date])

  const draft = record || baseRecord
  const currentPage = Number(draft.current_page) || 0
  const totalPages = Number(draft.total_pages) || 0
  const progress = totalPages > 0
    ? Math.min(100, Math.round((currentPage / totalPages) * 100))
    : 0
  const progressLabel = totalPages > 0 ? `${formatCompactNumber(currentPage)} / ${formatCompactNumber(totalPages)} pages` : '0 / 0 pages'

  const updateField = (field, value) => {
    setRecord((current) => ({
      ...(current || baseRecord),
      [field]: value,
    }))
  }

  const persistRecord = async (nextRecord) => {
    if (!bookId) return
    try {
      const payload = {
        status: String(nextRecord.status || 'done').trim().toLowerCase() || 'done',
        current_page: Math.max(0, parseInt(nextRecord.current_page, 10) || 0),
        total_pages: Math.max(0, parseInt(nextRecord.total_pages, 10) || 0),
        start_date: String(nextRecord.start_date || '').trim(),
        finish_date: String(nextRecord.finish_date || '').trim(),
        notes: String(nextRecord.notes || '').trim(),
      }
      const data = await apiFetch(`/finished-books/${bookId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const nextSaved = { ...baseRecord, ...(data.entry || payload) }
      setRecord(nextSaved)
      lastSavedRef.current = JSON.stringify(nextSaved)
    } catch (err) {
      // Keep the draft visible; autosave will retry on the next edit.
    }
  }

  useEffect(() => {
    if (!hydrated || !record) return undefined
    const signature = JSON.stringify({
      status: String(record.status || 'done').trim().toLowerCase() || 'done',
      current_page: Number(record.current_page) || 0,
      total_pages: Number(record.total_pages) || 0,
      start_date: String(record.start_date || '').trim(),
      finish_date: String(record.finish_date || '').trim(),
      notes: String(record.notes || '').trim(),
    })

    if (signature === lastSavedRef.current) return undefined

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      persistRecord(record)
    }, 650)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [record, hydrated])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  useEffect(() => {
    function handlePointerDown(event) {
      if (!statusMenuRef.current) return
      if (!statusMenuRef.current.contains(event.target)) {
        setStatusMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const statusLabelMap = {
    done: 'Finished',
    reading: 'Reading',
    not_started: 'Want to read',
  }
  const statusDotClass = {
    done: 'finishedStatusDot done',
    reading: 'finishedStatusDot reading',
    not_started: 'finishedStatusDot notStarted',
  }[draft.status] || 'finishedStatusDot'

  return (
    <div className="dialogScrim finishedScrim" onClick={onClose}>
      <article className="bookDialog finishedBookDialog paperGrain" onClick={(event) => event.stopPropagation()}>
        <button className="dialogClose" onClick={onClose} aria-label="Close details">
          <CloseIcon />
        </button>

        <div className="finishedDialogTop">
          <div className="finishedCoverColumn">
            <div className="finishedCoverWrap">
              <BookCover book={book} glow />
            </div>
            <div className="finishedProgressRing" style={{ '--progress': `${progress}%` }}>
              <span>{progress}%</span>
            </div>
            <div className="finishedPages">
              <strong>{progressLabel}</strong>
              <span>Pages read</span>
            </div>
          </div>

          <div className="finishedCopy">
            <div className="finishedHeader">
              <div>
                <h2>{book.title}</h2>
                <p>{book.author}</p>
              </div>
            </div>

            <div className="finishedStatusRow" ref={statusMenuRef}>
              <div className={statusMenuOpen ? 'finishedStatusControl open' : 'finishedStatusControl'}>
                <button
                  type="button"
                  className="finishedStatusButton"
                  onClick={() => setStatusMenuOpen((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={statusMenuOpen}
                >
                  <span>{statusLabelMap[draft.status] || 'Finished'}</span>
                  <span className={statusDotClass} />
                  <span className="finishedStatusCaret">▾</span>
                </button>
                {statusMenuOpen && (
                  <div className="finishedStatusMenu" role="menu" aria-label="Reading status">
                    {[
                      ['done', 'Finished'],
                      ['reading', 'Reading'],
                      ['not_started', 'Want to read'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={draft.status === value ? 'finishedStatusMenuItem active' : 'finishedStatusMenuItem'}
                        role="menuitemradio"
                        aria-checked={draft.status === value}
                        onClick={() => {
                          updateField('status', value)
                          setStatusMenuOpen(false)
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="finishedPanel">
              <div className="finishedFieldRow">
                <label className="finishedField">
                  <span>Progress</span>
                  <div className="finishedFieldValue">
                    <input
                      type="number"
                      min="0"
                      value={draft.current_page}
                      onChange={(event) => updateField('current_page', event.target.value)}
                    />
                    <span>/</span>
                    <input
                      type="number"
                      min="0"
                      value={draft.total_pages}
                      onChange={(event) => updateField('total_pages', event.target.value)}
                    />
                    <span>pages</span>
                  </div>
                </label>
              </div>

              <div className="finishedFieldRow twoCol">
                <label className="finishedField">
                  <span>Start</span>
                  <input
                    type="date"
                    value={draft.start_date}
                    onChange={(event) => updateField('start_date', event.target.value)}
                  />
                </label>
                <label className="finishedField">
                  <span>End</span>
                  <input
                    type="date"
                    value={draft.finish_date}
                    onChange={(event) => updateField('finish_date', event.target.value)}
                  />
                </label>
              </div>

              <label className="finishedNotes">
                <span>Notes</span>
                <textarea
                  rows="7"
                  value={draft.notes}
                  onChange={(event) => updateField('notes', event.target.value)}
                  placeholder="Add a few thoughts, a memorable passage, or why this one mattered."
                />
              </label>
            </div>
          </div>
        </div>

      </article>
    </div>
  )
}

function ScraperDialog({ onClose, onSuccess }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setError('Please enter a URL.')
      return
    }
    if (!trimmedUrl.includes('/book/show/')) {
      setError('Please enter a valid Goodreads book URL (e.g., containing /book/show/).')
      return
    }

    setLoading(true)
    setError(null)
    setStatusMessage('Connecting to Goodreads...')

    // Set up status intervals to give the user a sense of progress during the wait
    const progressSteps = [
      { delay: 3000, message: 'Downloading book page...' },
      { delay: 8000, message: 'Extracting book metadata...' },
      { delay: 13000, message: 'Fetching similar books...' },
      { delay: 18000, message: 'Downloading cover image...' },
      { delay: 23000, message: 'Analyzing cover colors and gradients...' },
      { delay: 28000, message: 'Saving book to dataset...' }
    ]

    const timers = progressSteps.map(step => 
      setTimeout(() => setStatusMessage(step.message), step.delay)
    )

    try {
      const res = await apiFetch('/scrape-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl }),
      })
      timers.forEach(clearTimeout)
      if (res.ok && res.book) {
        onSuccess(res.book)
      } else {
        setError('Failed to import book details.')
      }
    } catch (err) {
      timers.forEach(clearTimeout)
      setError(err.message || 'An error occurred while importing the book.')
    } finally {
      setLoading(false)
      setStatusMessage('')
    }
  }

  return (
    <div className="dialogScrim" onClick={onClose}>
      <article className="bookDialog paperGrain scraperDialog" onClick={(e) => e.stopPropagation()}>
        <button className="dialogIconButton dialogClose" onClick={onClose} aria-label="Close dialog">
          <CloseIcon />
        </button>
        
        <h2>Add Book to Library</h2>
        <p className="dialogAuthor" style={{ marginBottom: '1.5rem' }}>
          Enter a Goodreads URL to crawl and import it into your Bookscape library.
        </p>

        <form onSubmit={handleSubmit} className="scraperForm">
          <div className="scraperField">
            <label htmlFor="goodreads-url" className="scraperLabel">
              Goodreads Book URL
            </label>
            <input
              id="goodreads-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              placeholder="https://www.goodreads.com/book/show/..."
              className="scraperInput"
              required
            />
          </div>

          {error && (
            <p className="scraperError">
              {error}
            </p>
          )}

          {loading && (
            <div className="scraperStatus">
              <SyncIcon spinning={true} />
              <span className="scraperStatusText">
                {statusMessage}
              </span>
            </div>
          )}

          <div className="scraperButtons">
            <button
              type="button"
              className="secondaryButton"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primaryButton"
              disabled={loading}
            >
              {loading ? 'Importing...' : 'Import'}
            </button>
          </div>
        </form>
      </article>
    </div>
  )
}

function Progress({ value }) {
  return (
    <div className="progressTrack">
      <div style={{ width: `${value}%` }} />
    </div>
  )
}

function StarRating({ value }) {
  return (
    <span className="starRating">
      <StarIcon />
      {value.toFixed(1)}
    </span>
  )
}

function BookOpenIcon() {
  return <BookOpen />
}

function LibraryIcon() {
  return <Library />
}

function BookmarkIcon() {
  return <Bookmark />
}

function CheckIcon() {
  return <CheckCircle2 />
}

function FlameIcon() {
  return <Flame />
}

function PlusIcon() {
  return <Plus />
}

function SearchIcon() {
  return <Search />
}

function MenuIcon() {
  return <Menu />
}

function ClockIcon() {
  return <Clock3 />
}

function StarIcon() {
  return <Star />
}

function CloseIcon() {
  return <X />
}

function SyncIcon({ spinning = false }) {
  return <RefreshCcw className={spinning ? 'syncIcon spinning' : 'syncIcon'} />
}

function HeartIcon({ filled = false }) {
  return filled ? <Heart fill="currentColor" /> : <Heart />
}

function StarMiniIcon() {
  return <Star />
}

function PagesIcon() {
  return <FileText />
}

function ReviewIcon() {
  return <MessageSquareText />
}

function TrashIcon() {
  return <Trash2 />
}

function ChevronLeftIcon() {
  return <ChevronLeft />
}

function ChevronRightIcon() {
  return <ChevronRight />
}
