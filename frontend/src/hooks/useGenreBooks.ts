import useCatalogBooks from './useCatalogBooks.js'

// Matches the backend's /genre-books default; unlike author and series, this one is capped.
const GENRE_BOOK_LIMIT = 100

function useGenreBooks(genreName: string) {
  return useCatalogBooks(
    genreName ? `/genre-books?genre=${encodeURIComponent(genreName)}&limit=${GENRE_BOOK_LIMIT}` : '',
    'Could not load genre books.',
  )
}

export default useGenreBooks
