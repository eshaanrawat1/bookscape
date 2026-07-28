import { useEffect, useState } from 'react'
import { Clock3, ChevronLeft, ChevronRight } from 'lucide-react'
import { toNumberOrZero } from '../utils.js'
import { buildHeroGlow } from '../color.js'
import BookCover from '../components/BookCover.jsx'
import Progress from '../components/Progress.jsx'
import Shelf from '../components/Shelf.jsx'

function ReadingNowHero({ books, onOpen }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [direction, setDirection] = useState('next')

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

  const pagesLeft = Math.round((toNumberOrZero(book.pages) * (100 - toNumberOrZero(book.progress))) / 100)
  const heroGlowColor = buildHeroGlow(book.color || `hsl(${book.tint})`)

  return (
    <section className="heroCard paperGrain">
      <div className="heroGlow" style={{ '--hero-glow': heroGlowColor }} />
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
              <span>{pagesLeft} pages left</span>
            </div>
            <Progress value={book.progress} />
          </div>
        </div>
      </div>
    </section>
  )
}

function ReadingNow({
  currentlyReading,
  wantToRead,
  collections,
  booksByIds,
  onOpen,
  onOpenAuthor,
  onOpenReadingNow,
}) {
  return (
    <div className="stack">
      {currentlyReading.length > 0 && <ReadingNowHero books={currentlyReading} onOpen={onOpenReadingNow} />}
      <Shelf title="Up next" subtitle="Saved for the right moment." books={wantToRead.slice(0, 6)} onOpen={onOpen} onOpenAuthor={onOpenAuthor} />
      {collections
        .filter((collection) => (collection.books?.length || collection.bookIds?.length || 0) > 0)
        .map((collection) => (
          <Shelf
            key={collection.id}
            title={collection.name}
            subtitle="Collection"
            books={collection.books?.length ? collection.books : booksByIds(collection.bookIds)}
            onOpen={onOpen}
            onOpenAuthor={onOpenAuthor}
          />
        ))}
    </div>
  )
}

export default ReadingNow
