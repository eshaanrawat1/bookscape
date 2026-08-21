import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ToastContext } from '../context/ToastContext.jsx'
import type { Toast, ToastOptions, ToastTone } from '../types.js'

// Errors get longer than confirmations — "Saved to Want to read." is read at a
// glance, "Could not reach the Obsidian vault at /Users/…" is not.
const DURATION: Record<ToastTone, number> = {
  info: 4000,
  error: 6500,
}

// Kept in step with the .toast.exiting animation. A timeout rather than an
// animationend listener on purpose: under prefers-reduced-motion the animation
// is `none` and the event never fires, which would strand the toast on screen.
const EXIT_MS = 180

// Three is the point where the stack starts covering content rather than
// reporting on it. Older ones drop off the top.
const MAX_VISIBLE = 3

interface ToastItemProps {
  toast: Toast
  exiting: boolean
  onDismiss: (id: number) => void
}

function ToastItem({ toast, exiting, onDismiss }: ToastItemProps) {
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || exiting) return undefined
    const timer = setTimeout(() => onDismiss(toast.id), DURATION[toast.tone])
    return () => clearTimeout(timer)
    // Un-pausing restarts the full duration rather than resuming the remainder.
    // Someone who moused over a toast to read it has just told us they want the
    // time, and the bookkeeping to resume mid-count buys nothing here.
  }, [paused, exiting, toast.id, toast.tone, onDismiss])

  return (
    <div
      className={['toast', `toast${toast.tone === 'error' ? 'Error' : 'Info'}`, exiting && 'exiting']
        .filter(Boolean)
        .join(' ')}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      // Keyboard users park focus on the dismiss button to read at their own
      // pace, so focus holds the toast open exactly as hover does.
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <p className="toastMessage">{toast.message}</p>
      <button
        type="button"
        className="toastDismiss"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        <X />
      </button>
    </div>
  )
}

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [exiting, setExiting] = useState<number[]>([])
  const nextId = useRef(0)
  // Every pending removal, so a provider unmount doesn't leave timers pointing
  // at a dead setState.
  const exitTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  // Lets a toast replace an earlier one with the same key without `showToast`
  // having to depend on `toasts` — the identity has to stay stable, since
  // callers hold onto it across renders.
  const keys = useRef(new Map<string, number>())

  useEffect(() => () => {
    exitTimers.current.forEach(clearTimeout)
    exitTimers.current = []
  }, [])

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    setExiting((current) => current.filter((exitingId) => exitingId !== id))
    keys.current.forEach((value, key) => {
      if (value === id) keys.current.delete(key)
    })
  }, [])

  const dismiss = useCallback((id: number) => {
    setExiting((current) => (current.includes(id) ? current : [...current, id]))
    const timer = setTimeout(() => {
      remove(id)
      exitTimers.current = exitTimers.current.filter((pending) => pending !== timer)
    }, EXIT_MS)
    exitTimers.current.push(timer)
  }, [remove])

  const showToast = useCallback((message: string, options: ToastOptions = {}) => {
    const text = String(message || '').trim()
    if (!text) return
    const id = (nextId.current += 1)
    const tone = options.tone || 'info'
    const { key } = options

    setToasts((current) => {
      // A keyed repeat swaps in a new id, so the item remounts: the enter
      // animation replays and its dismiss timer starts over, which is what
      // makes a second click on the same button read as a fresh answer rather
      // than a stale one about to expire.
      const replacing = key ? keys.current.get(key) : undefined
      const kept = replacing === undefined ? current : current.filter((toast) => toast.id !== replacing)
      if (key) keys.current.set(key, id)
      return [...kept, { id, message: text, tone }].slice(-MAX_VISIBLE)
    })
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        // Always mounted, even with nothing to show: a live region has to exist
        // in the document before content lands inside it, or screen readers miss
        // the first announcement. `polite` throughout — none of these interrupt
        // anything, they report on something the user just did.
        <div className="toastHost" role="region" aria-label="Notifications" aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              exiting={exiting.includes(toast.id)}
              onDismiss={dismiss}
            />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export default ToastProvider
