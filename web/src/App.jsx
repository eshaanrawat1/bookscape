import { useState, useEffect } from 'react'

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const BASE = '/api'

async function apiFetch(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json()
}

// Normalise a book from the /my-books response into the shape the UI expects.
function normaliseBook(raw) {
  const totalPages = raw.reading_total_pages || raw.total_pages || 0
  const currentPage = raw.reading_current_page || raw.current_page || 0
  const progress =
    totalPages > 0 ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0

  const status = raw.reading_status || raw.status || 'not_started'

  return {
    id: raw.id,
    title: raw.title || 'Untitled',
    author: raw.author || '',
    cover: raw.image_url || '',
    tint: '220 30% 45%', // neutral fallback tint — image_url is used for actual cover art
    genre: raw.genre || (Array.isArray(raw.genres) && raw.genres[0]) || '',
    pages: totalPages,
    rating: parseFloat(raw.book_rating) || 0,
    progress,
    status,
    format: [], // not tracked in our dataset; omit audio badge
    blurb: raw.description || '',
    // keep raw fields for completeness
    _raw: raw,
  }
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
  { id: 'reading-now', label: 'Reading Now', icon: BookOpenIcon },
  { id: 'library', label: 'Library', icon: LibraryIcon },
]

const shelfNav = [
  { id: 'want-to-read', label: 'Want to Read', icon: BookmarkIcon },
  { id: 'finished', label: 'Finished', icon: CheckIcon },
]

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function App() {
  const [view, setView] = useState('reading-now')
  const [dark, setDark] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [selected, setSelected] = useState(null)

  // Live data from the API
  const [books, setBooks] = useState([])
  const [collections, setCollections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [myBooksRes, listsRes] = await Promise.all([
          apiFetch('/my-books'),
          apiFetch('/reading-lists'),
        ])

        if (cancelled) return

        const normalisedBooks = (myBooksRes.books || []).map(normaliseBook)
        setBooks(normalisedBooks)

        // Map reading-list API response → sidebar collections shape
        const rawLists = listsRes.lists || []
        const mappedCollections = rawLists.map((list) => ({
          id: list.name.toLowerCase().replace(/\s+/g, '-'),
          name: list.name,
          description: '',
          bookIds: (list.book_ids || []),
        }))
        setCollections(mappedCollections)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Derived views from live books
  const bookById = new Map(books.map((b) => [b.id, b]))
  const booksByIds = (ids) => ids.map((id) => bookById.get(id)).filter(Boolean)
  const currentlyReading = books.filter((b) => b.status === 'reading')
  const wantToRead = books.filter((b) => b.status === 'not_started')
  const finished = books.filter((b) => b.status === 'done')
  const heroBook = currentlyReading[0] || books[0] || null

  const activeCollection = view.startsWith('collection:')
    ? collections.find((c) => `collection:${c.id}` === view)
    : null
  const meta = activeCollection ? activeCollection : viewMeta[view]

  return (
    <div className={dark ? 'appRoot dark' : 'appRoot'}>
      <div className="hearthShell">
        <Sidebar
          active={view}
          collections={collections}
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
            <button className="lampButton" onClick={() => setDark((v) => !v)} aria-label="Toggle dark mode">
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
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
                heroBook={heroBook}
              />
            )}
          </div>
        </main>
      </div>

      {selected && <BookDialog book={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({ active, collections, onSelect }) {
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

      <section className="navSection">
        <div className="sectionHeader">
          <p className="sectionLabel">Collections</p>
          <button className="plusButton" aria-label="New collection">
            <PlusIcon />
          </button>
        </div>
        {collections.map((collection) => {
          const id = `collection:${collection.id}`
          const isActive = active === id
          return (
            <button
              key={collection.id}
              className={isActive ? 'collectionButton active' : 'collectionButton'}
              onClick={() => onSelect(id)}
            >
              <span className="collectionDot" />
              <span>{collection.name}</span>
            </button>
          )
        })}
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

function ViewContent({ view, activeCollection, onOpen, books, booksByIds, currentlyReading, wantToRead, finished, heroBook }) {
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
    return (
      <div className="stack">
        <Shelf title="Currently reading" books={currentlyReading} onOpen={onOpen} />
        <Shelf title="All books" books={books} onOpen={onOpen} />
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

function BookDialog({ book, onClose }) {
  return (
    <div className="dialogScrim" onClick={onClose}>
      <article className="bookDialog paperGrain" onClick={(event) => event.stopPropagation()}>
        <button className="dialogClose" onClick={onClose} aria-label="Close details">
          <CloseIcon />
        </button>
        <div className="dialogCover">
          <BookCover book={book} glow />
        </div>
        <div className="dialogCopy">
          {book.genre && <span className="pill">{book.genre}</span>}
          <h2>{book.title}</h2>
          <p>{book.author}</p>
          <p>{book.blurb || 'A great read from your library.'}</p>
          <div className="dialogStats">
            {book.pages > 0 && <span>{book.pages} pages</span>}
            {book.progress > 0 && <span>{book.progress}% read</span>}
            {book.rating > 0 && <StarRating value={book.rating} />}
          </div>
          <button className="primaryButton">
            <BookOpenIcon />
            Open book
          </button>
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
