import { useState, type KeyboardEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import BookCover from '../components/BookCover.jsx'
import BrandMark from '../components/BrandMark.jsx'
import HighlightDialog from '../components/HighlightDialog.jsx'
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
  onDelete: () => Promise<void>
}

function HighlightCard({ highlight, onSaveNote, onDelete }: HighlightCardProps) {
  const [note, setNote] = useState(highlight.note)
  const [busy, setBusy] = useState(false)

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

  return (
    <article className="highlightCard">
      <blockquote className="highlightQuote">{highlight.text}</blockquote>
      <div className="highlightMetaRow">
        <span className="highlightMeta">{meta}</span>
        <button
          type="button"
          className="highlightDeleteButton"
          onClick={onDelete}
          aria-label="Delete highlight"
        >
          <Trash2 />
          Delete
        </button>
      </div>
      <textarea
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
