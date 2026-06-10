# Hearth Design System

## Colors

The UI reuses the reference project's warm OKLCH palette through CSS custom properties.

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--background` | `oklch(0.96 0.012 80)` | `oklch(0.22 0.018 50)` | App canvas |
| `--foreground` | `oklch(0.26 0.024 50)` | `oklch(0.92 0.02 78)` | Primary text |
| `--card` | `oklch(0.98 0.01 84)` | `oklch(0.26 0.02 48)` | Cards, dialogs, covers badge |
| `--primary` | `oklch(0.55 0.13 55)` | `oklch(0.72 0.13 60)` | Active navigation, CTAs, progress |
| `--primary-foreground` | `oklch(0.98 0.012 84)` | `oklch(0.22 0.02 50)` | Text/icons on primary |
| `--secondary` | `oklch(0.92 0.018 78)` | `oklch(0.3 0.022 48)` | Secondary surfaces |
| `--muted` | `oklch(0.93 0.015 80)` | `oklch(0.3 0.02 48)` | Progress tracks, quiet fills |
| `--muted-foreground` | `oklch(0.5 0.025 60)` | `oklch(0.72 0.025 70)` | Supporting text |
| `--accent` | `oklch(0.88 0.04 70)` | `oklch(0.36 0.04 58)` | Pills, hover states |
| `--accent-foreground` | `oklch(0.3 0.04 50)` | `oklch(0.93 0.025 80)` | Text/icons on accent |
| `--border` | `oklch(0.88 0.02 75)` | `oklch(0.34 0.02 50)` | Dividers, outlines |
| `--sidebar` | `oklch(0.93 0.018 76)` | `oklch(0.2 0.018 50)` | Sidebar panel |
| `--sidebar-accent` | `oklch(0.88 0.03 70)` | `oklch(0.32 0.03 56)` | Collection active states |
| `--sidebar-border` | `oklch(0.86 0.022 72)` | `oklch(0.3 0.02 50)` | Sidebar divider |

Ambient cover glow uses each book's HSL `tint` value at 55-60% alpha.

## Typography

- Headings and book titles use `Georgia, "Times New Roman", serif` to approximate the reference Fraunces serif.
- Body text uses the system sans stack: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Page titles scale from `2.5rem` to `3.15rem` on desktop.
- Hero book titles scale from `2.9rem` to `4.25rem`.
- Sidebar and action labels are medium-to-bold sans text with no negative letter spacing.
- Section labels are uppercase with `0.07em` tracking.

## Spacing

- Desktop sidebar width: `28rem`.
- Desktop top bar height: `9.75rem`.
- Main content max width: `89rem`.
- Main content padding: `3.9rem 3.2rem 6rem`.
- Reading stacks use `5rem` vertical gaps.
- Book grids use `3.8rem` row gaps and `2.3rem` column gaps.
- Shelf scrollers use `2.3rem` item gaps.
- Hero layout uses a `21rem` cover column and `3.8rem` internal gap.

## Radii

- Base radius token: `0.875rem`.
- Book covers: `0.85rem`.
- Store cards: `1.55rem`.
- Week card: `1.65rem`.
- Hero card: `3.1rem`.
- Search, nav pills, buttons, badges: `999px`.

## Shadows

- Book covers: `0 14px 30px -12px rgba(60, 40, 20, 0.55)` in light mode, deeper black in dark mode.
- Store cards: `0 18px 40px -20px rgba(60, 40, 20, 0.5)`.
- Dialogs: `0 30px 80px rgba(0, 0, 0, 0.35)`.
- Preview dock: `0 18px 45px rgba(0, 0, 0, 0.32)`.

## Texture

The `paperGrain` utility matches the reference dotted paper effect:

```css
background-image: radial-gradient(oklch(0.4 0.02 50 / 0.04) 1px, transparent 1px);
background-size: 4px 4px;
```
