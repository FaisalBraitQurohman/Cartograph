import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { PANEL_FOOTER_HEIGHT, PANEL_HEADER_HEIGHT, PANEL_ROW_HEIGHT, type MapFolder } from "@/lib/graph/graph.ts";
import { useMapInteraction } from "./interaction";

/**
 * A folder on the canvas: a closed box, or a panel once it has been opened.
 *
 * Both are the same object in the same place. Opening fills the border with rows
 * rather than scattering files across the canvas, so the map does not rearrange
 * itself around one click.
 *
 * Height is not decoration. A closed box is as tall as the number of folders
 * that depend on it, and as wide as its label needs, so a long name never also
 * reads as an important folder.
 */
export type FolderFlowNode = Node<MapFolder, "folder">;

export function FolderNodeView({ data }: NodeProps<FolderFlowNode>) {
  const { selection, lit, hovered, scrollPanel } = useMapInteraction();
  const dimmed = lit !== null && !lit.has(data.id);
  const chosen = selection === data.id;
  // A hover is a ring, never a colour change. Colour on this map means kind or
  // direction, and borrowing either of those for a pointer position would say
  // something about the folder that isn't true.
  const pointed = hovered === data.id;

  return (
    <div
      aria-label={data.path}
      className={`h-full w-full rounded-[4px] border bg-surface-raised ${
        chosen ? "border-accent" : "border-border"
      } ${pointed ? "ring-2 ring-accent/45" : ""}`}
      style={{ opacity: dimmed ? 0.38 : 1 }}
    >
      {data.open ? <PanelHeader data={data} /> : <ClosedBox data={data} />}

      {data.open ? <PanelFooter data={data} onScroll={(by) => scrollPanel(data.id, by)} /> : null}

      <Handle className="!h-px !w-px !border-0 !bg-transparent" position={Position.Left} type="target" />
      <Handle className="!h-px !w-px !border-0 !bg-transparent" position={Position.Right} type="source" />
    </div>
  );
}

/**
 * What a panel's header has to carry: the folder's name, how many files are in
 * it, and its fan-in and fan-out. Clicking it puts the folder back to being one
 * closed box.
 */
function PanelHeader({ data }: { data: MapFolder }) {
  return (
    <header className="border-b border-border px-2 pb-1 pt-1.5" style={{ height: PANEL_HEADER_HEIGHT }}>
      {/*
        A button for its keyboard behaviour and its role for a screen reader, not
        for the click: React Flow's onNodeClick is what handles the pointer, and
        a handler here as well would run the same gesture twice.
      */}
      <button className="block w-full cursor-pointer text-left" title={`Close ${data.path}`} type="button">
        <span className="block truncate font-mono text-[11px] leading-3 text-text">{data.label}</span>
        <span className="mt-[3px] flex items-baseline gap-2.5 text-[10px] leading-3 tabular-nums">
          <span className="text-text-muted">{data.fileCount} files</span>
          <span className="text-incoming" title={`${data.fanIn} folders depend on it`}>
            ←{data.fanIn}
          </span>
          <span className="text-outgoing" title={`Depends on ${data.fanOut} folders`}>
            {data.fanOut}-&gt;
          </span>
        </span>
      </button>
    </header>
  );
}

/**
 * A closed box shows the same three numbers an open panel's header does, because
 * those are what the box is for: how much is in it, how many folders depend on
 * it, and how many it depends on. The arrows are the direction, which is the
 * one thing colour on an edge cannot say while nothing is selected.
 */
function ClosedBox({ data }: { data: MapFolder }) {
  return (
    <button
      className="flex h-full w-full cursor-pointer flex-col justify-center px-2.5 text-left"
      title={`Open ${data.path} — ${data.fileCount} files, ${data.fanIn} folders depend on it, it depends on ${data.fanOut}`}
      type="button"
    >
      <span className="truncate font-mono text-[11px] leading-3 text-text">{data.label}</span>
      <span className="mt-[3px] flex items-baseline gap-1.5 text-[10px] leading-3 tabular-nums">
        <span className="text-text-muted">{data.fileCount} files</span>
        <span className="text-incoming" title={`${data.fanIn} folders depend on it`}>
          ←{data.fanIn}
        </span>
        <span className="text-outgoing" title={`Depends on ${data.fanOut} folders`}>
          {data.fanOut}→
        </span>
      </span>
    </button>
  );
}

/**
 * The panel's scrollbar and its count of what is off screen.
 *
 * The rows are real nodes on the canvas rather than lines of text in here, so
 * this cannot be an `overflow: auto` div — those nodes live outside this
 * element. Scrolling moves which rows are on screen instead, and this is the
 * control for it.
 *
 * The count of hidden files stays true whatever the scroll position, because
 * "there are more files than you can see here" stops being the useful thing to
 * say the moment you scroll.
 */
function PanelFooter({
  data,
  onScroll,
}: {
  data: MapFolder;
  onScroll: (by: number) => void;
}) {
  if (data.hiddenRowCount === 0 && data.scrollableBy === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 border-t border-border px-1.5"
      style={{ height: PANEL_FOOTER_HEIGHT }}
    >
      <ScrollStep disabled={data.scroll === 0} label="Scroll up" onClick={() => onScroll(-1)} />
      <ScrollStep
        disabled={data.scroll >= data.scrollableBy}
        flip
        label="Scroll down"
        onClick={() => onScroll(1)}
      />
      <span className="min-w-0 flex-1 truncate text-[9.5px] leading-3 text-text-muted">
        {data.hiddenRowCount === 0 ? "scrolled" : `${data.hiddenRowCount} more not shown`}
      </span>
    </div>
  );
}

function ScrollStep({
  disabled,
  label,
  onClick,
  flip,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  flip?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className="nodrag flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[2px] text-text-muted hover:bg-surface hover:text-text disabled:cursor-default disabled:opacity-30"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={label}
      type="button"
    >
      <svg
        aria-hidden="true"
        className={`h-2.5 w-2.5 ${flip ? "rotate-180" : ""}`}
        viewBox="0 0 10 10"
        fill="none"
      >
        <path
          d="M2.5 6.25 5 3.75l2.5 2.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.25"
        />
      </svg>
    </button>
  );
}

export { PANEL_ROW_HEIGHT };