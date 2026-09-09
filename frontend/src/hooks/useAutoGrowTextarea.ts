import { useLayoutEffect, useRef, type RefObject } from 'react'

interface AutoGrowOptions {
  // Stop growing after this many lines and scroll beyond it. Without a cap a
  // long enough value pushes everything below it off the page, so any field
  // holding text of unbounded length should set one.
  maxLines?: number
}

// Keeps a textarea exactly as tall as its content, up to `maxLines`, so nothing
// is hidden behind a scrollbar at the lengths the field is actually for. Only
// worth it for fields whose content is short and bounded — a highlight's note
// is a sentence or two. A field that can hold a page of text wants a fixed box
// and a scrollbar instead, which is why this is opt-in per textarea rather than
// a rule on the element.
//
// The pairing with CSS matters: the textarea needs `resize: none` so a
// hand-dragged height is not overwritten on the next keystroke, and it must not
// set its own `overflow-y` — that is toggled here as the cap is crossed.
function useAutoGrowTextarea(value: string, options: AutoGrowOptions = {}): RefObject<HTMLTextAreaElement> {
  const { maxLines } = options
  const ref = useRef<HTMLTextAreaElement>(null)

  // Layout effect, not effect: the measure-and-set happens before paint, so a
  // growing note never shows one frame at the old height.
  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return

    const style = window.getComputedStyle(field)
    // scrollHeight covers padding but not borders, while the height being set
    // is a border-box one (the app's reset makes every element border-box), so
    // the borders have to be added back or the field ends up short by them.
    const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)

    // Collapse first — scrollHeight can only report a height at or above the
    // current one, so without this the field would grow and never shrink. The
    // overflow reset goes with it: measuring while a scrollbar is up would
    // fold the scrollbar's own space into the answer.
    field.style.height = 'auto'
    field.style.overflowY = 'hidden'
    const content = field.scrollHeight + borders

    const cap = maxLines ? lineHeightOf(style) * maxLines + paddingOf(style) + borders : Infinity
    field.style.height = `${Math.min(content, cap)}px`
    field.style.overflowY = content > cap ? 'auto' : 'hidden'
  }, [value, maxLines])

  return ref
}

// `line-height: normal` computes to the keyword rather than a length, and only
// the browser knows what the font makes of it; 1.2em is the usual stand-in.
function lineHeightOf(style: CSSStyleDeclaration): number {
  return parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 0) * 1.2
}

function paddingOf(style: CSSStyleDeclaration): number {
  return (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
}

export default useAutoGrowTextarea
