import { useState, useEffect, useLayoutEffect, useRef, type Ref } from 'react'
import {
  X, Star, MessageSquareText, FileText, Plus, Heart, Highlighter, ChevronDown, Upload, Download,
  LoaderCircle, Hash, Sigma, Calendar, CalendarCheck, TextAlignStart,
} from 'lucide-react'
import { apiFetch } from '../../api.js'
import { normaliseBook, getCatalogBookId, formatCompactNumber, resolveSavedWantToReadBook } from '../../utils.js'
import BookCover from '../books/BookCover.jsx'
import DateProperty from './DateProperty.jsx'
import GenrePills from '../books/GenrePills.jsx'
import HighlightDialog from './HighlightDialog.jsx'
import { useLibraryData } from '../../context/LibraryDataContext.jsx'
import { useNavigation } from '../../context/NavigationContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import type { DialogCloseProps } from './Dialog.jsx'
import type { Book, BookProps, RawBookPayload, VaultAction } from '../../types.js'

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

interface ReadingProgressResponse {
  entry?: Partial<ReadingProgressRecord>
}

// Saved-state fingerprint. Both sides must use exactly these fields or autosave fires on every open.
const recordSignature = (record: ReadingProgressRecord): string => JSON.stringify({
  status: String(record.status || 'done').trim().toLowerCase() || 'done',
  current_page: Number(record.current_page) || 0,
  total_pages: Number(record.total_pages) || 0,
  start_date: String(record.start_date || '').trim(),
  finish_date: String(record.finish_date || '').trim(),
  // Rounded to the server's two decimals so the fingerprint matches the PUT response and autosave settles.
  my_rating: Math.round((Number(record.my_rating) || 0) * 100) / 100,
  notes: String(record.notes || '').trim(),
})

// 0, '' and [] are normaliseBook's stand-ins for a missing field, not real values.
const hasValue = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  if (typeof value === 'string') return value.trim() !== ''
  return value !== null && value !== undefined
}

const STATUS_LABELS: Record<string, string> = {
  done: 'Finished',
  reading: 'Reading',
  dnf: 'DNF',
  not_started: 'Not started',
}

// Mirrors TRACKED_STATUSES on the server; these books open on the tracking panel.
const TRACKED_STATUSES = ['reading', 'done', 'dnf']

