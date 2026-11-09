import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import BookDialog from './BookDialog.jsx'
import type { DialogCloseProps } from './Dialog.jsx'
import useModalLayer from '../../hooks/useModalLayer.js'
import type { Book } from '../../types.js'

export interface Selected {
  book: Book
  isNavigation?: boolean
}

interface BookDialogStageProps extends DialogCloseProps {
  selected: Selected
}

// Card swaps crossfade. The outgoing snapshot is derived during render; an effect would paint a gap.
const CROSSFADE_MS = 180

// The stage is centred, so height changes move the card: pin it through the swap, ease once content is quiet.
const CONTENT_QUIET_MS = 140
const MAX_HOLD_MS = 800

function BookDialogStage({ selected, onClose }: BookDialogStageProps) {
  const [priorSelected, setPriorSelected] = useState(selected)
  const [outgoing, setOutgoing] = useState<Selected | null>(null)
  const [stageHeight, setStageHeight] = useState<number | null>(null)

  // Owned here because a crossfade briefly mounts two BookDialogs. No blocksHotkeys, so chords stay live.
  useModalLayer({ onEscape: onClose })

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

  // Mirrored to a ref so the observer and timers can read it without being rebuilt on each update.
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
        // Height never moved: keep holding so a slow fetch still gets an eased settle.
        if (fromDeadline && !easingRef.current) setStageHeight(null)
        return
      }
      if (fromDeadline && easingRef.current) return
      easingRef.current = true
      setStageHeight(cardHeightRef.current)
    }

    // The first measurement is the pre-fetch height at the swap; hold it past the crossfade.
    let awaitingFirstMeasure = true

    // offsetHeight, not getBoundingClientRect: the latter includes the enter animation's scale, which would stick.
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
    // Backstop: release the pin even if the incoming card never goes quiet.
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
      // Content shifted mid-ease: chase it rather than releasing the pin and snapping.
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
