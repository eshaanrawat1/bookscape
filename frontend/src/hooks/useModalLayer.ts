import { useEffect, useRef } from 'react'

interface ModalLayerOptions {
  // Runs on Escape when top-most. Undefined swallows the key, as a dialog mid-save needs.
  onEscape?: () => void
  // Whether this layer is on the stack; always-mounted popovers pass their open state.
  enabled?: boolean
  // Suppresses app-wide chords while open.
  blocksHotkeys?: boolean
}

type Layer = { current: ModalLayerOptions }

// One stack for every Escape-dismissible surface, so only the top-most closes.
const layers: Layer[] = []

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const top = layers[layers.length - 1]
  if (!top) return

  // Window capture runs first, so this keeps the key from every layer below.
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

function useModalLayer(options: ModalLayerOptions): void {
  // Read through a ref so a fresh inline callback doesn't re-push the layer above its siblings.
  const layer = useRef<ModalLayerOptions>(options)
  layer.current = options

  const enabled = options.enabled ?? true

  useEffect(() => {
    if (!enabled) return undefined
    pushLayer(layer)
    return () => popLayer(layer)
  }, [enabled])
}

// Read at keydown so dialogs needn't plumb open state up to App.
function hotkeysBlocked(): boolean {
  return layers.some((layer) => layer.current.blocksHotkeys === true)
}

export { useModalLayer, hotkeysBlocked }
export default useModalLayer
