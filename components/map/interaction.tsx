"use client";

import { createContext, useContext } from "react";

/**
 * How the canvas and the detail pane talk to each other.
 *
 * React Flow hands a custom node its own props and nothing else, so what the
 * nodes need from the workspace around them travels through context instead of
 * being threaded through every renderer.
 *
 * The two hover directions live here rather than in either component. Hovering a
 * neighbour in the pane has to light it up on the map, and hovering a node on the
 * map has to light it up in the pane; both are the same pair of callbacks read by
 * two views of one piece of state, so neither side can disagree about what is
 * hovered.
 */
export type MapInteraction = {
  /** The one thing currently selected, as a canvas item id. */
  selection: string | null;
  /** Item ids that stay at full strength while something is selected. */
  lit: ReadonlySet<string> | null;
  /** The item a pointer is over, on the map or in the pane. Item id or file path. */
  hovered: string | null;
  /** A closed box or an open panel's header was clicked. */
  toggleFolder: (itemId: string) => void;
  /** A file row was clicked. Null clears the selection. */
  selectItem: (itemId: string | null) => void;
  /** A file path was clicked in the pane, whatever drew it. */
  selectPath: (path: string) => void;
  /**
   * The rail category currently dimming everything else, or null.
   *
   * Read by the nodes rather than passed to them, because the match count a folder
   * shows is a function of this and of the fold, and React Flow does not thread a
   * fourth argument through to a custom node.
   */
  category: string | null;
  /** A pointer left a node or a pane row. Null clears the hover. */
  hover: (id: string | null) => void;
  /** Move a panel's rows by one, forwards or back. */
  scrollPanel: (itemId: string, by: number) => void;
  /** A folder was dragged somewhere. The position outranks its seat. */
  moveNode: (itemId: string, at: { x: number; y: number }) => void;
};

const Interaction = createContext<MapInteraction | null>(null);

export const MapInteractionProvider = Interaction.Provider;

export function useMapInteraction(): MapInteraction {
  const value = useContext(Interaction);
  if (!value) throw new Error("Map nodes must be rendered inside a MapInteractionProvider");
  return value;
}
