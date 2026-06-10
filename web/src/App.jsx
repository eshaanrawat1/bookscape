import { useState } from 'react'

const books = [
  {
    id: 'lantern-keeper',
    title: 'The Lantern Keeper',
    author: 'Mara Ellison',
    cover: '/covers/lantern-keeper.png',
    tint: '30 90% 55%',
    genre: 'Literary Fiction',
    pages: 312,
    rating: 4.6,
    progress: 64,
    format: ['ebook', 'audiobook'],
    blurb:
      'On the last inhabited island of a fading archipelago, a woman tends the light that keeps the ships-and her memories-from running aground.'
  },
  {
    id: 'letters-from-the-pines',
    title: 'Letters from the Pines',
    author: 'Theo Hartwell',
    cover: '/covers/letters-from-the-pines.png',
    tint: '150 35% 35%',
    genre: 'Literary Fiction',
    pages: 274,
    rating: 4.3,
    progress: 28,
    format: ['ebook']
  },
  {
    id: 'a-quiet-kitchen',
    title: 'A Quiet Kitchen',
    author: 'Iris Moreau',
    cover: '/covers/a-quiet-kitchen.png',
    tint: '25 75% 50%',
    genre: 'Memoir & Food',
    pages: 248,
    rating: 4.8,
    progress: 0,
    format: ['ebook', 'audiobook']
  },
  {
    id: 'tidewater',
    title: 'Tidewater',
    author: 'Soren Vale',
    cover: '/covers/tidewater.png',
    tint: '200 45% 40%',
    genre: 'Literary Fiction',
    pages: 356,
    rating: 4.1,
    progress: 100,
    format: ['ebook', 'audiobook']
  },
  {
    id: 'the-wool-road',
    title: 'The Wool Road',
    author: 'Edith Caraway',
    cover: '/covers/the-wool-road.png',
    tint: '35 80% 50%',
    genre: 'Historical Fiction',
    pages: 402,
    rating: 4.5,
    progress: 0,
    format: ['ebook']
  },
  {
    id: 'midnight-almanac',
    title: 'The Midnight Almanac',
    author: 'Cyrus Bell',
    cover: '/covers/midnight-almanac.png',
    tint: '250 40% 45%',
    genre: 'Nature & Science',
    pages: 288,
    rating: 4.7,
    progress: 12,
    format: ['ebook', 'audiobook']
  },
  {
    id: 'saffron-house',
    title: 'The Saffron House',
    author: 'Nadia Khoury',
    cover: '/covers/saffron-house.png',
    tint: '45 85% 55%',
    genre: 'Contemporary Fiction',
    pages: 330,
    rating: 4.4,
    progress: 0,
    format: ['ebook', 'audiobook']
  },
  {
    id: 'winter-orchard',
    title: 'Winter Orchard',
    author: 'Lewis Ashby',
    cover: '/covers/winter-orchard.png',
    tint: '120 20% 45%',
    genre: 'Poetry',
    pages: 96,
    rating: 4.2,
    progress: 0,
    format: ['ebook']
  },
  {
    id: 'the-cartographer',
    title: "The Cartographer's Daughter",
    author: 'Beatrix Lowe',
    cover: '/covers/the-cartographer.png',
    tint: '20 50% 45%',
    genre: 'Adventure',
    pages: 388,
    rating: 4.6,
    progress: 0,
    format: ['ebook', 'audiobook']
  },
  {
    id: 'slow-mornings',
    title: 'Slow Mornings',
    author: 'Priya Anand',
    cover: '/covers/slow-mornings.png',
    tint: '30 60% 60%',
    genre: 'Wellbeing',
    pages: 210,
    rating: 4.0,
    progress: 0,
    format: ['ebook', 'audiobook']
  }
]

const collections = [
  {
    id: 'rainy-day',
    name: 'Rainy Day Reads',
    description: 'For grey afternoons and a second cup of tea.',
    bookIds: ['lantern-keeper', 'letters-from-the-pines', 'tidewater']
  },
  {
    id: 'comfort',
    name: 'Comfort Shelf',
    description: 'Books that feel like a warm blanket.',
    bookIds: ['a-quiet-kitchen', 'slow-mornings', 'winter-orchard']
  },
  {
    id: 'wanderlust',
    name: 'Armchair Travels',
    description: 'Go somewhere without leaving the chair.',
    bookIds: ['the-cartographer', 'the-wool-road', 'saffron-house']
  }
]

