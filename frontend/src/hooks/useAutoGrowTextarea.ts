import { useLayoutEffect, useRef, type RefObject } from 'react'

interface AutoGrowOptions {
  maxLines?: number
}

// Fits a textarea to its content up to maxLines. Needs `resize: none` and no CSS `overflow-y`.
function useAutoGrowTextarea(value: string, options: AutoGrowOptions = {}): RefObject<HTMLTextAreaElement> {
  const { maxLines } = options
  const ref = useRef<HTMLTextAreaElement>(null)

  // Layout effect so a growing note never paints one frame at the old height.
  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return

    const style = window.getComputedStyle(field)
    // scrollHeight excludes borders but the height is border-box, so add them back.
    const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)

    // Collapse first or scrollHeight can never shrink; clear overflow so a scrollbar doesn't skew it.
    field.style.height = 'auto'
    field.style.overflowY = 'hidden'
    const content = field.scrollHeight + borders

    const cap = maxLines ? lineHeightOf(style) * maxLines + paddingOf(style) + borders : Infinity
    field.style.height = `${Math.min(content, cap)}px`
    field.style.overflowY = content > cap ? 'auto' : 'hidden'
  }, [value, maxLines])

  return ref
}

// `line-height: normal` computes to a keyword; 1.2em is the usual stand-in.
function lineHeightOf(style: CSSStyleDeclaration): number {
  return parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 0) * 1.2
}

function paddingOf(style: CSSStyleDeclaration): number {
  return (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
}

export default useAutoGrowTextarea
