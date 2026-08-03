import { type CSSProperties, useMemo } from 'react'
import { formatCompactNumber } from '../utils.js'
import type { ReadingHeatmap as ReadingHeatmapData } from '../types.js'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Sunday-first, matching the backend's week alignment. Only alternate days are
// labelled: seven stacked letters at this cell size is noise, not orientation.
const WEEKDAY_LABELS = ['', 'M', '', 'W', '', 'F', '']

interface Cell {
  key: string
  /** Null for padding days outside the year — rendered as a gap, not a cell. */
  date: string | null
  pages: number
  books: number
  level: number
}

/** Walk start..end day by day, joining the sparse day list onto the full grid. */
function buildCells(data: ReadingHeatmapData, year: number): Cell[] {
  const byDate = new Map(data.days.map((day) => [day.date, day]))
  const cells: Cell[] = []
  // Parsed as UTC and stepped in UTC so a DST boundary cannot skip or repeat a
  // cell — these are calendar dates, not moments.
  const cursor = new Date(`${data.start}T00:00:00Z`)
  const last = new Date(`${data.end}T00:00:00Z`)

  while (cursor <= last) {
    const iso = cursor.toISOString().slice(0, 10)
    const day = byDate.get(iso)
    cells.push({
      key: iso,
      date: cursor.getUTCFullYear() === year ? iso : null,
      pages: day?.pages || 0,
      books: day?.books || 0,
      level: day?.level || 0,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return cells
}

/** Column index of the week each month starts in, for the header labels. */
function monthColumns(cells: Cell[]): { label: string; column: number }[] {
  const seen = new Set<number>()
  const columns: { label: string; column: number }[] = []

  cells.forEach((cell, index) => {
    if (!cell.date) return
    const month = Number(cell.date.slice(5, 7)) - 1
    if (seen.has(month)) return
    seen.add(month)
    columns.push({ label: MONTH_LABELS[month], column: Math.floor(index / 7) + 1 })
  })
  return columns
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTH_LABELS[m - 1]} ${d}, ${y}`
}

function ReadingHeatmap({ data, year }: { data: ReadingHeatmapData; year: number }) {
  const cells = useMemo(() => buildCells(data, year), [data, year])
  const months = useMemo(() => monthColumns(cells), [cells])
  const weeks = Math.ceil(cells.length / 7)

  return (
    <section className="statsHeatmap">
      <header className="heatmapHeader">
        <h2>Reading days</h2>
        <p>
          {data.days_read > 0
            ? `${data.days_read} ${data.days_read === 1 ? 'day' : 'days'} with pages`
            : 'No pages logged yet'}
          {' · '}
          {year}
        </p>
      </header>

      <div className="heatmapScroll">
        <div className="heatmapGrid" style={{ '--heatmap-weeks': weeks } as CSSProperties}>
          <div className="heatmapMonths" aria-hidden="true">
            {months.map((month) => (
              <span key={month.label} style={{ gridColumnStart: month.column }}>{month.label}</span>
            ))}
          </div>

          <div className="heatmapWeekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={index}>{label}</span>
            ))}
          </div>

          {/* A grid of cells is a table of one measure by date, so it is exposed
              as one — the tooltips are pointer-only and would otherwise be the
              sole way to read a value. */}
          <div className="heatmapCells" role="img" aria-label={heatmapSummary(data, year)}>
            {cells.map((cell) => (
              cell.date === null
                ? <span key={cell.key} className="heatmapPad" />
                : (
                  <span
                    key={cell.key}
                    className="heatmapCell"
                    data-level={cell.level}
                    title={cellTitle(cell)}
                  />
                )
            ))}
          </div>
        </div>
      </div>

      <footer className="heatmapLegend">
        <span>Fewer pages</span>
        <div className="heatmapLegendScale">
          {Array.from({ length: data.levels + 1 }, (_, level) => (
            <span key={level} className="heatmapCell" data-level={level} />
          ))}
        </div>
        <span>More</span>
      </footer>
    </section>
  )
}

function cellTitle(cell: Cell): string {
  if (cell.pages <= 0) return `${formatDate(cell.date as string)} — no pages`
  const books = cell.books === 1 ? '1 book' : `${cell.books} books`
  return `${formatCompactNumber(cell.pages)} pages · ${books} — ${formatDate(cell.date as string)}`
}

function heatmapSummary(data: ReadingHeatmapData, year: number): string {
  if (data.days_read === 0) return `No reading days recorded in ${year}.`
  const best = data.best_day
    ? ` Best day ${formatDate(data.best_day.date)} with ${data.best_day.pages} pages.`
    : ''
  return (
    `Reading days in ${year}: ${data.days_read} days with pages, ` +
    `${formatCompactNumber(data.total_pages)} pages in total. ` +
    `Longest streak ${data.streak.longest} days.${best}`
  )
}

export default ReadingHeatmap
