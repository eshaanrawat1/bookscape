import { buildHeroGlow } from '../color.js'

function BookCover({ book, glow = false }) {
  const coverGlowColor = buildHeroGlow(book.color || `hsl(${book.tint})`)
  return (
    <div className={glow ? 'bookCover hasGlow' : 'bookCover'} style={{ '--cover-glow': coverGlowColor }}>
      {glow && <div className="coverGlow" />}
      <div className="coverImage">
        <div className="spineShadow" />
        <img src={book.cover} alt={`Cover of ${book.title} by ${book.author}`} />
        <div className="coverSheen" />
      </div>
    </div>
  )
}

export default BookCover
