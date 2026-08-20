import { Library, Search, BarChart3, BookOpen, Bookmark, CheckCircle2, type LucideIcon } from 'lucide-react'

interface ViewMetaEntry {
  title: string
  subtitle: string
}

interface NavItem {
  id: string
  label: string
  icon: LucideIcon
}

interface SelectOption {
  value: string
  label: string
}

const viewMeta: Record<string, ViewMetaEntry> = {
  'reading-now': { title: 'Reading Now', subtitle: 'Pick up where you left off.' },
  library: { title: 'Library', subtitle: 'Everything on your shelves.' },
  search: { title: 'Search', subtitle: 'Find a book by title or author.' },
  stats: { title: 'Statistics', subtitle: 'A quick read on your finished books.' },
  'want-to-read': { title: 'Want to Read', subtitle: 'Saved for a rainy day.' },
  finished: { title: 'Finished', subtitle: "Books you've loved and closed." },
}

const mainNav: NavItem[] = [
  { id: 'library', label: 'Library', icon: Library },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'stats', label: 'Statistics', icon: BarChart3 },
]

const shelfNav: NavItem[] = [
  { id: 'reading-now', label: 'Reading Now', icon: BookOpen },
  { id: 'want-to-read', label: 'Want to Read', icon: Bookmark },
  { id: 'finished', label: 'Finished', icon: CheckCircle2 },
]

const isMac = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')

function shortcutLabel(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`
}

// ⌘1–⌘6 follow the sidebar top to bottom, so the numbering and the hints
// rendered next to each row stay in sync with whatever order these two lists
// happen to be in.
const navOrder: string[] = [...mainNav, ...shelfNav].map((item) => item.id)

function navShortcut(viewId: string): string | null {
  const index = navOrder.indexOf(viewId)
  if (index === -1 || index >= 9) return null
  return shortcutLabel(String(index + 1))
}

const monthOptions: SelectOption[] = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
]

export { viewMeta, mainNav, shelfNav, monthOptions, isMac, shortcutLabel, navOrder, navShortcut }