function BookDialog({ book, isNavigation = false, exiting = false, cardRef, onClose }: BookDialogProps) {
  const { collections, wantToReadBooks, addBookToCollection, toggleBookWantToRead, refreshLibrary } = useLibraryData()
  const { onOpen, onOpenAuthor, onOpenSeries } = useNavigation()
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

  const savedWantToReadBook = resolveSavedWantToReadBook(book, wantToReadBooks)
  const [fullBook, setFullBook] = useState<Book | null>(null)
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false)
  const [savingCollection, setSavingCollection] = useState('')
  const [savingToRead, setSavingToRead] = useState(false)
  const [highlighting, setHighlighting] = useState(false)

  const bookId = [
    book?._raw?.id,
    book?.id,
    getCatalogBookId(book),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)[0] || ''

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

  // The card's payload wins, but only where it has a value, so sparse rows don't blank fetched fields.
  const displayBook = fullBook
    ? {
        ...fullBook,
        ...(Object.fromEntries(
          Object.entries(book).filter(([key, value]) => hasValue(value) || !hasValue(fullBook[key as keyof Book])),
        ) as Partial<Book>),
        similar_books: fullBook.similar_books || book.similar_books || [],
      } as Book
    : book
  const similarBooks = displayBook.similar_books || []
  const dialogGenres = (displayBook.genres && displayBook.genres.length > 0)
    ? displayBook.genres.slice(0, 5)
    : (displayBook.genre ? [displayBook.genre] : [])
  const savedWantToReadKey = getCatalogBookId(savedWantToReadBook)
  const isSavedToWantToRead = Boolean(savedWantToReadBook)

  const [record, setRecord] = useState<ReadingProgressRecord | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef('')
  const statusMenuRef = useRef<HTMLDivElement>(null)
  const baseRecord: ReadingProgressRecord = {
    status: book.status || 'not_started',
    current_page: book.currentPage || 0,
    total_pages: book.totalPages || book.pages || 0,
    start_date: book.startDate || '',
    finish_date: book.finishDate || '',
    my_rating: 0,
    notes: '',
  }

  useEffect(() => {
    let cancelled = false
    setHydrated(false)
    if (!bookId) {
      setRecord(baseRecord)
      lastSavedRef.current = recordSignature(baseRecord)
      setHydrated(true)
      return () => { cancelled = true }
    }

    // The fetched entry is authoritative; baseRecord only fills the gap before it lands.
    apiFetch<ReadingProgressResponse>(`/reading-progress/${bookId}`)
      .then((data) => {
        if (cancelled) return
        const next = data?.entry || {}
        const nextRecord: ReadingProgressRecord = {
          ...baseRecord,
          ...next,
          total_pages: Number(next.total_pages) || baseRecord.total_pages,
        }
        setRecord(nextRecord)
        lastSavedRef.current = recordSignature(nextRecord)
        setHydrated(true)
      })
      .catch(() => {
        if (!cancelled) {
          const nextRecord = { ...baseRecord }
          setRecord(nextRecord)
          lastSavedRef.current = recordSignature(nextRecord)
          setHydrated(true)
        }
      })

    return () => { cancelled = true }
  }, [bookId, baseRecord.current_page, baseRecord.total_pages, baseRecord.start_date, baseRecord.finish_date])

  const draft = record || baseRecord
  const trackedTotalPages = Number(draft.total_pages) || 0
  const trackedCurrentPage = Number(draft.current_page) || 0
  const progressPct = trackedTotalPages > 0
    ? Math.min(100, Math.max(0, Math.round((trackedCurrentPage / trackedTotalPages) * 100)))
    : 0
  const [obsidianBusy, setObsidianBusy] = useState<VaultAction | null>(null)
  const canSyncObsidian = Boolean(bookId) && TRACKED_STATUSES.includes(draft.status)

  // Toasts outlive the dialog, so they name the book.
  const vaultToastKey = `vault:${bookId}`

  const pushToVault = async () => {
    if (!bookId || obsidianBusy) return
    setObsidianBusy('push')
    try {
      await apiFetch(`/sync/obsidian/push/${bookId}`, { method: 'POST' })
      showToast(`Pushed “${displayBook.title}” to the vault.`, { key: vaultToastKey })
    } catch (err) {
      showError(err, 'Could not push to vault.', vaultToastKey)
    } finally {
      setObsidianBusy(null)
    }
  }

  const pullFromVault = async () => {
    if (!bookId || obsidianBusy) return
    setObsidianBusy('pull')
    try {
      await apiFetch(`/sync/obsidian/pull/${bookId}`, { method: 'POST' })
      const refreshed = await apiFetch<ReadingProgressResponse>(`/reading-progress/${bookId}`)
      const nextEntry = refreshed?.entry || {}
      const nextRecord: ReadingProgressRecord = {
        ...baseRecord,
        ...nextEntry,
        total_pages: Number(nextEntry.total_pages) || baseRecord.total_pages,
      }
      setRecord(nextRecord)
      lastSavedRef.current = recordSignature(nextRecord)
      await refreshLibrary()
      showToast(`Pulled “${displayBook.title}” from the vault.`, { key: vaultToastKey })
    } catch (err) {
      showError(err, 'Could not pull from vault.', vaultToastKey)
    } finally {
      setObsidianBusy(null)
    }
  }

  const updateField = (field: keyof ReadingProgressRecord, value: string) => {
    setRecord((current) => ({
      ...(current || baseRecord),
      [field]: value,
      // Mirrors the server dropping a DNF's finish date, so it doesn't linger until autosave round-trips.
      ...(field === 'status' && value === 'dnf' ? { finish_date: '' } : {}),
    }))
  }

  const persistRecord = async (nextRecord: ReadingProgressRecord) => {
    if (!bookId) return
    try {
      const payload = {
        status: String(nextRecord.status || 'done').trim().toLowerCase() || 'done',
        current_page: Math.max(0, parseInt(String(nextRecord.current_page), 10) || 0),
        total_pages: Math.max(0, parseInt(String(nextRecord.total_pages), 10) || 0),
        start_date: String(nextRecord.start_date || '').trim(),
        finish_date: String(nextRecord.finish_date || '').trim(),
        my_rating: Math.min(5, Math.max(0, Number(nextRecord.my_rating) || 0)),
        notes: String(nextRecord.notes || '').trim(),
      }
      const data = await apiFetch<ReadingProgressResponse>(`/reading-progress/${bookId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const nextSaved: ReadingProgressRecord = { ...baseRecord, ...(data.entry || payload) }
      setRecord(nextSaved)
      lastSavedRef.current = recordSignature(nextSaved)
      // "Reading now" and "Finished" derive from the app-level list, which nothing else refills after an edit.
      await refreshLibrary()
    } catch {
      // Keep the draft visible; autosave will retry on the next edit.
    }
  }

  useEffect(() => {
    if (!hydrated || !record) return undefined
    const signature = recordSignature(record)

    if (signature === lastSavedRef.current) return undefined

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      persistRecord(record)
    }, 650)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [record, hydrated])

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
    not_started: 'trackingStatusDot notStarted',
  } as Record<string, string>)[draft.status] || 'trackingStatusDot'

  const handleSave = async () => {
    if (!bookId || savingToRead) return
    setSavingToRead(true)
    try {
      const nextSaved = !isSavedToWantToRead
      await toggleBookWantToRead(isSavedToWantToRead ? savedWantToReadKey : bookId, isSavedToWantToRead)
      showToast(
        nextSaved
          ? `Saved “${displayBook.title}” to Want to read.`
          : `Removed “${displayBook.title}” from Want to read.`,
        { key: `want-to-read:${bookId}` },
      )
    } catch (err) {
      showError(err, 'Could not save this book.', `want-to-read:${bookId}`)
    } finally {
      setSavingToRead(false)
    }
  }

  const handleAddToCollection = async (collectionName: string) => {
    if (!bookId || !collectionName || savingCollection === collectionName) return
    setSavingCollection(collectionName)
    try {
      await addBookToCollection(collectionName, bookId)
      setCollectionMenuOpen(false)
      showToast(`Added “${displayBook.title}” to ${collectionName}.`, { key: `collection:${bookId}` })
    } catch (err) {
      showError(err, 'Could not add this book.', `collection:${bookId}`)
    } finally {
      setSavingCollection('')
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
            <BookCover book={displayBook} />
            {view === 'tracking' && canSyncObsidian && (
              <div className="trackingVault">
                <div className="trackingVaultRow">
                  <button
                    type="button"
                    className="dialogIconButton"
                    onClick={pushToVault}
                    disabled={obsidianBusy !== null}
                    aria-label="Push this book to the Obsidian vault"
                    title="Push to vault"
                  >
                    <Upload />
                  </button>
                  <button
                    type="button"
                    className="dialogIconButton"
                    onClick={pullFromVault}
                    disabled={obsidianBusy !== null}
                    aria-label="Pull this book from the Obsidian vault"
                    title="Pull from vault"
                  >
                    <Download />
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="dialogCopy">
            <h2>{displayBook.title}</h2>
            {displayBook.series ? (
              <button
                type="button"
                className="dialogSeries dialogSeriesButton"
                onClick={() => onOpenSeries(displayBook.series)}
                aria-label={`View the ${displayBook.series} series`}
              >
                {displayBook.series}
                {displayBook.seriesNumber ? ` #${displayBook.seriesNumber}` : ''}
              </button>
            ) : null}
            {displayBook.author ? (
              <button
                type="button"
                className="dialogAuthor dialogAuthorButton"
                onClick={() => onOpenAuthor(displayBook.author)}
              >
                {displayBook.author}
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
                  {displayBook.rating > 0 && (
                    <span className="dialogStatItem">
                      <Star />
                      <span>{displayBook.rating.toFixed(2)}{displayBook.ratingCount > 0 ? ` (${formatCompactNumber(displayBook.ratingCount)})` : ''}</span>
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

                {dialogGenres.length > 0 && <GenrePills genres={dialogGenres} />}

                <p className="dialogBlurb">{displayBook.blurb || 'A great read from your library.'}</p>

                <div className="dialogActionPanel">
                  <div className="dialogActionRow">
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
                      className="dialogIconButton dialogHighlightButton"
                      onClick={() => setHighlighting(true)}
                      disabled={!bookId}
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
                            {[
                              ['done', 'Finished'],
                              ['reading', 'Reading'],
                              ['dnf', 'DNF'],
                              ['not_started', 'Not started'],
                            ].map(([value, label]) => (
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
                similarBooks.map((simRaw) => {
                  const simBook = normaliseBook(simRaw)
                  return (
                    <button key={simBook.id} className="similarCard" onClick={() => onOpen(simBook)}>
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
        )}

        {highlighting && (
          <HighlightDialog book={displayBook} onClose={() => setHighlighting(false)} />
        )}
      </article>
  )
}

export default BookDialog
