import { createContext, useContext } from 'react'
import type { LibraryDataContextValue } from '../types.js'

const LibraryDataContext = createContext<LibraryDataContextValue | null>(null)

function useLibraryData(): LibraryDataContextValue {
  const ctx = useContext(LibraryDataContext)
  if (!ctx) throw new Error('useLibraryData must be used within a LibraryDataContext.Provider')
  return ctx
}

export { LibraryDataContext, useLibraryData }
