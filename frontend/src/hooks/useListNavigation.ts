import { useEffect, useState, type KeyboardEvent } from 'react'

interface ListNavigationOptions {
  // 0 highlights the first row so Enter always acts; -1 starts empty so Enter falls through to the form.
  initialIndex?: number
  onSelect?: (index: number) => void
}

interface ListNavigation {
  activeIndex: number
  setActiveIndex: (index: number) => void
  // True when the key was consumed, so callers can fall through otherwise.
  handleKeyDown: (event: KeyboardEvent) => boolean
}

function useListNavigation(count: number, options: ListNavigationOptions = {}): ListNavigation {
  const { initialIndex = 0, onSelect } = options
  const [activeIndex, setActiveIndex] = useState(count > 0 ? initialIndex : -1)

  // Rows churn as the query changes, so reset rather than point at a row that's gone.
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
