"use client";

import type { Category } from "@/lib/graph/categories.ts";
import { kindFill } from "./swatches";

/**
 * The left rail: what kinds of file are on this map, and how many of each.
 *
 * Clicking a row dims everything that is not in it. Dimming rather than removing is
 * the whole design: a category filter that took files off the screen would leave a
 * reader guessing about the shape of what was taken away, and the folders around it
 * are the only way to know where a category lives in the repository.
 */
export function FileRail({
  categories,
  fileCount,
  active,
  onSelect,
}: {
  categories: readonly Category[];
  fileCount: number;
  /** The category currently dimming everything else, or null. */
  active: string | null;
  onSelect: (categoryId: string | null) => void;
}) {
  return (
    <nav
      aria-label="File categories"
      className="flex h-full w-[212px] shrink-0 flex-col border-r border-border bg-surface-raised/40"
    >
      <div className="border-b border-border px-3.5 py-2.5">
        <h2 className="text-[11px] font-medium text-text">Categories</h2>
        <p className="mt-0.5 text-[10px] text-text-muted">
          {active === null ? "Folder each file was parsed from" : "Click again to clear"}
        </p>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {categories.map((category) => {
          const chosen = active === category.id;
          // Not dimmed. The selected row is what everything else is dimmed against,
          // and dimming it too would make the two states harder to tell apart than
          // they are.
          const faded = active !== null && !chosen;
          return (
            <li key={category.id}>
              <button
                aria-pressed={chosen}
                className={`flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-[5px] text-left text-[11px] transition-opacity ${
                  chosen ? "text-text" : faded ? "text-text-muted opacity-45" : "text-text-muted"
                } hover:bg-surface`}
                onClick={() => onSelect(chosen ? null : category.id)}
                title={`${category.fileCount} files in ${category.label}`}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`h-[9px] w-[9px] shrink-0 rounded-[2px] ${kindFill(category.swatch)}`}
                />
                <span className="min-w-0 flex-1 truncate font-mono" title={category.label}>
                  {category.label}
                </span>
                <span className="shrink-0 tabular-nums">{category.fileCount}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-baseline justify-between border-t border-border px-3.5 py-2.5 text-[10px] text-text-muted">
        <span>{categories.length} categories</span>
        <span className="tabular-nums">{fileCount} files</span>
      </div>
    </nav>
  );
}
