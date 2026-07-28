import { createContext, useContext } from 'react'

const NavigationContext = createContext(null)

function useNavigation() {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigation must be used within a NavigationContext.Provider')
  return ctx
}

export { NavigationContext, useNavigation }
