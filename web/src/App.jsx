import { useEffect, useMemo, useRef, useState } from 'react'

// prod 
const API = '/api'

// dev
// const API = 'http://127.0.0.1:8000'
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

function formatShortDate(isoDate) {
  if (!isoDate) return 'Unknown day'
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function buildHeatmapGrid(days) {
  if (!Array.isArray(days) || !days.length) return { columns: [], monthTicks: [] }
  const byDate = new Map(days.map((d) => [d.date, d]))
  const start = new Date(`${days[0].date}T00:00:00`)
  const end = new Date(`${days[days.length - 1].date}T00:00:00`)
  const startMonday = new Date(start)
  const shift = (startMonday.getDay() + 6) % 7
  startMonday.setDate(startMonday.getDate() - shift)
  const columns = []
  const monthTicks = []
  let cursor = new Date(startMonday)
  while (cursor <= end) {
    const week = []
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(cursor)
      day.setDate(cursor.getDate() + i)
      const key = day.toISOString().slice(0, 10)
      week.push(byDate.get(key) || null)
    }
    const monthIdx = week[0] ? new Date(`${week[0].date}T00:00:00`).getMonth() : cursor.getMonth()
    if (columns.length === 0 || monthIdx !== (columns[columns.length - 1]?.monthIdx)) {
      monthTicks.push({ monthIdx, col: columns.length })
    }
    columns.push({ week, monthIdx })
    cursor.setDate(cursor.getDate() + 7)
  }
  return { columns, monthTicks }
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
  const [expandedDescByBookId, setExpandedDescByBookId] = useState({})
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
  const [syncedAllBooks, setSyncedAllBooks] = useState([])
  const [trackerBook, setTrackerBook] = useState(null)
  const [trackerDraft, setTrackerDraft] = useState(null)
  const [trackerSaving, setTrackerSaving] = useState(false)
  const [trackerStatusOpen, setTrackerStatusOpen] = useState(false)
  const [activeStatsPeriod, setActiveStatsPeriod] = useState('monthly')
  const [statsByPeriod, setStatsByPeriod] = useState({})
  const [statsActivity, setStatsActivity] = useState({ days: [], summary: { activeDays: 0, currentStreak: 0, longestStreak: 0, totalPagesYear: 0 } })
  const [syncingStats, setSyncingStats] = useState(false)
  const [syncPreviewBooks, setSyncPreviewBooks] = useState([])
  const [syncSelectedBookIds, setSyncSelectedBookIds] = useState([])
  const [syncPickerOpen, setSyncPickerOpen] = useState(false)
  const [applyingSyncSelection, setApplyingSyncSelection] = useState(false)

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

  useEffect(() => {
    setAddModalBook(null)
    setFeedCollectionMenuBookId('')
    setFeedNewCollectionDraft('')
    setFeedSimilarBookId('')
    setShowSimilar(false)
    setSearchDetailBook(null)
    setSelected(null)
    setTrackerBook(null)
  }, [tab])

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

  const refreshSyncedAllBooks = async () => {
    try {
      const r = await fetch(`${API}/my-books`)
      const d = await r.json()
      if (!r.ok) return
      setSyncedAllBooks(d.books || [])
    } catch {
      // Best effort only.
    }
  }

  useEffect(() => {
    refreshSyncedAllBooks()
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
    // Match /my-books merge: stale progress rows (e.g. after a sparse sync) can be all zeros while
    // Obsidian snapshot on the book still has pages/status — treat that as "no saved progress".
    const st = String(existing.status || '').toLowerCase()
    const isDegenerateProgress =
      (st === 'not_started' || !st) &&
      !Number(existing.total_pages) &&
      !Number(existing.current_page)
    const src = isDegenerateProgress ? {} : existing
    const totalPages = Math.max(
      0,
      Number(
        src.total_pages ||
          book.reading_total_pages ||
          book.total_pages ||
          getPageCount(book) ||
          0
      )
    )
    const rawCurrent = Number(
      src.current_page ||
        book.reading_current_page ||
        book.current_page ||
        0
    )
    const currentPage = Math.max(0, Math.min(rawCurrent, totalPages || rawCurrent))
    setTrackerBook(book)
    setTrackerStatusOpen(false)
    setTrackerDraft({
      status: src.status || book.reading_status || book.status || 'not_started',
      total_pages: Number.isFinite(totalPages) ? totalPages : 0,
      current_page: Number.isFinite(currentPage) ? currentPage : 0,
      start_date: toDateInputValue(src.start_date || book.reading_start_date || book.start_date),
      finish_date: toDateInputValue(src.finish_date || book.reading_finish_date || book.finish_date),
      notes: src.notes || existing.notes || ''
    })
  }

  const normalizeNonNegativeInt = (raw) => {
    const digits = String(raw ?? '').replace(/[^\d]/g, '')
    if (!digits) return 0
    return Number.parseInt(digits, 10)
  }

  const updateTrackerCurrentPage = (rawValue) => {
    setTrackerDraft((prev) => {
      if (!prev) return prev
      const nextCurrent = normalizeNonNegativeInt(rawValue)
      const total = Math.max(0, Number(prev.total_pages || 0))
      const cappedCurrent = total > 0 ? Math.min(nextCurrent, total) : nextCurrent
      return { ...prev, current_page: cappedCurrent }
    })
  }

  const updateTrackerTotalPages = (rawValue) => {
    setTrackerDraft((prev) => {
      if (!prev) return prev
      const nextTotalRaw = normalizeNonNegativeInt(rawValue)
      const bookTotal = Math.max(0, Number(getPageCount(trackerBook) || 0))
      const nextTotal = bookTotal > 0 ? Math.min(nextTotalRaw, bookTotal) : nextTotalRaw
      const nextCurrent = Math.min(Math.max(0, Number(prev.current_page || 0)), nextTotal || Number(prev.current_page || 0))
      return { ...prev, total_pages: nextTotal, current_page: nextCurrent }
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
    await refreshSyncedAllBooks()
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

  const goToMapEntry = (b) => {
    if (!b) return
    setTab('explorer')
    setFeedSimilarBookId('')
    setShowSimilar(false)
    openFromSearch(b)
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

  const getPageLength = (b) =>
    b?.num_pages ?? b?.book_pages ?? b?.pages ?? b?.total_pages ?? b?.reading_total_pages ?? null
  const getRatingCount = (b) => parseNumberish(b?.book_rating_count ?? b?.rating_count ?? b?.ratings_count)
  const getAvgRating = (b) => parseNumberish(b?.book_rating ?? b?.average_rating ?? b?.rating)
  const getReviewCount = (b) => parseNumberish(b?.book_review_count ?? b?.review_count ?? b?.reviews_count)
  const getPageCount = (b) => parseNumberish(getPageLength(b))
  const getShortDescription = (b) => {
    const text = (b?.description || '').trim()
    if (!text) return 'No description available yet.'
    return text.length > 220 ? `${text.slice(0, 220).trim()}...` : text
  }
  const getFullDescription = (b) => {
    const text = (b?.description || '').trim()
    return text || 'No description available yet.'
  }
  const isDescExpanded = (bookId) => !!expandedDescByBookId[bookId]
  const toggleDescription = (bookId) => {
    if (!bookId) return
    setExpandedDescByBookId((prev) => ({ ...prev, [bookId]: !prev[bookId] }))
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

  const allListBooks = syncedAllBooks

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

  const statsProfile = {
    initials: 'ER',
    name: 'Eshaan Rawat'
  }

  const emptyStats = { totalBooksRead: 0, totalPagesRead: 0, daysReadStreak: 0, daysRead: 0, daysPassed: 0 }

  const statPeriods = [
    { key: 'daily', label: 'Daily', data: statsByPeriod.daily || emptyStats },
    { key: 'monthly', label: 'Monthly', data: statsByPeriod.monthly || emptyStats },
    { key: 'yearly', label: 'Yearly', data: statsByPeriod.yearly || emptyStats },
    { key: 'all', label: 'All', data: statsByPeriod.all || emptyStats }
  ]
  const activeStatsData = statPeriods.find((period) => period.key === activeStatsPeriod)?.data || emptyStats
  const heatmapData = useMemo(() => buildHeatmapGrid(statsActivity.days || []), [statsActivity.days])

  const fetchReadingStats = async () => {
    try {
      const r = await fetch(`${API}/reading-stats`)
      const d = await r.json()
      if (r.ok && d?.periods) {
        setStatsByPeriod(d.periods)
        setStatsActivity(d.activity || { days: [], summary: { activeDays: 0, currentStreak: 0, longestStreak: 0, totalPagesYear: 0 } })
      }
    } catch {
      // Keep placeholders if API is unavailable.
    }
  }

  const syncStatsFromObsidian = async () => {
    try {
      setSyncingStats(true)
      const r = await fetch(`${API}/sync/obsidian?dry_run=true`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) {
        showToast(d?.detail || 'Sync failed')
        return
      }
      if (d?.periods) setStatsByPeriod(d.periods)
      if (d?.activity) setStatsActivity(d.activity)
      const proposed = (d?.proposed_books || []).filter((b) => b?.id)
      if (proposed.length) {
        setSyncPreviewBooks(proposed)
        setSyncSelectedBookIds(proposed.map((b) => b.id))
        setSyncPickerOpen(true)
        showToast(`Review ${proposed.length} proposed books`)
      } else {
        showToast('No new books to add')
      }
    } catch {
      showToast('Could not reach sync service')
    } finally {
      setSyncingStats(false)
    }
  }

  const applySelectedSyncBooks = async () => {
    try {
      setApplyingSyncSelection(true)
      const r = await fetch(`${API}/sync/obsidian/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_ids: syncSelectedBookIds })
      })
      const d = await r.json()
      if (!r.ok) {
        showToast(d?.detail || 'Could not apply selected books')
        return
      }
      if (d?.periods) setStatsByPeriod(d.periods)
      if (d?.activity) setStatsActivity(d.activity)
      await refreshSyncedAllBooks()
      setSyncPickerOpen(false)
      setSyncPreviewBooks([])
      setSyncSelectedBookIds([])
      showToast(`Added ${d?.applied_count || 0} books`)
    } catch {
      showToast('Could not apply selected books')
    } finally {
      setApplyingSyncSelection(false)
    }
  }

  const toggleSyncSelection = (bookId) => {
    setSyncSelectedBookIds((prev) => (
      prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
    ))
  }

  const ignoreBookSuggestion = async (book) => {
    try {
      const r = await fetch(`${API}/sync/obsidian/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: book?.title || '', author: book?.author || '' })
      })
      const d = await r.json()
      if (!r.ok) {
        showToast(d?.detail || 'Could not ignore this suggestion')
        return
      }
      setSyncPreviewBooks((prev) => prev.filter((x) => x.id !== book.id))
      setSyncSelectedBookIds((prev) => prev.filter((id) => id !== book.id))
      showToast('Will not suggest this book again')
    } catch {
      showToast('Could not ignore this suggestion')
    }
  }

  useEffect(() => {
    fetchReadingStats()
  }, [])

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

  const renderCollectionPicker = ({
    bookId,
    draftValue,
    onDraftChange,
    onAfterAdd = () => {},
    onAfterCreate = () => {},
    title = 'Save to Collection',
    subtitle = null,
    rootClassName = 'collectionPickerCard'
  }) => (
    <div className={rootClassName} onClick={(e) => e.stopPropagation()}>
      <div className="collectionPickerHeader">{title}</div>
      {subtitle && <div className="collectionPickerSub">{subtitle}</div>}
      <div className="collectionPickerList">
        {readingLists.map((list) => (
          <button
            key={`picker-add-${bookId}-${list.name}`}
            onClick={async () => {
              await addBookToList(list.name, bookId, true)
              onAfterAdd()
            }}
          >
            {list.name}
          </button>
        ))}
        {!readingLists.length && <div className="emptyList">No collections yet. Create one below.</div>}
      </div>
      <div className="collectionPickerCreate">
        <input
          value={draftValue}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={nextCollectionName}
        />
        <button
          onClick={async () => {
            const name = (draftValue || nextCollectionName).trim()
            if (!name) return
            await createReadingList(name, bookId)
            onAfterCreate()
          }}
          aria-label="Create collection"
        >
          +
        </button>
      </div>
    </div>
  )

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
          <button className={`menuTab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
            <span className="appleIcon" aria-hidden>
              <svg className="appleIconSvg" viewBox="0 0 24 24" fill="none">
                <path d="M5 18V9.5M12 18V6M19 18v-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M3.5 18.5h17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </span>
            <span>Stats</span>
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
              <span>My Books</span>
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
          <div className="feedDetailModalWrap">
            <article className={`feedTikTokCard feedCardFull ${selectedBook.image_url ? 'hasImage' : ''}`}>
              {selectedBook.image_url && <img className="feedPosterImg feedPosterImgFull" src={selectedBook.image_url} alt="" loading="lazy" />}
              <div className="feedCardGradientFull" />
              <button className="feedDetailCloseBtn" onClick={() => setSelected(null)} aria-label="Close details">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </button>

              <div className="feedContentBottom">
                <div className="feedGenrePills">
                  <span>{formatGenreLabel(selectedBook.genre)}</span>
                  {selectedBook.subgenre && <span>{selectedBook.subgenre}</span>}
                  <span>Fiction</span>
                </div>
                <h2 className="feedCardTitleFull">{selectedBook.title || 'Untitled'}</h2>
                <div className="feedCardAuthorFull">{formatAuthors(selectedBook.author) || 'Unknown author'}</div>
                <div className="feedCardMetaRow">
                  <div className="feedMetaItem">
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                    </svg>
                    <span>{getAvgRating(selectedBook) != null ? Number(getAvgRating(selectedBook)).toFixed(2) : 'N/A'}</span>
                  </div>
                  <div className="feedMetaItem">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" stroke="currentColor" strokeWidth="1.8"/>
                    </svg>
                    <span>{getPageCount(selectedBook) != null ? `${getPageCount(selectedBook)} pages` : 'N/A'}</span>
                  </div>
                </div>
                <p className={`feedCardDesc ${isDescExpanded(selectedBook.id) ? 'expanded' : ''}`}>
                  {isDescExpanded(selectedBook.id) ? getFullDescription(selectedBook) : getShortDescription(selectedBook)}
                </p>
                <button className="feedReadMoreBtn" onClick={() => toggleDescription(selectedBook.id)}>
                  {isDescExpanded(selectedBook.id) ? 'Show less' : 'Read more'}
                </button>
              </div>

              <div className="feedActionsRight">
                <div className="feedActionBtn">
                  <button
                    className={`feedActionIcon ${isLiked(selectedBook.id) ? 'liked' : ''}`}
                    onClick={() => toggleLike(selectedBook)}
                    aria-label={isLiked(selectedBook.id) ? 'Unlike book' : 'Like book'}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M12.1 21.35 10.8 20.2C5.9 15.8 2.7 12.9 2.7 9.3 2.7 6.4 4.9 4.2 7.8 4.2c1.7 0 3.3.8 4.3 2.1 1-1.3 2.6-2.1 4.3-2.1 2.9 0 5.1 2.2 5.1 5.1 0 3.6-3.2 6.5-8.1 10.9l-1.3 1.15Z" />
                    </svg>
                  </button>
                </div>
                <div className="feedActionBtn">
                  <button
                    className="feedActionIcon saveActionIcon"
                    onClick={() => setAddModalBook(selectedBook)}
                    aria-label="Save to collection"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-3-6 3V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
                <div className="feedActionBtn">
                  <button
                    className="feedActionIcon"
                    onClick={() => setShowSimilar((v) => !v)}
                    aria-label={showSimilar ? 'Hide similar books' : 'Show similar books'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {showSimilar && (
                <div className="feedSimilarDrawer feedSimilarDrawerModern">
                  <button className="feedSimilarCloseBtn" onClick={() => setShowSimilar(false)} aria-label="Close similar books">
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                    </svg>
                  </button>
                  <div className="feedSimilarRail feedSimilarRailModern">
                    {recs.slice(0, 10).map((rec) => (
                      <button key={`map-rec-${selectedBook.id}-${rec.id || rec.title}`} className="feedSimilarCard feedSimilarCardModern" onClick={() => goToMapEntry(rec)}>
                        <div className="feedSimilarCover feedSimilarCoverModern">
                          {rec.image_url ? <img src={rec.image_url} alt="" loading="lazy" /> : <div className="feedSimilarFallback" />}
                        </div>
                      </button>
                    ))}
                    {!recs.length && <div className="feedSimilarEmpty">No similar books found yet.</div>}
                  </div>
                </div>
              )}
            </article>
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
              return (
              <section key={b.id || `${b.title}-${idx}`} className="feedItem feedItemFull">
                <article className={`feedTikTokCard feedCardFull ${b.image_url ? 'hasImage' : ''} ${feedSimilarBookId === b.id ? 'similarOpen' : ''} ${feedCollectionMenuBookId === b.id ? 'collectionOpen' : ''}`}>
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
                    <p className={`feedCardDesc ${isDescExpanded(b.id) ? 'expanded' : ''}`}>
                      {isDescExpanded(b.id) ? getFullDescription(b) : getShortDescription(b)}
                    </p>
                    <button className="feedReadMoreBtn" onClick={() => toggleDescription(b.id)}>
                      {isDescExpanded(b.id) ? 'Show less' : 'Read more'}
                    </button>
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
                    </div>
                    <div className="feedActionBtn collectionMenuWrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="feedActionIcon saveActionIcon"
                        onClick={(e) => {
                          e.stopPropagation()
                          setFeedCollectionMenuBookId((prev) => (prev === b.id ? '' : b.id))
                        }}
                        aria-label="Save to collection"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-3-6 3V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                    <div className="feedActionBtn">
                      <button
                        className="feedActionIcon"
                        onClick={() => toggleFeedSimilar(b)}
                        aria-label={feedSimilarBookId === b.id ? 'Hide similar books' : 'Show similar books'}
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {feedCollectionMenuBookId === b.id && renderCollectionPicker({
                    bookId: b.id,
                    draftValue: feedNewCollectionDraft,
                    onDraftChange: setFeedNewCollectionDraft,
                    onAfterAdd: () => {
                      setFeedCollectionMenuBookId('')
                      setFeedNewCollectionDraft('')
                    },
                    onAfterCreate: () => {
                      setFeedCollectionMenuBookId('')
                      setFeedNewCollectionDraft('')
                    },
                    rootClassName: 'collectionPickerCard feedCollectionPanel'
                  })}

                  {feedSimilarBookId === b.id && (
                    <div className="feedSimilarDrawer feedSimilarDrawerModern">
                      <button className="feedSimilarCloseBtn" onClick={() => setFeedSimilarBookId('')} aria-label="Close similar books">
                        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                        </svg>
                      </button>
                      <div className="feedSimilarRail feedSimilarRailModern">
                        {(feedRecsByBookId[b.id] || []).slice(0, 10).map((rec) => (
                          <button key={`feed-rec-${b.id}-${rec.id || rec.title}`} className="feedSimilarCard feedSimilarCardModern" onClick={() => goToMapEntry(rec)}>
                            <div className="feedSimilarCover feedSimilarCoverModern">
                              {rec.image_url ? <img src={rec.image_url} alt="" loading="lazy" /> : <div className="feedSimilarFallback" />}
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
          <div className="feedDetailModalWrap">
            <article className={`feedTikTokCard feedCardFull ${searchDetailBook.image_url ? 'hasImage' : ''} ${feedSimilarBookId === searchDetailBook.id ? 'similarOpen' : ''}`}>
              {searchDetailBook.image_url && <img className="feedPosterImg feedPosterImgFull" src={searchDetailBook.image_url} alt="" loading="lazy" />}
              <div className="feedCardGradientFull" />
              <button className="feedDetailCloseBtn" onClick={() => setSearchDetailBook(null)} aria-label="Close details">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </button>

              <div className="feedContentBottom">
                <div className="feedGenrePills">
                  <span>{formatGenreLabel(searchDetailBook.genre)}</span>
                  {searchDetailBook.subgenre && <span>{searchDetailBook.subgenre}</span>}
                  <span>Fiction</span>
                </div>
                <h2 className="feedCardTitleFull">{searchDetailBook.title || 'Untitled'}</h2>
                <div className="feedCardAuthorFull">{formatAuthors(searchDetailBook.author) || 'Unknown author'}</div>
                <div className="feedCardMetaRow">
                  <div className="feedMetaItem">
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                    </svg>
                    <span>{getAvgRating(searchDetailBook) != null ? Number(getAvgRating(searchDetailBook)).toFixed(2) : 'N/A'}</span>
                  </div>
                  <div className="feedMetaItem">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" stroke="currentColor" strokeWidth="1.8"/>
                    </svg>
                    <span>{getPageCount(searchDetailBook) != null ? `${getPageCount(searchDetailBook)} pages` : 'N/A'}</span>
                  </div>
                </div>
                <p className={`feedCardDesc ${isDescExpanded(searchDetailBook.id) ? 'expanded' : ''}`}>
                  {isDescExpanded(searchDetailBook.id) ? getFullDescription(searchDetailBook) : getShortDescription(searchDetailBook)}
                </p>
                <button className="feedReadMoreBtn" onClick={() => toggleDescription(searchDetailBook.id)}>
                  {isDescExpanded(searchDetailBook.id) ? 'Show less' : 'Read more'}
                </button>
              </div>

              <div className="feedActionsRight">
                <div className="feedActionBtn">
                  <button
                    className={`feedActionIcon ${isLiked(searchDetailBook.id) ? 'liked' : ''}`}
                    onClick={() => toggleLike(searchDetailBook)}
                    aria-label={isLiked(searchDetailBook.id) ? 'Unlike book' : 'Like book'}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M12.1 21.35 10.8 20.2C5.9 15.8 2.7 12.9 2.7 9.3 2.7 6.4 4.9 4.2 7.8 4.2c1.7 0 3.3.8 4.3 2.1 1-1.3 2.6-2.1 4.3-2.1 2.9 0 5.1 2.2 5.1 5.1 0 3.6-3.2 6.5-8.1 10.9l-1.3 1.15Z" />
                    </svg>
                  </button>
                </div>
                <div className="feedActionBtn">
                  <button
                    className="feedActionIcon saveActionIcon"
                    onClick={() => setAddModalBook(searchDetailBook)}
                    aria-label="Save to collection"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-3-6 3V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
                <div className="feedActionBtn">
                  <button
                    className="feedActionIcon"
                    onClick={() => toggleFeedSimilar(searchDetailBook)}
                    aria-label={feedSimilarBookId === searchDetailBook.id ? 'Hide similar books' : 'Show similar books'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {feedSimilarBookId === searchDetailBook.id && (
                <div className="feedSimilarDrawer feedSimilarDrawerModern">
                  <button className="feedSimilarCloseBtn" onClick={() => setFeedSimilarBookId('')} aria-label="Close similar books">
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                    </svg>
                  </button>
                  <div className="feedSimilarRail feedSimilarRailModern">
                    {(feedRecsByBookId[searchDetailBook.id] || []).slice(0, 10).map((rec) => (
                      <button
                        key={`search-rec-${searchDetailBook.id}-${rec.id || rec.title}`}
                        className="feedSimilarCard feedSimilarCardModern"
                        onClick={() => {
                          setFeedSimilarBookId('')
                          setSearchDetailBook(rec)
                        }}
                      >
                        <div className="feedSimilarCover feedSimilarCoverModern">
                          {rec.image_url ? <img src={rec.image_url} alt="" loading="lazy" /> : <div className="feedSimilarFallback" />}
                        </div>
                      </button>
                    ))}
                    {!feedRecsByBookId[searchDetailBook.id]?.length && <div className="feedSimilarEmpty">No similar books found yet.</div>}
                  </div>
                </div>
              )}
            </article>
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
                  <h2>{activeList ? activeList.name : 'My Books'}</h2>
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

      {tab === 'stats' && (
        <div className="statsShell">
          <section className="statsSection">
            <header className="statsHeader">
              <div className="statsIdentity">
                <div className="statsAvatar" aria-hidden>{statsProfile.initials}</div>
                <div>
                  <h2>{statsProfile.name}</h2>
                </div>
              </div>
              <button
                className="statsSyncBtn"
                type="button"
                aria-label="Sync stats"
                onClick={syncStatsFromObsidian}
                disabled={syncingStats}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5 0 1.01-.3 1.95-.82 2.74l1.46 1.46A6.96 6.96 0 0 0 19 13c0-3.87-3.13-7-7-7Zm-5.18.26L5.36 4.8A6.96 6.96 0 0 0 5 8c0 3.87 3.13 7 7 7v3l4-4-4-4v3c-2.76 0-5-2.24-5-5 0-.63.12-1.23.34-1.74Z"/>
                </svg>
                <span>{syncingStats ? 'Syncing...' : 'Sync'}</span>
              </button>
            </header>
            <div className="statsPeriods">
              <div className="statsTabs" role="tablist" aria-label="Stats period">
                {statPeriods.map((period) => (
                  <button
                    key={period.key}
                    role="tab"
                    aria-selected={activeStatsPeriod === period.key}
                    className={`statsTab ${activeStatsPeriod === period.key ? 'active' : ''}`}
                    onClick={() => setActiveStatsPeriod(period.key)}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
              <article className="statsPeriodCard">
                <div className="statsPeriodTitle">{statPeriods.find((p) => p.key === activeStatsPeriod)?.label || 'Monthly'}</div>
                <div className="statsGrid">
                  <div className="statTile">
                    <div className="statIcon books" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 1 2-2h14V4a2 2 0 0 0-2-2Zm0 14H6V4h12v12Z"/>
                      </svg>
                    </div>
                    <div className="statValue">{formatCount(activeStatsData.totalBooksRead)}</div>
                    <div className="statLabel">Total Books Read</div>
                  </div>
                  <div className="statTile">
                    <div className="statIcon pages" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M21 3H7a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14V3Zm-2 12H9v-2h10v2Zm0-3H9v-2h10v2Zm0-3H9V7h10v2ZM3 5v16a2 2 0 0 1-2-2V5h2Z"/>
                      </svg>
                    </div>
                    <div className="statValue">{formatCount(activeStatsData.totalPagesRead)}</div>
                    <div className="statLabel">Pages Read</div>
                  </div>
                  <div className="statTile">
                    <div className="statIcon streak" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M13.5 2s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73L7.23 6A8.9 8.9 0 0 0 4 12.03C4 16.43 7.58 20 12 20s8-3.57 8-7.97C20 7.9 17.2 4.29 13.5 2ZM12 18a4 4 0 0 1-4-4c0-1.57.88-2.91 2.17-3.58 0 0 .59 1.11 2.01 1.11 1.26 0 1.85-.81 1.85-.81A4.02 4.02 0 0 1 16 14a4 4 0 0 1-4 4Z"/>
                      </svg>
                    </div>
                    <div className="statValue">{formatCount(activeStatsData.daysReadStreak)}</div>
                    <div className="statLabel">Day Read Streak</div>
                  </div>
                  <div className="statTile">
                    <div className="statIcon days" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5V10h14v9Zm-9.3-1.7 5.6-5.6-1.4-1.4-4.2 4.2-1.9-1.9-1.4 1.4 3.3 3.3Z"/>
                      </svg>
                    </div>
                    <div className="statValue">{formatCount(activeStatsData.daysRead)} / {formatCount(activeStatsData.daysPassed)}</div>
                    <div className="statLabel">Days Read</div>
                  </div>
                </div>
                <section className="statsActivityCard">
                  <div className="statsActivityHead">
                    <div>
                      <h3>Reading Activity</h3>
                      <p>{formatCount(statsActivity?.summary?.activeDays || 0)} active days in the past year</p>
                    </div>
                    <div className="statsActivityStreak">
                      <strong>{formatCount(statsActivity?.summary?.currentStreak || 0)} day streak</strong>
                    </div>
                  </div>
                  <div className="statsHeatmapWrap">
                    <div className="statsHeatmapMonths">
                      {heatmapData.monthTicks.map((tick) => (
                        <span key={`m-${tick.col}`} style={{ gridColumn: `${tick.col + 1}` }}>
                          {new Date(new Date().getFullYear(), tick.monthIdx, 1).toLocaleString(undefined, { month: 'short' })}
                        </span>
                      ))}
                    </div>
                    <div className="statsHeatmapBody">
                      <div className="statsHeatmapWeekdays">
                        <span>Mon</span>
                        <span>Wed</span>
                        <span>Fri</span>
                      </div>
                      <div className="statsHeatmapGrid">
                        {heatmapData.columns.map((col, colIdx) => (
                          <div key={`col-${colIdx}`} className="statsHeatmapCol">
                            {col.week.map((day, rowIdx) => {
                              const level = day?.intensityLevel || 0
                              return (
                                <div
                                  key={`cell-${colIdx}-${rowIdx}`}
                                  className={`statsHeatmapCell l${level} ${day ? '' : 'empty'}`}
                                  title={day
                                    ? `${formatShortDate(day.date)}: ${formatCount(day.pagesRead)} pages, ${formatCount(day.booksCompleted)} completed`
                                    : 'Outside range'}
                                />
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="statsHeatmapLegend">
                      <span>Less</span>
                      <i className="statsHeatmapCell l0" />
                      <i className="statsHeatmapCell l1" />
                      <i className="statsHeatmapCell l2" />
                      <i className="statsHeatmapCell l3" />
                      <i className="statsHeatmapCell l4" />
                      <i className="statsHeatmapCell l5" />
                      <span>More</span>
                    </div>
                  </div>
                </section>
              </article>
            </div>
          </section>
        </div>
      )}

      {addModalBook && (
        <div className="addListLayer">
          <div className="addListBackdrop" onClick={() => setAddModalBook(null)} />
          {renderCollectionPicker({
            bookId: addModalBook.id,
            draftValue: listDraftByName,
            onDraftChange: setListDraftByName,
            onAfterAdd: () => setAddModalBook(null),
            onAfterCreate: () => setAddModalBook(null),
            title: `Add "${addModalBook.title}"`,
            subtitle: 'Select a collection or create a new one.',
            rootClassName: 'collectionPickerCard addListModal'
          })}
        </div>
      )}
      {syncPickerOpen && (
        <div className="addListLayer">
          <div
            className="addListBackdrop"
            onClick={() => {
              if (applyingSyncSelection) return
              setSyncPickerOpen(false)
            }}
          />
          <div className="syncPickerModal">
            <div className="syncPickerHead">
              <h3>Review Proposed Books</h3>
              <p>Deselect any books already present. All are selected by default.</p>
            </div>
            <div className="syncPickerList">
              {syncPreviewBooks.map((book) => (
                <label key={`sync-pick-${book.id}`} className="syncPickerRow">
                  <input
                    type="checkbox"
                    checked={syncSelectedBookIds.includes(book.id)}
                    onChange={() => toggleSyncSelection(book.id)}
                    disabled={applyingSyncSelection}
                  />
                  <span className="syncPickerMeta">
                    <strong>{book.title || 'Untitled'}</strong>
                    <em>{book.author || 'Unknown author'}</em>
                  </span>
                  <button
                    type="button"
                    className="syncPickerIgnoreBtn"
                    onClick={() => ignoreBookSuggestion(book)}
                    disabled={applyingSyncSelection}
                    title="Don't suggest in the future"
                    aria-label={`Don't suggest ${book.title || 'this book'} in the future`}
                  >
                    ×
                  </button>
                </label>
              ))}
              {!syncPreviewBooks.length && <div className="emptyList">No proposed books found.</div>}
            </div>
            <div className="syncPickerActions">
              <button
                className="syncPickerCancel"
                onClick={() => setSyncPickerOpen(false)}
                disabled={applyingSyncSelection}
              >
                Cancel
              </button>
              <button
                className="syncPickerApply"
                onClick={applySelectedSyncBooks}
                disabled={applyingSyncSelection || !syncSelectedBookIds.length}
              >
                {applyingSyncSelection ? 'Applying...' : `Add Selected (${syncSelectedBookIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
      {trackerBook && trackerDraft && (
        <div className="readTrackerLayer">
          <div className="addListBackdrop" onClick={closeTracker} />
          <div className="readTrackerModal">

            {/* Blurred artwork background */}
            {trackerBook.image_url && (
              <img className="readTrackerBg" src={trackerBook.image_url} alt="" aria-hidden />
            )}
            <div className="readTrackerScrim" />

            <button className="readTrackerClose" onClick={closeTracker} aria-label="Close">
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
            </button>

            {/* Left — cover */}
            <div className="readTrackerLeft">
              <div className="readTrackerCover">
                {trackerBook.image_url
                  ? <img src={trackerBook.image_url} alt="" loading="lazy" />
                  : <div className="listBookImageFallback" />}
              </div>

              {/* Progress arc */}
              <div className="readTrackerRingWrap">
                <div className="readTrackerRing" style={{
                  '--pct': `${Math.max(0, Math.min(100, trackerDraft.total_pages > 0
                    ? (trackerDraft.current_page / trackerDraft.total_pages) * 100 : 0))}%`
                }}>
                  <span>
                    {Math.max(0, Math.min(100, Math.round(trackerDraft.total_pages > 0
                      ? (trackerDraft.current_page / trackerDraft.total_pages) * 100 : 0)))}%
                  </span>
                </div>
                <div className="readTrackerRingLabel">
                  <strong>{trackerDraft.current_page}<em> / {trackerDraft.total_pages || '–'}</em></strong>
                  <span>pages read</span>
                </div>
              </div>
            </div>

            {/* Right — info + form */}
            <div className="readTrackerRight">
              <div className="readTrackerMeta">
                <h3 className="readTrackerTitle">{trackerBook.title || 'Untitled'}</h3>
                <p className="readTrackerAuthor">{formatAuthors(trackerBook.author) || 'Unknown author'}</p>
              </div>

              {/* Status select */}
              <div className="readTrackerSelectWrap">
                <select
                  className="readTrackerSelect"
                  value={trackerDraft.status}
                  onChange={(e) => setTrackerDraft((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="not_started">Want to Read</option>
                  <option value="reading">Currently Reading</option>
                  <option value="done">Finished</option>
                </select>
                <span className={`readTrackerStatusDot ${trackerDraft.status}`} />
              </div>

              {/* Stat rows */}
              <div className="readTrackerRows">
                <label className="readTrackerRow">
                  <span className="readTrackerRowLabel">Progress</span>
                  <div className="readTrackerPagePair">
                    <input className="readTrackerRowInput" type="number" min="0"
                      max={trackerDraft.total_pages || undefined}
                      value={trackerDraft.current_page}
                      onChange={(e) => updateTrackerCurrentPage(e.target.value)} />
                    <span className="readTrackerPageSep">/</span>
                    <input className="readTrackerRowInput" type="number" min="0"
                      max={getPageCount(trackerBook) || undefined}
                      value={trackerDraft.total_pages}
                      onChange={(e) => updateTrackerTotalPages(e.target.value)} />
                    <span className="readTrackerPageUnit">pages</span>
                  </div>
                </label>
                <label className="readTrackerRow readTrackerRowDates">
                  <div className="readTrackerDatePair">
                    <span className="readTrackerDateLabel">Start</span>
                    <input className="readTrackerRowInput" type="date"
                      value={trackerDraft.start_date}
                      onChange={(e) => setTrackerDraft((prev) => ({ ...prev, start_date: e.target.value }))} />
                    <span className="readTrackerDateLabel">End</span>
                    <input className="readTrackerRowInput" type="date"
                      value={trackerDraft.finish_date}
                      onChange={(e) => setTrackerDraft((prev) => ({ ...prev, finish_date: e.target.value }))} />
                  </div>
                </label>
              </div>

              <label className="readTrackerNotes">
                <span className="readTrackerRowLabel">Notes</span>
                <textarea
                  value={trackerDraft.notes}
                  onChange={(e) => setTrackerDraft((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Write your thoughts here…" />
              </label>
            </div>

          </div>
        </div>
      )}
      {toastMsg && <div className="toastMsg">{toastMsg}</div>}
      </main>
    </div>
  )
}
