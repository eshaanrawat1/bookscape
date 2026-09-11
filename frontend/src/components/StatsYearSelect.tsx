import { useEffect, useRef, useState } from 'react'
import { BarChart3, ChevronDown } from 'lucide-react'
import useModalLayer from '../hooks/useModalLayer.js'

interface StatsYearSelectProps {
  /** '' is all time. */
  value: string
  years: number[]
  onChange: (value: string) => void
}

const ALL_TIME = 'All time'

function StatsYearSelect({ value, years, onChange }: StatsYearSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useModalLayer({ enabled: open, onEscape: () => setOpen(false) })

  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={`yearSelect${open ? ' isOpen' : ''}`}>
      <button
        type="button"
        className="yearSelectTrigger"
        aria-expanded={open}
        aria-label={`Year: ${value || ALL_TIME}`}
        onClick={() => setOpen((current) => !current)}
      >
        <BarChart3 className="yearSelectIcon" />
        <span className="yearSelectValue">{value || ALL_TIME}</span>
        <ChevronDown className="yearSelectChevron" />
      </button>
      <div className="yearSelectPanel" aria-hidden={!open}>
        {years.map((year) => (
          <button
            key={year}
            type="button"
            className={`yearSelectOption${String(year) === value ? ' active' : ''}`}
            onClick={() => choose(String(year))}
          >
            {year}
          </button>
        ))}
        {/* All time sits under the years rather than above them: the picker
            opens on a year, so the years are what the eye lands on first. */}
        <button
          type="button"
          className={`yearSelectOption${value === '' ? ' active' : ''}`}
          onClick={() => choose('')}
        >
          {ALL_TIME}
        </button>
      </div>
    </div>
  )
}

export default StatsYearSelect
