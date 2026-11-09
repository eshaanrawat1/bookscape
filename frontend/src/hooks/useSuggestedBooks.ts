import useCatalogBooks from './useCatalogBooks.js'
import type { Book } from '../types.js'

// Errors are dropped: an empty list makes Shelf render nothing, which suits a secondary shelf.
function useSuggestedBooks(): Book[] {
  const { books } = useCatalogBooks('/suggested-books', '')
  return books
}

export default useSuggestedBooks
