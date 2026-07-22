import BookCard from './BookCard.jsx'

function Shelf({ title, subtitle, books, onOpen, onOpenAuthor, onSeeAll }) {
  if (!books.length) return null

  return (
    <section className="shelf">
      <div className="shelfHeader">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {onSeeAll && (
          <button onClick={() => onSeeAll(title)}>See all</button>
        )}
      </div>
      <div className="shelfScroll">
        {books.map((book) => (
          <BookCard key={book.id} book={book} onOpen={onOpen} onOpenAuthor={onOpenAuthor} />
        ))}
      </div>
    </section>
  )
}

export default Shelf
