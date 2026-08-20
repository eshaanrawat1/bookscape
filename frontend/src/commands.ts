import { FilePlus2, FolderPlus, RefreshCw, Settings, Upload, Download, Bookmark } from 'lucide-react'
import { mainNav, shelfNav, navShortcut, shortcutLabel } from './constants.js'
import type { Collection, Command, CommandDeps } from './types.js'

// The palette's command list. Built in App, where every callback below is
// already in scope, rather than pulled from context — several of these actions
// (add book, vault sync) are App-local state that nothing else needs.
function buildCommands(deps: CommandDeps): Command[] {
  const { collections, vaultBusy, goTo, onAddBook, onNewCollection, onRefresh, onVaultSettings, onPush, onPull } = deps

  const navCommands: Command[] = [...mainNav, ...shelfNav].map((item) => ({
    id: `nav:${item.id}`,
    label: `Go to ${item.label}`,
    group: 'Navigate',
    icon: item.icon,
    hint: navShortcut(item.id) ?? undefined,
    keywords: item.id,
    run: () => goTo(item.id),
  }))

  const collectionCommands: Command[] = collections.map((collection: Collection) => ({
    id: `collection:${collection.id}`,
    label: `Go to ${collection.name}`,
    group: 'Collections',
    icon: Bookmark,
    keywords: 'collection list shelf',
    run: () => goTo(`collection:${collection.id}`),
  }))

  const actionCommands: Command[] = [
    {
      id: 'action:add-book',
      label: 'Add Book',
      group: 'Actions',
      icon: FilePlus2,
      hint: shortcutLabel('N'),
      keywords: 'new import scrape goodreads',
      run: onAddBook,
    },
    {
      id: 'action:new-collection',
      label: 'New Collection',
      group: 'Actions',
      icon: FolderPlus,
      keywords: 'create list shelf',
      run: onNewCollection,
    },
    {
      id: 'action:refresh',
      label: 'Refresh Library',
      group: 'Actions',
      icon: RefreshCw,
      keywords: 'reload sync data',
      run: onRefresh,
    },
    {
      id: 'action:vault-settings',
      label: 'Vault Settings',
      group: 'Actions',
      icon: Settings,
      keywords: 'obsidian path folder preferences',
      run: onVaultSettings,
    },
    // Hidden rather than disabled while a sync is in flight — the icon pill
    // already disables its buttons, and a row you can highlight but not run
    // reads as broken.
    ...(vaultBusy === null
      ? ([
        {
          id: 'action:push-vault',
          label: 'Push to Vault',
          group: 'Actions',
          icon: Upload,
          keywords: 'obsidian export sync',
          run: onPush,
        },
        {
          id: 'action:pull-vault',
          label: 'Pull from Vault',
          group: 'Actions',
          icon: Download,
          keywords: 'obsidian import sync',
          run: onPull,
        },
      ] as Command[])
      : []),
  ]

  return [...navCommands, ...actionCommands, ...collectionCommands]
}

// Cheap subsequence scorer — enough to make "gtst" find "Go to Statistics"
// without pulling in a fuzzy-match dependency. Higher is better; 0 means no
// match at all.
function scoreCommand(command: Command, query: string): number {
  const needle = query.trim().toLowerCase()
  if (!needle) return 1

  const label = command.label.toLowerCase()
  const haystack = `${label} ${command.keywords || ''}`.toLowerCase()

  if (label.startsWith(needle)) return 1000 - label.length
  if (label.includes(needle)) return 800 - label.indexOf(needle)

  // Word starts: "gts" matching the g/t/s of "Go to Statistics".
  const initials = label.split(/\s+/).map((word) => word[0] || '').join('')
  if (initials.startsWith(needle)) return 700

  if (haystack.includes(needle)) return 500

  // Fall back to an in-order subsequence over the label, penalised by how
  // spread out the matched characters are.
  let index = -1
  let gaps = 0
  for (const char of needle) {
    const next = label.indexOf(char, index + 1)
    if (next === -1) return 0
    gaps += next - index - 1
    index = next
  }
  return Math.max(1, 300 - gaps)
}

function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands
  return commands
    .map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command)
}

export { buildCommands, filterCommands, scoreCommand }
