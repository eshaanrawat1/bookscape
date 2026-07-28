import { createContext, useContext } from 'react'

const LibraryDataContext = createContext(null)

function useLibraryData() {
  const ctx = useContext(LibraryDataContext)
  if (!ctx) throw new Error('useLibraryData must be used within a LibraryDataContext.Provider')
  return ctx
}

export { LibraryDataContext, useLibraryData }