const viewMeta = {
  'reading-now': { title: 'Reading Now', subtitle: 'Pick up where you left off.' },
  library: { title: 'Library', subtitle: 'Everything on your shelves.' },
  'want-to-read': { title: 'Want to Read', subtitle: 'Saved for a rainy day.' },
  finished: { title: 'Finished', subtitle: "Books you've loved and closed." }
}

const mainNav = [
  { id: 'reading-now', label: 'Reading Now', icon: BookOpenIcon },
  { id: 'library', label: 'Library', icon: LibraryIcon },
]

const shelfNav = [
  { id: 'want-to-read', label: 'Want to Read', icon: BookmarkIcon },
  { id: 'finished', label: 'Finished', icon: CheckIcon }
]

const bookById = new Map(books.map((book) => [book.id, book]))
const booksByIds = (ids) => ids.map((id) => bookById.get(id)).filter(Boolean)
const currentlyReading = books.filter((book) => book.progress > 0 && book.progress < 100)
const wantToRead = books.filter((book) => book.progress === 0)
const finished = books.filter((book) => book.progress === 100)
const heroBook = bookById.get('lantern-keeper')

export default function App() {
  const [view, setView] = useState('reading-now')
  const [dark, setDark] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [selected, setSelected] = useState(null)

  const activeCollection = view.startsWith('collection:')
    ? collections.find((collection) => `collection:${collection.id}` === view)
    : null
  const meta = activeCollection ? activeCollection : viewMeta[view]

  return (
    <div className={dark ? 'appRoot dark' : 'appRoot'}>
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
                <MenuIcon />
              </button>
              <div>
                <h1>{meta.title || meta.name}</h1>
                <p>{meta.subtitle || meta.description}</p>
              </div>
            </div>
            <button className="lampButton" onClick={() => setDark((value) => !value)} aria-label="Toggle dark mode">
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
          </header>

          <div className="mainContent">
            <ViewContent view={view} activeCollection={activeCollection} onOpen={setSelected} />
          </div>
        </main>
      </div>

      {selected && <BookDialog book={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function Sidebar({ active, onSelect }) {
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

function ViewContent({ view, activeCollection, onOpen }) {
  if (activeCollection) {
    return <BookGrid books={booksByIds(activeCollection.bookIds)} onOpen={onOpen} />
  }

  if (view === 'reading-now') {
    return (
      <div className="stack">
        <ReadingNowHero book={heroBook} onOpen={onOpen} />
        <Shelf title="Continue reading" subtitle="You were in the middle of these." books={currentlyReading} onOpen={onOpen} />
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

function ReadingNowHero({ book, onOpen }) {
  const pagesLeft = Math.round((book.pages * (100 - book.progress)) / 100)

  return (
    <section className="heroCard paperGrain">
      <div className="heroGlow" style={{ background: `hsl(${book.tint} / 0.6)` }} />
      <div className="heroInner">
        <button className="heroCover" onClick={() => onOpen(book)}>
          <BookCover book={book} glow />
        </button>
        <div className="heroCopy">
          <span className="pill">
            <ClockIcon />
            Continue reading
          </span>
          <h2>{book.title}</h2>
          <p className="bookMeta">
            {book.author} · {book.genre}
          </p>
          <p className="heroBlurb">{book.blurb}</p>
          <div className="progressBlock">
            <div>
              <span>{book.progress}% · chapter 9 of 14</span>
              <span>{pagesLeft} pages left</span>
            </div>
            <Progress value={book.progress} />
          </div>
          <div className="actionRow">
            <button className="primaryButton">
              <BookOpenIcon />
              Keep reading
            </button>
            <button className="secondaryButton">
              <HeadphonesIcon />
              Listen instead
            </button>
            <StarRating value={book.rating} />
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
  const isAudio = book.format.includes('audiobook')

  return (
    <button className="bookCard" onClick={() => onOpen(book)}>
      <div className="coverWrap">
        <BookCover book={book} />
        {isAudio && (
          <span className="audioBadge">
            <HeadphonesIcon />
          </span>
        )}
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
          <span className="pill">{book.genre}</span>
          <h2>{book.title}</h2>
          <p>{book.author}</p>
          <p>{book.blurb || 'A cozy shelf pick with a warm cover, calm pacing, and a perfect spot in the evening stack.'}</p>
          <div className="dialogStats">
            <span>{book.pages} pages</span>
            <span>{book.progress}% read</span>
            <StarRating value={book.rating} />
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
