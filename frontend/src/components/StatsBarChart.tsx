import { type CSSProperties } from 'react'
import { monthLabels } from '../constants.js'

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

interface StatsBarChartProps {
  /** Counts, January first. Padded to twelve here rather than trusted. */
  months: number[] | undefined
  label: string
}

function StatsBarChart({ months, label }: StatsBarChartProps) {
  // The plot is a calendar year whatever arrives, so the twelve columns are
  // built here: a short or missing list draws an empty year rather than
  // taking the page down with it.
  const counts = Array.from({ length: 12 }, (_, index) => Number(months?.[index]) || 0)
  const { top, step } = niceScale(Math.max(...counts))
  const ticks = Array.from({ length: INTERVALS + 1 }, (_, index) => index * step)

  return (
    <figure className="barChart" role="img" aria-label={summarise(counts, label)}>
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
        <div className="barChartBars">
          {counts.map((count, index) => (
            <div className="barChartColumn" key={monthLabels[index]}>
              <div className="barChartBar" style={{ '--bar-height': `${(count / top) * 100}%` } as CSSProperties}>
                <span className="barChartTip">
                  {monthLabels[index]} · {count === 1 ? '1 book' : `${count} books`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="barChartMonths" aria-hidden="true">
        {monthLabels.map((month) => <span key={month}>{month}</span>)}
      </div>
    </figure>
  )
}

function summarise(months: number[], label: string): string {
  const total = months.reduce((sum, count) => sum + count, 0)
  if (total === 0) return `No books finished in ${label}.`
  const best = months.indexOf(Math.max(...months))
  return (
    `Books finished by month in ${label}: `
    + months.map((count, index) => `${monthLabels[index]} ${count}`).join(', ')
    + `. Busiest month ${monthLabels[best]}.`
  )
}

export default StatsBarChart
