import useCatalogBooks from './useCatalogBooks.js'

function useAuthorBooks(authorName: string) {
  return useCatalogBooks(
    authorName ? `/author-books?author=${encodeURIComponent(authorName)}` : '',
    'Could not load author books.',
  )
}

export default useAuthorBooks
