import type { Category } from "@/lib/graph/categories.ts";
import { kindFill } from "./swatches";

/**
 * The left rail: what kinds of file are on this map, and how many of each.
 *
 * Nothing here filters anything yet. The rail exists in this phase because the
 * shell is settled here — a later phase puts behaviour into these rows without
 * moving them.
 */
export function FileRail({
  categories,
  fileCount,
}: {
  categories: readonly Category[];
  fileCount: number;
}) {
  return (
    <nav
      aria-label="File categories"
      className="flex h-full w-[212px] shrink-0 flex-col border-r border-border bg-surface-raised/40"
    >
      <div className="border-b border-border px-3.5 py-2.5">
        <h2 className="text-[11px] font-medium text-text">Categories</h2>
        <p className="mt-0.5 text-[10px] text-text-muted">Folder each file was parsed from</p>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {categories.map((category) => (
          <li key={category.id}>
            <div className="flex items-center gap-2.5 px-3.5 py-[5px] text-[11px] text-text-muted">
              <span
                aria-hidden="true"
                className={`h-[9px] w-[9px] shrink-0 rounded-[2px] ${kindFill(category.swatch)}`}
              />
              <span className="min-w-0 flex-1 truncate font-mono" title={category.label}>
                {category.label}
              </span>
              <span className="shrink-0 tabular-nums">{category.fileCount}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between border-t border-border px-3.5 py-2.5 text-[10px] text-text-muted">
        <span>{categories.length} categories</span>
        <span className="tabular-nums">{fileCount} files</span>
      </div>
    </nav>
  );
}