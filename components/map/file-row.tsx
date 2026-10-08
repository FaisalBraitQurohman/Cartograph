import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { MapRow } from "@/lib/graph/graph.ts";
import { useMapInteraction } from "./interaction";

/**
 * One file inside an open panel.
 *
 * It is a node in its own right rather than a line of text, because a row has
 * edges landing on it and a selectable thing has to be selectable. Selecting it
 * does the same thing selecting a box does.
 */
export type FileFlowNode = Node<MapRow, "file">;

export function FileRowView({ data }: NodeProps<FileFlowNode>) {
  const { selection, lit, hovered } = useMapInteraction();
  const dimmed = lit !== null && !lit.has(data.id);
  const chosen = selection === data.id;
  // Driven by the same shared state as the folder box, so a pointer over the row
  // on the map and a pointer over its path in the pane are one highlight.
  const pointed = hovered === data.id;

  return (
    <div
      className={`h-full w-full cursor-pointer rounded-[3px] border px-1.5 ${
        chosen ? "border-accent bg-accent/10" : "border-transparent hover:border-border"
      } ${pointed ? "ring-2 ring-accent/45" : ""}`}
      style={{ opacity: dimmed ? 0.38 : 1 }}
    >
      {/*
        A button for keyboard and screen-reader reasons only. React Flow's
        onNodeClick handles the pointer; a handler here too would run the same
        gesture twice and toggle the row on and off in one click.
      */}
      <button
        className="flex h-full w-full items-center gap-1.5 text-left"
        title={data.path}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] leading-none text-text">
          {data.label}
        </span>
        <span className="shrink-0 text-[9.5px] leading-none tabular-nums text-text-muted">
          {data.fanIn}
        </span>
      </button>

      <Handle className="!h-px !w-px !border-0 !bg-transparent" position={Position.Left} type="target" />
      <Handle className="!h-px !w-px !border-0 !bg-transparent" position={Position.Right} type="source" />
    </div>
  );
}