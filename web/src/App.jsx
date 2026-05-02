import { useEffect, useMemo, useRef, useState } from 'react'

const API = 'http://127.0.0.1:8000'
const W = 1600
const H = 900
const PAD = 120

const genreColor = {
  fantasy: '#68d487',
  science_fiction: '#6ea8ff',
  mystery: '#a88dff',
  romance: '#ef78be',
  history: '#7aa5c2',
  self_help: '#f0c24f',
  thriller: '#f0c24f',
  young_adult: '#68d487'
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
}

function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function project(points) {
  if (!points.length) return []
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const rx = maxX - minX || 1
  const ry = maxY - minY || 1
  return points.map((p) => ({
    ...p,
    mx: ((p.x - minX) / rx) * (W - PAD * 2) + PAD,
    my: ((p.y - minY) / ry) * (H - PAD * 2) + PAD
  }))
}

function byKey(arr, fn) {
  const m = new Map()
  for (const x of arr) {
    const k = fn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

function formatAuthors(author) {
  return (author || '')
    .split('|')
    .map((a) => a.trim())
    .filter(Boolean)
    .join(', ')
}

function formatCount(n) {
  if (n == null || Number.isNaN(Number(n))) return 'Unknown'
  return Number(n).toLocaleString()
}

function formatCompactCount(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return 'Unknown'
  if (Math.abs(num) < 1000) return `${Math.round(num)}`
  const units = [
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' }
  ]
  const u = units.find((x) => Math.abs(num) >= x.v)
  if (!u) return `${Math.round(num)}`
  const raw = num / u.v
  const digits = raw >= 10 ? 1 : 2
  return `${raw.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}${u.s}`
}

function formatGenreLabel(genre) {
  return (genre || 'unknown').replaceAll('_', ' ')
}

function parseNumberish(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const raw = String(v)
  const cleaned = raw.replace(/,/g, '')
  const match = cleaned.match(/-?\d+(\.\d+)?/)
  if (!match) return null
  const num = Number(match[0])
  return Number.isFinite(num) ? num : null
}

function normalizeForDedup(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(edicion|edicions|edicione|ediciones|spanish|espanol|espanol|espanola|espanol|portugues|french|francais|deutsch|german|italiano|russian)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isLikelyNonEnglishEdition(book) {
  const text = `${book?.title || ''} ${book?.description || ''}`.toLowerCase()
  return /edici[oó]n|espa[ñn]ol|versi[oó]n|traducci[oó]n|idioma|portugu[eê]s|fran[cç]ais|deutsch|italiano/.test(text)
}

function downsampleBooksByGrid(books, target = 450) {
  if (books.length <= target) return { visible: books, hiddenCount: 0 }
  const minX = Math.min(...books.map((b) => b.mx))
  const maxX = Math.max(...books.map((b) => b.mx))
  const minY = Math.min(...books.map((b) => b.my))
  const maxY = Math.max(...books.map((b) => b.my))
  const area = Math.max((maxX - minX) * (maxY - minY), 1)
  const cell = Math.max(16, Math.floor(Math.sqrt(area / target)))

  const buckets = new Map()
  for (const b of books) {
    const gx = Math.floor((b.mx - minX) / cell)
    const gy = Math.floor((b.my - minY) / cell)
    const key = `${gx}:${gy}`
    if (!buckets.has(key)) buckets.set(key, b)
  }
  const visible = Array.from(buckets.values())
  return { visible, hiddenCount: Math.max(0, books.length - visible.length) }
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'from', 'by',
  'book', 'books', 'story', 'novel', 'series', 'author', 'about', 'into', 'through', 'over',
  'under', 'after', 'before', 'during', 'is', 'are', 'was', 'were', 'be', 'being', 'been',
  'this', 'that', 'these', 'those', 'it', 'its', 'as', 'but', 'if', 'than', 'then', 'also'
])

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
}

function titleCase(s) {
  return s
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function toDateInputValue(raw) {
  if (!raw) return ''
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return ''
}

function inferSubgenreName(items, genre, clusterId) {
  if (!items.length) return `Subgenre ${clusterId}`

  const unigram = new Map()
  const bigram = new Map()
  const genreText = (genre || '').replaceAll('_', ' ').toLowerCase()

  for (const b of items) {
    const text = `${b.title || ''} ${b.description || ''}`
    const tokens = tokenize(text).filter((t) => !genreText.includes(t))

    for (const t of tokens) unigram.set(t, (unigram.get(t) || 0) + 1)
    for (let i = 0; i < tokens.length - 1; i += 1) {
      if (tokens[i] === tokens[i + 1]) continue
      const bg = `${tokens[i]} ${tokens[i + 1]}`
      bigram.set(bg, (bigram.get(bg) || 0) + 1)
    }
  }

  const bestBigram = Array.from(bigram.entries()).sort((a, b) => b[1] - a[1])[0]
  if (bestBigram && bestBigram[1] >= 2) return titleCase(bestBigram[0])

  const bestUnigram = Array.from(unigram.entries()).sort((a, b) => b[1] - a[1])[0]
  if (bestUnigram) return titleCase(bestUnigram[0])

  return `Subgenre ${clusterId}`
}

export default function App() {
  const [tab, setTab] = useState('explorer')
  const [points, setPoints] = useState([])
  const [feedOrder, setFeedOrder] = useState([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [recs, setRecs] = useState([])
  const [selected, setSelected] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [showSimilar, setShowSimilar] = useState(false)
  const [hoveredBook, setHoveredBook] = useState(null)
  const [likedBookIds, setLikedBookIds] = useState([])
  const [feedCollectionMenuBookId, setFeedCollectionMenuBookId] = useState('')
  const [feedNewCollectionDraft, setFeedNewCollectionDraft] = useState('')
  const [feedSimilarBookId, setFeedSimilarBookId] = useState('')
  const [feedRecsByBookId, setFeedRecsByBookId] = useState({})
  const [searchDetailBook, setSearchDetailBook] = useState(null)
  const [searchTabQuery, setSearchTabQuery] = useState('')
  const [searchTabSuggestions, setSearchTabSuggestions] = useState([])
  const [searchTabResults, setSearchTabResults] = useState([])
  const [readingLists, setReadingLists] = useState([])
  const [newListName, setNewListName] = useState('')
  const [listDraftByName, setListDraftByName] = useState('')
  const [editingListName, setEditingListName] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [addModalBook, setAddModalBook] = useState(null)
  const [listsMsg, setListsMsg] = useState('')
  const [toastMsg, setToastMsg] = useState('')
  const [listsQuery, setListsQuery] = useState('')
  const [activeListName, setActiveListName] = useState('all')
  const [readingProgressById, setReadingProgressById] = useState({})
  const [trackerBook, setTrackerBook] = useState(null)
  const [trackerDraft, setTrackerDraft] = useState(null)
  const [trackerSaving, setTrackerSaving] = useState(false)
  const [trackerStatusOpen, setTrackerStatusOpen] = useState(false)

  const [mode, setMode] = useState('genres')
  const [activeGenre, setActiveGenre] = useState(null)
  const [activeSub, setActiveSub] = useState(null)
  const [feedIndex, setFeedIndex] = useState(0)
  const feedScrollerRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/points?zoom=near&max_points=22000`).then((r) => r.json()).then((d) => setPoints(d.points || []))
  }, [])

  const showToast = (msg) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg(''), 1700)
  }

  useEffect(() => {
    fetch(`${API}/liked-books`)
      .then((r) => r.json())
      .then((d) => setLikedBookIds((d.book_ids || []).filter(Boolean)))
  }, [])

  useEffect(() => {
    if (!feedCollectionMenuBookId) return
    const onDocClick = () => setFeedCollectionMenuBookId('')
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [feedCollectionMenuBookId])

  const refreshReadingLists = async () => {
    const r = await fetch(`${API}/reading-lists`)
    const d = await r.json()
    setReadingLists(d.lists || [])
  }

  useEffect(() => {
    refreshReadingLists()
  }, [])

  useEffect(() => {
    fetch(`${API}/reading-progress`)
      .then((r) => r.json())
      .then((d) => setReadingProgressById(d.entries || {}))
  }, [])

  useEffect(() => {
    if (activeListName === 'all') return
    if (!readingLists.some((x) => x.name === activeListName)) setActiveListName('all')
  }, [readingLists, activeListName])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setSuggestions([])
      return
    }
    const t = setTimeout(async () => {
      const r = await fetch(`${API}/search?q=${encodeURIComponent(q)}&limit=8`)
      const d = await r.json()
      const uniq = []
      const seen = new Set()
      for (const x of (d.results || [])) {
        const key = x.id || `${x.title}::${x.author}`
        if (seen.has(key)) continue
        seen.add(key)
        uniq.push(x)
      }
      setSuggestions(uniq)
    }, 180)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const q = searchTabQuery.trim()
    if (tab !== 'search' || q.length < 1) {
      setSearchTabSuggestions([])
      return
    }
    const t = setTimeout(async () => {
      const r = await fetch(`${API}/search/suggest?q=${encodeURIComponent(q)}&limit=8`)
      const d = await r.json()
      setSearchTabSuggestions(d.suggestions || [])
    }, 120)
    return () => clearTimeout(t)
  }, [searchTabQuery, tab])

  useEffect(() => {
    if (tab === 'search') return
    setSearchTabResults([])
    setSearchTabSuggestions([])
    setSearchDetailBook(null)
  }, [tab])

  const mapped = useMemo(() => project(points), [points])

  const genres = useMemo(() => {
    const m = byKey(mapped, (p) => p.genre || 'unknown')
    const ranked = Array.from(m.entries())
      .map(([genre, items]) => ({ genre, items, count: items.length }))
      .sort((a, b) => b.count - a.count)

    const centerX = W * 0.5
    // Lift the genre ring slightly so bubbles clear the bottom stepper UI.
    const centerY = H * 0.49
    const ring = Math.min(W, H) * 0.26

    return ranked.map(({ genre, items, count }, i) => {
      const angle = (-Math.PI / 2) + (i * (2 * Math.PI / Math.max(1, ranked.length)))
      const cx = centerX + Math.cos(angle) * ring
      const cy = centerY + Math.sin(angle) * ring
      const r = Math.max(85, Math.min(88, 30 + Math.sqrt(count) * 1.7))
      return { genre, items, cx, cy, r, count: items.length, color: genreColor[genre] || '#8aa2bc' }
    })
  }, [mapped])

  const subs = useMemo(() => {
    if (!activeGenre) return []
    const pool = mapped.filter((p) => (p.genre || 'unknown') === activeGenre)
    // Group by finalized taxonomy label for UI clarity.
    const m = byKey(pool, (p) => p.subgenre || 'General')
    const raw = Array.from(m.entries()).map(([name, items]) => ({
      key: name,
      name,
      items,
      count: items.length
    })).sort((a, b) => b.count - a.count)

    // Center subgenre bubbles in the viewport for a consistent layout per genre.
    const cx0 = W * 0.5
    const cy0 = H * 0.5
    const ring = Math.max(120, Math.min(230, 90 + raw.length * 16))

    const counts = raw.map((s) => s.count)
    const minCount = Math.min(...counts, 1)
    const maxCount = Math.max(...counts, 1)
    const minLog = Math.log1p(minCount)
    const maxLog = Math.log1p(maxCount)
    const minArea = Math.PI * 27 * 27
    const maxArea = Math.PI * 78 * 78

    const scaleSubgenreRadius = (count) => {
      if (maxLog === minLog) return 46
      const t = (Math.log1p(count) - minLog) / (maxLog - minLog)
      const area = minArea + t * (maxArea - minArea)
      return Math.sqrt(area / Math.PI)
    }

    return raw.map((s, i) => {
      const angle = (-Math.PI / 2) + (i * (2 * Math.PI / Math.max(1, raw.length)))
      const cx = cx0 + Math.cos(angle) * ring
      const cy = cy0 + Math.sin(angle) * ring
      const r = scaleSubgenreRadius(s.count)
      return { ...s, cx, cy, r }
    })
  }, [mapped, activeGenre])

  const books = useMemo(() => {
    if (!activeGenre || activeSub == null) return []
    return mapped.filter((p) => (p.genre || 'unknown') === activeGenre && `${p.subgenre || 'General'}` === `${activeSub}`)
  }, [mapped, activeGenre, activeSub])
  const booksRender = useMemo(() => downsampleBooksByGrid(books, 520), [books])
  const topFeedBooks = useMemo(() => {
    const ranked = [...points].sort((a, b) => Number(b.book_rating_count || 0) - Number(a.book_rating_count || 0))
    const uniq = []
    const seen = new Set()
    for (const b of ranked) {
      const key = `${normalizeForDedup(b.title)}::${normalizeForDedup((b.author || '').split('|')[0])}`
      if (seen.has(key)) continue
      seen.add(key)
      if (isLikelyNonEnglishEdition(b)) {
        // Prefer the first higher-ranked edition and skip likely translated duplicates.
        continue
      }
      uniq.push(b)
      if (uniq.length >= 100) break
    }
    // Backfill in case filter was too aggressive.
    if (uniq.length < 100) {
      for (const b of ranked) {
        const key = `${normalizeForDedup(b.title)}::${normalizeForDedup((b.author || '').split('|')[0])}`
        if (uniq.find((x) => `${normalizeForDedup(x.title)}::${normalizeForDedup((x.author || '').split('|')[0])}` === key)) continue
        uniq.push(b)
        if (uniq.length >= 100) break
      }
    }
    return uniq
  }, [points])
  const feedBooks = useMemo(() => {
    if (!feedOrder.length) return topFeedBooks
    const byId = new Map(topFeedBooks.map((b) => [b.id, b]))
    const ordered = feedOrder.map((id) => byId.get(id)).filter(Boolean)
    const present = new Set(ordered.map((b) => b.id))
    const missing = topFeedBooks.filter((b) => !present.has(b.id))
    return [...ordered, ...missing]
  }, [topFeedBooks, feedOrder])
  const likedBooks = useMemo(() => points.filter((p) => likedBookIds.includes(p.id)), [points, likedBookIds])

  const selectedBook = useMemo(() => points.find((p) => p.id === selected?.id) || selected, [points, selected])
  const activeColor = (activeGenre && genreColor[activeGenre]) || '#6ea8ff'
  const sceneStyle = useMemo(() => {
    if (tab === 'feed') {
      return {
        '--bg-core': 'rgba(8, 10, 14, 0.94)',
        '--bg-mid': 'rgba(8, 10, 14, 0.94)'
      }
    }
    if (tab === 'liked' || tab === 'search') {
      return {
        '--bg-core': 'rgba(6, 8, 12, 0.18)',
        '--bg-mid': 'rgba(1, 3, 6, 0.96)'
      }
    }
    if (mode === 'genres') {
      return {
        '--bg-core': 'rgba(92, 64, 168, 0.38)',
        '--bg-mid': 'rgba(34, 25, 61, 0.78)'
      }
    }
    return {
      '--bg-core': rgba(activeColor, 0.34),
      '--bg-mid': rgba(activeColor, 0.16)
    }
  }, [tab, mode, activeColor])

  const selectBook = async (b) => {
    setSelected(b)
    setShowSimilar(false)
    const r = await fetch(`${API}/recommendations?book_id=${encodeURIComponent(b.id)}`)
    const d = await r.json()
    const uniq = []
    const seen = new Set()
    for (const x of (d.results || [])) {
      const key = x.id || `${(x.title || '').trim().toLowerCase()}::${(x.author || '').trim().toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      uniq.push(x)
    }
    setRecs(uniq)
  }

  const runSearch = async () => {
    if (!query.trim()) return
    const r = await fetch(`${API}/search?q=${encodeURIComponent(query)}`)
    const d = await r.json()
    const uniq = []
    const seen = new Set()
    for (const x of (d.results || [])) {
      const key = x.id || `${x.title}::${x.author}`
      if (seen.has(key)) continue
      seen.add(key)
      uniq.push(x)
    }
    setResults(uniq)
    setSuggestions(uniq.slice(0, 8))
  }

  const runSearchTab = async (raw) => {
    const q = (raw ?? searchTabQuery).trim()
    if (!q) return
    const r = await fetch(`${API}/search?q=${encodeURIComponent(q)}&limit=24`)
    const d = await r.json()
    setSearchTabResults(d.results || [])
    setSearchTabQuery(q)
  }

  const isLiked = (bookId) => likedBookIds.includes(bookId)

  const toggleLike = async (book) => {
    const id = book?.id
    if (!id) return
    const likedNow = likedBookIds.includes(id)
    const url = likedNow ? `${API}/liked-books/${encodeURIComponent(id)}` : `${API}/liked-books`
    const method = likedNow ? 'DELETE' : 'POST'
    const opts = likedNow
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book_id: id }) }
    const r = await fetch(url, opts)
    const d = await r.json()
    if (!r.ok) {
      setListsMsg(d.detail || 'Could not update likes')
      return
    }
    setLikedBookIds((d.book_ids || []).filter(Boolean))
  }

  const addFromFeedMenu = async (listName, bookId) => {
    await addBookToList(listName, bookId)
    setFeedCollectionMenuBookId('')
    setFeedNewCollectionDraft('')
  }

  const loadRecommendations = async (bookId) => {
    if (!bookId) return []
    const r = await fetch(`${API}/recommendations?book_id=${encodeURIComponent(bookId)}`)
    const d = await r.json()
    const uniq = []
    const seen = new Set()
    for (const x of (d.results || [])) {
      const key = x.id || `${(x.title || '').trim().toLowerCase()}::${(x.author || '').trim().toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      uniq.push(x)
    }
    return uniq
  }

  const toggleFeedSimilar = async (book) => {
    const id = book?.id
    if (!id) return
    if (feedSimilarBookId === id) {
      setFeedSimilarBookId('')
      return
    }
    setFeedSimilarBookId(id)
    if (feedRecsByBookId[id]) return
    const similar = await loadRecommendations(id)
    setFeedRecsByBookId((prev) => ({ ...prev, [id]: similar }))
  }

  const openTracker = (book) => {
    if (!book?.id) return
    const existing = readingProgressById[book.id] || {}
    const totalPages = Math.max(0, Number(existing.total_pages || getPageCount(book) || 0))
    const currentPage = Math.max(0, Math.min(Number(existing.current_page || 0), totalPages || Number(existing.current_page || 0)))
    setTrackerBook(book)
    setTrackerStatusOpen(false)
    setTrackerDraft({
      status: existing.status || 'not_started',
      total_pages: Number.isFinite(totalPages) ? totalPages : 0,
      current_page: Number.isFinite(currentPage) ? currentPage : 0,
      start_date: toDateInputValue(existing.start_date),
      finish_date: toDateInputValue(existing.finish_date),
      notes: existing.notes || ''
    })
  }

  const saveTracker = async () => {
    if (!trackerBook?.id || !trackerDraft) return
    setTrackerSaving(true)
    const totalPages = Math.max(0, Number(trackerDraft.total_pages || 0))
    const currentPage = Math.max(0, Math.min(Number(trackerDraft.current_page || 0), totalPages || Number(trackerDraft.current_page || 0)))
    const payload = {
      status: trackerDraft.status || 'not_started',
      total_pages: totalPages,
      current_page: currentPage,
      start_date: trackerDraft.start_date || '',
      finish_date: trackerDraft.finish_date || '',
      notes: trackerDraft.notes || ''
    }
    const r = await fetch(`${API}/reading-progress/${encodeURIComponent(trackerBook.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const d = await r.json()
    setTrackerSaving(false)
    if (!r.ok) {
      showToast(d.detail || 'Could not save reading progress')
      return false
    }
    setReadingProgressById(d.entries || {})
    return true
  }

  const closeTracker = async () => {
    if (trackerSaving) return
    const ok = await saveTracker()
    if (ok) {
      setTrackerBook(null)
      setTrackerStatusOpen(false)
    }
  }

  const openFromSearch = (b) => {
    setActiveGenre(b.genre || 'unknown')
    setActiveSub(`${b.subgenre || 'General'}`)
    setMode('books')
    setResults([])
    setSuggestions([])
    selectBook(b)
  }

  const personalizedSurprise = () => {
    if (!mapped.length) return
    const pool = (mode === 'books' && activeGenre)
      ? mapped.filter((p) => (p.genre || 'unknown') === activeGenre)
      : mapped

    let chosen = null
    if (selectedBook?.id) {
      // Prefer nearby books for "personalized" feel.
      const sx = selectedBook.mx ?? pool[0]?.mx ?? 0
      const sy = selectedBook.my ?? pool[0]?.my ?? 0
      const scored = pool
        .map((p) => ({ p, d: (p.mx - sx) ** 2 + (p.my - sy) ** 2 }))
        .sort((a, b) => a.d - b.d)
      const top = scored.slice(1, 80)
      chosen = top[Math.floor(Math.random() * Math.max(1, top.length))]?.p || pool[Math.floor(Math.random() * pool.length)]
    } else {
      chosen = pool[Math.floor(Math.random() * pool.length)]
    }
    if (chosen) openFromSearch(chosen)
  }

  const crumbSegments = [{ key: 'library', label: 'Library', level: 'genres' }]
  if (activeGenre) {
    crumbSegments.push({ key: 'genre', label: activeGenre.replaceAll('_', '-'), level: 'subgenres' })
  }
  if (activeSub) {
    const match = mapped.find((p) => `${p.subgenre || 'General'}` === `${activeSub}`)
    crumbSegments.push({ key: 'subgenre', label: match?.subgenre || 'Subgenre', level: 'books' })
  }
  if (mode === 'books' && selectedBook?.title) {
    crumbSegments.push({ key: 'book', label: selectedBook.title, level: 'book' })
  }

  const goToCrumb = (level) => {
    if (level === 'genres') {
      setMode('genres')
      setActiveGenre(null)
      setActiveSub(null)
      setSelected(null)
      setShowSimilar(false)
      return
    }
    if (level === 'subgenres') {
      setMode('subgenres')
      setActiveSub(null)
      setSelected(null)
      setShowSimilar(false)
      return
    }
    if (level === 'books') {
      setMode('books')
      setSelected(null)
      setShowSimilar(false)
    }
  }

  const getPageLength = (b) => b?.num_pages ?? b?.book_pages ?? b?.pages ?? null
  const getRatingCount = (b) => parseNumberish(b?.book_rating_count ?? b?.rating_count ?? b?.ratings_count)
  const getAvgRating = (b) => parseNumberish(b?.book_rating ?? b?.average_rating ?? b?.rating)
  const getReviewCount = (b) => parseNumberish(b?.book_review_count ?? b?.review_count ?? b?.reviews_count)
  const getPageCount = (b) => parseNumberish(getPageLength(b))
  const getShortDescription = (b) => {
    const text = (b?.description || '').trim()
    if (!text) return 'No description available yet.'
    return text.length > 220 ? `${text.slice(0, 220).trim()}...` : text
  }

  const shuffleFeed = () => {
    const ids = topFeedBooks.map((b) => b.id)
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = ids[i]
      ids[i] = ids[j]
      ids[j] = tmp
    }
    setFeedOrder(ids)
    setFeedIndex(0)
    if (feedScrollerRef.current) feedScrollerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const createReadingList = async (name, addBookId = null) => {
    const clean = (name || '').trim()
    if (!clean) return
    const r = await fetch(`${API}/reading-lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: clean })
    })
    const d = await r.json()
    if (!r.ok) {
      setListsMsg(d.detail || 'Could not create list')
      return
    }
    setReadingLists(d.lists || [])
    setNewListName('')
    setListDraftByName('')
    if (addBookId) await addBookToList(clean, addBookId, false)
  }

  const addBookToList = async (listName, bookId, keepModal = false) => {
    if (!bookId) return
    const existing = readingLists.find((x) => x.name === listName)
    if (existing?.book_ids?.includes(bookId) || existing?.books?.some((b) => b.id === bookId)) {
      showToast(`Already in "${listName}"`)
      if (!keepModal) setAddModalBook(null)
      return
    }
    const r = await fetch(`${API}/reading-lists/${encodeURIComponent(listName)}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: bookId })
    })
    const d = await r.json()
    if (!r.ok) {
      showToast(d.detail || 'Could not add book')
      return
    }
    setReadingLists(d.lists || [])
    showToast(`Added to "${listName}"`)
    if (!keepModal) setAddModalBook(null)
  }

  const deleteList = async (name) => {
    const r = await fetch(`${API}/reading-lists/${encodeURIComponent(name)}`, { method: 'DELETE' })
    const d = await r.json()
    if (!r.ok) {
      setListsMsg(d.detail || 'Could not delete list')
      return
    }
    setReadingLists(d.lists || [])
  }

  const renameList = async (currentName, nextName) => {
    const clean = (nextName || '').trim()
    if (!clean || clean === currentName) {
      setEditingListName('')
      setRenameDraft('')
      return
    }
    const r = await fetch(`${API}/reading-lists/${encodeURIComponent(currentName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: clean })
    })
    const d = await r.json()
    if (!r.ok) {
      setListsMsg(d.detail || 'Could not rename list')
      return
    }
    setReadingLists(d.lists || [])
    if (activeListName === currentName) setActiveListName(clean)
    setEditingListName('')
    setRenameDraft('')
  }

  const removeFromList = async (name, bookId) => {
    const r = await fetch(`${API}/reading-lists/${encodeURIComponent(name)}/books/${encodeURIComponent(bookId)}`, { method: 'DELETE' })
    const d = await r.json()
    if (!r.ok) {
      setListsMsg(d.detail || 'Could not remove book')
      return
    }
    setReadingLists(d.lists || [])
  }

  const allListBooks = useMemo(() => {
    const m = new Map()
    for (const list of readingLists) {
      for (const b of (list.books || [])) {
        if (!m.has(b.id)) m.set(b.id, b)
      }
    }
    return Array.from(m.values())
  }, [readingLists])

  const visibleLists = useMemo(() => {
    const q = listsQuery.trim().toLowerCase()
    if (!q) return readingLists
    return readingLists.filter((l) => l.name.toLowerCase().includes(q))
  }, [readingLists, listsQuery])

  const activeList = useMemo(() => {
    if (activeListName === 'all') return null
    return readingLists.find((x) => x.name === activeListName) || null
  }, [readingLists, activeListName])

  const visibleBooks = activeList ? (activeList.books || []) : allListBooks

  const stars = (rating) => {
    const n = Math.max(0, Math.min(5, Math.round(Number(rating || 0))))
    return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`
  }

  const nextCollectionName = useMemo(() => {
    const taken = new Set(
      readingLists
        .map((x) => (x?.name || '').trim().toLowerCase())
        .filter(Boolean)
    )
    let n = 1
    while (taken.has(`collection ${n}`)) n += 1
    return `Collection ${n}`
  }, [readingLists])

  useEffect(() => {
    if (tab !== 'feed') return
    const el = feedScrollerRef.current
    if (!el) return
    const onScroll = () => {
      const children = Array.from(el.querySelectorAll('.feedItem'))
      if (!children.length) return
      const viewportCenter = el.scrollTop + el.clientHeight * 0.5
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i < children.length; i += 1) {
        const node = children[i]
        const center = node.offsetTop + node.clientHeight * 0.5
        const d = Math.abs(center - viewportCenter)
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }
      setFeedIndex(best)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [tab, feedBooks.length])

  return (
    <div className="scene minimalScene appleShell" style={sceneStyle}>
      <aside className="appleSidebar">
        <div className="appleSectionTitle">Library</div>
        <div className="topMenu appleNav">
          <button className={`menuTab ${tab === 'explorer' ? 'active' : ''}`} onClick={() => setTab('explorer')}>
            <span className="appleIcon" aria-hidden>
              <svg className="appleIconSvg" viewBox="0 0 24 24" fill="none">
                <path d="M4 10.8 12 4l8 6.8v8.2a1 1 0 0 1-1 1h-5.2v-6h-3.6v6H5a1 1 0 0 1-1-1v-8.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
              </svg>
            </span>
            <span>Explorer</span>
          </button>
          <button className={`menuTab ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>
            <span className="appleIcon" aria-hidden>
              <svg className="appleIconSvg" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="3.5" width="16" height="17" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </span>
            <span>Feed</span>
          </button>
          <button className={`menuTab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
            <span className="appleIcon" aria-hidden>
              <svg className="appleIconSvg" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8"/>
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </span>
            <span>Search</span>
          </button>
          <button
            className={`menuTab ${tab === 'liked' ? 'active' : ''}`}
            onClick={() => setTab('liked')}
          >
            <span className="appleIcon" aria-hidden>
              <svg className="appleIconSvg" viewBox="0 0 24 24" fill="none">
                <path d="M12 20.2s-6.8-4.4-8.8-8C1.4 8.7 3.1 5.5 6.5 5.5c2 0 3.2 1 4 2 0.8-1 2-2 4-2 3.4 0 5.1 3.2 3.3 6.7-2 3.6-8.8 8-8.8 8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
              </svg>
            </span>
            <span>Liked</span>
          </button>
        </div>
        <div className="appleSectionTitle collectionsHeader">My Collections</div>
        <div className="appleCollections">
          <div
            className={`sideListItem collectionRow ${tab === 'lists' && activeListName === 'all' ? 'on' : ''}`}
            onClick={() => { setTab('lists'); setActiveListName('all') }}
          >
            <span className="itemLead">
              <span className="appleIcon" aria-hidden>
                <svg className="appleIconSvg" viewBox="0 0 24 24" fill="none">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <span>All Books</span>
            </span>
            <span className="collectionActions">
              <span>{allListBooks.length}</span>
            </span>
          </div>
          {visibleLists.map((list) => (
            <div
              key={`nav-${list.name}`}
              className={`sideListItem collectionRow ${tab === 'lists' && activeListName === list.name ? 'on' : ''}`}
              onClick={() => { setTab('lists'); setActiveListName(list.name) }}
              onDoubleClick={() => { setEditingListName(list.name); setRenameDraft(list.name) }}
            >
              <span className="itemLead">
                <span className="appleIcon" aria-hidden>
                  <svg className="appleIconSvg" viewBox="0 0 24 24" fill="none">
                    <path d="M3 7h18M3 12h18M3 17h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </span>
                {editingListName === list.name ? (
                  <input
                    autoFocus
                    className="collectionRenameInput"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => renameList(list.name, renameDraft)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameList(list.name, renameDraft)
                      if (e.key === 'Escape') {
                        setEditingListName('')
                        setRenameDraft('')
                      }
                    }}
                  />
                ) : (
                  <span>{list.name}</span>
                )}
              </span>
              <span className="collectionActions">
                <span>{list.count || 0}</span>
                <button
                  className="collectionDeleteBtn"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteList(list.name)
                  }}
                  aria-label={`Delete ${list.name}`}
                >
                  <svg viewBox="0 0 20 20" aria-hidden>
                    <path d="M5 5L15 15M15 5L5 15" />
                  </svg>
                </button>
              </span>
            </div>
          ))}
          <button
            className="sideListItem newCollectionItem"
            onClick={() => createReadingList(newListName || nextCollectionName)}
          >
            <span className="itemLead">
              <span className="appleIcon" aria-hidden>
                <svg className="appleIconSvg" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </span>
              <span>New Collection</span>
            </span>
          </button>
        </div>
      </aside>
      <main className="appleMain">

      {tab === 'explorer' && (
        <>
      <div className="headerLeft">
        {mode !== 'genres' && <button className="backBtn" onClick={() => {
          if (mode === 'books') setMode('subgenres')
          else { setMode('genres'); setActiveGenre(null); setActiveSub(null) }
        }}>‹</button>}
        <div>
          <div className="crumbs" aria-label="Breadcrumb">
            {crumbSegments.map((segment, idx) => {
              const isLast = idx === crumbSegments.length - 1
              const isInteractive = !isLast && segment.level !== 'book'
              return (
                <span key={segment.key} className="crumbItem">
                  {isInteractive ? (
                    <button className="crumbBtn" onClick={() => goToCrumb(segment.level)}>
                      {segment.label}
                    </button>
                  ) : (
                    <span className="crumbCurrent">{segment.label}</span>
                  )}
                  {!isLast && <span className="crumbSep">/</span>}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      <svg className="map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          {genres.map((g) => (
            <radialGradient key={`grad-${g.genre}`} id={`grad-${g.genre}`} cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor={rgba(g.color, 0.98)} />
              <stop offset="55%" stopColor={rgba(g.color, 0.78)} />
              <stop offset="100%" stopColor={rgba(g.color, 0.56)} />
            </radialGradient>
          ))}
          {activeGenre && (
            <radialGradient id="grad-active" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor={rgba(activeColor, 0.98)} />
              <stop offset="100%" stopColor={rgba(activeColor, 0.62)} />
            </radialGradient>
          )}
        </defs>
        {mode === 'genres' && genres.map((g) => (
          <g key={g.genre} className="clickable bubbleGroup" onClick={() => { setActiveGenre(g.genre); setMode('subgenres') }}>
            <circle cx={g.cx} cy={g.cy} r={g.r + 10} className="glow" style={{ color: g.color }} />
            <circle cx={g.cx} cy={g.cy} r={g.r} fill={`url(#grad-${g.genre})`} opacity="0.98" />
            <text x={g.cx} y={g.cy + g.r + 26} className="labelMain">{g.genre.replaceAll('_', '-')}</text>
          </g>
        ))}

        {mode === 'subgenres' && subs.map((s) => (
          <g key={s.key} className="clickable bubbleGroup" onClick={() => { setActiveSub(`${s.name}`); setMode('books') }}>
            <circle cx={s.cx} cy={s.cy} r={s.r + 9} className="glow" style={{ color: activeColor }} />
            <circle cx={s.cx} cy={s.cy} r={s.r} fill="url(#grad-active)" opacity="0.98" />
            <text x={s.cx} y={s.cy + s.r + 22} className="labelMain">{s.name}</text>
          </g>
        ))}

        {mode === 'books' && booksRender.visible.map((b, i) => (
          <g
            key={b.id}
            className="clickable pointGroup"
            onClick={() => selectBook(b)}
            onMouseEnter={() => setHoveredBook(b)}
            onMouseLeave={() => setHoveredBook((current) => (current?.id === b.id ? null : current))}
          >
            <circle
              cx={b.mx}
              cy={b.my}
              r={selectedBook?.id === b.id ? 15 : 11}
              className="bookDot"
              style={{ '--dot': activeColor }}
            />
          </g>
        ))}
      </svg>

      {mode === 'books' && hoveredBook && !selectedBook && (
        <div
          className="mapHoverPreview"
          style={{
            left: `${(hoveredBook.mx / W) * 100}%`,
            top: `${(hoveredBook.my / H) * 100}%`
          }}
        >
          <div className="mapHoverTitle">{hoveredBook.title || 'Untitled'}</div>
          <div className="mapHoverAuthor">{formatAuthors(hoveredBook.author) || 'Unknown author'}</div>
          <div className="mapHoverMeta">
            <span>{hoveredBook.subgenre || 'General'}</span>
            {hoveredBook.book_rating != null && <span>★ {Number(hoveredBook.book_rating).toFixed(1)}</span>}
          </div>
        </div>
      )}

      {mode === 'books' && selectedBook && (
        <div className="bookModalLayer">
          <div className="bookBackdrop" onClick={() => setSelected(null)} />
          <div className="bookModal">
            <button className="bookModalClose" onClick={() => setSelected(null)}>×</button>
            <div className="bookModalIcon" style={{ '--accent': activeColor }}>
              <span />
            </div>
            <div className="bookModalTitle">{selectedBook.title}</div>
            <div className="bookModalAuthor">{formatAuthors(selectedBook.author)}</div>
            <div className="bookModalTags">
              <span className="tagNeutral">{selectedBook.genre?.replaceAll('_', ' ') || 'Unknown'}</span>
              <span className="tagAccent" style={{ '--accent': activeColor }}>{selectedBook.subgenre || 'General'}</span>
              {(selectedBook.book_rating != null) && (
                <span className="tagNeutral">★ {Number(selectedBook.book_rating).toFixed(1)}</span>
              )}
              {(selectedBook.book_rating_count != null) && (
                <span className="tagNeutral">{Number(selectedBook.book_rating_count).toLocaleString()} ratings</span>
              )}
              {(selectedBook.book_review_count != null) && (
                <span className="tagNeutral">{Number(selectedBook.book_review_count).toLocaleString()} reviews</span>
              )}
            </div>
            <div className="bookModalRule" />
            <p className="bookModalBody">
              {selectedBook.description
                ? selectedBook.description
                : 'Part of a cluster of similar books based on themes, writing style, and reader preferences.'}
            </p>
            <div className="mapModalActions">
              <button
                className={`heartBtn ${isLiked(selectedBook.id) ? 'on' : ''}`}
                onClick={() => toggleLike(selectedBook)}
                aria-label={isLiked(selectedBook.id) ? 'Unlike book' : 'Like book'}
              >
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M12.1 21.35 10.8 20.2C5.9 15.8 2.7 12.9 2.7 9.3 2.7 6.4 4.9 4.2 7.8 4.2c1.7 0 3.3.8 4.3 2.1 1-1.3 2.6-2.1 4.3-2.1 2.9 0 5.1 2.2 5.1 5.1 0 3.6-3.2 6.5-8.1 10.9l-1.3 1.15Z" />
                </svg>
              </button>
              <button
                className="collectionPlusBtn mapModalAddBtn"
                onClick={() => setAddModalBook(selectedBook)}
                aria-label="Add to collection"
              >
                +
              </button>
              {recs.length > 0 && (
                <button
                  className={`mapMenuBtn ${showSimilar ? 'on' : ''}`}
                  onClick={() => setShowSimilar((v) => !v)}
                  aria-label={showSimilar ? 'Hide similar books' : 'Show similar books'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M5 7h14M5 12h14M5 17h14" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bottomHint">
        {mode === 'genres' && 'Click a genre to explore its subgenres'}
        {mode === 'subgenres' && 'Click a subgenre to see individual books'}
        {mode === 'books' && `Click a book to see details.${booksRender.hiddenCount > 0 ? ` Showing ${booksRender.visible.length} of ${books.length} for performance.` : ''}`}
      </div>

      {(suggestions.length > 0 || results.length > 0) && (
        <div className="searchResults">
          {(suggestions.length ? suggestions : results).slice(0, 8).map((r) => (
            <button key={r.id} onClick={() => openFromSearch(r)}>
              {r.title}
            </button>
          ))}
        </div>
      )}
        </>
      )}

      {tab === 'feed' && (
        <div className="feedShell feedShellModern">
          <div className="feedToolbar feedToolbarModern">
            <div className="feedToolbarLabel">Discover</div>
            <button className="feedShuffleBtn feedShuffleBtnModern" onClick={shuffleFeed}>
              <svg viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M3 7h2.5a4 4 0 013.2 1.6L10 10.5m0 0l1.3 1.9A4 4 0 0014.5 14H17m-7-3.5l-1.3-1.9A4 4 0 005.5 7H3m14 7l-2 2m2-2l-2-2M3 14h2.5a4 4 0 003.2-1.6L10 10.5m7-3.5h-2.5a4 4 0 00-3.2 1.6L10 10.5m7-3.5l-2-2m2 2l-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Shuffle
            </button>
          </div>
          <div className="feedScroller feedScrollerModern" ref={feedScrollerRef}>
            {feedBooks.map((b, idx) => {
              const avgRating = getAvgRating(b)
              const pageCount = getPageCount(b)
              const ratingCount = getRatingCount(b)
              return (
              <section key={b.id || `${b.title}-${idx}`} className="feedItem feedItemFull">
                <article className={`feedTikTokCard feedCardFull ${b.image_url ? 'hasImage' : ''} ${feedSimilarBookId === b.id ? 'similarOpen' : ''}`}>
                  {b.image_url && <img className="feedPosterImg feedPosterImgFull" src={b.image_url} alt="" loading="lazy" />}
                  <div className="feedCardGradientFull" />

                  <div className="feedContentBottom">
                    <div className="feedGenrePills">
                      <span>{formatGenreLabel(b.genre)}</span>
                      {b.subgenre && <span>{b.subgenre}</span>}
                      <span>Fiction</span>
                    </div>
                    <h2 className="feedCardTitleFull">{b.title || 'Untitled'}</h2>
                    <div className="feedCardAuthorFull">{formatAuthors(b.author) || 'Unknown author'}</div>
                    <div className="feedCardMetaRow">
                      <div className="feedMetaItem">
                        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                        </svg>
                        <span>{avgRating != null ? Number(avgRating).toFixed(2) : 'N/A'}</span>
                      </div>
                      <div className="feedMetaItem">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" stroke="currentColor" strokeWidth="1.8"/>
                        </svg>
                        <span>{pageCount != null ? `${pageCount} pages` : 'N/A'}</span>
                      </div>
                    </div>
                    <p className="feedCardDesc">{getShortDescription(b)}</p>
                    <button className="feedReadMoreBtn">Read more</button>
                  </div>

                  <div className="feedActionsRight">
                    <div className="feedActionBtn">
                      <button
                        className={`feedActionIcon ${isLiked(b.id) ? 'liked' : ''}`}
                        onClick={() => toggleLike(b)}
                        aria-label={isLiked(b.id) ? 'Unlike book' : 'Like book'}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden>
                          <path d="M12.1 21.35 10.8 20.2C5.9 15.8 2.7 12.9 2.7 9.3 2.7 6.4 4.9 4.2 7.8 4.2c1.7 0 3.3.8 4.3 2.1 1-1.3 2.6-2.1 4.3-2.1 2.9 0 5.1 2.2 5.1 5.1 0 3.6-3.2 6.5-8.1 10.9l-1.3 1.15Z" />
                        </svg>
                      </button>
                      <span>{formatCompactCount(ratingCount)}</span>
                    </div>
                    <div className="feedActionBtn">
                      <button
                        className="feedActionIcon"
                        onClick={() => toggleFeedSimilar(b)}
                        aria-label="Show reviews"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <span>{formatCompactCount(getReviewCount(b))}</span>
                    </div>
                    <div className="feedActionBtn collectionMenuWrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="feedActionIcon"
                        onClick={(e) => {
                          e.stopPropagation()
                          setFeedCollectionMenuBookId((prev) => (prev === b.id ? '' : b.id))
                        }}
                        aria-label="Add to collection"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                        </svg>
                      </button>
                      <span>Save</span>
                      {feedCollectionMenuBookId === b.id && (
                        <div className="collectionDropdown collectionDropdownModern">
                          <div className="collectionDropdownHeader">Save to Collection</div>
                          <div className="collectionDropdownList">
                            {readingLists.map((list) => (
                              <button key={`feed-add-${b.id}-${list.name}`} onClick={() => addFromFeedMenu(list.name, b.id)}>
                                {list.name}
                              </button>
                            ))}
                          </div>
                          <div className="collectionDropdownCreate">
                            <input
                              value={feedNewCollectionDraft}
                              onChange={(e) => setFeedNewCollectionDraft(e.target.value)}
                              placeholder={nextCollectionName}
                            />
                            <button
                              onClick={async () => {
                                const name = (feedNewCollectionDraft || nextCollectionName).trim()
                                await createReadingList(name, b.id)
                                setFeedCollectionMenuBookId('')
                                setFeedNewCollectionDraft('')
                              }}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="feedActionBtn">
                      <button
                        className="feedActionIcon"
                        onClick={() => {}}
                        aria-label="Share"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <span>Share</span>
                    </div>
                  </div>

                  {feedSimilarBookId === b.id && (
                    <div className="feedSimilarDrawer feedSimilarDrawerModern">
                      <div className="feedSimilarHead feedSimilarHeadModern">
                        <div>
                          <strong>Similar to this book</strong>
                          <span>Based on readers who enjoyed this</span>
                        </div>
                        <button onClick={() => setFeedSimilarBookId('')} aria-label="Close similar books">
                          <svg viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                          </svg>
                        </button>
                      </div>
                      <div className="feedSimilarRail feedSimilarRailModern">
                        {(feedRecsByBookId[b.id] || []).slice(0, 10).map((rec) => (
                          <button key={`feed-rec-${b.id}-${rec.id || rec.title}`} className="feedSimilarCard feedSimilarCardModern" onClick={() => openFromSearch(rec)}>
                            <div className="feedSimilarCover feedSimilarCoverModern">
                              {rec.image_url ? <img src={rec.image_url} alt="" loading="lazy" /> : <div className="feedSimilarFallback" />}
                            </div>
                            <div className="feedSimilarInfo">
                              <div className="feedSimilarTitle">{rec.title || 'Untitled'}</div>
                              <div className="feedSimilarAuthor">{formatAuthors(rec.author) || 'Unknown'}</div>
                            </div>
                          </button>
                        ))}
                        {!feedRecsByBookId[b.id]?.length && <div className="feedSimilarEmpty">No similar books found yet.</div>}
                      </div>
                    </div>
                  )}
                </article>
              </section>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'search' && (
        <div className="searchTabShell">
          <div className="searchHero">
            <div className="searchBarWrap">
              <input
                className="searchHeroInput"
                value={searchTabQuery}
                onChange={(e) => setSearchTabQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearchTab()}
                placeholder="Search by title, author, or genre"
              />
            </div>
            {!!searchTabSuggestions.length && (
              <div className="searchSuggestList">
                {searchTabSuggestions.map((s) => (
                  <button key={s} onClick={() => runSearchTab(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
          <div className="searchResultsGrid">
            {searchTabResults.map((b) => (
              <article key={`search-${b.id}`} className="searchCoverCard" onClick={() => setSearchDetailBook(b)} title={b.title || 'Untitled'}>
                <div className="searchCoverWrap">
                  {b.image_url ? <img src={b.image_url} alt="" loading="lazy" /> : <div className="listBookImageFallback" />}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'search' && searchDetailBook && (
        <div className="searchDetailLayer">
          <div className="addListBackdrop" onClick={() => setSearchDetailBook(null)} />
          <div className="searchDetailModalNew">
            <button className="searchDetailCloseNew" onClick={() => setSearchDetailBook(null)} aria-label="Close details">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
            </button>
            <div className="searchDetailGrid">
              <div className="searchDetailCover">
                {searchDetailBook.image_url ? (
                  <img src={searchDetailBook.image_url} alt="" loading="lazy" />
                ) : (
                  <div className="searchDetailCoverFallback" />
                )}
              </div>
              <div className="searchDetailInfo">
                <div className="searchDetailGenre">{formatGenreLabel(searchDetailBook.genre)}</div>
                <h2 className="searchDetailTitle">{searchDetailBook.title || 'Untitled'}</h2>
                <div className="searchDetailAuthor">{formatAuthors(searchDetailBook.author) || 'Unknown author'}</div>
                <div className="searchDetailStats">
                  <div className="searchDetailStat rating">
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                    </svg>
                    <span>{getAvgRating(searchDetailBook) != null ? Number(getAvgRating(searchDetailBook)).toFixed(2) : 'N/A'}</span>
                  </div>
                  <div className="searchDetailStat">
                    <span>{formatCompactCount(getRatingCount(searchDetailBook))} ratings</span>
                  </div>
                  <div className="searchDetailStat">
                    <span>{getPageCount(searchDetailBook) != null ? `${getPageCount(searchDetailBook)} pages` : 'N/A'}</span>
                  </div>
                </div>
                <p className="searchDetailDesc">{(searchDetailBook?.description || 'No description available yet.').trim()}</p>
                <div className="searchDetailActions">
                  <button
                    className={`searchDetailLikeBtn ${isLiked(searchDetailBook.id) ? 'liked' : ''}`}
                    onClick={() => toggleLike(searchDetailBook)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M12.1 21.35 10.8 20.2C5.9 15.8 2.7 12.9 2.7 9.3 2.7 6.4 4.9 4.2 7.8 4.2c1.7 0 3.3.8 4.3 2.1 1-1.3 2.6-2.1 4.3-2.1 2.9 0 5.1 2.2 5.1 5.1 0 3.6-3.2 6.5-8.1 10.9l-1.3 1.15Z" />
                    </svg>
                    {isLiked(searchDetailBook.id) ? 'Liked' : 'Like'}
                  </button>
                  <button className="searchDetailSaveBtn" onClick={() => setAddModalBook(searchDetailBook)}>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    Add to Collection
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'liked' && (
        <div className="listsShell appleBooksCollectionShell">
          <div className="listsScreen listsSinglePane">
            <section className="listsContent">
              <div className="listsTopBar">
                <div>
                  <h2>Liked</h2>
                </div>
                <div className="listsActions">
                  <div className="listsTotalBooks">{likedBooks.length} books</div>
                </div>
              </div>
              <div className="bookCardGrid coversOnlyGrid">
                {likedBooks.map((b) => (
                  <article
                    key={`liked-${b.id}`}
                    className="listBookCard coverOnlyCard"
                    title={b.title || 'Untitled'}
                    onClick={() => openTracker(b)}
                  >
                    <div className="listBookImageWrap">
                      {b.image_url ? <img src={b.image_url} alt="" loading="lazy" /> : <div className="listBookImageFallback" />}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === 'lists' && (
        <div className="listsShell appleBooksCollectionShell">
          <div className="listsScreen listsSinglePane">
            <section className="listsContent">
              <div className="listsTopBar">
                <div>
                  <h2>{activeList ? activeList.name : 'All Books'}</h2>
                </div>
                <div className="listsActions">
                  <div className="listsTotalBooks">{visibleBooks.length} books</div>
                </div>
              </div>
              {listsMsg && <div className="listsMsg">{listsMsg}</div>}
              <div className="bookCardGrid coversOnlyGrid">
                {visibleBooks.map((b) => (
                  <article
                    key={`${activeListName}-${b.id}`}
                    className="listBookCard coverOnlyCard"
                    title={b.title || 'Untitled'}
                    onClick={() => openTracker(b)}
                  >
                    <div className="listBookImageWrap">
                      {b.image_url ? <img src={b.image_url} alt="" loading="lazy" /> : <div className="listBookImageFallback" />}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {addModalBook && (
        <div className="addListLayer">
          <div className="addListBackdrop" onClick={() => setAddModalBook(null)} />
          <div className="addListModal">
            <div className="addListTitle">Add "{addModalBook.title}"</div>
            <div className="addListSub">Select a collection or create a new one.</div>
            <div className="addListButtons">
              {readingLists.map((list) => (
                <button key={list.name} onClick={() => addBookToList(list.name, addModalBook.id)}>
                  {list.name}
                </button>
              ))}
              {!readingLists.length && <div className="emptyList">No collections yet. Create one below.</div>}
            </div>
            <div className="addListCreate">
              <input
                value={listDraftByName}
                onChange={(e) => setListDraftByName(e.target.value)}
                placeholder="New collection name"
              />
              <button onClick={() => createReadingList(listDraftByName, addModalBook.id)}>Create + Add</button>
            </div>
          </div>
        </div>
      )}
      {trackerBook && trackerDraft && (
        <div className="readTrackerLayer">
          <div className="addListBackdrop" onClick={closeTracker} />
          <div className="readTrackerModal">
            <button className="searchDetailClose" onClick={closeTracker} aria-label="Close tracker">×</button>
            <div className="readTrackerHead">
              <div className="readTrackerCover">
                {trackerBook.image_url ? <img src={trackerBook.image_url} alt="" loading="lazy" /> : <div className="listBookImageFallback" />}
              </div>
              <div className="readTrackerTitleBlock">
                <h3>{trackerBook.title || 'Untitled'}</h3>
                <p>{formatAuthors(trackerBook.author) || 'Unknown author'}</p>
                <div className="readTrackerMiniProgress">
                  <div
                    className="readTrackerRing"
                    style={{
                      '--pct': `${Math.max(
                        0,
                        Math.min(
                          100,
                          trackerDraft.total_pages > 0 ? (trackerDraft.current_page / trackerDraft.total_pages) * 100 : 0
                        )
                      )}%`
                    }}
                  >
                    <span>
                      {Math.max(
                        0,
                        Math.min(
                          100,
                          Math.round(trackerDraft.total_pages > 0 ? (trackerDraft.current_page / trackerDraft.total_pages) * 100 : 0)
                        )
                      )}
                      %
                    </span>
                  </div>
                  <div className="readTrackerMiniProgressText">
                    <strong>{trackerDraft.current_page} of {trackerDraft.total_pages || 0}</strong>
                    <span>pages read</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="readTrackerRule" />
            <div className="readTrackerStatusWrap">
              <button
                className="readTrackerStatusBtn"
                onClick={() => setTrackerStatusOpen((v) => !v)}
                aria-expanded={trackerStatusOpen}
              >
                <span className="readTrackerStatusIcon" aria-hidden>
                  <span className={`readTrackerStatusDot ${trackerDraft.status}`} />
                </span>
                <span>
                  {trackerDraft.status === 'done' ? 'Finished' : trackerDraft.status === 'reading' ? 'Currently Reading' : 'Want to Read'}
                </span>
                <span className={`readTrackerStatusChevron ${trackerStatusOpen ? 'open' : ''}`} aria-hidden>
                  <svg viewBox="0 0 20 20">
                    <path d="M5 8l5 5 5-5" />
                  </svg>
                </span>
              </button>
              {trackerStatusOpen && (
                <div className="readTrackerStatusMenu">
                  <button onClick={() => { setTrackerDraft((prev) => ({ ...prev, status: 'not_started' })); setTrackerStatusOpen(false) }}>
                    <span className="readTrackerMenuLabel">Want to Read</span>{trackerDraft.status === 'not_started' && <span>✓</span>}
                  </button>
                  <button onClick={() => { setTrackerDraft((prev) => ({ ...prev, status: 'reading' })); setTrackerStatusOpen(false) }}>
                    <span className="readTrackerMenuLabel">Currently Reading</span>{trackerDraft.status === 'reading' && <span>✓</span>}
                  </button>
                  <button onClick={() => { setTrackerDraft((prev) => ({ ...prev, status: 'done' })); setTrackerStatusOpen(false) }}>
                    <span className="readTrackerMenuLabel">Finished</span>{trackerDraft.status === 'done' && <span>✓</span>}
                  </button>
                </div>
              )}
            </div>
            <div className="readTrackerGrid">
              <label>
                <span>Current Page</span>
                <input
                  type="number"
                  min="0"
                  max={trackerDraft.total_pages || undefined}
                  value={trackerDraft.current_page}
                  onChange={(e) => setTrackerDraft((prev) => ({ ...prev, current_page: Number(e.target.value || 0) }))}
                />
              </label>
              <label>
                <span>Total Pages</span>
                <input
                  type="number"
                  min="0"
                  value={trackerDraft.total_pages}
                  onChange={(e) => setTrackerDraft((prev) => ({ ...prev, total_pages: Number(e.target.value || 0) }))}
                />
              </label>
              <label>
                <span>Started</span>
                <input
                  type="date"
                  value={trackerDraft.start_date}
                  onChange={(e) => setTrackerDraft((prev) => ({ ...prev, start_date: e.target.value }))}
                />
              </label>
              <label>
                <span>Finished</span>
                <input
                  type="date"
                  value={trackerDraft.finish_date}
                  onChange={(e) => setTrackerDraft((prev) => ({ ...prev, finish_date: e.target.value }))}
                />
              </label>
            </div>
            <label className="readTrackerNotes">
              <span>Notes</span>
              <textarea
                value={trackerDraft.notes}
                onChange={(e) => setTrackerDraft((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Write your thoughts here..."
              />
            </label>
          </div>
        </div>
      )}
      <aside className={`recoDrawer ${showSimilar ? 'open' : ''}`}>
        <div className="recoTitle">Similar Books</div>
        <div className="recoList">
          {recs.slice(0, 12).map((rec) => (
            <button
              key={`rec-${rec.id || rec.title}`}
              onClick={() => {
                setShowSimilar(false)
                selectBook(rec)
              }}
            >
              <strong>{rec.title || 'Untitled'}</strong>
              <span>{formatAuthors(rec.author) || 'Unknown author'}</span>
            </button>
          ))}
          {!recs.length && <div className="emptyList">No similar books found yet.</div>}
        </div>
      </aside>
      {toastMsg && <div className="toastMsg">{toastMsg}</div>}
      </main>
    </div>
  )
}
