import { useEffect, useState } from 'react'
import BookDialog from './BookDialog.jsx'
import type { Book } from '../types.js'

export interface Selected {
  book: Book
  preferLiveStatus?: boolean
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

function BookDialogStage({ selected, onClose }: BookDialogStageProps) {
  const [priorSelected, setPriorSelected] = useState(selected)
  const [outgoing, setOutgoing] = useState<Selected | null>(null)

  if (selected !== priorSelected) {
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!prefersReducedMotion && selected.isNavigation && priorSelected.book.id !== selected.book.id) {
      setOutgoing(priorSelected)
    } else {
      setOutgoing(null)
    }
    setPriorSelected(selected)
  }

  useEffect(() => {
    if (!outgoing) return
    const timer = setTimeout(() => setOutgoing(null), CROSSFADE_MS)
    return () => clearTimeout(timer)
  }, [outgoing])

  return (
    <div className="dialogScrim" onClick={onClose}>
      <div className="dialogCrossfadeStage">
        {outgoing && (
          <BookDialog
            key={outgoing.book.id}
            book={outgoing.book}
            preferLiveStatus={outgoing.preferLiveStatus}
            onClose={onClose}
            exiting
          />
        )}
        <BookDialog
          key={selected.book.id}
          book={selected.book}
          preferLiveStatus={selected.preferLiveStatus}
          isNavigation={selected.isNavigation}
          onClose={onClose}
        />
      </div>
    </div>
  )
}

export default BookDialogStage
