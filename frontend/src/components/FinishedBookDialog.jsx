import { useState, useEffect, useRef } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { apiFetch } from '../api.js'
import { getCatalogBookId } from '../utils.js'
import BookCover from './BookCover.jsx'

function FinishedBookDialog({ book, preferLiveStatus = false, onClose, onOpenAuthor }) {
  const [record, setRecord] = useState(null)
  const [hydrated, setHydrated] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const saveTimerRef = useRef(null)
  const lastSavedRef = useRef('')
  const statusMenuRef = useRef(null)
  const bookId = [
    book?._raw?.id,
    book?.id,
    book?.uid,
    getCatalogBookId(book),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)[0] || ''
  const baseRecord = {
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

    apiFetch(`/reading-progress/${bookId}`)
      .then((data) => {
        if (cancelled) return
        const next = data?.entry || {}
        const nextRecord = {
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

  const updateField = (field, value) => {
    setRecord((current) => ({
      ...(current || baseRecord),
      [field]: value,
    }))
  }

  const persistRecord = async (nextRecord) => {
    if (!bookId) return
    try {
      const payload = {
        status: String(nextRecord.status || 'done').trim().toLowerCase() || 'done',
        current_page: Math.max(0, parseInt(nextRecord.current_page, 10) || 0),
        total_pages: Math.max(0, parseInt(nextRecord.total_pages, 10) || 0),
        start_date: String(nextRecord.start_date || '').trim(),
        finish_date: String(nextRecord.finish_date || '').trim(),
        notes: String(nextRecord.notes || '').trim(),
      }
      const data = await apiFetch(`/reading-progress/${bookId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const nextSaved = { ...baseRecord, ...(data.entry || payload) }
      setRecord(nextSaved)
      lastSavedRef.current = JSON.stringify(nextSaved)
    } catch (err) {
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
    function handlePointerDown(event) {
      if (!statusMenuRef.current) return
      if (!statusMenuRef.current.contains(event.target)) {
        setStatusMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const statusLabelMap = {
    done: 'Finished',
    reading: 'Reading',
    not_started: 'Want to read',
  }
  const statusDotClass = {
    done: 'finishedStatusDot done',
    reading: 'finishedStatusDot reading',
    not_started: 'finishedStatusDot notStarted',
  }[draft.status] || 'finishedStatusDot'

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
                      ['not_started', 'Want to read'],
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
                  rows="7"
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
