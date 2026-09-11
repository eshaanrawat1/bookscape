import { type CSSProperties } from 'react'

/** Axis tops worth landing on, scaled by powers of ten. */
const NICE_STEPS = [1, 2, 5, 10]

const INTERVALS = 3

/** A round axis top and the gap between its gridlines.
 *
 * Three intervals, so the plot carries four labels including the zero — enough
 * to read a bar off without turning the background into a ladder. The step is
 * rounded up to a 1/2/5 multiple, which is what keeps the labels whole numbers:
 * a peak of 11 books scales to 0-5-10-15 rather than 0-3.7-7.3-11.
 */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: INTERVALS, step: 1 }
  const raw = max / INTERVALS
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = (NICE_STEPS.find((nice) => nice * magnitude >= raw) ?? 10) * magnitude
  return { top: step * INTERVALS, step }
}

interface ChartBar {
  label: string
  count: number
}

interface StatsBarChartProps {
  /** One column each, left to right. Twelve months, or a run of years. */
  bars: ChartBar[]
  /** What a column stands for — names the axis in the spoken summary. */
  unit: 'month' | 'year'
  label: string
}

function StatsBarChart({ bars, unit, label }: StatsBarChartProps) {
  const { top, step } = niceScale(Math.max(0, ...bars.map((bar) => bar.count)))
  const ticks = Array.from({ length: INTERVALS + 1 }, (_, index) => index * step)
  // The columns are driven from here rather than fixed at twelve in CSS, since
  // the all-time chart is one column per year read. The floor of 1 is only to
  // keep `repeat()` valid on an empty payload, which draws a bare grid.
  const plotStyle = { '--chart-columns': Math.max(bars.length, 1) } as CSSProperties

  return (
    <figure
      className="barChart"
      data-scale={unit === 'year' ? 'years' : 'months'}
      role="img"
      aria-label={summarise(bars, unit, label)}
    >
      <div className="barChartTicks" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>{tick}</span>
        ))}
      </div>

      <div className="barChartPlot">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="barChartGridline"
            style={{ bottom: `${(tick / top) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        <div className="barChartBars" style={plotStyle}>
          {bars.map((bar) => (
            <div className="barChartColumn" key={bar.label}>
              <div className="barChartBar" style={{ '--bar-height': `${(bar.count / top) * 100}%` } as CSSProperties}>
                <span className="barChartTip">
                  {bar.label} · {bar.count === 1 ? '1 book' : `${bar.count} books`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="barChartMonths" style={plotStyle} aria-hidden="true">
        {bars.map((bar) => <span key={bar.label}>{bar.label}</span>)}
      </div>
    </figure>
  )
}

function summarise(bars: ChartBar[], unit: 'month' | 'year', label: string): string {
  const total = bars.reduce((sum, bar) => sum + bar.count, 0)
  if (total === 0) return `No books finished in ${label}.`
  const best = bars.reduce((peak, bar) => (bar.count > peak.count ? bar : peak))
  return (
    `Books finished by ${unit} in ${label}: `
    + bars.map((bar) => `${bar.label} ${bar.count}`).join(', ')
    + `. Busiest ${unit} ${best.label}.`
  )
}

export default StatsBarChart
export type { ChartBar }
