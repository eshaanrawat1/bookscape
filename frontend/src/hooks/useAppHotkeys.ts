import { useEffect, useRef } from 'react'
import { navOrder } from '../constants.js'
import { hotkeysBlocked } from './useModalLayer.js'

interface AppHotkeyHandlers {
  onTogglePalette: () => void
  onAddBook: () => void
  onNavigate: (viewId: string) => void
}

// Global shortcut listener. Everything is chorded with ⌘/Ctrl, so no text-field guard is needed.
function useAppHotkeys(handlers: AppHotkeyHandlers): void {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      // Dialogs with unsaved input mute these; the book dialog and palette deliberately don't.
      if (hotkeysBlocked()) return

      const key = event.key.toLowerCase()

      if (key === 'k') {
        event.preventDefault()
        latest.current.onTogglePalette()
        return
      }

      if (key === 'n') {
        event.preventDefault()
        latest.current.onAddBook()
        return
      }

      if (!event.shiftKey && /^[1-9]$/.test(event.key)) {
        const target = navOrder[Number(event.key) - 1]
        if (!target) return
        event.preventDefault()
        latest.current.onNavigate(target)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

export default useAppHotkeys
