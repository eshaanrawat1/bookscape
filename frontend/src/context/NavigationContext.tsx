import { createContext, useContext } from 'react'
import type { NavigationContextValue } from '../types.js'

const NavigationContext = createContext<NavigationContextValue | null>(null)

function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigation must be used within a NavigationContext.Provider')
  return ctx
}

export { NavigationContext, useNavigation }
