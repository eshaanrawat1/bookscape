import { useRef, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { buildHeroGlow } from '../color.js'
import type { Book } from '../types.js'

interface BookCoverProps {
  book: Book
  glow?: boolean
}

function BookCover({ book, glow = false }: BookCoverProps) {
  const coverGlowColor = buildHeroGlow(book.color)
  const [loaded, setLoaded] = useState(false)
  const prevCoverRef = useRef(book.cover)

  if (prevCoverRef.current !== book.cover) {
    prevCoverRef.current = book.cover
    setLoaded(false)
  }

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    if (typeof img.decode === 'function') {
      img.decode().then(() => setLoaded(true), () => setLoaded(true))
    } else {
      setLoaded(true)
    }
  }

  return (
    <div className={glow ? 'bookCover hasGlow' : 'bookCover'} style={{ '--cover-glow': coverGlowColor } as CSSProperties}>
      {glow && <div className="coverGlow" />}
      <div className="coverImage">
        <div className="spineShadow" />
        <img
          src={book.cover}
          alt={`Cover of ${book.title} by ${book.author}`}
          className={loaded ? 'coverLoaded' : ''}
          onLoad={handleLoad}
          onError={() => setLoaded(true)}
        />
        <div className="coverSheen" />
      </div>
    </div>
  )
}

export default BookCover
