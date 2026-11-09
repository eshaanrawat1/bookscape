import { useState, useLayoutEffect, useRef } from 'react'

interface GenrePillsProps {
  genres: string[]
}

interface Metrics {
  pills: number[]
  overflow: number
  gap: number
}

// Sub-pixel slack: fractional pill widths can sum a hair over a row that visually fits.
const EPSILON = 0.5

// Leading pills that fit on one line, reserving room for the +N chip when anything is dropped.
function fitCount({ pills, overflow, gap }: Metrics, available: number): number {
  let used = 0
  for (let index = 0; index < pills.length; index += 1) {
    const next = used + (index > 0 ? gap : 0) + pills[index]
    if (next > available + EPSILON) {
      let count = index
      let width = used
      while (count > 0 && width + gap + overflow > available + EPSILON) {
        count -= 1
        width -= pills[count] + (count > 0 ? gap : 0)
      }
      return count
    }
    used = next
  }
  return pills.length
}

// Pinned to one row so card height never depends on genre count; the rest collapse into +N.
function GenrePills({ genres }: GenrePillsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState<number | null>(null)

  // Widths only change with the genres, so measure once and cache; resizes just redo the arithmetic.
  const metricsRef = useRef<Metrics | null>(null)
  const key = genres.join('\0')
  const [priorKey, setPriorKey] = useState(key)
  if (key !== priorKey) {
    setPriorKey(key)
    metricsRef.current = null
    setVisibleCount(null)
  }

  // Children are only valid to read during the unclamped render, i.e. while the cache is empty.
  const measureAndFit = () => {
    const container = containerRef.current
    // Zero width means not laid out yet; measuring would collapse every pill into the chip.
    if (!container || !container.clientWidth) return

    if (!metricsRef.current) {
      const children = Array.from(container.children) as HTMLElement[]
      metricsRef.current = {
        pills: children.slice(0, -1).map((el) => el.getBoundingClientRect().width),
        overflow: children[children.length - 1].getBoundingClientRect().width,
        gap: parseFloat(getComputedStyle(container).columnGap) || 0,
      }
    }
    setVisibleCount(fitCount(metricsRef.current, container.clientWidth))
  }

  // Layout effect so clamping lands in the same frame and overflowing pills never paint.
  useLayoutEffect(measureAndFit, [key])

  // Observer deliveries land after layout effects, so this never races the first measurement.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => measureAndFit())
    observer.observe(container)
    return () => observer.disconnect()
  }, [key])

  const measuring = visibleCount === null
  const shown = measuring ? genres : genres.slice(0, visibleCount)
  const hidden = genres.slice(shown.length)

  return (
    <div className="dialogGenrePills" ref={containerRef} aria-label="Genres">
      {shown.map((genre) => (
        <span key={genre} className="dialogGenrePill">
          {genre}
        </span>
      ))}
      {/* Kept while measuring so its width is known before the first clamp; never painted. */}
      {(measuring || hidden.length > 0) && (
        <span
          className="dialogGenrePill dialogGenrePillOverflow"
          title={hidden.join(', ')}
          aria-hidden={measuring || undefined}
        >
          +{hidden.length}
        </span>
      )}
    </div>
  )
}

export default GenrePills
