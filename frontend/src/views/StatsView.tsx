import { type CSSProperties } from 'react'
import AccordionFilter from '../components/AccordionFilter.jsx'
import ReadingHeatmap from '../components/ReadingHeatmap.jsx'
import StatsCarousel from '../components/StatsCarousel.jsx'
import { monthOptions } from '../constants.js'
import { buildHeroGlow } from '../color.js'
import { formatCompactNumber } from '../utils.js'
import useHeatmap from '../hooks/useHeatmap.js'
import useStats from '../hooks/useStats.js'

function StatsView() {
  const { summary, loading, error, year, month, setYear, setMonth } = useStats()
  const years = summary?.available_years || []
  const hasBooks = (summary?.books_read || 0) > 0
  const heroColor = summary?.most_time_spent?.color || summary?.densest_book?.color || 'oklch(0.62 0.14 55)'

  // The grid is a calendar year, so "All years" has to resolve to one: the most
  // recent year with finished books, falling back to the current one. The month
  // filter is deliberately ignored — a single month is not a heatmap.
  const heatmapYear = Number(year) || years[0] || new Date().getFullYear()
  const { heatmap } = useHeatmap(hasBooks ? heatmapYear : null)

  return (
    <div className="stack statsPage">
      <div className="statsFilters">
        <AccordionFilter
          label="Year"
          value={year}
          emptyLabel="All years"
          options={years.map((value) => ({ value: String(value), label: String(value) }))}
          onChange={setYear}
        />
        <AccordionFilter
          label="Month"
          value={month}
          emptyLabel="All months"
          options={monthOptions}
          onChange={setMonth}
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
      ) : summary && hasBooks ? (
        <>
          <section className="heroCard paperGrain statsHeroCard">
            <div className="heroGlow statsHeroGlow" style={{ '--hero-glow': buildHeroGlow(heroColor) } as CSSProperties} />
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

          {heatmap && <ReadingHeatmap data={heatmap} year={heatmapYear} />}

          <StatsCarousel featured={summary.featured || []} />
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
