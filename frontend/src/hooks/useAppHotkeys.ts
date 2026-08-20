import { useEffect, useRef } from 'react'
import { navOrder } from '../constants.js'
import { hotkeysBlocked } from './useModalLayer.js'

interface AppHotkeyHandlers {
  onTogglePalette: () => void
  onAddBook: () => void
  onNavigate: (viewId: string) => void
}

// The app's one global shortcut listener. Everything here is chorded with
// ⌘/Ctrl, which is why there is no "is a text field focused" guard — ⌘1 is
// never a keystroke the user meant to type into the search box.
//
// These are in-window DOM shortcuts, not Tauri globalShortcut registrations, so
// they need no allowlist entry and stay inert while the app is in the
// background. macOS's default Tauri menu claims ⌘Q/W/M/H and the edit keys;
// none of the chords below collide with it.
function useAppHotkeys(handlers: AppHotkeyHandlers): void {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      // A dialog holding unsaved input or a destructive confirm mutes the lot.
      // The book dialog and the palette deliberately don't, so "from anywhere"
      // really means from anywhere.
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
