/**
 * Zoom, and the number telling you where you are.
 *
 * The percentage is the point, not the buttons. Without it there is no way to
 * tell "I am zoomed out far enough that the graph is unreadable" from "the
 * graph is small", and both look like the same empty canvas.
 *
 * The step is React Flow's own, so the buttons and the scroll wheel feel like
 * one control rather than two.
 */
export function ZoomControl({
  percent,
  onZoomIn,
  onZoomOut,
}: {
  percent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  // `onClick` is passed straight through: React Flow's zoomIn takes no
  // arguments in this version, so wrapping it to pass a duration would be
  // passing something the type says does not exist.
  return (
    <div className="absolute right-3 top-3 z-10 flex items-center overflow-hidden rounded-[4px] border border-border bg-surface-raised">
      <button
        aria-label="Zoom in"
        className="flex h-7 w-7 cursor-pointer items-center justify-center text-text-muted hover:bg-surface hover:text-text"
        onClick={onZoomIn}
        title="Zoom in"
        type="button"
      >
        <Magnifier direction="in" />
      </button>

      {/*
        A live region, because a screen reader user pressing "zoom in" gets no
        other feedback at all — nothing on the canvas moves in a way that is
        announced.
      */}
      <output
        aria-live="polite"
        className="min-w-[46px] border-x border-border px-1.5 text-center font-mono text-[10px] leading-none tabular-nums text-text-muted"
      >
        {Math.round(percent * 100)}%
      </output>

      <button
        aria-label="Zoom out"
        className="flex h-7 w-7 cursor-pointer items-center justify-center text-text-muted hover:bg-surface hover:text-text"
        onClick={onZoomOut}
        title="Zoom out"
        type="button"
      >
        <Magnifier direction="out" />
      </button>
    </div>
  );
}

function Magnifier({ direction }: { direction: "in" | "out" }) {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.25" />
      <path
        d={
          direction === "in"
            ? "M6 4.25v3.5M4.25 6h3.5M9.5 9.5 12.5 12.5"
            : "M4.25 6h3.5M9.5 9.5 12.5 12.5"
        }
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}