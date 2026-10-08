"use client";

import { useCallback, useMemo, useState } from "react";
import type { RepositoryParseResult } from "@/parser/types.mts";
import { describeCategories, type CategorySet } from "@/lib/graph/categories.ts";
import { foldFolders } from "@/lib/graph/fold.ts";
import { deriveMap, PANEL_VISIBLE_ROWS, fileItemId, folderPathOf } from "@/lib/graph/graph.ts";
import { litItems } from "@/lib/graph/highlight.ts";
import { seatFolders, seatIn, type PlacedBox } from "@/lib/graph/layout.ts";
import { DetailPane } from "./detail-pane";
import { FileRail } from "./file-rail";
import { MapCanvas } from "./map-canvas";
import type { MapInteraction } from "./interaction";

/**
 * The shell: a rail on the left, the map in the middle, a detail pane on the
 * right. It is built once and the three columns do not move again — later phases
 * fill the panes, they do not rearrange them.
 *
 * Nothing here fetches. Every figure the detail pane shows is already in the
 * browser, because selecting something is arithmetic over the parse rather than a
 * request. Selecting a file fires no network call at all.
 */
export function MapWorkspace({
  parse,
  categories,
}: {
  parse: RepositoryParseResult;
  categories?: CategorySet;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // How far each open panel is scrolled, by folder path. Cleared when a folder
  // closes, so reopening it starts at the top rather than where it was left.
  const [scrolled, setScrolled] = useState<ReadonlyMap<string, number>>(() => new Map());
  // Where the reader has dragged a folder to, which outranks its seat. Session
  // state, not saved: this is how the map is being looked at right now, not a
  // fact about the repository.
  const [moved, setMoved] = useState<ReadonlyMap<string, PlacedBox>>(() => new Map());

  // Folding is arithmetic over the parsed files and nothing else, so it is
  // computed once and the same set of nodes comes out every time.
  const fold = useMemo(() => foldFolders(parse.files), [parse]);
  const categorySet = useMemo(() => categories ?? describeCategories(parse.files), [categories, parse]);

  /**
   * The layout is decided once, from the closed boxes, and never recomputed.
   *
   * Dagre recomputes every rank when a node's size changes, so laying out the
   * map as it currently stands meant a 64px box becoming a 148px panel shifted
   * all twenty-odd nodes and threw the reader to the far side of the graph. A
   * node that opens instead grows around the point its box already occupied, and
   * nothing else moves — ever, no matter how many folders are open.
   *
   * That also means the positions are a function of the folded map alone, which
   * is what makes the picture the same on every load.
   */
  const seats = useMemo(() => seatFolders(parse, fold), [parse, fold]);

  const map = useMemo(
    () => deriveMap(parse, fold, expanded, scrolled),
    [parse, fold, expanded, scrolled],
  );
  const placed = useMemo(() => seatIn(seats, map.folders, moved), [seats, map, moved]);

  const lit = useMemo(() => litItems(map, selection), [map, selection]);

  /**
   * The item a hovered file path is drawn as.
   *
   * A file in a closed folder or outside its scroll window has no row — so
   * hovering its path in the pane lights up the box. Reading the same expansion
   * state the map was built from is what keeps the two views pointing at one
   * object rather than at a name that happens to match.
   */
  const itemOfPath = useMemo(() => {
    const drawn = new Map<string, string>();
    for (const folder of map.folders) {
      const node = fold.nodes.find((candidate) => candidate.id === folderPathOf(folder.id));
      for (const path of node?.files ?? []) drawn.set(path, folder.id);
      for (const row of folder.rows) drawn.set(row.path, row.id);
    }
    return drawn;
  }, [fold, map.folders]);

  /**
   * Which item is highlighted for a hover, from either direction.
   *
   * The pane sends a file path and the map sends an item id, and this resolves
   * both to the one thing on screen they mean. Without it, hovering a path in the
   * pane and hovering its row on the map would be two different pieces of state
   * that happened to look alike.
   */
  const highlightOf = useCallback(
    (id: string | null): string | null => {
      if (id === null) return null;
      // An id from the map is already what is on screen. A path from the pane is a
      // name, and the thing on screen is whatever is holding it.
      return id.startsWith("file:") || id.startsWith("folder:") ? id : (itemOfPath.get(id) ?? null);
    },
    [itemOfPath],
  );

  /**
   * The hovered file as a path, whichever view it was hovered in.
   *
   * The map speaks in item ids and the pane speaks in paths, so each side needs
   * the other's vocabulary for the shared highlight to point at the same row.
   */
  const hoverPath = useMemo(() => {
    if (hovered === null) return null;
    if (hovered.startsWith("file:")) return hovered.slice("file:".length);
    if (hovered.startsWith("folder:")) return null;
    return hovered;
  }, [hovered]);

  const toggleFolder = useCallback((itemId: string) => {
    const path = folderPathOf(itemId);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    setScrolled((current) => {
      // Closing a folder forgets where it was scrolled to, so reopening it
      // starts at the top rather than halfway down a list nobody has seen.
      if (!current.has(path)) return current;
      const next = new Map(current);
      next.delete(path);
      return next;
    });
    setSelection(itemId);
  }, []);

  const moveNode = useCallback((itemId: string, at: { x: number; y: number }) => {
    setMoved((current) => {
      const x = Math.round(at.x);
      const y = Math.round(at.y);
      const existing = current.get(itemId);
      // Returning the same map tells React nothing changed, which matters here:
      // this runs on every frame of a drag, and a folder that lands on the pixel
      // it started on should not cost a render.
      if (existing && existing.x === x && existing.y === y) return current;

      const next = new Map(current);
      next.set(itemId, { x, y, width: 0, height: 0 });
      return next;
    });
  }, []);

  const scrollPanel = useCallback((itemId: string, by: number) => {
    const path = folderPathOf(itemId);
    setScrolled((current) => {
      const next = new Map(current);
      next.set(path, (next.get(path) ?? 0) + by);
      return next;
    });
  }, []);

  /**
   * Select a file by path, from anywhere.
   *
   * A file inside a folder that is still folded has nothing on the map to be
   * selected on, so its folder is opened as well. Selecting a name that the reader
   * cannot see highlighted would be worse than moving the map under them, and the
   * panel is the only place the file exists on screen.
   *
   * An open panel shows a window of rows and scrolls through the rest, so opening
   * the folder is not enough — a file past the tenth row is still not on screen.
   * The panel is scrolled to put it there, because a selection with no row behind
   * it dims the map and highlights nothing, which reads as a broken click.
   */
  const selectPath = useCallback(
    (path: string) => {
      const folder = fold.nodeOfFile.get(path);
      if (folder !== undefined) {
        setExpanded((current) => (current.has(folder) ? current : new Set(current).add(folder)));
        const index = fold.nodes.find((node) => node.id === folder)?.files.indexOf(path) ?? -1;
        if (index >= 0) {
          setScrolled((current) => {
            // The same window the map draws, so the row this lands on is one that
            // exists rather than one clamped away.
            const last = Math.max(0, (fold.nodes.find((node) => node.id === folder)?.fileCount ?? 0) - PANEL_VISIBLE_ROWS);
            const start = Math.min(Math.max(0, index - PANEL_VISIBLE_ROWS + 1), last);
            if (current.get(folder) === start) return current;
            return new Map(current).set(folder, start);
          });
        }
      }
      setSelection(fileItemId(path));
    },
    [fold],
  );

  const hover = useCallback((id: string | null) => setHovered(id), []);

  const interaction = useMemo<MapInteraction>(
    () => ({
      selection,
      lit,
      hovered: highlightOf(hovered),
      toggleFolder,
      selectItem: setSelection,
      selectPath,
      hover,
      scrollPanel,
      moveNode,
    }),
    [selection, lit, hovered, highlightOf, toggleFolder, selectPath, hover, scrollPanel, moveNode],
  );

  return (
    <div className="flex h-full min-h-0 bg-surface">
      <FileRail
        categories={categorySet.categories}
        fileCount={parse.summary.filesParsed}
      />

      {/* h-full as well as flex-1. `flex-1` sets the width but leaves the height
          to the parent, and a flex child with no height of its own collapses to
          zero — which React Flow refuses to draw into, and the map is silently
          absent rather than broken. */}
      <div className="h-full min-w-0 flex-1">
        <MapCanvas interaction={interaction} map={map} placed={placed} />
      </div>

      {/*
        `hovered` is passed as a path rather than as the raw hover state. The map
        reports an item id, and the pane's rows are keyed by path — handing one to
        the other as-is is how the two directions end up looking identical while
        pointing at nothing.
      */}
      <DetailPane
        categories={categorySet}
        hovered={hoverPath}
        map={map}
        onHoverPath={hover}
        onSelectPath={selectPath}
        parse={parse}
        selection={selection}
      />
    </div>
  );
}
