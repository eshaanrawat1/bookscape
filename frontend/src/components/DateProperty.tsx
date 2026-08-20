import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import useModalLayer from '../hooks/useModalLayer.js'

interface DatePropertyProps {
  value: string
  label: string
  onChange: (next: string) => void
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Six fixed rows, so the popover never changes height as you page through
// months — a 5-week month next to a 6-week one would otherwise make the
// Clear/Today row jump under the cursor.
const GRID_DAYS = 42

// `YYYY-MM-DD` in, local calendar date out. Going via `new Date(value)` would
// parse the bare date as UTC and land on the previous day west of Greenwich.
const parseISODate = (value: string): Date | null => {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const toISODate = (date: Date): string => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

const formatDisplayDate = (value: string): string => {
  const date = parseISODate(value)
  return date ? `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}` : ''
}

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const addMonths = (date: Date, months: number): Date => {
  // Clamp to the last day of the target month so 31 Jan + 1 month lands on 28
  // Feb rather than rolling over into March.
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(date.getDate(), lastDay))
  return target
}

const buildMonthGrid = (month: Date): Date[] => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = addDays(first, -first.getDay())
  return Array.from({ length: GRID_DAYS }, (_, index) => addDays(start, index))
}

function DateProperty({ value, label, onChange }: DatePropertyProps) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const [cursor, setCursor] = useState<Date>(() => parseISODate(value) || new Date())
  const anchorRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const focusedDayRef = useRef<HTMLButtonElement>(null)

  const today = new Date()
  const todayISO = toISODate(today)
  const cursorISO = toISODate(cursor)
  const display = formatDisplayDate(value)

  const openPicker = () => {
    setCursor(parseISODate(value) || new Date())
    setOpen(true)
  }

  const closePicker = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const commit = (next: string) => {
    onChange(next)
    closePicker()
  }

  // Registered above the book dialog's own layer while the picker is open, so
  // Escape dismisses the picker rather than the whole dialog behind it.
  useModalLayer({ enabled: open, onEscape: () => closePicker() })

  useEffect(() => {
    if (!open) return undefined
    function handlePointerDown(event: PointerEvent) {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  // Flip above the field when the popover would spill past the bottom of the
  // card, which clips it — `.bookDialog` scrolls its own overflow.
  useLayoutEffect(() => {
    if (!open) return
    const popover = popoverRef.current
    const anchor = anchorRef.current
    const card = anchor?.closest('.bookDialog')
    if (!popover || !anchor || !card) return
    const anchorRect = anchor.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const height = popover.offsetHeight
    const spillsBelow = anchorRect.bottom + height > cardRect.bottom - 8
    const fitsAbove = anchorRect.top - height > cardRect.top + 8
    setDropUp(spillsBelow && fitsAbove)
  }, [open])

  useEffect(() => {
    if (open) focusedDayRef.current?.focus()
  }, [open, cursorISO])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Escape is handled by the modal layer above, which stops the key before
    // it ever reaches React's synthetic event system.
    // Arrow keys belong to the day grid; leave them alone while the month
    // arrows or Clear/Today have focus so those stay tabbable as normal.
    if (!(event.target as HTMLElement).closest('.datePickerDay')) return
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      setCursor(move())
    }
  }

  const days = buildMonthGrid(cursor)

  return (
    <div className="datePropertyAnchor" ref={anchorRef}>
      <button
        type="button"
        ref={triggerRef}
        className={display ? 'datePropertyTrigger' : 'datePropertyTrigger empty'}
        onClick={() => (open ? closePicker(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={display ? `${label}: ${display}` : `${label}: empty`}
      >
        {display || 'Empty'}
      </button>

      {open && (
        <div
          className={dropUp ? 'datePicker up' : 'datePicker'}
          ref={popoverRef}
          role="dialog"
          aria-label={label}
          onKeyDown={handleKeyDown}
        >
          <div className="datePickerHeader">
            <span className="datePickerMonth">
              {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
            </span>
            <div className="datePickerNav">
              <button
                type="button"
                className="datePickerNavButton"
                onClick={() => setCursor(addMonths(cursor, -1))}
                aria-label="Previous month"
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                className="datePickerNavButton"
                onClick={() => setCursor(addMonths(cursor, 1))}
                aria-label="Next month"
              >
                <ChevronRight />
              </button>
            </div>
          </div>

          <div className="datePickerWeekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((weekday, index) => (
              <span key={index}>{weekday}</span>
            ))}
          </div>

          <div className="datePickerGrid">
            {days.map((day) => {
              const iso = toISODate(day)
              const outside = day.getMonth() !== cursor.getMonth()
              const className = [
                'datePickerDay',
                outside && 'outside',
                iso === todayISO && 'today',
                iso === value && 'selected',
              ].filter(Boolean).join(' ')
              return (
                <button
                  key={iso}
                  type="button"
                  ref={iso === cursorISO ? focusedDayRef : undefined}
                  className={className}
                  tabIndex={iso === cursorISO ? 0 : -1}
                  aria-pressed={iso === value}
                  aria-label={formatDisplayDate(iso)}
                  onClick={() => commit(iso)}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>

          <div className="datePickerFooter">
            <button type="button" className="datePickerAction" onClick={() => commit('')}>
              Clear
            </button>
            <button type="button" className="datePickerAction" onClick={() => commit(todayISO)}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default DateProperty
