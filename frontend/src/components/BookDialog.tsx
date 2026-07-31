import { useState, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { X, Star, MessageSquareText, FileText, Plus, Heart, ChevronDown, Upload, Download } from 'lucide-react'
import { apiFetch } from '../api.js'
import { normaliseBook, getCatalogBookId, formatCompactNumber, resolveSavedWantToReadBook } from '../utils.js'
import { buildDialogGlow } from '../color.js'
import BookCover from './BookCover.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book, RawBookPayload } from '../types.js'

interface BookDialogProps {
  book: Book
  preferLiveStatus?: boolean
  onClose: () => void
}

interface ReadingProgressRecord {
  status: string
  current_page: number | string
  total_pages: number | string
  start_date: string
  finish_date: string
  notes: string
}

interface ReadingProgressResponse {
  book_id?: string
  entry?: Partial<ReadingProgressRecord>
}

const STATUS_LABELS: Record<string, string> = {
  done: 'Finished',
  reading: 'Reading',
  not_started: 'Not started',
}

function BookDialog({ book, preferLiveStatus = false, onClose }: BookDialogProps) {
  const { collections, wantToReadBooks, addBookToCollection, toggleBookWantToRead } = useLibraryData()
  const { onOpen, onOpenAuthor } = useNavigation()
  const [view, setView] = useState<'library' | 'tracking'>(() => (
    ['reading', 'done'].includes(book.status) ? 'tracking' : 'library'
  ))
  const panelViewportRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  const isFirstViewRender = useRef(true)

  const prefersReducedMotion = () => (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )

  const switchView = (nextView: 'library' | 'tracking') => {
    if (nextView === view) return
    if (!prefersReducedMotion()) {
      const viewport = panelViewportRef.current
      if (viewport) {
        setPanelHeight(viewport.getBoundingClientRect().height)
      }
    }
    setView(nextView)
  }

  useLayoutEffect(() => {
    if (isFirstViewRender.current) {
      isFirstViewRender.current = false
      return
    }
    if (prefersReducedMotion()) {
      setPanelHeight(null)
      return
    }
    const content = panelRef.current
    if (!content) return
    const target = content.scrollHeight
    const frame = requestAnimationFrame(() => setPanelHeight(target))
    return () => cancelAnimationFrame(frame)
  }, [view])

  const handlePanelTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'height') return
    setPanelHeight(null)
  }

  const savedWantToReadBook = resolveSavedWantToReadBook(book, wantToReadBooks)
  const [fullBook, setFullBook] = useState<Book | null>(null)
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [savingCollection, setSavingCollection] = useState('')
  const [savingToRead, setSavingToRead] = useState(false)

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

  const displayBook = fullBook ? { ...fullBook, ...book, similar_books: fullBook.similar_books || book.similar_books || [] } : book
  const similarBooks = displayBook.similar_books || []
  const dialogGenres = (displayBook.genres && displayBook.genres.length > 0)
    ? displayBook.genres.slice(0, 5)
    : (displayBook.genre ? [displayBook.genre] : [])
  const savedWantToReadKey = getCatalogBookId(savedWantToReadBook)
  const isSavedToWantToRead = Boolean(savedWantToReadBook)

  // Tracking view state
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
    notes: '',
  }

  useEffect(() => {
    let cancelled = false
    setHydrated(false)
    if (!bookId) {
      setRecord(baseRecord)
      lastSavedRef.current = JSON.stringify(baseRecord)
      setHydrated(true)
      return () => { cancelled = true }
    }

    apiFetch<ReadingProgressResponse>(`/reading-progress/${bookId}`)
      .then((data) => {
        if (cancelled) return
        const next = data?.entry || {}
        const nextRecord: ReadingProgressRecord = {
          ...baseRecord,
          ...next,
          total_pages: Number(next.total_pages) || baseRecord.total_pages,
        }
        if (preferLiveStatus) {
          nextRecord.status = baseRecord.status
        }
        setRecord(nextRecord)
        lastSavedRef.current = JSON.stringify(nextRecord)
        setHydrated(true)
      })
      .catch(() => {
        if (!cancelled) {
          const nextRecord = { ...baseRecord }
          if (preferLiveStatus) {
            nextRecord.status = baseRecord.status
          }
          setRecord(nextRecord)
          lastSavedRef.current = JSON.stringify(nextRecord)
          setHydrated(true)
        }
      })

    return () => { cancelled = true }
  }, [bookId, baseRecord.current_page, baseRecord.total_pages, baseRecord.start_date, baseRecord.finish_date])

  const draft = record || baseRecord
  const [obsidianBusy, setObsidianBusy] = useState<'push' | 'pull' | null>(null)
  const [obsidianMessage, setObsidianMessage] = useState('')
  const canSyncObsidian = Boolean(bookId) && (draft.status === 'reading' || draft.status === 'done')

  const pushToVault = async () => {
    if (!bookId || obsidianBusy) return
    setObsidianBusy('push')
    setObsidianMessage('')
    try {
      await apiFetch(`/sync/obsidian/push/${bookId}`, { method: 'POST' })
      setObsidianMessage('Pushed to vault.')
    } catch (err) {
      setObsidianMessage(err instanceof Error ? err.message : 'Could not push to vault.')
    } finally {
      setObsidianBusy(null)
    }
  }

  const pullFromVault = async () => {
    if (!bookId || obsidianBusy) return
    setObsidianBusy('pull')
    setObsidianMessage('')
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
      lastSavedRef.current = JSON.stringify(nextRecord)
      setObsidianMessage('Pulled from vault.')
    } catch (err) {
      setObsidianMessage(err instanceof Error ? err.message : 'Could not pull from vault.')
    } finally {
      setObsidianBusy(null)
    }
  }

  const updateField = (field: keyof ReadingProgressRecord, value: string) => {
    setRecord((current) => ({
      ...(current || baseRecord),
      [field]: value,
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
        notes: String(nextRecord.notes || '').trim(),
      }
      const data = await apiFetch<ReadingProgressResponse>(`/reading-progress/${bookId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const nextSaved: ReadingProgressRecord = { ...baseRecord, ...(data.entry || payload) }
      setRecord(nextSaved)
      lastSavedRef.current = JSON.stringify(nextSaved)
    } catch {
      // Keep the draft visible; autosave will retry on the next edit.
    }
  }

  useEffect(() => {
    if (!hydrated || !record) return undefined
    const signature = JSON.stringify({
      status: String(record.status || 'done').trim().toLowerCase() || 'done',
      current_page: Number(record.current_page) || 0,
      total_pages: Number(record.total_pages) || 0,
      start_date: String(record.start_date || '').trim(),
      finish_date: String(record.finish_date || '').trim(),
      notes: String(record.notes || '').trim(),
    })

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
    not_started: 'trackingStatusDot notStarted',
  } as Record<string, string>)[draft.status] || 'trackingStatusDot'

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
        <button className="dialogIconButton dialogClose" onClick={onClose} aria-label="Close details">
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
                  </div>

                  {actionMessage && <p className="dialogActionMessage">{actionMessage}</p>}
                </div>
              </>
            ) : (
              <>
                <div className="trackingStatusRow" ref={statusMenuRef}>
                  <div className={statusMenuOpen ? 'trackingStatusControl open' : 'trackingStatusControl'}>
                    <button
                      type="button"
                      className="trackingStatusButton"
                      onClick={() => setStatusMenuOpen((value) => !value)}
                      aria-haspopup="menu"
                      aria-expanded={statusMenuOpen}
                    >
                      <span>{STATUS_LABELS[draft.status]}</span>
                      <span className={statusDotClass} />
                      <ChevronDown className="trackingStatusCaret" strokeWidth={2.25} />
                    </button>
                    {statusMenuOpen && (
                      <div className="trackingStatusMenu" role="menu" aria-label="Reading status">
                        {[
                          ['done', 'Finished'],
                          ['reading', 'Reading'],
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

                {canSyncObsidian && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                    {obsidianMessage && <span className="dialogActionMessage">{obsidianMessage}</span>}
                  </div>
                )}

                <div className="trackingPanel">
                  <div className="trackingFieldRow">
                    <label className="trackingField">
                      <span>Progress</span>
                      <div className="trackingFieldValue">
                        <input
                          type="number"
                          min="0"
                          className="trackingPageInput"
                          value={draft.current_page}
                          onChange={(event) => updateField('current_page', event.target.value)}
                        />
                        <span className="trackingFieldSep">/</span>
                        <input
                          type="number"
                          min="0"
                          className="trackingPageInput"
                          value={draft.total_pages}
                          onChange={(event) => updateField('total_pages', event.target.value)}
                        />
                        <span className="trackingFieldUnit">pages</span>
                      </div>
                    </label>
                  </div>

                  <div className="trackingFieldRow twoCol">
                    <label className="trackingField">
                      <span>Start</span>
                      <input
                        type="date"
                        value={draft.start_date}
                        onChange={(event) => updateField('start_date', event.target.value)}
                      />
                    </label>
                    <label className="trackingField">
                      <span>End</span>
                      <input
                        type="date"
                        value={draft.finish_date}
                        onChange={(event) => updateField('finish_date', event.target.value)}
                      />
                    </label>
                  </div>

                  <label className="trackingNotes">
                    <span>Notes</span>
                    <textarea
                      rows={7}
                      value={draft.notes}
                      onChange={(event) => updateField('notes', event.target.value)}
                      placeholder="Add a few thoughts, a memorable passage, or why this one mattered."
                    />
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
        )}
      </article>
    </div>
  )
}

export default BookDialog
