"use client";

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import { PANEL_HEADER_HEIGHT, PANEL_ROW_HEIGHT, type MapGraph, type MapRow } from "@/lib/graph/graph.ts";
import { edgeDirection, edgeOpacity, isEdgeLit } from "@/lib/graph/highlight.ts";
import { boundsOf, type PlacedBox } from "@/lib/graph/layout.ts";
import { FileRowView, type FileFlowNode } from "./file-row";
import { FolderNodeView, type FolderFlowNode } from "./folder-node";
import { MapInteractionProvider, type MapInteraction } from "./interaction";
import { ZoomControl } from "./zoom-control";

/**
 * The canvas.
 *
 * Everything drawn here comes from the derived map: which folders are boxes,
 * which are panels, which files are rows inside them, and which edge lands on
 * what. This adds presentation and decides nothing.
 */

const nodeTypes: NodeTypes = {
  folder: FolderNodeView,
  file: FileRowView,
};

const FIT_PADDING = 40;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;

/**
 * How far a pointer must travel before the gesture stops being a click. See
 * where it is used: the threshold and the click distance are the same number on
 * purpose, so there is no distance at which a folder both opens and moves.
 */
const DRAG_THRESHOLD = 4;

export function MapCanvas({
  map,
  placed,
  interaction,
}: {
  map: MapGraph;
  placed: ReadonlyMap<string, PlacedBox>;
  interaction: MapInteraction;
}) {
  return (
    <ReactFlowProvider>
      <MapInteractionProvider value={interaction}>
        <Canvas map={map} placed={placed} interaction={interaction} />
      </MapInteractionProvider>
    </ReactFlowProvider>
  );
}

