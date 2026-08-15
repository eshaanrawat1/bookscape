import useCatalogBooks from './useCatalogBooks.js'

// Unlike the author and series drilldowns this one is capped, matching the
// backend's own default for /genre-books — a broad genre like "Fiction" covers
// most of the catalog.
const GENRE_BOOK_LIMIT = 100

function useGenreBooks(genreName: string) {
  return useCatalogBooks(
    genreName ? `/genre-books?genre=${encodeURIComponent(genreName)}&limit=${GENRE_BOOK_LIMIT}` : '',
    'Could not load genre books.',
  )
}

export default useGenreBooks
