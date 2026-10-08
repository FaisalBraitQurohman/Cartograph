/**
 * The rule a node object has to follow for its edges to survive.
 *
 * React Flow rebuilds a node's internals whenever it is handed a new object for
 * it, and the handle bounds — the points its edges are drawn from — go with the
 * old one. `parseHandles` decides whether to carry them over, and it only does
 * so when the node carries its own `measured`:
 *
 *     return !userNode.measured ? undefined : internalNode?.internals.handleBounds
 *
 * Without `measured`, every rebuilt node loses its handle bounds and its edges
 * have nothing to attach to. The map rebuilds its nodes constantly — on every
 * frame of a drag, on every folder opened, on every scroll — and the bounds were
 * being dropped faster than the ResizeObserver could restore them, so dragging a
 * folder made every edge on the map disappear.
 *
 * The layout knows every node's size before anything is drawn, because the sizes
 * come from the fold rather than from the text inside the boxes. Saying so with
 * `measured` costs nothing and is not an approximation: it is the same number
 * the layout used to place the node.
 *
 * Structural on purpose. This is a rule about what React Flow needs to see, and
 * it should be stated where it can be checked without the library.
 */
export interface NodeShape {
  id: string;
  type?: string | undefined;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  measured: { width?: number; height?: number };
  data: unknown;
  parentId?: string | undefined;
  extent?: unknown;
  draggable?: boolean | undefined;
  selectable?: boolean | undefined;
}

/** Whether two nodes would render and behave identically. */
export function isSameNode(previous: NodeShape, next: NodeShape): boolean {
  return (
    previous.id === next.id &&
    previous.type === next.type &&
    // By reference on purpose. The node's data is the folder or file it draws,
    // and it is rebuilt only when that content actually changed, so comparing it
    // by value would be a deep walk on every frame of a drag.
    previous.data === next.data &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.parentId === next.parentId &&
    previous.extent === next.extent &&
    previous.draggable === next.draggable &&
    previous.selectable === next.selectable
  );
}

/**
 * Whether a node keeps its handle bounds when React Flow rebuilds it.
 *
 * The first time a node is seen it has no previous internals and there is
 * nothing to keep, so this is true only once the node has been measured once.
 * Kept here rather than in a test so the rule has a name.
 */
export function keepsHandleBounds(previous: NodeShape | undefined): boolean {
  return previous !== undefined && previous.measured.width !== undefined;
}