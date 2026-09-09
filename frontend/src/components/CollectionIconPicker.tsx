import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useModalLayer from '../hooks/useModalLayer.js'
import { collectionIcons, collectionIconLabel } from '../collectionIcons.js'

interface CollectionIconPickerProps {
  // The dot the picker hangs off. The panel is positioned from its rect rather
  // than nested inside it: `.collectionList` scrolls its own overflow, so a
  // popover living in the row would be clipped by the list it sits in.
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

  // Placed to the right of the dot and vertically centred on it, then pulled
  // back inside the viewport — the sidebar rows near the floor would otherwise
  // open a panel that runs off the bottom of the window.
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
      // A portal still bubbles its events up the React tree, so without this a
      // click in the panel would also reach the collection row that renders it
      // and navigate away mid-choice.
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      // Hidden until measured, so the panel never flashes at the top-left
      // corner on the frame before its position is known.
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
