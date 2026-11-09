import { useRef, useState, type SyntheticEvent } from 'react'
import type { BookProps } from '../../types.js'

interface BookCoverProps extends BookProps {
  // For very long rows (the reading-goal strip); shelves want all their covers at once.
  lazy?: boolean
}

function BookCover({ book, lazy = false }: BookCoverProps) {
  const [loaded, setLoaded] = useState(false)
  const prevCoverRef = useRef(book.image_url)

  if (prevCoverRef.current !== book.image_url) {
    prevCoverRef.current = book.image_url
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
    <div className="bookCover">
      <div className="coverImage">
        <div className="spineShadow" />
        <img
          src={book.image_url}
          alt={`Cover of ${book.title} by ${book.author}`}
          className={loaded ? 'coverLoaded' : ''}
          loading={lazy ? 'lazy' : undefined}
          onLoad={handleLoad}
          onError={() => setLoaded(true)}
        />
        <div className="coverSheen" />
      </div>
    </div>
  )
}

export default BookCover
