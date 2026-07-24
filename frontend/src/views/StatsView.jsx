import { BarChart3 } from 'lucide-react'
import AccordionFilter from '../components/AccordionFilter.jsx'
import BookCard from '../components/BookCard.jsx'
import { monthOptions } from '../constants.js'
import { buildHeroGlow } from '../color.js'
import { formatCompactNumber } from '../utils.js'

function StatsView({ summary, loading, error, year, month, onYearChange, onMonthChange, onOpen, onOpenAuthor }) {
  const years = summary?.available_years || []
  const hasBooks = (summary?.books_read || 0) > 0
  const heroColor = summary?.most_time_spent?.color || summary?.densest_book?.color || 'oklch(0.62 0.14 55)'

  return (
    <div className="stack statsPage">
      <div className="statsFilters">
        <AccordionFilter
          label="Year"
          value={year}
          emptyLabel="All years"
          options={years.map((value) => ({ value: String(value), label: String(value) }))}
          onChange={onYearChange}
        />
        <AccordionFilter
          label="Month"
          value={month}
          emptyLabel="All months"
          options={monthOptions}
          onChange={onMonthChange}
        />
      </div>

      {loading ? (
        <div className="emptyState">
          <p>Loading stats...</p>
        </div>
      ) : error ? (
        <div className="emptyState">
          <h2>Could not load stats</h2>
          <p>{error}</p>
        </div>
      ) : hasBooks ? (
        <>
          <section className="heroCard paperGrain statsHeroCard">
            <div className="heroGlow statsHeroGlow" style={{ '--hero-glow': buildHeroGlow(heroColor) }} />
            <div className="statsHeroCopy">
              <h2>Reading at a glance</h2>
              <p>Minimal stats pulled from your finished books and Obsidian snapshot.</p>
            </div>
            <div className="statsSummary">
              <div className="statsMetric">
                <strong>{summary.books_read}</strong>
                <span>Books read</span>
              </div>
              <div className="statsMetric">
                <strong>{formatCompactNumber(summary.pages_read)}</strong>
                <span>Pages read</span>
              </div>
              <div className="statsMetric">
                <strong>{summary.genres_covered}</strong>
                <span>Genres covered</span>
              </div>
            </div>
            <div className="statsMetaRow">
              <span>{summary.most_time_spent_days ? `${summary.most_time_spent_days} days longest read` : 'No long reads tracked yet'}</span>
              {summary.genre_list?.length > 0 ? <span>{summary.genre_list.slice(0, 4).join(' · ')}</span> : null}
            </div>
          </section>

          <section className="statsFeatured">
            {summary.densest_book && (
              <div className="statsFeature">
                <div className="statsFeatureHeader">
                  <h2>Densest book</h2>
                  <p>{formatCompactNumber(summary.densest_book.totalPages)} pages</p>
                </div>
                <BookCard book={summary.densest_book} onOpen={onOpen} onOpenAuthor={onOpenAuthor} />
              </div>
            )}
            {summary.most_time_spent && (
              <div className="statsFeature">
                <div className="statsFeatureHeader">
                  <h2>Most time spent</h2>
                  <p>{summary.most_time_spent_days ? `${summary.most_time_spent_days} days` : 'No date range'}</p>
                </div>
                <BookCard book={summary.most_time_spent} onOpen={onOpen} onOpenAuthor={onOpenAuthor} />
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="emptyState statsEmptyState">
          <h2>No finished books yet</h2>
          <p>Finish a book in Obsidian or in the finished books store to see stats here.</p>
        </div>
      )}
    </div>
  )
}

export default StatsView
