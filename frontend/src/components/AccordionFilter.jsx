import { useState, useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'

function AccordionFilter({ label, value, emptyLabel, options, onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const selected = options.find((option) => String(option.value) === String(value)) || null
  const displayLabel = selected?.label || emptyLabel

  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
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
