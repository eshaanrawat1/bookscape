import { useState, useEffect, useLayoutEffect, useRef, type Ref } from 'react'
import {
  X, Star, MessageSquareText, FileText, Plus, Highlighter, ChevronDown,
  LoaderCircle, Hash, Sigma, Calendar, CalendarCheck, TextAlignStart,
} from 'lucide-react'
import { apiFetch } from '../../api.js'
import { formatCompactNumber } from '../../utils.js'
import BookCover from '../books/BookCover.jsx'
import DateProperty from './DateProperty.jsx'
import GenrePills from '../books/GenrePills.jsx'
import HighlightDialog from './HighlightDialog.jsx'
import { useLibraryData } from '../../context/LibraryDataContext.jsx'
import { useNavigation } from '../../context/NavigationContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import type { DialogCloseProps } from './Dialog.jsx'
import type { Book, BookProps, Collection } from '../../types.js'

interface BookDialogProps extends BookProps, DialogCloseProps {
  isNavigation?: boolean
  exiting?: boolean
  cardRef?: Ref<HTMLElement>
}

type BookDialogView = 'library' | 'tracking'

interface ReadingProgressRecord {
  status: string
  current_page: number | string
  total_pages: number | string
  start_date: string
  finish_date: string
  // String mid-edit, number once saved: the rating row uses this to tell a typed "0" from unrated.
  my_rating: number | string
  notes: string
}

const recordFromBook = (book: Book): ReadingProgressRecord => ({
  status: book.status,
  current_page: book.current_page,
  total_pages: book.total_pages,
  start_date: book.start_date,
  finish_date: book.finish_date,
  my_rating: book.my_rating,
  notes: book.notes,
})

// What gets saved, and so what autosave compares. Ranges are the server's to enforce.
const toPayload = (record: ReadingProgressRecord) => ({
  status: record.status,
  current_page: parseInt(String(record.current_page), 10) || 0,
  total_pages: parseInt(String(record.total_pages), 10) || 0,
  start_date: record.start_date.trim(),
  finish_date: record.finish_date.trim(),
  my_rating: Number(record.my_rating) || 0,
  notes: record.notes.trim(),
})

const recordSignature = (record: ReadingProgressRecord): string => JSON.stringify(toPayload(record))

const STATUS_OPTIONS = [
  ['done', 'Finished'],
  ['reading', 'Reading'],
  ['want', 'Want to read'],
  ['dnf', 'DNF'],
  ['not_started', 'Not started'],
]
const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUS_OPTIONS)

// Picked-up statuses: these open on the tracking panel.
const TRACKED_STATUSES = ['reading', 'done', 'dnf']

