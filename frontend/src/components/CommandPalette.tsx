import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import BookCover from './BookCover.jsx'
import { searchBooks, formatCompactNumber } from '../utils.js'
import { filterCommands } from '../commands.js'
import { useNavigation } from '../context/NavigationContext.jsx'
import useModalLayer from '../hooks/useModalLayer.js'
import useListNavigation from '../hooks/useListNavigation.js'
import type { Book, Command, CommandGroup } from '../types.js'

// Matches the search view's preview so the two surfaces feel like one thing.
const DEBOUNCE_MS = 180
const BOOK_LIMIT = 8

type PaletteRow =
  | { kind: 'command'; key: string; group: CommandGroup; command: Command }
  | { kind: 'book'; key: string; group: 'Books'; book: Book }

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const { onOpen } = useNavigation()
  const [query, setQuery] = useState('')
  const [books, setBooks] = useState<Book[]>([])
  const [booksLoading, setBooksLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  // No blocksHotkeys: ⌘K should toggle the palette shut and ⌘1–6 should
  // navigate straight through it.
  useModalLayer({ onEscape: onClose })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trimmed = query.trim()

  useEffect(() => {
    if (!trimmed) {
      setBooks([])
      setBooksLoading(false)
      return undefined
    }

    setBooksLoading(true)
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchBooks(trimmed, BOOK_LIMIT)
        if (!cancelled) setBooks(results)
      } catch {
        // A failed lookup just means no book rows; the commands still work.
        if (!cancelled) setBooks([])
      } finally {
        if (!cancelled) setBooksLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmed])

  const rows: PaletteRow[] = useMemo(() => {
    const commandRows: PaletteRow[] = filterCommands(commands, trimmed).map((command) => ({
      kind: 'command',
      key: command.id,
      group: command.group,
      command,
    }))
    const bookRows: PaletteRow[] = books.map((book) => ({
      kind: 'book',
      key: `book:${book.id}`,
      group: 'Books',
      book,
    }))
    return [...commandRows, ...bookRows]
  }, [commands, trimmed, books])

  const runRow = (index: number) => {
    const row = rows[index]
    if (!row) return
    // Close first: a command that opens another dialog (Add Book, Vault
    // Settings) would otherwise leave the palette stacked on top of it.
    onClose()
    if (row.kind === 'book') {
      onOpen(row.book)
    } else {
      void row.command.run()
    }
  }

  const { activeIndex, setActiveIndex, handleKeyDown } = useListNavigation(rows.length, {
    initialIndex: 0,
    onSelect: runRow,
  })

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const activeId = activeIndex >= 0 && rows[activeIndex] ? `paletteRow-${activeIndex}` : undefined

  return (
    <div className="dialogScrim paletteScrim" onClick={onClose}>
      <article
        className="bookDialog paperGrain commandPalette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="paletteField">
          <Search />
          <input
            ref={inputRef}
            type="text"
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder="Search books or run a command…"
            aria-label="Search books or run a command"
            aria-autocomplete="list"
            aria-controls="paletteResults"
            aria-activedescendant={activeId}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="paletteResults" id="paletteResults" role="listbox" aria-label="Results">
          {rows.length === 0 ? (
            <p className="paletteStatus">
              {booksLoading ? 'Searching books…' : `No matches for “${trimmed}”.`}
            </p>
          ) : (
            rows.map((row, index) => (
              <PaletteRowItem
                key={row.key}
                row={row}
                index={index}
                active={index === activeIndex}
                showHeader={index === 0 || rows[index - 1].group !== row.group}
                rowRef={(node) => { rowRefs.current[index] = node }}
                onHover={() => setActiveIndex(index)}
                onRun={() => runRow(index)}
              />
            ))
          )}
          {rows.length > 0 && booksLoading ? (
            <p className="paletteStatus">Searching books…</p>
          ) : null}
        </div>

        <footer className="paletteFooter">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </article>
    </div>
  )
}

interface PaletteRowItemProps {
  row: PaletteRow
  index: number
  active: boolean
  showHeader: boolean
  rowRef: (node: HTMLButtonElement | null) => void
  onHover: () => void
  onRun: () => void
}

function PaletteRowItem({ row, index, active, showHeader, rowRef, onHover, onRun }: PaletteRowItemProps) {
  return (
    <>
      {showHeader ? <p className="paletteGroupLabel">{row.group}</p> : null}
      <button
        ref={rowRef}
        type="button"
        id={`paletteRow-${index}`}
        role="option"
        aria-selected={active}
        className={active ? 'paletteRow active' : 'paletteRow'}
        // Keeps focus (and so the caret) in the input when a row is clicked.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={onHover}
        onClick={onRun}
      >
        {row.kind === 'book' ? (
          <>
            <span className="paletteRowCover">
              <BookCover book={row.book} />
            </span>
            <span className="paletteRowCopy">
              <strong>{row.book.title}</strong>
              {row.book.author ? <span>{row.book.author}</span> : null}
            </span>
            <span className="paletteRowHint">{bookMeta(row.book)}</span>
          </>
        ) : (
          <>
            <span className="paletteRowIcon"><row.command.icon /></span>
            <span className="paletteRowCopy">
              <strong>{row.command.label}</strong>
            </span>
            {row.command.hint ? <kbd className="paletteRowHint">{row.command.hint}</kbd> : null}
          </>
        )}
      </button>
    </>
  )
}

function bookMeta(book: Book): string {
  const parts: string[] = []
  if (book.genre) parts.push(book.genre)
  if (book.pages) parts.push(`${formatCompactNumber(book.pages)} pages`)
  return parts.join(' · ')
}

export default CommandPalette
