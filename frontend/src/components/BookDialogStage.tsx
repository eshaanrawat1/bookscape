import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import BookDialog from './BookDialog.jsx'
import type { Book } from '../types.js'

export interface Selected {
  book: Book
  isNavigation?: boolean
}

interface BookDialogStageProps {
  selected: Selected
  onClose: () => void
}

// Card-to-card navigation (clicking a "similar book") crossfades the incoming
// card in over the outgoing one instead of letting the outgoing card vanish
// instantly, which reads as a flicker of bare scrim between the two. The
// outgoing snapshot must be derived synchronously during render (React's
// "adjusting state when a prop changes" pattern) rather than in a useEffect —
// an effect runs after the swap has already committed, so the old card would
// already be gone for one paint before the effect re-adds it, which is the
// exact flicker this is meant to prevent.
const CROSSFADE_MS = 180

// The stage is centred in the scrim, so every change in card height moves the
// card by half the delta. During a navigation the height changes twice: once
// when the incoming card replaces the outgoing one (different title/blurb
// lengths), and again a moment later when the incoming card's /book/{id} fetch
// lands and fills in the stats row, genre pills and real blurb. Tracking that
// live is what makes the card visibly drop and then climb back — the flicker.
//
// Instead the stage is pinned at the outgoing card's height for the crossfade,
// held until the incoming card has stopped resizing for CONTENT_QUIET_MS, and
// then eased once to whatever height the content settled at. Nothing moves
// while the cards swap; the settle is a single smooth ease afterwards.
const CONTENT_QUIET_MS = 140
const MAX_HOLD_MS = 800

function BookDialogStage({ selected, onClose }: BookDialogStageProps) {
  const [priorSelected, setPriorSelected] = useState(selected)
  const [outgoing, setOutgoing] = useState<Selected | null>(null)
  const [stageHeight, setStageHeight] = useState<number | null>(null)

  const cardRef = useRef<HTMLElement | null>(null)
  const cardHeightRef = useRef(0)
  const stageHeightRef = useRef<number | null>(null)
  const easingRef = useRef(false)
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (selected !== priorSelected) {
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!prefersReducedMotion && selected.isNavigation && priorSelected.book.id !== selected.book.id) {
      setOutgoing(priorSelected)
      setStageHeight(cardHeightRef.current || null)
    } else {
      setOutgoing(null)
      setStageHeight(null)
    }
    setPriorSelected(selected)
  }

  // Mirror the pin into a ref so the observer and timers below can read it
  // without being torn down and rebuilt on every height update. Declared first
  // so it is already in sync when the effects that read it run.
  useLayoutEffect(() => {
    stageHeightRef.current = stageHeight
  })

  useEffect(() => {
    if (!outgoing) return
    const timer = setTimeout(() => setOutgoing(null), CROSSFADE_MS)
    return () => clearTimeout(timer)
  }, [outgoing])

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return undefined

    const settle = (fromDeadline: boolean) => {
      if (quietTimerRef.current) {
        clearTimeout(quietTimerRef.current)
        quietTimerRef.current = null
      }
      const pinned = stageHeightRef.current
      if (pinned === null) return
      if (Math.abs(pinned - cardHeightRef.current) < 1) {
        // The height never moved, so there is nothing to ease. Keep holding —
        // a pin that already matches the content is invisible, and it means a
        // slow fetch still gets an eased settle rather than a snap.
        if (fromDeadline && !easingRef.current) setStageHeight(null)
        return
      }
      if (fromDeadline && easingRef.current) return
      easingRef.current = true
      setStageHeight(cardHeightRef.current)
    }

    // The first measurement is the incoming card's pre-fetch height, taken at
    // the swap itself — hold it past the crossfade so the settle never runs
    // while the cards are still dissolving into each other.
    let awaitingFirstMeasure = true

    // offsetHeight, not getBoundingClientRect().height: the latter is the
    // post-transform rect. The first card of a session enters with
    // dialogEnterIn, which scales it from 0.94, and ResizeObserver does not
    // fire on transform changes — so every measurement taken during that
    // 380ms recorded a shrunken height that then stuck. The first card-to-card
    // hop pinned the stage to it, and since the stage is centred in the scrim
    // a too-short pin dropped the incoming card before the settle lifted it
    // back. Layout height is what the pin is about, so measure layout height.
    const measure = () => {
      const height = card.offsetHeight
      if (height <= 0) return
      cardHeightRef.current = height
      if (stageHeightRef.current === null) return
      const delay = awaitingFirstMeasure ? CROSSFADE_MS + CONTENT_QUIET_MS : CONTENT_QUIET_MS
      awaitingFirstMeasure = false
      if (quietTimerRef.current) clearTimeout(quietTimerRef.current)
      quietTimerRef.current = setTimeout(() => settle(false), delay)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    // Backstop: if the incoming card never goes quiet (or its data never
    // arrives) the pin has to be released eventually so the stage can size
    // itself normally again.
    const deadline = stageHeightRef.current !== null
      ? setTimeout(() => settle(true), MAX_HOLD_MS)
      : null

    return () => {
      observer.disconnect()
      if (deadline) clearTimeout(deadline)
      if (quietTimerRef.current) {
        clearTimeout(quietTimerRef.current)
        quietTimerRef.current = null
      }
    }
  }, [selected])

  const handleStageTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    // The tab panel inside a card animates its own height and bubbles up here.
    if (event.target !== event.currentTarget || event.propertyName !== 'height') return
    easingRef.current = false
    if (Math.abs((stageHeightRef.current ?? 0) - cardHeightRef.current) < 1) {
      setStageHeight(null)
    } else {
      // Content shifted again mid-ease — chase it instead of releasing the pin,
      // which would snap the remaining distance.
      easingRef.current = true
      setStageHeight(cardHeightRef.current)
    }
  }

  return (
    <div className="dialogScrim" onClick={onClose}>
      <div
        className={stageHeight !== null ? 'dialogCrossfadeStage settling' : 'dialogCrossfadeStage'}
        style={stageHeight !== null ? { height: stageHeight } : undefined}
        onTransitionEnd={handleStageTransitionEnd}
      >
        {outgoing && (
          <BookDialog
            key={outgoing.book.id}
            book={outgoing.book}
            onClose={onClose}
            exiting
          />
        )}
        <BookDialog
          key={selected.book.id}
          book={selected.book}
          isNavigation={selected.isNavigation}
          cardRef={cardRef}
          onClose={onClose}
        />
      </div>
    </div>
  )
}

export default BookDialogStage