function BookDialog({ book: openedBook, isNavigation = false, exiting = false, cardRef, onClose }: BookDialogProps) {
  const { collections, booksByIds, addBookToCollection, applyBook } = useLibraryData()
  const book = booksByIds([openedBook.id])[0] || openedBook
  const { onOpen, onOpenDrilldown } = useNavigation()
  const { showToast, showError } = useToast()
  const [view, setView] = useState<BookDialogView>(() => (
    TRACKED_STATUSES.includes(book.status) ? 'tracking' : 'library'
  ))
  const panelViewportRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  const lastAnimatedView = useRef(view)

  const prefersReducedMotion = () => (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )

  const switchView = (nextView: BookDialogView) => {
    if (nextView === view) return
    if (!prefersReducedMotion()) {
      const viewport = panelViewportRef.current
      if (viewport) {
        setPanelHeight(viewport.getBoundingClientRect().height)
      }
    }
    setView(nextView)
  }

  const panelResizeObserverRef = useRef<ResizeObserver | null>(null)

  useLayoutEffect(() => {
    // StrictMode replays effects with the same view; comparing to the last animated view is idempotent.
    if (lastAnimatedView.current === view) {
      return
    }
    lastAnimatedView.current = view
    if (prefersReducedMotion()) {
      setPanelHeight(null)
      return
    }
    const content = panelRef.current
    if (!content) return

    // Track content while it settles; a one-shot scrollHeight can miss async data and clip the last row.
    const observer = new ResizeObserver(() => {
      setPanelHeight(content.scrollHeight)
    })
    observer.observe(content)
    panelResizeObserverRef.current = observer

    const frame = requestAnimationFrame(() => setPanelHeight(content.scrollHeight))
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      if (panelResizeObserverRef.current === observer) panelResizeObserverRef.current = null
    }
  }, [view])

  const handlePanelTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'height') return
    panelResizeObserverRef.current?.disconnect()
    panelResizeObserverRef.current = null
    setPanelHeight(null)
  }

  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false)
  const [savingCollection, setSavingCollection] = useState<number | null>(null)
  const [highlighting, setHighlighting] = useState(false)

  const bookId = book.id
  const similarBooks = booksByIds(book.similar_book_ids)
  const dialogGenres = book.genres.slice(0, 5)

  // Tracking view state
  const [draft, setRecord] = useState<ReadingProgressRecord>(() => recordFromBook(book))
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef(recordSignature(draft))
  const statusMenuRef = useRef<HTMLDivElement>(null)

  const trackedTotalPages = Number(draft.total_pages) || 0
  const trackedCurrentPage = Number(draft.current_page) || 0
  const progressPct = trackedTotalPages > 0
    ? Math.min(100, Math.max(0, Math.round((trackedCurrentPage / trackedTotalPages) * 100)))
    : 0

  const updateField = (field: keyof ReadingProgressRecord, value: string) => {
    setRecord((current) => ({
      ...current,
      [field]: value,
      // Mirrors the server dropping a DNF's finish date, so it doesn't linger until autosave round-trips.
      ...(field === 'status' && value === 'dnf' ? { finish_date: '' } : {}),
    }))
  }

  const persistRecord = async (nextRecord: ReadingProgressRecord) => {
    try {
      const payload = toPayload(nextRecord)
      const { book: saved } = await apiFetch<{ book: Book }>(`/books/${bookId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      // Clearing Total Pages means "use the catalog's length". The server answers
      // with that length, and it must not appear in the field mid-edit.
      const nextSaved: ReadingProgressRecord = {
        ...recordFromBook(saved),
        total_pages: payload.total_pages > 0 ? saved.total_pages : nextRecord.total_pages,
      }
      setRecord(nextSaved)
      lastSavedRef.current = recordSignature(nextSaved)
      applyBook(saved)
    } catch {
      // Keep the draft visible; autosave will retry on the next edit.
    }
  }

  useEffect(() => {
    if (recordSignature(draft) === lastSavedRef.current) return undefined

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      persistRecord(draft)
    }, 650)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [draft])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!statusMenuRef.current) return
      if (!statusMenuRef.current.contains(event.target as Node)) {
        setStatusMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const statusDotClass = ({
    done: 'trackingStatusDot done',
    reading: 'trackingStatusDot reading',
    dnf: 'trackingStatusDot dnf',
    want: 'trackingStatusDot want',
    not_started: 'trackingStatusDot notStarted',
  } as Record<string, string>)[draft.status] || 'trackingStatusDot'

  const handleAddToCollection = async (collection: Collection) => {
    if (savingCollection === collection.id) return
    setSavingCollection(collection.id)
    try {
      await addBookToCollection(collection.id, bookId)
      setCollectionMenuOpen(false)
      showToast(`Added “${book.title}” to ${collection.name}.`, { key: `collection:${bookId}` })
    } catch (err) {
      showError(err, 'Could not add this book.', `collection:${bookId}`)
    } finally {
      setSavingCollection(null)
    }
  }

  const articleClassName = [
    'bookDialog',
    isNavigation && 'navigating',
    exiting && 'exiting',
  ].filter(Boolean).join(' ')

  return (
      <article
        ref={cardRef}
        className={articleClassName}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="dialogIconButton dialogClose" onClick={onClose} aria-label="Close details">
          <X />
        </button>
        <div className="dialogTop">
          <div className="dialogCover">
            <BookCover book={book} />
          </div>
          <div className="dialogCopy">
            <h2>{book.title}</h2>
            {book.series ? (
              <button
                type="button"
                className="dialogSeries dialogSeriesButton"
                onClick={() => onOpenDrilldown('series', book.series)}
                aria-label={`View the ${book.series} series`}
              >
                {book.series}
                {book.series_number ? ` #${book.series_number}` : ''}
              </button>
            ) : null}
            {book.author ? (
              <button
                type="button"
                className="dialogAuthor dialogAuthorButton"
                onClick={() => onOpenDrilldown('author', book.author)}
              >
                {book.author}
              </button>
            ) : null}

            <div className="dialogTabs" role="tablist">
              <button
                type="button"
                role="tab"
                id="dialogTabAbout"
                aria-selected={view === 'library'}
                aria-controls="dialogTabPanel"
                className={view === 'library' ? 'dialogTab active' : 'dialogTab'}
                onClick={() => switchView('library')}
              >
                About
              </button>
              <button
                type="button"
                role="tab"
                id="dialogTabReading"
                aria-selected={view === 'tracking'}
                aria-controls="dialogTabPanel"
                className={view === 'tracking' ? 'dialogTab active' : 'dialogTab'}
                onClick={() => switchView('tracking')}
              >
                My Reading
              </button>
            </div>

            <div
              className={panelHeight !== null ? 'dialogTabPanelViewport animating' : 'dialogTabPanelViewport'}
              style={panelHeight !== null ? { height: panelHeight } : undefined}
              ref={panelViewportRef}
              onTransitionEnd={handlePanelTransitionEnd}
            >
            <div
              className="dialogTabPanel"
              key={view}
              id="dialogTabPanel"
              role="tabpanel"
              aria-labelledby={view === 'library' ? 'dialogTabAbout' : 'dialogTabReading'}
              ref={panelRef}
            >
            {view === 'library' ? (
              <>
                <div className="dialogStatsRow">
                  {book.avg_rating > 0 && (
                    <span className="dialogStatItem">
                      <Star />
                      <span>{book.avg_rating.toFixed(2)}{book.rating_count > 0 ? ` (${formatCompactNumber(book.rating_count)})` : ''}</span>
                    </span>
                  )}
                  {book.review_count > 0 && (
                    <span className="dialogStatItem">
                      <MessageSquareText />
                      <span>{formatCompactNumber(book.review_count)}</span>
                    </span>
                  )}
                  {book.total_pages > 0 && (
                    <span className="dialogStatItem">
                      <FileText />
                      <span>{formatCompactNumber(book.total_pages)} pages</span>
                    </span>
                  )}
                </div>

                {dialogGenres.length > 0 && <GenrePills genres={dialogGenres} />}

                <p className="dialogBlurb">{book.description || 'A great read from your library.'}</p>

                <div className="dialogActionPanel">
                  <div className="dialogActionRow">
                    <div className={collectionMenuOpen ? 'collectionMenuAnchor open' : 'collectionMenuAnchor'}>
                      <button
                        type="button"
                        className="dialogIconButton dialogCollectionButton"
                        onClick={() => setCollectionMenuOpen((value) => !value)}
                        disabled={!collections.length}
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
                              onClick={() => handleAddToCollection(collection)}
                              disabled={savingCollection === collection.id}
                            >
                              <span>{collection.name}</span>
                              {savingCollection === collection.id ? <span className="collectionPickerState">Adding…</span> : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="dialogIconButton dialogHighlightButton"
                      onClick={() => setHighlighting(true)}
                      aria-label="Add a highlight"
                      title="Add a highlight"
                    >
                      <Highlighter />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="trackingProps">
                  <div className="trackingProp" ref={statusMenuRef}>
                    <span className="trackingPropLabel">
                      <LoaderCircle aria-hidden="true" />
                      <span>Status</span>
                    </span>
                    <div className="trackingPropValue">
                      <div className={statusMenuOpen ? 'trackingStatusControl open' : 'trackingStatusControl'}>
                        <button
                          type="button"
                          className="trackingStatusButton"
                          data-status={draft.status}
                          onClick={() => setStatusMenuOpen((value) => !value)}
                          aria-haspopup="menu"
                          aria-expanded={statusMenuOpen}
                        >
                          <span className={statusDotClass} />
                          <span>{STATUS_LABELS[draft.status]}</span>
                          <ChevronDown className="trackingStatusCaret" strokeWidth={2.25} />
                        </button>
                        {statusMenuOpen && (
                          <div className="trackingStatusMenu" role="menu" aria-label="Reading status">
                            {STATUS_OPTIONS.map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                className={draft.status === value ? 'trackingStatusMenuItem active' : 'trackingStatusMenuItem'}
                                role="menuitemradio"
                                aria-checked={draft.status === value}
                                onClick={() => {
                                  updateField('status', value)
                                  setStatusMenuOpen(false)
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <label className="trackingProp">
                    <span className="trackingPropLabel">
                      <Star aria-hidden="true" />
                      <span>My Rating</span>
                    </span>
                    <span className="trackingPropValue">
                      <input
                        type="number"
                        min="0"
                        max="5"
                        step="0.01"
                        className="trackingPageInput trackingRatingInput"
                        placeholder="Empty"
                        // Only numeric 0 shows the placeholder; a typed "0" is a string, so "0.5" can be entered.
                        value={draft.my_rating === 0 ? '' : draft.my_rating}
                        onChange={(event) => updateField('my_rating', event.target.value)}
                      />
                      <span className="trackingRatingScale">/ 5</span>
                    </span>
                  </label>

                  <label className="trackingProp">
                    <span className="trackingPropLabel">
                      <Hash aria-hidden="true" />
                      <span>Total Pages</span>
                    </span>
                    <span className="trackingPropValue">
                      <input
                        type="number"
                        min="0"
                        className="trackingPageInput"
                        placeholder="Empty"
                        value={draft.total_pages}
                        onChange={(event) => updateField('total_pages', event.target.value)}
                      />
                    </span>
                  </label>

                  <label className="trackingProp">
                    <span className="trackingPropLabel">
                      <Hash aria-hidden="true" />
                      <span>Current Page</span>
                    </span>
                    <span className="trackingPropValue">
                      <input
                        type="number"
                        min="0"
                        className="trackingPageInput"
                        placeholder="Empty"
                        value={draft.current_page}
                        onChange={(event) => updateField('current_page', event.target.value)}
                      />
                    </span>
                  </label>

                  <div className="trackingProp">
                    <span className="trackingPropLabel">
                      <Sigma aria-hidden="true" />
                      <span>Progress</span>
                    </span>
                    <span className="trackingPropValue static">
                      <span className="trackingProgressPct">{progressPct}%</span>
                      <span
                        className="trackingProgressTrack"
                        role="progressbar"
                        aria-valuenow={progressPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span className="trackingProgressFill" style={{ width: `${progressPct}%` }} />
                      </span>
                    </span>
                  </div>

                  <div className="trackingProp">
                    <span className="trackingPropLabel">
                      <Calendar aria-hidden="true" />
                      <span>Started</span>
                    </span>
                    <span className="trackingPropValue">
                      <DateProperty
                        label="Started"
                        value={draft.start_date}
                        onChange={(next) => updateField('start_date', next)}
                      />
                    </span>
                  </div>

                  <div className="trackingProp">
                    <span className="trackingPropLabel">
                      <CalendarCheck aria-hidden="true" />
                      <span>Completed</span>
                    </span>
                    <span className="trackingPropValue">
                      <DateProperty
                        label="Completed"
                        value={draft.finish_date}
                        onChange={(next) => updateField('finish_date', next)}
                      />
                    </span>
                  </div>

                  <label className="trackingProp notes">
                    <span className="trackingPropLabel">
                      <TextAlignStart aria-hidden="true" />
                      <span>Notes</span>
                    </span>
                    <span className="trackingPropValue">
                      <textarea
                        rows={6}
                        value={draft.notes}
                        onChange={(event) => updateField('notes', event.target.value)}
                        placeholder="Empty"
                      />
                    </span>
                  </label>
                </div>
              </>
            )}
            </div>
            </div>
          </div>
        </div>

        {view === 'library' && (
          <div className="dialogSimilar">
            <h3>Similar Books</h3>
            <div className="dialogSimilarScroll">
              {similarBooks.length > 0 ? (
                similarBooks.map((simBook) => (
                  <button key={simBook.id} className="similarCard" onClick={() => onOpen(simBook)}>
                    <BookCover book={simBook} />
                  </button>
                ))
              ) : (
                <div className="similarCard similarCardEmpty" aria-hidden="true">
                </div>
              )}
            </div>
          </div>
        )}

        {highlighting && (
          <HighlightDialog book={book} onClose={() => setHighlighting(false)} />
        )}
      </article>
  )
}

export default BookDialog
