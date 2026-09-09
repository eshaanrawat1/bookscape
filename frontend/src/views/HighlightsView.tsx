import { useState, type KeyboardEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import BookCover from '../components/BookCover.jsx'
import BrandMark from '../components/BrandMark.jsx'
import HighlightDialog from '../components/HighlightDialog.jsx'
import useAutoGrowTextarea from '../hooks/useAutoGrowTextarea.js'
import useHighlights from '../hooks/useHighlights.js'
import { formatDayLabel } from '../utils.js'
import { useToast } from '../context/ToastContext.jsx'
import type { Highlight, HighlightGroup } from '../types.js'

function HighlightsView() {
  const { groups, loading, error, applyGroup, updateHighlight, deleteHighlight } = useHighlights()
  const { showToast } = useToast()
  // The selection is a book id rather than an index: the list reorders as
  // highlights are added, and an index would silently follow whatever book
  // moved into that slot.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  const selected = groups.find((group) => group.bookId === selectedId) || groups[0] || null

  const handleListKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = groups.findIndex((group) => group.bookId === selected?.bookId)
    const next = event.key === 'ArrowDown'
      ? (index + 1 >= groups.length ? 0 : index + 1)
      : (index <= 0 ? groups.length - 1 : index - 1)
    setSelectedId(groups[next]?.bookId ?? null)
  }

  if (loading) {
    return <div className="emptyState"><p>Loading your highlights…</p></div>
  }

  if (error) {
    return <div className="emptyState"><h2>Could not load highlights</h2><p>{error}</p></div>
  }

  // No create button here on purpose: a highlight is always saved against a
  // book, so the one way in is the highlight button on the book itself — and
  // this page is where you find out that is where to go.
  if (groups.length === 0) {
    return (
      <div className="highlightsEmpty">
        <BrandMark className="highlightsEmptyMark" />
        <h2>You don’t have any highlights</h2>
        <p>Open any book and use the highlight button to save your first passage.</p>
      </div>
    )
  }

  return (
    <div className="highlightsLayout">
      <section className="highlightsBookPane" aria-label="Books with highlights">
        <div
          className="highlightsBookList"
          role="listbox"
          tabIndex={0}
          aria-label="Books with highlights"
          aria-activedescendant={selected ? `highlightBook-${selected.bookId}` : undefined}
          onKeyDown={handleListKeyDown}
        >
          {groups.map((group) => (
            <BookRow
              key={group.bookId}
              group={group}
              active={group.bookId === selected?.bookId}
              onSelect={() => setSelectedId(group.bookId)}
            />
          ))}
        </div>
      </section>

      {selected && (
        <section className="highlightsDetailPane" aria-label={`Highlights from ${selected.book.title}`}>
          <header className="highlightsDetailHeader">
            <div>
              <h2>{selected.book.title}</h2>
              <p>{countLabel(selected.count)}</p>
            </div>
            <button type="button" className="primaryButton highlightsNewButton" onClick={() => setComposing(true)}>
              <Plus />
              New
            </button>
          </header>

          <div className="highlightCardList">
            {selected.highlights.map((highlight) => (
              <HighlightCard
                key={highlight.id}
                highlight={highlight}
                onSaveNote={async (note) => {
                  try {
                    await updateHighlight(highlight.id, { note })
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Could not save the note.', {
                      tone: 'error',
                      key: `highlight:${highlight.id}`,
                    })
                  }
                }}
                onSaveEdit={async (fields) => {
                  try {
                    await updateHighlight(highlight.id, fields)
                    return true
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Could not save the highlight.', {
                      tone: 'error',
                      key: `highlight:${highlight.id}`,
                    })
                    // Reported false so the card stays in edit mode on the text
                    // that failed rather than reverting it out from under you.
                    return false
                  }
                }}
                onDelete={async () => {
                  try {
                    await deleteHighlight(highlight.id)
                    showToast('Highlight deleted.', { key: `highlight:${highlight.id}` })
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Could not delete the highlight.', {
                      tone: 'error',
                      key: `highlight:${highlight.id}`,
                    })
                  }
                }}
              />
            ))}
          </div>
        </section>
      )}

      {composing && selected && (
        <HighlightDialog
          book={selected.book}
          onClose={() => setComposing(false)}
          onCreated={(group) => {
            applyGroup(group)
            setSelectedId(group.book_id)
          }}
        />
      )}
    </div>
  )
}

// How far the note field grows before it starts scrolling. The backend caps the
// stored text at 5000 characters; this is the layout's own guard, so a pasted
// wall of text cannot push the highlights below it off the page.
const NOTE_MAX_LINES = 5

