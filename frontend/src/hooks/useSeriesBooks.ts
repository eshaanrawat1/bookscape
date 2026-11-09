import useCatalogBooks from './useCatalogBooks.js'

// The backend orders by series number; don't re-sort text like "1.5".
function useSeriesBooks(seriesName: string) {
  return useCatalogBooks(
    seriesName ? `/series-books?series=${encodeURIComponent(seriesName)}` : '',
    'Could not load series books.',
  )
}

export default useSeriesBooks
