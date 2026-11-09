import BookCard from '../components/books/BookCard.jsx'
import StatsBarChart from '../components/stats/StatsBarChart.jsx'
import StatsYearSelect from '../components/stats/StatsYearSelect.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import SectionHeader from '../components/ui/SectionHeader.jsx'
import { formatCompactNumber } from '../utils.js'
import { monthLabels } from '../constants.js'
import { useNavigation } from '../context/NavigationContext.jsx'
import useStats from '../hooks/useStats.js'

function StatsView() {
  const { summary, year, setYear } = useStats()
  const { onOpenBooksRead } = useNavigation()
  const { books, availableYears: years } = summary

  if (years.length === 0) {
    return (
      <EmptyState
        className="statsEmptyState"
        title="No finished books yet"
        message="Finish a book to see stats here."
      />
    )
  }

  const scope = year || 'all time'

  // Months for a chosen year, years for all time; labels are mapped so a short `months` still draws twelve.
  const bars = year
    ? monthLabels.map((month, index) => ({ label: month, count: summary.months[index] }))
    : summary.yearCounts.map((entry) => ({ label: String(entry.year), count: entry.count }))

  const tiles = [
    { value: String(summary.booksRead), label: 'books read' },
    { value: formatCompactNumber(summary.pagesRead), label: 'pages read' },
    { value: String(summary.genresCovered), label: 'genres covered' },
    { value: String(summary.daysReading), label: 'days reading' },
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
        <SectionHeader
          className="statsSectionHeader"
          title="Reading by year"
          subtitle={year ? 'Your reading activity, month by month.' : 'Books finished, year by year.'}
        >
          <StatsYearSelect value={year} years={years} onChange={setYear} />
        </SectionHeader>
        <StatsBarChart bars={bars} unit={year ? 'month' : 'year'} label={scope} />
      </section>

      {books.length > 0 && (
        <section className="statsSection">
          <SectionHeader
            className="statsSectionHeader"
            title="Books read"
            subtitle={year ? "All the books you've read this year." : "All the books you've ever read."}
          >
            <button type="button" className="statsSeeAll" onClick={() => onOpenBooksRead(year)}>
              See all
            </button>
          </SectionHeader>
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
