import { useEffect, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { buildHeroGlow } from '../color.js'
import BookCover from '../components/BookCover.jsx'
import Progress from '../components/Progress.jsx'
import SeriesShelf from '../components/SeriesShelf.jsx'
import Shelf from '../components/Shelf.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import useSeriesProgress from '../hooks/useSeriesProgress.js'
import type { Book } from '../types.js'

interface ReadingNowHeroProps {
  books: Book[]
  onOpen: (book: Book) => void
}

function ReadingNowHero({ books, onOpen }: ReadingNowHeroProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')

  // In case the list shrinks
  const safeIndex = books && currentIndex >= books.length ? 0 : currentIndex

  useEffect(() => {
    if (!books || books.length < 2) return
    const neighborCovers = [
      books[(safeIndex + 1) % books.length]?.cover,
      books[(safeIndex - 1 + books.length) % books.length]?.cover,
    ]
    neighborCovers.forEach((src) => {
      if (!src) return
      const preload = new Image()
      preload.src = src
    })
  }, [books, safeIndex])

  if (!books || books.length === 0) return null

  const book = books[safeIndex]

  const nextBook = () => {
    setDirection('next')
    setCurrentIndex((i) => (i + 1) % books.length)
  }
  const prevBook = () => {
    setDirection('prev')
    setCurrentIndex((i) => (i - 1 + books.length) % books.length)
  }

  // Subtracted from the reading row's own two numbers rather than scaled off
  // the catalog's length. `book.pages` is the edition Goodreads describes and
  // `book.progress` is measured against the copy in your hands, so multiplying
  // one by the other mixed two different books: Dracula, 17 pages into a
  // 703-page copy, claimed 478 pages left instead of 686. Even where the two
  // counts agree the answer was approximate, since it scaled a length by a
  // percentage already rounded to a whole number.
  const pagesLeft = Math.max(0, book.totalPages - book.currentPage)
  const heroGlowColor = buildHeroGlow(book.color)

  return (
    <section className="heroCard paperGrain">
      <div className="heroGlow" style={{ '--hero-glow': heroGlowColor } as CSSProperties} />
      {books.length > 1 && (
        <div className="carouselControls">
          <button className="carouselButton" onClick={prevBook} aria-label="Previous book">
            <ChevronLeft />
          </button>
          <button className="carouselButton" onClick={nextBook} aria-label="Next book">
            <ChevronRight />
          </button>
        </div>
      )}
      <div className={`heroInner heroSlide-${direction}`} key={book.id}>
        <button className="heroCover" onClick={() => onOpen(book)}>
          <BookCover book={book} glow />
        </button>
        <div className="heroCopy">
          <h2>{book.title}</h2>
          <p className="bookMeta">
            {book.author} · {book.genre}
          </p>
          <p className="heroBlurb">{book.blurb}</p>
          <div className="progressBlock">
            <div>
              <span>{book.progress}%</span>
              {/* A book with no page count on either row has no remainder to
                  report, and rendering the subtraction anyway would announce
                  "0 pages left" on a book you have barely started. */}
              {book.totalPages > 0 && <span>{pagesLeft} pages left</span>}
            </div>
            <Progress value={book.progress} />
          </div>
        </div>
      </div>
    </section>
  )
}

function ReadingNow() {
  const { currentlyReading, wantToRead, collections, booksByIds } = useLibraryData()
  const { onOpen, onOpenWantToRead } = useNavigation()
  const seriesInProgress = useSeriesProgress()
  return (
    <div className="stack">
      {currentlyReading.length > 0 && <ReadingNowHero books={currentlyReading} onOpen={onOpen} />}
      {/* Above "Up next", which is a saved-for-later list: a series you are
          already inside of is a stronger claim on what to read next than a book
          you once bookmarked. */}
      <SeriesShelf series={seriesInProgress} />
      <Shelf
        title="Up next"
        subtitle="Saved for the right moment."
        books={wantToRead.slice(0, 30)}
        onSeeAll={onOpenWantToRead}
      />
      {collections
        .filter((collection) => (collection.books?.length || collection.bookIds?.length || 0) > 0)
        .map((collection) => (
          <Shelf
            key={collection.id}
            title={collection.name}
            subtitle="Kept together on purpose."
            books={collection.books?.length ? collection.books : booksByIds(collection.bookIds)}
          />
        ))}
    </div>
  )
}

export default ReadingNow
