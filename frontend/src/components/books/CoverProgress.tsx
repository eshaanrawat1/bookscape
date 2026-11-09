import Progress from '../ui/Progress.jsx'
import type { Book } from '../../types.js'

interface CoverProgressProps {
  book: Book | null
}

// Shown even at 0% while reading; otherwise only when there's progress to report.
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
