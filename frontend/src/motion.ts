import type { Transition, Variants } from 'motion/react'

// Shared timing for every Motion-driven transition in the app.
//
// The durations and curves below are the ones the stylesheet already used, kept
// deliberately identical so the animations Motion now owns (view swaps, dialog
// enter/exit, panel heights) sit on the same curve as the CSS transitions that
// remain — hover states, focus rings, chevron rotations. Change a value here
// rather than at a call site, so the app keeps reading as one system.

export const EASE_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1]
export const EASE_SOFT: [number, number, number, number] = [0.22, 1, 0.36, 1]

export const transitions = {
  /** Backdrop fade behind any dialog. */
  scrim: { duration: 0.2, ease: 'easeOut' } as Transition,

  /** First open of a dialog card: it lifts and scales into place. */
  dialogEnter: { duration: 0.38, ease: EASE_EXPO } as Transition,

  /**
   * Card-to-card navigation inside the dialog. The incoming card paints on top
   * of the outgoing one, so the two fades are deliberately asymmetric: the
   * incoming card reaches full opacity before the outgoing one starts to leave.
   * Two cards at half opacity would both let the scrim through at the midpoint,
   * which reads as a brightness dip.
   */
  crossfadeIn: { duration: 0.18, ease: 'easeOut' } as Transition,
  crossfadeOut: { duration: 0.18, ease: 'easeIn', delay: 0.07 } as Transition,

  /** Any container easing to a newly measured height. */
  height: { duration: 0.32, ease: EASE_EXPO } as Transition,

  /** Content swapping inside a container that is already sized. */
  panelIn: { duration: 0.24, ease: EASE_EXPO } as Transition,
  panelOut: { duration: 0.12, ease: 'easeIn' } as Transition,

  /** Menus and popovers anchored to a trigger. */
  popover: { duration: 0.14, ease: 'easeOut' } as Transition,

  /** Top-level view swap in the content pane, and the matching title swap. */
  viewIn: { duration: 0.24, ease: EASE_EXPO } as Transition,
  viewOut: { duration: 0.12, ease: 'easeIn' } as Transition,

  /** Hero carousel paging. */
  hero: { duration: 0.26, ease: EASE_SOFT } as Transition,

  /** The sliding active-tab / active-nav indicator. */
  indicator: { type: 'spring', stiffness: 520, damping: 42, mass: 1 } as Transition,

  /** Mobile navigation drawer. */
  drawer: { duration: 0.28, ease: EASE_EXPO } as Transition,
}

/** Applied to the element that swaps when the active view changes. */
export const viewVariants: Variants = {
  hidden: { opacity: 0, y: 8, transition: transitions.viewOut },
  visible: { opacity: 1, y: 0, transition: transitions.viewIn },
  exit: { opacity: 0, y: -6, transition: transitions.viewOut },
}

/**
 * Applied to a grid or shelf so its cards arrive one after another. Cards read
 * their own state from these labels, so a `BookCard` rendered outside such a
 * container (the stats page features two on their own) simply stays static.
 */
export const cardContainerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
}

export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_EXPO } },
  exit: { opacity: 0, scale: 0.92, transition: { duration: 0.18, ease: 'easeIn' } },
}

/**
 * Hero carousel paging. The custom value is the direction the reader asked for,
 * so the outgoing card leaves the way the incoming one came from.
 */
export const heroVariants: Variants = {
  enter: (direction: 'next' | 'prev') => ({ opacity: 0, x: direction === 'next' ? 36 : -36 }),
  center: { opacity: 1, x: 0, transition: transitions.hero },
  exit: (direction: 'next' | 'prev') => ({
    opacity: 0,
    x: direction === 'next' ? -36 : 36,
    transition: transitions.hero,
  }),
}

/** Calendar months paging sideways. Custom value is +1 forwards, -1 back. */
export const monthGridVariants: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 18 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.16, ease: EASE_EXPO } },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction * -18,
    transition: { duration: 0.1, ease: 'easeIn' },
  }),
}

/** Menus and popovers that grow out of their trigger. */
export const popoverVariants: Variants = {
  hidden: { opacity: 0, y: -6, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: transitions.popover },
  exit: { opacity: 0, y: -4, scale: 0.99, transition: { duration: 0.1, ease: 'easeIn' } },
}
