import { useMemo } from 'react'
import BookCard from '../components/BookCard.jsx'
import StatsBarChart from '../components/StatsBarChart.jsx'
import StatsYearSelect from '../components/StatsYearSelect.jsx'
import { formatCompactNumber, normaliseBook } from '../utils.js'
import { monthLabels } from '../constants.js'
import { useNavigation } from '../context/NavigationContext.jsx'
import useStats from '../hooks/useStats.js'

function StatsView() {
  const { summary, loading, error, year, setYear } = useStats()
  const { onOpenBooksRead } = useNavigation()
  const books = useMemo(() => (summary?.books || []).map(normaliseBook), [summary])

  if (loading && !summary) {
    return <div className="emptyState"><p>Loading stats…</p></div>
  }

  if (error) {
    return <div className="emptyState"><h2>Could not load stats</h2><p>{error}</p></div>
  }

  const years = summary?.available_years || []

  if (!summary || years.length === 0) {
    return (
      <div className="emptyState statsEmptyState">
        <h2>No finished books yet</h2>
        <p>Finish a book in Obsidian or in the finished books store to see stats here.</p>
      </div>
    )
  }

  const scope = year || 'all time'

  // A chosen year is drawn month by month; all time is drawn year by year,
  // because stacking every January together would say which months you read in
  // but nothing about which years. The month labels are mapped rather than the
  // payload trusted, so a short `months` still draws a full twelve.
  const bars = year
    ? monthLabels.map((month, index) => ({
      label: month,
      count: Number(summary.months?.[index]) || 0,
    }))
    : (summary.year_counts || []).map((entry) => ({
      label: String(entry.year),
      count: entry.count,
    }))

  const tiles = [
    { value: String(summary.books_read), label: 'books read' },
    { value: formatCompactNumber(summary.pages_read), label: 'pages read' },
    { value: String(summary.genres_covered), label: 'genres covered' },
    { value: String(summary.days_reading), label: 'days reading' },
  ]

  return (
    <div className="stack statsPage">
      <section className="statTiles" aria-label={`Totals for ${scope}`}>
        {tiles.map((tile) => (
          <div className="statTile" key={tile.label}>
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </div>
        ))}
      </section>

      <section className="statsSection">
        <header className="statsSectionHeader">
          <div>
            <h2>Reading by year</h2>
            <p>
              {year
                ? 'Your reading activity, month by month.'
                : 'Books finished, year by year.'}
            </p>
          </div>
          <StatsYearSelect value={year} years={years} onChange={setYear} />
        </header>
        <StatsBarChart bars={bars} unit={year ? 'month' : 'year'} label={scope} />
      </section>

      {books.length > 0 && (
        <section className="statsSection">
          <header className="statsSectionHeader">
            <div>
              <h2>Books read</h2>
              <p>{year ? "All the books you've read this year." : "All the books you've ever read."}</p>
            </div>
            {/* The row is a scroller; this opens the same books as a full page
                for whichever year the picker above is on. */}
            <button type="button" className="statsSeeAll" onClick={() => onOpenBooksRead(year)}>
              See all
            </button>
          </header>
          <div className="statsBookScroll" tabIndex={0} role="group" aria-label="Books read">
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default StatsView
