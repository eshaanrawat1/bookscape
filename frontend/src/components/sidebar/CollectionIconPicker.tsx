import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useModalLayer from '../../hooks/useModalLayer.js'
import { collectionIcons, collectionIconLabel } from '../../collectionIcons.js'

interface CollectionIconPickerProps {
  // Positioned from its rect rather than nested: `.collectionList` would clip a child popover.
  anchor: HTMLElement | null
  current: string
  onSelect: (icon: string) => void
  onClose: () => void
}

const PANEL_MARGIN = 8
const PANEL_GAP = 10

function CollectionIconPicker({ anchor, current, onSelect, onClose }: CollectionIconPickerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [filter, setFilter] = useState('')
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useModalLayer({ onEscape: onClose, blocksHotkeys: true })

  const matches = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return collectionIcons
    return collectionIcons.filter((entry) => entry.search.includes(query))
  }, [filter])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchor?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [anchor, onClose])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || !anchor) return
    const rect = anchor.getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = panel
    const maxLeft = window.innerWidth - width - PANEL_MARGIN
    const maxTop = window.innerHeight - height - PANEL_MARGIN
    setPosition({
      left: Math.max(PANEL_MARGIN, Math.min(rect.right + PANEL_GAP, maxLeft)),
      top: Math.max(PANEL_MARGIN, Math.min(rect.top + rect.height / 2 - height / 2, maxTop)),
    })
  }, [anchor])

  return createPortal(
    <div
      ref={panelRef}
      className="iconPicker"
      role="dialog"
      aria-label="Choose a collection icon"
      // Portals still bubble through React, or this click would also navigate the row.
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      // Hidden until measured so it doesn't flash at the top-left corner.
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
    >
      <div className="iconPickerHeader">
        <input
          className="iconPickerFilter"
          value={filter}
          autoFocus
          placeholder="Filter…"
          aria-label="Filter icons"
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches[0]) {
              event.preventDefault()
              onSelect(matches[0].name)
            }
          }}
        />
        <button
          type="button"
          className="iconPickerReset"
          disabled={!current}
          onClick={() => onSelect('')}
        >
          <span className="iconPickerDot" aria-hidden="true" />
          Default
        </button>
      </div>

      {matches.length === 0 ? (
        <p className="iconPickerEmpty">No icons match “{filter.trim()}”.</p>
      ) : (
        <div className="iconPickerGrid">
          {matches.map(({ name, Icon }) => (
            <button
              key={name}
              type="button"
              className={name === current ? 'iconPickerOption selected' : 'iconPickerOption'}
              title={collectionIconLabel(name)}
              aria-label={collectionIconLabel(name)}
              aria-pressed={name === current}
              onClick={() => onSelect(name)}
            >
              <Icon />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

export default CollectionIconPicker
