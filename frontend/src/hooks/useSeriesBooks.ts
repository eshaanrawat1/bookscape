import useCatalogBooks from './useCatalogBooks.js'

// The backend returns these already ordered by series number, so the view
// renders them as-is rather than re-sorting text like "1.5".
function useSeriesBooks(seriesName: string) {
  return useCatalogBooks(
    seriesName ? `/series-books?series=${encodeURIComponent(seriesName)}` : '',
    'Could not load series books.',
  )
}

export default useSeriesBooks
