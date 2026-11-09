import Progress from '../ui/Progress.jsx'
import type { Book } from '../../types.js'

interface CoverProgressProps {
  book: Book | null
}

// Shown even at 0% while reading; otherwise only when there's progress to report.
function CoverProgress({ book }: CoverProgressProps) {
  if (!book) return null
  const progress = book.total_pages > 0 ? Math.min(100, Math.round((book.current_page / book.total_pages) * 100)) : 0
  const show = book.status === 'reading' || (progress > 0 && progress < 100)
  if (!show) return null
  return (
    <div className="coverProgress">
      <Progress value={progress} />
    </div>
  )
}

export default CoverProgress
