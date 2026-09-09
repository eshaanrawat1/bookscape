import { useLayoutEffect, useRef, type RefObject } from 'react'

// Keeps a textarea exactly as tall as its content, so nothing is hidden behind
// a scrollbar. Only worth it for fields whose content is short and bounded — a
// highlight's note is a sentence or two. A field that can hold a page of text
// wants a fixed box and a scrollbar instead, which is why this is opt-in per
// textarea rather than a rule on the element.
//
// The pairing with CSS matters: the textarea needs `overflow: hidden` for
// scrollHeight to report the content height rather than the visible box, and
// `resize: none` so a hand-dragged height is not overwritten on the next
// keystroke.
function useAutoGrowTextarea(value: string): RefObject<HTMLTextAreaElement> {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Layout effect, not effect: the measure-and-set happens before paint, so a
  // growing note never shows one frame at the old height.
  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return
    // Collapse first — scrollHeight can only report a height at or above the
    // current one, so without this the field would grow and never shrink.
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [value])

  return ref
}

export default useAutoGrowTextarea
