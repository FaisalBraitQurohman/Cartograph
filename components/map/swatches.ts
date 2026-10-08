/**
 * Written out rather than interpolated. Tailwind only sees class names it can find
 * in the source, and `bg-kind-${n}` would compile to nothing.
 *
 * The index comes from `Category.swatch`, which is fixed to the category rather
 * than to its position in a list. The rail and the detail pane order categories
 * differently — path order against count order — so a swatch taken from list
 * position would paint the same category two colours on one screen.
 */
export const KIND_FILL = [
  "bg-kind-1",
  "bg-kind-2",
  "bg-kind-3",
  "bg-kind-4",
  "bg-kind-5",
  "bg-kind-6",
  "bg-kind-7",
  "bg-kind-8",
] as const;

export function kindFill(swatch: number): string {
  return KIND_FILL[swatch % KIND_FILL.length];
}