function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'highlight' : 'highlights'}`
}

interface BookRowProps {
  group: HighlightGroup
  active: boolean
  onSelect: () => void
}

function BookRow({ group, active, onSelect }: BookRowProps) {
  return (
    <button
      type="button"
      id={`highlightBook-${group.bookId}`}
      role="option"
      aria-selected={active}
      className={active ? 'highlightsBookRow active' : 'highlightsBookRow'}
      onClick={onSelect}
    >
      <span className="highlightsBookCopy">
        <strong>{group.book.title}</strong>
        <span>{countLabel(group.count)}</span>
      </span>
      <span className="highlightsBookCover">
        <BookCover book={group.book} lazy />
      </span>
    </button>
  )
}

interface HighlightCardProps {
  highlight: Highlight
  onSaveNote: (note: string) => Promise<void>
  // Resolves true when the write landed; false leaves the card in edit mode.
  onSaveEdit: (fields: { text: string; page: number }) => Promise<boolean>
  onDelete: () => Promise<void>
}

function HighlightCard({ highlight, onSaveNote, onSaveEdit, onDelete }: HighlightCardProps) {
  const [note, setNote] = useState(highlight.note)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  // The note grows with what you type, up to five lines, after which it
  // scrolls — a note long enough to push the rest of the page out of view is
  // not a note. The edit field above it keeps a fixed box and a resize handle
  // instead, since a highlight can run to a full passage.
  const noteRef = useAutoGrowTextarea(note, { maxLines: NOTE_MAX_LINES })
  const [draftText, setDraftText] = useState(highlight.text)
  const [draftPage, setDraftPage] = useState(highlight.page > 0 ? String(highlight.page) : '')

  // Reopened from whatever is stored rather than from the last draft, so
  // cancelling an edit and starting again begins from the saved text.
  const startEditing = () => {
    setDraftText(highlight.text)
    setDraftPage(highlight.page > 0 ? String(highlight.page) : '')
    setEditing(true)
  }

  const saveEdit = async () => {
    const text = draftText.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      if (await onSaveEdit({ text, page: Number(draftPage) || 0 })) setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  // Saved on blur rather than on every keystroke, and only when the text has
  // actually moved — tabbing through a card should not write to the database.
  const commitNote = async (field: HTMLTextAreaElement) => {
    // Escape blurs the field to dismiss it, which would otherwise land here and
    // save the very text it just abandoned. Flagged on the element rather than
    // in state because setState has not re-rendered by the time blur fires —
    // the same reason the sidebar's rename field carries a cancel flag.
    if (field.dataset.cancelNote === 'true') {
      delete field.dataset.cancelNote
      return
    }
    const clean = note.trim()
    if (clean === highlight.note) return
    setBusy(true)
    try {
      await onSaveNote(clean)
    } finally {
      setBusy(false)
    }
  }

  const meta = [
    highlight.page > 0 ? `Page ${highlight.page}` : '',
    formatDayLabel(highlight.createdAt),
  ].filter(Boolean).join('  ·  ')

  if (editing) {
    return (
      <article className="highlightCard">
        <textarea
          className="highlightEditInput"
          value={draftText}
          rows={5}
          autoFocus
          disabled={busy}
          aria-label="Highlight text"
          onChange={(event) => setDraftText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(false)
          }}
        />
        <div className="highlightMetaRow highlightEditRow">
          <label className="highlightEditPage">
            <span>Page</span>
            <input
              type="text"
              inputMode="numeric"
              value={draftPage}
              disabled={busy}
              placeholder="0"
              onChange={(event) => setDraftPage(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <div className="highlightEditActions">
            <button type="button" className="secondaryButton" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="primaryButton" onClick={saveEdit} disabled={busy || !draftText.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="highlightCard">
      <blockquote className="highlightQuote">{highlight.text}</blockquote>
      <div className="highlightMetaRow">
        <span className="highlightMeta">{meta}</span>
        <div className="highlightCardActions">
          <button
            type="button"
            className="highlightCardButton"
            onClick={startEditing}
            aria-label="Edit highlight"
          >
            <Pencil />
            Edit
          </button>
          <button
            type="button"
            className="highlightCardButton highlightDeleteButton"
            onClick={onDelete}
            aria-label="Delete highlight"
          >
            <Trash2 />
            Delete
          </button>
        </div>
      </div>
      <textarea
        ref={noteRef}
        className="highlightNoteInput"
        value={note}
        rows={1}
        disabled={busy}
        placeholder="Add note"
        aria-label="Note on this highlight"
        onChange={(event) => setNote(event.target.value)}
        onBlur={(event) => commitNote(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.currentTarget.dataset.cancelNote = 'true'
            setNote(highlight.note)
            event.currentTarget.blur()
          }
        }}
      />
    </article>
  )
}

export default HighlightsView
