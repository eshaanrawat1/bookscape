import { useState, useEffect, useRef } from 'react'

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
    title: raw.title || 'Untitled',
    author: raw.author || '',
    cover: raw.cover || raw.image_url || '',
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

function getBookIdentityCandidates(book) {
  const raw = book?._raw || book || {}
  const linked = raw.linked_dataset_book || {}
  return [
    raw.id,
    raw.uid,
    book?.id,
    book?.uid,
    linked.id,
    linked.uid,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
}

function normalizeIdentityText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function resolveSavedWantToReadBook(book, savedBooks) {
  const candidates = getBookIdentityCandidates(book)
  const candidateSet = new Set(candidates)
  const targetTitle = normalizeIdentityText(book?.title)
  const targetAuthor = normalizeIdentityText(book?.author)

  return (savedBooks || []).find((savedBook) => {
    const savedCandidates = getBookIdentityCandidates(savedBook)
    if (savedCandidates.some((id) => candidateSet.has(id))) return true
    return (
      normalizeIdentityText(savedBook?.title) === targetTitle &&
      normalizeIdentityText(savedBook?.author) === targetAuthor &&
      targetTitle &&
      targetAuthor
    )
  }) || null
}

// ---------------------------------------------------------------------------
// Static navigation metadata (no data dependency)
// ---------------------------------------------------------------------------

const viewMeta = {
  'reading-now': { title: 'Reading Now', subtitle: 'Pick up where you left off.' },
  library: { title: 'Library', subtitle: 'Everything on your shelves.' },
  'want-to-read': { title: 'Want to Read', subtitle: 'Saved for a rainy day.' },
  finished: { title: 'Finished', subtitle: "Books you've loved and closed." },
}

const mainNav = [
  { id: 'library', label: 'Library', icon: LibraryIcon },
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

  // Live data from the API
  const [books, setBooks] = useState([])
  const [collections, setCollections] = useState([])
  const [wantToReadBookIds, setWantToReadBookIds] = useState([])
  const [wantToReadBooks, setWantToReadBooks] = useState([])
  const [globalLibrary, setGlobalLibrary] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
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
                onOpen={setSelected}
                books={books}
                booksByIds={booksByIds}
                currentlyReading={currentlyReading}
                wantToRead={wantToRead}
                finished={finished}
                globalLibrary={globalLibrary}
              />
            )}
          </div>
        </main>
      </div>

      {selected && (
      <BookDialog
        key={selected.id || selected.uid}
        book={selected}
        collections={collections}
        savedWantToReadBook={resolveSavedWantToReadBook(selected, wantToReadBooks)}
        onAddToCollection={addBookToCollection}
        onClose={() => setSelected(null)}
        onOpen={setSelected}
        onToggleWantToRead={toggleBookWantToRead}
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

function ViewContent({ view, activeCollection, onOpen, books, booksByIds, currentlyReading, wantToRead, finished, globalLibrary }) {
  if (activeCollection) {
    return <BookGrid books={booksByIds(activeCollection.bookIds)} onOpen={onOpen} />
  }

  if (view === 'reading-now') {
    return (
      <div className="stack">
        {currentlyReading.length > 0 && <ReadingNowHero books={currentlyReading} onOpen={onOpen} />}
        <Shelf title="Up next" subtitle="Saved for the right moment." books={wantToRead.slice(0, 6)} onOpen={onOpen} />
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

  return (
    <section className="heroCard paperGrain">
      <div className="heroGlow" style={{ background: `hsl(${book.tint} / 0.6)` }} />
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

function BookGrid({ books, onOpen }) {
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
        <BookCard key={book.id} book={book} onOpen={onOpen} />
      ))}
    </div>
  )
}

function BookCard({ book, onOpen }) {
  return (
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
}

function BookCover({ book, glow = false }) {
  return (
    <div className={glow ? 'bookCover hasGlow' : 'bookCover'} style={{ '--cover-glow': `hsl(${book.tint} / 0.55)` }}>
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
  const identityCandidates = getBookIdentityCandidates(book)
  const bookId = identityCandidates[0] || ''

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
  const savedWantToReadKey = savedWantToReadBook ? (savedWantToReadBook.id || savedWantToReadBook.uid || '') : ''
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
      <article className="bookDialog paperGrain" onClick={(event) => event.stopPropagation()}>
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
                  <button key={simBook.id} className="similarCard" onClick={() => { if (onOpen) onOpen(simRaw) }}>
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

function FinishedBookDialog({ book, onClose }) {
  const [record, setRecord] = useState(null)
  const [hydrated, setHydrated] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const saveTimerRef = useRef(null)
  const lastSavedRef = useRef('')
  const statusMenuRef = useRef(null)
  const bookId = book.id || book.uid || ''
  const baseRecord = {
    status: 'done',
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
        setRecord(nextRecord)
        lastSavedRef.current = JSON.stringify(nextRecord)
        setHydrated(true)
      })
      .catch(() => {
        if (!cancelled) {
          setRecord(baseRecord)
          lastSavedRef.current = JSON.stringify(baseRecord)
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
                  <span className="finishedStatusDot" />
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

// ---------------------------------------------------------------------------
// Icons (unchanged from original)
// ---------------------------------------------------------------------------

function Icon({ children }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function BookOpenIcon() {
  return (
    <Icon>
      <path d="M12 7v14" />
      <path d="M3 5.5A3.5 3.5 0 0 1 6.5 2H12v19H6.5A3.5 3.5 0 0 0 3 17.5z" />
      <path d="M21 5.5A3.5 3.5 0 0 0 17.5 2H12v19h5.5a3.5 3.5 0 0 1 3.5-3.5z" />
    </Icon>
  )
}

function LibraryIcon() {
  return (
    <Icon>
      <path d="M4 19V5" />
      <path d="M8 19V5" />
      <path d="M12 19V5" />
      <path d="m17 5 3 14" />
    </Icon>
  )
}

function HeadphonesIcon() {
  return (
    <Icon>
      <path d="M3 14a9 9 0 0 1 18 0" />
      <path d="M5 14v4a2 2 0 0 0 2 2h1v-8H7a2 2 0 0 0-2 2z" />
      <path d="M19 14v4a2 2 0 0 1-2 2h-1v-8h1a2 2 0 0 1 2 2z" />
    </Icon>
  )
}

function BookmarkIcon() {
  return (
    <Icon>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </Icon>
  )
}

function CheckIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </Icon>
  )
}

function FlameIcon() {
  return (
    <Icon>
      <path d="M8.5 14.5A3.5 3.5 0 0 0 12 18a3.5 3.5 0 0 0 3.5-3.5c0-1.7-.9-2.7-2.2-4.1C12 9 11.4 7.7 12.2 5c-3 1.7-5.2 4.5-5.2 7.5a5 5 0 0 0 10 0" />
    </Icon>
  )
}

function PlusIcon() {
  return (
    <Icon>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  )
}

function MoonIcon() {
  return (
    <Icon>
      <path d="M20 14.2A7 7 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2z" />
    </Icon>
  )
}

function SunIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.3 17.7-1.4 1.4" />
      <path d="m19.1 4.9-1.4 1.4" />
    </Icon>
  )
}

function MenuIcon() {
  return (
    <Icon>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </Icon>
  )
}

function ClockIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  )
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="m12 3 2.75 5.58 6.16.9-4.45 4.34 1.05 6.13L12 17.05l-5.51 2.9 1.05-6.13-4.45-4.34 6.16-.9z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <Icon>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  )
}

function SyncIcon({ spinning = false }) {
  return (
    <svg className={spinning ? 'syncIcon spinning' : 'syncIcon'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 0 0-15.2-6.4L3 8" />
      <path d="M3 4v4h4" />
      <path d="M3 12a9 9 0 0 0 15.2 6.4L21 16" />
      <path d="M21 20v-4h-4" />
    </svg>
  )
}

function HeartIcon({ filled = false }) {
  return filled ? (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s-7.2-4.4-9.7-9.1C.4 7.6 2.5 4 6.4 4c2.1 0 3.7 1 4.8 2.4C12.3 5 13.9 4 16 4c3.9 0 6 3.6 4.1 7.9C19.2 16.6 12 21 12 21z"
        fill="currentColor"
      />
    </svg>
  ) : (
    <Icon>
      <path d="M12 20.2s-7-4.1-7-8.8c0-2.4 1.6-4.1 4-4.1 1.5 0 2.7.7 3.7 2 1-1.3 2.2-2 3.7-2 2.4 0 4 1.7 4 4.1 0 4.7-7 8.8-7 8.8z" />
    </Icon>
  )
}

function StarMiniIcon() {
  return (
    <Icon>
      <path d="m12 4 1.9 4.9 5.1.3-4 3.3 1.3 5-4.3-2.8-4.3 2.8 1.3-5-4-3.3 5.1-.3z" />
    </Icon>
  )
}

function PagesIcon() {
  return (
    <Icon>
      <path d="M7 4h8a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2V7a3 3 0 0 1 2-3z" />
      <path d="M9 8h6" />
      <path d="M9 11h6" />
    </Icon>
  )
}

function ReviewIcon() {
  return (
    <Icon>
      <path d="M6.5 6h11A2.5 2.5 0 0 1 20 8.5v5A2.5 2.5 0 0 1 17.5 16H11l-4.5 3V16H6.5A2.5 2.5 0 0 1 4 13.5v-5A2.5 2.5 0 0 1 6.5 6z" />
      <path d="M8.5 10h7" />
      <path d="M8.5 12.5h4.5" />
    </Icon>
  )
}

function TrashIcon() {
  return (
    <Icon>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </Icon>
  )
}

function ChevronLeftIcon() {
  return (
    <Icon>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  )
}

function ChevronRightIcon() {
  return (
    <Icon>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  )
}
