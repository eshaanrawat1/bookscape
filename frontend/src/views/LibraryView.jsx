import Shelf from '../components/Shelf.jsx'

function LibraryView({ globalLibrary, onOpen, onOpenAuthor, onOpenGenre }) {
  if (!globalLibrary || globalLibrary.length === 0) {
    return (
      <div className="emptyState">
        <p>Loading library...</p>
      </div>
    )
  }
  return (
    <div className="stack">
      {globalLibrary.map((genreSection) => (
        <Shelf
          key={genreSection.genre}
          title={genreSection.genre}
          books={genreSection.books}
          onOpen={onOpen}
          onOpenAuthor={onOpenAuthor}
          onSeeAll={onOpenGenre}
        />
      ))}
    </div>
  )
}

export default LibraryView
