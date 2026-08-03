import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

type ElementSource = RefObject<HTMLElement | null> | (() => HTMLElement | null)

/**
 * Tracks an element's laid-out height so a wrapper can animate towards it.
 *
 * Motion retargets a running animation whenever its target changes, so unlike a
 * CSS `transition: height` this needs no settle timer, no deadline backstop and
 * no transitionend chasing: late content — an async `/book/{id}` fetch landing,
 * a font swapping in — simply moves the target, and the animation already in
 * flight bends towards it instead of snapping the remaining distance.
 *
 * `offsetHeight` rather than `getBoundingClientRect()` on purpose. The dialog
 * card is mid-`scale` while its open animation runs, and a transformed rect
 * would feed that scale back in as height jitter.
 *
 * Returns null before the first measurement so callers can fall back to `auto`
 * and let the element size itself for the first paint. Measuring in a layout
 * effect means the real height lands in the same commit, before the browser
 * paints, so that fallback is never visible.
 *
 * `resetKey` re-attaches the observer — pass whatever identifies the element
 * being measured when it is swapped out for a different one.
 */
export default function useMeasuredHeight(source: ElementSource, resetKey?: unknown): number | null {
  const [height, setHeight] = useState<number | null>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source

  useLayoutEffect(() => {
    const current = sourceRef.current
    const element = typeof current === 'function' ? current() : current.current
    if (!element) {
      setHeight(null)
      return undefined
    }

    const measure = () => setHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [resetKey])

  return height
}
