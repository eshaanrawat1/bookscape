import BookCard from './BookCard.jsx'
import SectionHeader from '../ui/SectionHeader.jsx'
import type { Book } from '../../types.js'

interface ShelfProps {
  title: string
  subtitle?: string
  books: Book[]
  onSeeAll?: (title: string) => void
}

function Shelf({ title, subtitle, books, onSeeAll }: ShelfProps) {
  if (!books.length) return null

  return (
    <section className="shelf">
      <SectionHeader title={title} subtitle={subtitle}>
        {onSeeAll && (
          <button onClick={() => onSeeAll(title)}>See all</button>
        )}
      </SectionHeader>
      <div className="shelfScroll">
        {books.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
    </section>
  )
}

export default Shelf