function Canvas({
  map,
  placed,
  interaction,
}: {
  map: MapGraph;
  placed: ReadonlyMap<string, PlacedBox>;
  interaction: MapInteraction;
}) {
  const { setViewport, zoomIn, zoomOut } = useReactFlow();

  /**
   * One subscription per value, not one returning an object.
   *
   * `useStore` compares with `Object.is`, so a selector that builds a fresh
   * object is never equal to the last one and this component re-renders on every
   * single store notification. That is wasteful on its own and pathological once
   * dragging is on, because dragging writes to the store continuously: the extra
   * renders fed back into it until React gave up with "Maximum update depth
   * exceeded". Each selector below returns a number, which compares correctly.
   */
  const width = useStore((store) => store.width);
  const height = useStore((store) => store.height);
  const zoom = useStore((store) => store.transform[2]);
  // The fit happens once. Every later change to the layout is left alone on
  // purpose, so the ref below is the guard rather than a dependency list.
  const fitted = useRef(false);

  const nodes = useMemo(() => buildNodes(map, placed), [map, placed]);
  const edges = useMemo(() => buildEdges(map, interaction), [map, interaction]);

  /**
   * Keeping the view steady.
   *
   * The graph is fitted once, on mount, and from then on the viewport is only
   * touched when the user asks for it. Opening a folder changes the layout —
   * dagre re-runs, and every node moves — and refitting on each of those
   * changes is what made an open throw the reader across the map and shrink it
   * until nothing could be read. The rule in the spec is that a refit may only
   * ever zoom out, and doing less than that is what satisfies it: an open must
   * not lose the rest of the graph, which is also satisfied by not moving at all.
   *
   * `placed` is the layout from the expansion state this render committed, so
   * this reads the state after the change rather than the one before it.
   */
  useEffect(() => {
    if (fitted.current || width === 0 || height === 0) return;
    fitted.current = true;

    const bounds = boundsOf(placed.values());
    const fit = Math.min(
      (width - FIT_PADDING * 2) / bounds.width,
      (height - FIT_PADDING * 2) / bounds.height,
    );
    if (!Number.isFinite(fit) || fit <= 0) return;

    setViewport({
      x: (width - bounds.width * fit) / 2 - bounds.x * fit,
      y: (height - bounds.height * fit) / 2 - bounds.y * fit,
      // Never past 1:1. A graph fitted to a large display should sit at full
      // size in the middle of the canvas, not be magnified into overlapping
      // labels.
      zoom: Math.min(Math.max(fit, MIN_ZOOM), 1),
    });
  }, [width, height, placed, setViewport]);

  return (
    // No colorMode. React Flow would resolve "system" from prefers-color-scheme
    // on the client only, and the server has no document, so it renders `light`
    // while a dark-mode client renders `dark`. Passing the application's own
    // theme does not fix it either — that is "system" on the first render, which
    // is the same problem one layer down. Its light and dark values are all CSS
    // variables, so globals.css sets them off the class on <html> instead and
    // there is no prop here that can disagree between the two renders.
    <ReactFlow
      edges={edges}
      edgesFocusable={false}
      elementsSelectable={false}
      fitView={false}
      maxZoom={MAX_ZOOM}
      minZoom={MIN_ZOOM}
      nodeTypes={nodeTypes}
      nodes={nodes}
      nodesConnectable={false}
      nodesDraggable
      nodesFocusable={false}
      /**
       * Drag and click share the same gesture, so both numbers have to agree.
       *
       * `nodeDragThreshold` is how far the pointer must move before a drag
       * starts; `nodeClickDistance` is how far it may move before the click is
       * thrown away. Left at their defaults they are 1 and 0, which means a
       * one-pixel wobble both opens a folder and counts as a drag. At four
       * pixels a click opens, a drag moves, and nothing in between happens.
       */
      nodeClickDistance={DRAG_THRESHOLD}
      nodeDragThreshold={DRAG_THRESHOLD}
      /**
       * This is what makes a drag visible while it happens.
       *
       * React Flow only writes position changes into its own store in
       * uncontrolled mode — the `hasDefaultNodes` branch of `triggerNodeChanges`.
       * This map is controlled, so every movement during the drag was thrown away
       * and the folder only moved once, when the pointer was released and the
       * position was written down. Applying each change as it arrives is what
       * makes the folder follow the cursor.
       *
       * Only positions are applied. Dimension, selection and removal changes are
       * ignored: the layout owns all three, and this map records where a folder
       * was put and nothing else.
       */
      onNodesChange={(changes) => {
        for (const change of changes) {
          if (change.type !== "position" || !change.position) continue;
          interaction.moveNode(change.id, change.position);
        }
      }}
      // This handler is what makes the map clickable at all, not a convenience.
      // React Flow sets `pointer-events: none` on a node unless it is selectable,
      // draggable, or has one of onClick/onMouseEnter/onMouseMove/onMouseLeave
      // — so with nodesDraggable and elementsSelectable both off, the absence of
      // a handler is what stopped every node from receiving a click.
      //
      // It is also the only click handler. Nodes render no interactive element of
      // their own: a second handler would fire twice for one click and open a
      // folder and close it again in the same gesture.
      onNodeClick={(_, node) => {
        if (node.data.kind === "file") interaction.selectItem(node.id);
        else interaction.toggleFolder(node.id);
      }}
      /**
       * Hovering a node highlights it in the detail pane, which is the other half
       * of the pair this shares with the pane's own hover. Both are cheap because
       * the map is already drawn and the pane is already holding the file list —
       * there is nothing to fetch, so there is no delay to notice.
       *
       * Mouse only, not pointer: a touch has no hover state, so responding to it
       * would leave a highlight stuck on whatever was last touched.
       */
      onNodeMouseEnter={(_, node) => interaction.hover(node.id)}
      onNodeMouseLeave={() => interaction.hover(null)}
      onPaneClick={() => interaction.selectItem(null)}
      panOnScroll
      proOptions={{ hideAttribution: false }}
      selectionOnDrag={false}
    >
      <Background color="var(--border)" gap={28} size={1} variant={BackgroundVariant.Dots} />
      <ZoomControl onZoomIn={zoomIn} onZoomOut={zoomOut} percent={zoom} />
    </ReactFlow>
  );
}

/**
 * Nodes for React Flow.
 *
 * Every node carries `measured`. React Flow rebuilds a node's internals whenever
 * it gets a new object for it, and drops the handle bounds its edges are drawn
 * from unless the node says how big it is. The layout already knows every size —
 * the boxes are sized from the fold, not measured from the text inside them — so
 * this is stating a number that is already known, not guessing at one.
 */
