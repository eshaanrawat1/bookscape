import Progress from './Progress.jsx'
import type { Book } from '../types.js'

interface CoverProgressProps {
  book: Book | null
}

// The bar that sits across the bottom of a cover. It lives here rather than
// inline in a card because two different cards draw it — a loose book card and
// a series card showing the book you are in the middle of — and a book should
// not gain or lose its bar depending on which shelf picked it up.
//
// A book you are reading always gets one, even at 0%: an empty track still says
// "you are in this one, and barely started", which is exactly the thing a
// reader wants to see, and hiding it made a book one page in look untouched.
// Outside of `reading` the bar is only worth drawing when it has something to
// report — a finished book is not a 100% bar, it is simply done.
function CoverProgress({ book }: CoverProgressProps) {
  if (!book) return null
  const show = book.status === 'reading' || (book.progress > 0 && book.progress < 100)
  if (!show) return null
  return (
    <div className="coverProgress">
      <Progress value={book.progress} />
    </div>
  )
}

export default CoverProgress
