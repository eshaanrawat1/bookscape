import { useMemo } from 'react'
import BookCard from '../components/BookCard.jsx'
import StatsBarChart from '../components/StatsBarChart.jsx'
import StatsYearSelect from '../components/StatsYearSelect.jsx'
import { formatCompactNumber, normaliseBook } from '../utils.js'
import useStats from '../hooks/useStats.js'

function StatsView() {
  const { summary, loading, error, year, setYear } = useStats()
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

  // The chart is a calendar year of months either way; over all time it stacks
  // every January together, so the subtitle has to say which reading it is.
  const scope = year || 'all time'

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
                : 'Every year you have read, stacked month by month.'}
            </p>
          </div>
          <StatsYearSelect value={year} years={years} onChange={setYear} />
        </header>
        <StatsBarChart months={summary.months} label={scope} />
      </section>

      {books.length > 0 && (
        <section className="statsSection">
          <header className="statsSectionHeader">
            <div>
              <h2>Books read</h2>
              <p>{year ? "All the books you've read this year." : "All the books you've ever read."}</p>
            </div>
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