function buildNodes(map: MapGraph, placed: ReadonlyMap<string, PlacedBox>): Node[] {
  const folders: FolderFlowNode[] = map.folders.map((folder) => {
    const box = placed.get(folder.id) ?? {
      x: 0,
      y: 0,
      width: folder.width,
      height: folder.height,
    };
    return {
      id: folder.id,
      type: "folder",
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      measured: { width: box.width, height: box.height },
      data: folder,
      draggable: true,
      deletable: false,
    };
  });

  // A row is a node in its own right rather than a line of text inside the
  // panel, because edges terminate on rows. It is positioned relative to the
  // panel it belongs to, which is why the layout only has to place folders.
  const rows: FileFlowNode[] = map.rows.map((row) => {
    // Position within the panel's window, not within the folder: a row's index
    // counts from the first file in the folder, and the panel is scrolled to
    // somewhere in the middle of that.
    const panel = map.folders.find((folder) => folder.id === row.panelId);
    const slot = row.index - (panel?.scroll ?? 0);

    return {
      id: row.id,
      type: "file",
      parentId: row.panelId,
      extent: "parent",
      position: { x: 4, y: PANEL_HEADER_HEIGHT + slot * PANEL_ROW_HEIGHT },
      width: row.width,
      height: row.height,
      measured: { width: row.width, height: row.height },
      data: row,
      // A row belongs to its panel. Dragging one out would leave it parented to
      // a panel it is no longer inside.
      draggable: false,
      deletable: false,
      zIndex: 2,
    };
  });

  return [...folders, ...rows];
}

/** Which panel each drawn row belongs to, so an internal edge can be recognised. */
function panelOfRows(rows: readonly MapRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, row.panelId]));
}

function buildEdges(map: MapGraph, interaction: MapInteraction): Edge[] {
  const { selection, lit } = interaction;

  /**
   * What the edges are being read against.
   *
   * Every row an open panel is showing and its panel, whether or not anything
   * is selected. The panel also represents files outside its scroll window.
   * Opening a folder is already a statement that those files matter, so their
   * edges say which way they run without anything having to be picked first.
   *
   * Every open folder, not just the last one. Anchoring only on the selection
   * meant a second folder opened while another was selected came up with no
   * colour at all until you clicked a file inside it, so two folders that were
   * equally open behaved differently for no reason the reader could see. With
   * nothing open and nothing selected there is nothing to read against and no
   * edge has a direction to report.
   *
   * The selection joins the same set rather than replacing it, so selecting a
   * file adds its edges to the ones already coloured.
   *
   * `panelOf` is what separates an edge internal to one folder from one running
   * between two. Putting the panels in the anchor instead does not: the anchor is
   * every open folder's rows, so both ends of a cross-folder edge are in it too and
   * the edge is read as internal. That left 0 of 77 edges coloured with one folder
   * open, and 0 of 414 with all of them.
   */
  const panelOf = panelOfRows(map.rows);

  const anchor =
    map.rows.length > 0 || selection !== null
      ? new Set([...map.rows.map((row) => row.id), ...(selection ? [selection] : [])])
      : null;

  return map.edges.map((edge) => {
    // `lit` is the same set the nodes use, so an edge stays bright exactly when
    // both of the things it connects are still at full strength. Deciding it
    // again here from `selection` would be a second and subtly different answer
    // — it would keep an edge whose far end had been dimmed.
    const edgeIsLit = isEdgeLit(map, edge, lit);

    const direction = edgeIsLit ? edgeDirection(edge, anchor, panelOf) : null;
    const color =
      direction === "incoming"
        ? "var(--incoming)"
        : direction === "outgoing"
          ? "var(--outgoing)"
          : "var(--edge)";

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "default",
      style: {
        stroke: color,
        strokeWidth: 1 + Math.min(2, Math.log2(edge.weight + 1)),
        opacity: edgeOpacity(direction, edgeIsLit),
      },
      // Internal edges get no arrowhead. An arrow claims a direction, and an edge
      // between two files of one folder has none to claim — which is how a
      // relationship wholly inside a folder read as an incoming connection.
      markerEnd:
        direction === null
          ? undefined
          : { type: MarkerType.ArrowClosed, width: 11, height: 11, color },
      focusable: false,
      selectable: false,
    };
  });
}
