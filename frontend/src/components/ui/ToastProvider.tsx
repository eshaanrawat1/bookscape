import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ToastContext } from '../../context/ToastContext.jsx'
import { errorMessage } from '../../utils.js'
import type { Toast, ToastContextValue, ToastOptions, ToastTone } from '../../types.js'

const DURATION: Record<ToastTone, number> = {
  info: 4000,
  error: 6500,
}

// Matches .toast.exiting. A timeout, as animationend never fires under prefers-reduced-motion.
const EXIT_MS = 180

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
    // Un-pausing restarts the full duration on purpose.
  }, [paused, exiting, toast.id, toast.tone, onDismiss])

  return (
    <div
      className={['toast', `toast${toast.tone === 'error' ? 'Error' : 'Info'}`, exiting && 'exiting']
        .filter(Boolean)
        .join(' ')}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
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
  // Pending removals, cleared on unmount so timers don't hit a dead setState.
  const exitTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  // Keyed lookup lives in a ref so showToast stays stable across renders.
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
      // A new id remounts the item, replaying the animation and restarting its timer.
      const replacing = key ? keys.current.get(key) : undefined
      const kept = replacing === undefined ? current : current.filter((toast) => toast.id !== replacing)
      if (key) keys.current.set(key, id)
      return [...kept, { id, message: text, tone }].slice(-MAX_VISIBLE)
    })
  }, [])

  const showError = useCallback<ToastContextValue['showError']>((err, fallback, key) => {
    showToast(errorMessage(err, fallback), { tone: 'error', key })
  }, [showToast])

  return (
    <ToastContext.Provider value={{ showToast, showError }}>
      {children}
      {createPortal(
        // Always mounted: a live region must exist before content lands or screen readers miss it.
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
