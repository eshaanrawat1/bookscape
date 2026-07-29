import { useState, useEffect, type CSSProperties } from 'react'
import { X, Star, MessageSquareText, FileText, Plus, Heart, BookOpen } from 'lucide-react'
import { apiFetch } from '../api.js'
import { normaliseBook, getCatalogBookId, formatCompactNumber, resolveSavedWantToReadBook } from '../utils.js'
import { buildDialogGlow } from '../color.js'
import BookCover from './BookCover.jsx'
import FinishedBookDialog from './FinishedBookDialog.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book, RawBookPayload } from '../types.js'

interface BookDialogProps {
  book: Book
  onClose: () => void
}

function BookDialog({ book, onClose }: BookDialogProps) {
  const { collections, wantToReadBooks, addBookToCollection, toggleBookWantToRead } = useLibraryData()
  const { onOpen, onOpenAuthor, onOpenTracking } = useNavigation()
  const savedWantToReadBook = resolveSavedWantToReadBook(book, wantToReadBooks)
  const [fullBook, setFullBook] = useState<Book | null>(null)
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [savingCollection, setSavingCollection] = useState('')
  const [savingToRead, setSavingToRead] = useState(false)
  const bookId = getCatalogBookId(book)

  useEffect(() => {
    let cancelled = false
    setFullBook(null)
    if (!bookId) return () => { cancelled = true }
    apiFetch<RawBookPayload>(`/book/${bookId}`)
      .then((data) => {
        if (!cancelled && data) setFullBook({ ...normaliseBook(data), similar_books: data.similar_books || [] })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [bookId])

  const displayBook = fullBook ? { ...fullBook, ...book, similar_books: fullBook.similar_books || book.similar_books || [] } : book
  const similarBooks = displayBook.similar_books || []
  const dialogGenres = (displayBook.genres && displayBook.genres.length > 0)
    ? displayBook.genres.slice(0, 5)
    : (displayBook.genre ? [displayBook.genre] : [])
  const isTrackedBook = ['reading', 'done'].includes(book.status) || ['reading', 'done'].includes(displayBook.status)
  const savedWantToReadKey = getCatalogBookId(savedWantToReadBook)
  const isSavedToWantToRead = Boolean(savedWantToReadBook)

  if (isTrackedBook) {
    return (
      <FinishedBookDialog
        book={displayBook}
        onClose={onClose}
      />
    )
  }

  const handleSave = async () => {
    if (!bookId || savingToRead) return
    setSavingToRead(true)
    setActionMessage('')
    try {
      const nextSaved = !isSavedToWantToRead
      await toggleBookWantToRead(isSavedToWantToRead ? savedWantToReadKey : bookId, isSavedToWantToRead)
      setActionMessage(nextSaved ? 'Saved to Want to read.' : 'Removed from Want to read.')
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Could not save this book.')
    } finally {
      setSavingToRead(false)
    }
  }

  const handleAddToCollection = async (collectionName: string) => {
    if (!bookId || !collectionName || savingCollection === collectionName) return
    setSavingCollection(collectionName)
    setActionMessage('')
    try {
      await addBookToCollection(collectionName, bookId)
      setCollectionMenuOpen(false)
      setActionMessage(`Added to ${collectionName}.`)
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Could not add this book.')
    } finally {
      setSavingCollection('')
    }
  }

  return (
    <div className="dialogScrim" onClick={onClose}>
      <article
        className="bookDialog paperGrain"
        style={{ '--dialog-glow': buildDialogGlow(displayBook.color || `hsl(${displayBook.tint})`) } as CSSProperties}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="dialogClose" onClick={onClose} aria-label="Close details">
          <X />
        </button>
        <div className="dialogTop">
          <div className="dialogCover">
            <BookCover book={displayBook} glow />
          </div>
          <div className="dialogCopy">
            <h2>{displayBook.title}</h2>
            {displayBook.author ? (
              <button
                type="button"
                className="dialogAuthor dialogAuthorButton"
                onClick={() => onOpenAuthor?.(displayBook.author)}
                disabled={!onOpenAuthor}
              >
                {displayBook.author}
              </button>
            ) : null}

            <div className="dialogStatsRow">
              {displayBook.rating > 0 && (
                <span className="dialogStatItem">
                  <Star />
                  <span>{displayBook.rating.toFixed(1)}{displayBook.ratingCount > 0 ? ` (${formatCompactNumber(displayBook.ratingCount)})` : ''}</span>
                </span>
              )}
              {displayBook.reviewCount > 0 && (
                <span className="dialogStatItem">
                  <MessageSquareText />
                  <span>{formatCompactNumber(displayBook.reviewCount)}</span>
                </span>
              )}
              {displayBook.pages > 0 && (
                <span className="dialogStatItem">
                  <FileText />
                  <span>{formatCompactNumber(displayBook.pages)} pages</span>
                </span>
              )}
            </div>

            {dialogGenres.length > 0 && (
              <div className="dialogGenrePills" aria-label="Genres">
                {dialogGenres.map((genre) => (
                  <span key={genre} className="dialogGenrePill">
                    {genre}
                  </span>
                ))}
              </div>
            )}

            <p className="dialogBlurb">{displayBook.blurb || 'A great read from your library.'}</p>

            <div className="dialogActionPanel">
              <div className="dialogActionRow">
                <div className={collectionMenuOpen ? 'collectionMenuAnchor open' : 'collectionMenuAnchor'}>
                  <button
                    type="button"
                    className="dialogIconButton dialogCollectionButton"
                    onClick={() => setCollectionMenuOpen((value) => !value)}
                    disabled={!collections.length || !bookId}
                    aria-label="Add to collections"
                    title="Add to collections"
                    aria-expanded={collectionMenuOpen}
                  >
                    <Plus />
                  </button>
                  {collectionMenuOpen && collections.length > 0 && (
                    <div className="collectionPicker" role="menu" aria-label="Add to collection">
                      {collections.map((collection) => (
                        <button
                          key={collection.id}
                          type="button"
                          className="collectionPickerItem"
                          onClick={() => handleAddToCollection(collection.name)}
                          disabled={savingCollection === collection.name}
                        >
                          <span>{collection.name}</span>
                          {savingCollection === collection.name ? <span className="collectionPickerState">Adding…</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className={isSavedToWantToRead ? 'dialogIconButton dialogSaveButton saved' : 'dialogIconButton dialogSaveButton'}
                  onClick={handleSave}
                  disabled={!bookId || savingToRead}
                  aria-label={isSavedToWantToRead ? 'Remove from Want to read' : 'Save to Want to read'}
                  title={isSavedToWantToRead ? 'Remove from Want to read' : 'Save to Want to read'}
                >
                  <Heart fill={isSavedToWantToRead ? 'currentColor' : 'none'} />
                </button>

                <button
                  type="button"
                  className="dialogIconButton"
                  onClick={() => onOpenTracking(displayBook)}
                  disabled={!bookId}
                  aria-label="Track reading progress"
                  title="Track reading progress"
                >
                  <BookOpen />
                </button>
              </div>

              {actionMessage && <p className="dialogActionMessage">{actionMessage}</p>}
            </div>
          </div>
        </div>

        <div className="dialogSimilar">
          <h3>Similar Books</h3>
          <div className="dialogSimilarScroll">
            {similarBooks.length > 0 ? (
              similarBooks.map((simRaw) => {
                const simBook = normaliseBook(simRaw)
                return (
                  <button key={simBook.id} className="similarCard" onClick={() => { if (onOpen) onOpen(simBook) }}>
                    <BookCover book={simBook} />
                  </button>
                )
              })
            ) : (
              <div className="similarCard similarCardEmpty" aria-hidden="true">
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  )
}

export default BookDialog
