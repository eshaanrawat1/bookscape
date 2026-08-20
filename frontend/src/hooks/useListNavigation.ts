import { useEffect, useState, type KeyboardEvent } from 'react'

interface ListNavigationOptions {
  // 0 highlights the first row as soon as there is one (the command palette,
  // where Enter should always do something). -1 starts with nothing
  // highlighted, so Enter keeps whatever the surrounding form does (the search
  // view, where a bare Enter runs the full search).
  initialIndex?: number
  onSelect?: (index: number) => void
}

interface ListNavigation {
  activeIndex: number
  setActiveIndex: (index: number) => void
  // Returns true when the key was consumed, so callers can fall through to
  // their own handling otherwise.
  handleKeyDown: (event: KeyboardEvent) => boolean
}

// Arrow-key movement over a flat list of rows, shared by the command palette
// and the search view's preview dropdown so the two behave identically.
function useListNavigation(count: number, options: ListNavigationOptions = {}): ListNavigation {
  const { initialIndex = 0, onSelect } = options
  const [activeIndex, setActiveIndex] = useState(count > 0 ? initialIndex : -1)

  // Rows churn under the cursor as the query changes, so snap back rather than
  // leaving the highlight pointing at a row that is no longer there.
  useEffect(() => {
    setActiveIndex(count > 0 ? initialIndex : -1)
  }, [count, initialIndex])

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    if (count === 0) return false

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => (index + 1 >= count ? 0 : index + 1))
        return true
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => (index <= 0 ? count - 1 : index - 1))
        return true
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        return true
      case 'End':
        event.preventDefault()
        setActiveIndex(count - 1)
        return true
      case 'Enter':
        if (activeIndex < 0 || activeIndex >= count) return false
        event.preventDefault()
        onSelect?.(activeIndex)
        return true
      default:
        return false
    }
  }

  return { activeIndex, setActiveIndex, handleKeyDown }
}

export default useListNavigation
