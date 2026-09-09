import useCatalogBooks from './useCatalogBooks.js'
import type { Book } from '../types.js'

// The Suggested shelf on Reading Now: books drawn from the similar-books lists
// of what you most recently finished. The backend does the picking, so this is
// the same `{books}` fetch as the catalog drilldowns and shares their hook —
// including its `dataVersion` refetch, which matters more here than anywhere
// else: finishing a book changes both ends of the suggestion, the list it is
// drawn from and the set of books it may not suggest.
//
// The error string is dropped rather than surfaced. A failed load leaves the
// list empty and Shelf renders nothing, which is the right volume for a
// secondary shelf on a page with plenty else to show — the same posture
// useSeriesProgress takes for the row directly above this one.
function useSuggestedBooks(): Book[] {
  const { books } = useCatalogBooks('/suggested-books', '')
  return books
}

export default useSuggestedBooks
