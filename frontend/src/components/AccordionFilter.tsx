import { useState, useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import useModalLayer from '../hooks/useModalLayer.js'

interface AccordionOption {
  value: string
  label: string
}

interface AccordionFilterProps {
  label: string
  value: string
  emptyLabel: string
  options: AccordionOption[]
  onChange: (value: string) => void
}

function AccordionFilter({ label, value, emptyLabel, options, onChange }: AccordionFilterProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => String(option.value) === String(value)) || null
  const displayLabel = selected?.label || emptyLabel

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

  return (
    <div ref={rootRef} className={`statsFilter statsFilterAccordion${open ? ' isOpen' : ''}`}>
      <span>{label}</span>
      <button
        type="button"
        className="statsFilterTrigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <strong>{displayLabel}</strong>
        <ChevronRight className="statsFilterChevron" />
      </button>
      <div className="statsFilterPanel" aria-hidden={!open}>
        <button
          type="button"
          className={`statsFilterOption${value === '' ? ' active' : ''}`}
          onClick={() => {
            onChange('')
            setOpen(false)
          }}
        >
          {emptyLabel}
        </button>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`statsFilterOption${String(option.value) === String(value) ? ' active' : ''}`}
            onClick={() => {
              onChange(String(option.value))
              setOpen(false)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default AccordionFilter
