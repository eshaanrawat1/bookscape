import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import BookCover from './BookCover.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import { formatCompactNumber } from '../utils.js'
import type { FeaturedStat } from '../types.js'

interface StatsCarouselProps {
  featured: FeaturedStat[]
}

// Ratings run to the millions while pages and days stay small, so compact
// notation only earns its ambiguity past a thousand. Average rating is the one
// card whose number is fractional and must keep both decimals.
function formatValue(stat: FeaturedStat): string {
  if (stat.key === 'acclaimed') return stat.value.toFixed(2)
  if (stat.value >= 1000) return formatCompactNumber(stat.value)
  return String(Math.round(stat.value))
}

function StatsCarousel({ featured }: StatsCarouselProps) {
  const { onOpen, onOpenAuthor } = useNavigation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  // Scrolling is native (snap points, trackpad, touch, keyboard) — the arrows
  // are a mouse affordance layered on top, so they read their state from the
  // scroller rather than owning an index of their own.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const sync = () => {
      const max = el.scrollWidth - el.clientWidth
      setAtStart(el.scrollLeft <= 1)
      setAtEnd(el.scrollLeft >= max - 1)
    }

    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [featured])

  if (!featured?.length) return null

  // Card width is a fraction of the visible row and the gap is in rem against an
  // 11px root, so both are measured rather than assumed — a hardcoded step would
  // drift off the snap points at every breakpoint.
  const scrollByCard = (direction: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    const card = el.querySelector('.statsFocusCard')
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0
    const step = card ? card.getBoundingClientRect().width + gap : el.clientWidth * 0.8
    el.scrollBy({ left: step * direction, behavior: 'smooth' })
  }

  const scrollable = !atStart || !atEnd

  return (
    <section className="statsFocus">
      <div className="statsFocusHeader">
        <h2>In focus</h2>
        {scrollable && (
          <div className="statsFocusControls">
            <button
              type="button"
              className="carouselButton"
              onClick={() => scrollByCard(-1)}
              disabled={atStart}
              aria-label="Scroll to previous stats"
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              className="carouselButton"
              onClick={() => scrollByCard(1)}
              disabled={atEnd}
              aria-label="Scroll to next stats"
            >
              <ChevronRight />
            </button>
          </div>
        )}
      </div>

      <div className="statsFocusScroll" ref={scrollRef} tabIndex={0} role="group" aria-label="Standout books">
        {featured.map((stat) => (
          <article className="statsFocusCard" key={stat.key}>
            <button
              type="button"
              className="statsFocusCover"
              onClick={() => onOpen(stat.book)}
              aria-label={`${stat.label}: ${stat.book.title}, ${formatValue(stat)} ${stat.unit}`}
            >
              <BookCover book={stat.book} />
            </button>
            <div className="statsFocusBody">
              <p className="statsFocusLabel">{stat.label}</p>
              <strong className="statsFocusValue">{formatValue(stat)}</strong>
              <p className="statsFocusUnit">{stat.unit}</p>
              <button type="button" className="statsFocusTitle" onClick={() => onOpen(stat.book)}>
                {stat.book.title}
              </button>
              {stat.book.author ? (
                <button
                  type="button"
                  className="statsFocusAuthor"
                  onClick={() => onOpenAuthor?.(stat.book.author)}
                  disabled={!onOpenAuthor}
                >
                  {stat.book.author}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default StatsCarousel
