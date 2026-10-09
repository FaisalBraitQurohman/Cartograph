"use client";

import type { FileSummary } from "@/lib/graph/detail.ts";

/**
 * A list of file paths that can be clicked and hovered.
 *
 * Both directions matter and both are cheap: clicking a path here moves the map's
 * selection to that file, and hovering one lights it up on the map. Neither asks
 * the network anything, because the map is already holding every file path in the
 * repository and a name is one of them.
 *
 * Paths are shown the way the reader needs to disambiguate them — the file name
 * with its folder, so two `index.ts` in different places don't look like one row.
 */
export function PathList({
  items,
  hovered,
  onSelect,
  onHover,
}: {
  items: readonly FileSummary[];
  hovered: string | null;
  onSelect: (path: string) => void;
  onHover: (path: string | null) => void;
}) {
  if (items.length === 0) {
    return <p className="px-3.5 py-2 text-[10.5px] text-text-muted">None.</p>;
  }

  return (
    <ul className="min-w-0">
      {items.map((item) => {
        // A tinted row, never the accent itself. The accent means "this is what you
        // picked", and the row the pointer is over is not picked until it is
        // clicked — using the same colour would make the two look identical.
        const pointed = hovered === item.path;
        return (
          <li key={item.path}>
            <button
              className={`flex w-full items-baseline gap-2 border-l-2 px-3.5 py-[3px] text-left font-mono text-[10.5px] leading-[15px] ${
                pointed
                  ? "border-accent/50 bg-accent/5 text-text"
                  : "border-transparent text-text-muted hover:bg-surface-raised hover:text-text"
              }`}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(item.path)}
              onFocus={() => onHover(item.path)}
              onMouseEnter={() => onHover(item.path)}
              onMouseLeave={() => onHover(null)}
              title={item.path}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">
                <FileName path={item.path} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The name, with just enough folder to tell two files apart.
 *
 * The full path is on the `title` and in the pane's header, so the row itself only
 * carries the tail — the directory above the file name, then the file name. A row
 * that showed every segment would be unreadable at this width and would not tell
 * the reader anything the shorter form does not.
 */
export function FileName({ path }: { path: string }) {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return <>{path}</>;
  const folder = path.slice(0, cut);
  const parent = folder.slice(folder.lastIndexOf("/") + 1);
  return (
    <>
      <span className="text-text-muted">{parent}/</span>
      {path.slice(cut + 1)}
    </>
  );
}
