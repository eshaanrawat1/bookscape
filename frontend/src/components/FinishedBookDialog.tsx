import { useState, useEffect, useRef } from 'react'
import { X, ChevronDown, Upload, Download } from 'lucide-react'
import { apiFetch } from '../api.js'
import { getCatalogBookId } from '../utils.js'
import BookCover from './BookCover.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book } from '../types.js'

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

interface FinishedBookDialogProps {
  book: Book
  preferLiveStatus?: boolean
  onClose: () => void
}

function FinishedBookDialog({ book, preferLiveStatus = false, onClose }: FinishedBookDialogProps) {
  const { onOpenAuthor } = useNavigation()
  const [record, setRecord] = useState<ReadingProgressRecord | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef('')
  const statusMenuRef = useRef<HTMLDivElement>(null)
  const bookId = [
    book?._raw?.id,
    book?.id,
    getCatalogBookId(book),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)[0] || ''
  const baseRecord: ReadingProgressRecord = {
    status: book.status || 'not_started',
    current_page: book.currentPage ?? book.pages ?? 0,
    total_pages: book.totalPages ?? book.pages ?? 0,
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
      const nextRecord: ReadingProgressRecord = { ...baseRecord, ...(refreshed?.entry || {}) }
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

  const statusLabelMap: Record<string, string> = {
    done: 'Finished',
    reading: 'Reading',
    not_started: 'Not started',
  }
  const statusDotClass = ({
    done: 'finishedStatusDot done',
    reading: 'finishedStatusDot reading',
    not_started: 'finishedStatusDot notStarted',
  } as Record<string, string>)[draft.status] || 'finishedStatusDot'

  return (
    <div className="dialogScrim finishedScrim" onClick={onClose}>
      <article className="bookDialog finishedBookDialog paperGrain" onClick={(event) => event.stopPropagation()}>
        <button className="dialogClose" onClick={onClose} aria-label="Close details">
          <X />
        </button>

        <div className="finishedDialogTop">
          <div className="finishedCoverColumn">
            <div className="finishedCoverWrap">
              <BookCover book={book} glow />
            </div>
          </div>

          <div className="finishedCopy">
            <div className="finishedHeader">
              <div>
                <h2>{book.title}</h2>
                {book.author ? (
                  <button
                    type="button"
                    className="finishedAuthorButton"
                    onClick={() => onOpenAuthor?.(book.author)}
                    disabled={!onOpenAuthor}
                  >
                    {book.author}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="finishedStatusRow" ref={statusMenuRef}>
              <div className={statusMenuOpen ? 'finishedStatusControl open' : 'finishedStatusControl'}>
                <button
                  type="button"
                  className="finishedStatusButton"
                  onClick={() => setStatusMenuOpen((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={statusMenuOpen}
                >
                  <span>{statusLabelMap[draft.status] || 'Finished'}</span>
                  <span className={statusDotClass} />
                  <ChevronDown className="finishedStatusCaret" strokeWidth={2.25} />
                </button>
                {statusMenuOpen && (
                  <div className="finishedStatusMenu" role="menu" aria-label="Reading status">
                    {[
                      ['done', 'Finished'],
                      ['reading', 'Reading'],
                      ['not_started', 'Not started'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={draft.status === value ? 'finishedStatusMenuItem active' : 'finishedStatusMenuItem'}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
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

            <div className="finishedPanel">
              <div className="finishedFieldRow">
                <label className="finishedField">
                  <span>Progress</span>
                  <div className="finishedFieldValue">
                    <input
                      type="number"
                      min="0"
                      className="finishedPageInput"
                      value={draft.current_page}
                      onChange={(event) => updateField('current_page', event.target.value)}
                    />
                    <span className="finishedFieldSep">/</span>
                    <input
                      type="number"
                      min="0"
                      className="finishedPageInput"
                      value={draft.total_pages}
                      onChange={(event) => updateField('total_pages', event.target.value)}
                    />
                    <span className="finishedFieldUnit">pages</span>
                  </div>
                </label>
              </div>

              <div className="finishedFieldRow twoCol">
                <label className="finishedField">
                  <span>Start</span>
                  <input
                    type="date"
                    value={draft.start_date}
                    onChange={(event) => updateField('start_date', event.target.value)}
                  />
                </label>
                <label className="finishedField">
                  <span>End</span>
                  <input
                    type="date"
                    value={draft.finish_date}
                    onChange={(event) => updateField('finish_date', event.target.value)}
                  />
                </label>
              </div>

              <label className="finishedNotes">
                <span>Notes</span>
                <textarea
                  rows={7}
                  value={draft.notes}
                  onChange={(event) => updateField('notes', event.target.value)}
                  placeholder="Add a few thoughts, a memorable passage, or why this one mattered."
                />
              </label>
            </div>
          </div>
        </div>

      </article>
    </div>
  )
}

export default FinishedBookDialog
