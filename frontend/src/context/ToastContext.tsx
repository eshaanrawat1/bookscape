import { createContext, useContext } from 'react'
import type { ToastContextValue } from '../types.js'

const ToastContext = createContext<ToastContextValue | null>(null)

function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastContext.Provider')
  return ctx
}

export { ToastContext, useToast }
export default useToast
