import { useEffect, useRef } from 'react'

interface ModalLayerOptions {
  // Runs when Escape is pressed and this is the top-most layer. Leaving it
  // undefined on a registered layer means Escape is swallowed but does nothing
  // — the right behaviour for a dialog mid-save, where the key must not fall
  // through to whatever is behind it either.
  onEscape?: () => void
  // Whether this layer is on the stack at all. Popovers that live permanently
  // in the tree (the stats filter, the date picker) pass their open state here,
  // so a closed one doesn't sit on the stack swallowing Escape.
  enabled?: boolean
  // Suppresses the app-wide ⌘K / ⌘1–6 / ⌘N chords while this layer is open.
  // For surfaces holding unsaved input or a destructive confirm.
  blocksHotkeys?: boolean
}

type Layer = { current: ModalLayerOptions }

// Every escape-dismissible surface in the app — dialogs, the command palette,
// the stats filter dropdown, the date picker, the sidebar rename field — pushes
// onto this one stack, so the top-most one owns Escape outright. Without the
// ordering, a palette opened over a book dialog would close both at once, and a
// date picker inside a book dialog would take the whole dialog down with it.
const layers: Layer[] = []

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const top = layers[layers.length - 1]
  if (!top) return

  // Capture phase on window is the very first thing in the event path, so
  // stopping here reliably keeps the key away from every layer below.
  event.preventDefault()
  event.stopPropagation()

  top.current.onEscape?.()
}

function pushLayer(layer: Layer) {
  layers.push(layer)
  if (layers.length === 1) {
    window.addEventListener('keydown', onWindowKeyDown, true)
  }
}

function popLayer(layer: Layer) {
  const index = layers.lastIndexOf(layer)
  if (index !== -1) layers.splice(index, 1)
  if (layers.length === 0) {
    window.removeEventListener('keydown', onWindowKeyDown, true)
  }
}

// Registers the caller as the top-most escape layer for as long as it is
// mounted and `enabled`.
function useModalLayer(options: ModalLayerOptions): void {
  // Options are read through a ref so a parent re-render handing down a fresh
  // inline callback doesn't pop the layer and re-push it above its siblings.
  const layer = useRef<ModalLayerOptions>(options)
  layer.current = options

  const enabled = options.enabled ?? true

  useEffect(() => {
    if (!enabled) return undefined
    pushLayer(layer)
    return () => popLayer(layer)
  }, [enabled])
}

// Read at keydown time by useAppHotkeys, so no dialog has to plumb its open
// state up to App just to mute the shortcuts.
function hotkeysBlocked(): boolean {
  return layers.some((layer) => layer.current.blocksHotkeys === true)
}

export { useModalLayer, hotkeysBlocked }
export default useModalLayer
