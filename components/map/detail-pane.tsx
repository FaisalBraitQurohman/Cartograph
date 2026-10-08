"use client";

import { useMemo, useState } from "react";
import { describeDetail, LOOSE_FILES, type Detail, type FolderDetail, type RepositoryDetail } from "@/lib/graph/detail.ts";
import type { CategorySet } from "@/lib/graph/categories.ts";
import type { MapGraph } from "@/lib/graph/graph.ts";
import type { RepositoryParseResult } from "@/parser/types.mts";
import { PathList, FileName } from "./path-list";
import { kindFill } from "./swatches";

/**
 * The right-hand pane.
 *
 * Its resting state is the repository itself rather than a prompt to select
 * something, because most of what somebody wants to know about a codebase is a
 * property of the codebase, not of one file. Deselecting returns here.
 *
 * Two tabs. Structure is everything arithmetic can answer, and it is present from
 * the first render. Explanation is empty on purpose: nothing in this phase can
 * produce one, so the tab says so rather than showing a spinner for a request
 * that will never be made.
 *
 * Which tab is open is the pane's own state and lives above the selection, so
 * comparing explanations across three files does not mean reopening the tab three
 * times. Nothing here fetches — every figure is already in the browser.
 */

type Tab = "structure" | "explanation";

export function DetailPane({
  parse,
  categories,
  map,
  selection,
  hovered,
  onSelectPath,
  onHoverPath,
}: {
  parse: RepositoryParseResult;
  categories: CategorySet;
  map: MapGraph;
  selection: string | null;
  hovered: string | null;
  onSelectPath: (path: string) => void;
  onHoverPath: (path: string | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("structure");

  const detail = useMemo(
    () => describeDetail(parse, categories, map, selection),
    [parse, categories, map, selection],
  );

  return (
    <aside aria-label="Details" className="flex h-full w-[320px] shrink-0 flex-col border-l border-border">
      <div className="flex shrink-0 items-stretch border-b border-border" role="tablist">
        <TabButton chosen={tab === "structure"} label="Structure" onClick={() => setTab("structure")} />
        <TabButton chosen={tab === "explanation"} label="Explanation" onClick={() => setTab("explanation")} />
      </div>

      {/*
        The tab lives in this component's state rather than being derived from the
        selection, which is what makes it survive a change of selection. Deriving
        it — or keying this element on the selection — would reset it on every
        click, and someone comparing three files would reopen the tab three times.
      */}
      <div aria-label={tab === "structure" ? "Structure" : "Explanation"} className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
        {tab === "structure" ? (
          <Structure detail={detail} hovered={hovered} onHoverPath={onHoverPath} onSelectPath={onSelectPath} />
        ) : (
          <ExplanationEmpty />
        )}
      </div>
    </aside>
  );
}

function TabButton({ chosen, label, onClick }: { chosen: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-selected={chosen}
      className={`cursor-pointer border-b-2 px-3.5 py-2 text-[11px] ${
        chosen ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function Structure({
  detail,
  hovered,
  onHoverPath,
  onSelectPath,
}: {
  detail: Detail;
  hovered: string | null;
  onHoverPath: (path: string | null) => void;
  onSelectPath: (path: string) => void;
}) {
  if (detail.kind === "repository") {
    return <RepositoryStructure detail={detail} hovered={hovered} onHoverPath={onHoverPath} onSelectPath={onSelectPath} />;
  }
  if (detail.kind === "folder") return <FolderStructure detail={detail} />;
  return (
    <FileStructure detail={detail} hovered={hovered} onHoverPath={onHoverPath} onSelectPath={onSelectPath} />
  );
}

/**
 * The pane with nothing selected: what this repository is, what the rest of it
 * leans on, and where reading starts.
 */
function RepositoryStructure({
  detail,
  hovered,
  onHoverPath,
  onSelectPath,
}: {
  detail: RepositoryDetail;
  hovered: string | null;
  onHoverPath: (path: string | null) => void;
  onSelectPath: (path: string) => void;
}) {
  return (
    <div className="pb-6">
      <header className="border-b border-border px-3.5 py-3">
        <h2 className="truncate font-mono text-[13px] leading-5 text-text" title={detail.name}>
          {detail.name}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-text-muted">
          {detail.frameworks.length > 0 ? (
            detail.frameworks.map((framework) => (
              <span
                className="rounded-[2px] border border-border px-1.5 py-[1px]"
                key={framework.id}
                title={`${framework.fileCount} files import ${framework.specifiers.join(", ")}`}
              >
                {framework.label}
              </span>
            ))
          ) : (
            <span>No framework identified</span>
          )}
        </div>
      </header>

      <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
        <Figure label="files" value={detail.fileCount} />
        <Figure label="imports" value={detail.importCount} />
        {/*
          Routes are stated as not parsed rather than as zero. The parser does not
          extract them, so "0" would claim this repository has no routes when it
          only says nobody looked.
        */}
        <Figure label="routes" text="not parsed" />
      </div>

      <Section
        heading="Most depended on"
        note={`${shown(detail.mostImportedTotal, detail.mostImported.length)} of ${detail.mostImportedTotal} files something imports`}
      >
        <ol className="min-w-0">
          {detail.mostImported.map((file) => (
            <RankedRow
              figure={file.fanIn}
              hovered={hovered === file.path}
              key={file.path}
              path={file.path}
              onHover={onHoverPath}
              onSelect={onSelectPath}
            />
          ))}
        </ol>
      </Section>

      <Section
        heading="Nothing imports these"
        note={`${shown(detail.orphanTotal, detail.orphans.length)} of ${detail.orphanTotal} files nothing imports`}
      >
        <ol className="min-w-0">
          {detail.orphans.map((file) => (
            <RankedRow
              figure={file.fanOut}
              hovered={hovered === file.path}
              key={file.path}
              path={file.path}
              onHover={onHoverPath}
              onSelect={onSelectPath}
            />
          ))}
        </ol>
      </Section>

      {/*
        Coverage, and the unplaced count, in one place at the foot of the pane.
        Both are answers about how much of the repository the numbers above actually
        cover, so they sit with them rather than being filed away — and the
        unplaced count is the one figure here that says the grouping itself did not
        place every file.
      */}
      <p className="border-t border-border px-3.5 py-2 text-[10px] leading-[15px] text-text-muted">
        {detail.unplacedCount} files sit above the depth this groups at, so the grouping could not
        place them. {detail.skippedCount} of {detail.fileCount + detail.skippedCount} files found were
        skipped by the parser. {detail.externalImportCount} imports point outside the repository,{" "}
        {detail.unresolvedImportCount} could not be resolved.
      </p>
    </div>
  );
}

/**
 * A file's importer or importee, with the number that ranked it.
 *
 * The figure is right-aligned and tinted by direction, the same green and amber
 * the edges use. A list of what depends on this file and a list of what it depends
 * on are the two halves of the question, and they are not the same list.
 */
function RankedRow({
  figure,
  hovered,
  path,
  onHover,
  onSelect,
}: {
  figure: number;
  hovered: boolean;
  path: string;
  onHover: (path: string | null) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <li>
      <button
        className={`flex w-full items-baseline gap-2 border-l-2 px-3.5 py-[3px] text-left font-mono text-[10.5px] leading-[15px] ${
          hovered
            ? "border-accent/50 bg-accent/5 text-text"
            : "border-transparent text-text-muted hover:bg-surface-raised hover:text-text"
        }`}
        onBlur={() => onHover(null)}
        onClick={() => onSelect(path)}
        onFocus={() => onHover(path)}
        onMouseEnter={() => onHover(path)}
        onMouseLeave={() => onHover(null)}
        title={path}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">
          <FileName path={path} />
        </span>
        <span className="shrink-0 tabular-nums">{figure}</span>
      </button>
    </li>
  );
}

function FileStructure({
  detail,
  hovered,
  onHoverPath,
  onSelectPath,
}: {
  detail: Extract<Detail, { kind: "file" }>;
  hovered: string | null;
  onHoverPath: (path: string | null) => void;
  onSelectPath: (path: string) => void;
}) {
  return (
    <div className="pb-6">
      <header className="border-b border-border px-3.5 py-3">
        <h2 className="break-all font-mono text-[12px] leading-[17px] text-text">{detail.path}</h2>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-text-muted">
          <span
            aria-hidden="true"
            className={`h-[9px] w-[9px] shrink-0 rounded-[2px] ${kindFill(detail.category.swatch)}`}
          />
          <span className="truncate" title={detail.category.label}>
            {detail.category.label}
          </span>
        </div>
      </header>

      <dl className="grid grid-cols-3 gap-px border-b border-border bg-border text-[10px]">
        <Cell label="lines" value={detail.lines} />
        <Cell label="depends on" value={detail.imports.length} tone="outgoing" />
        <Cell label="depended on" value={detail.importedBy.length} tone="incoming" />
      </dl>

      {/*
        The counts come off the arrays rendered underneath them, in the same
        render, so a figure that disagrees with its own list is not reachable.
      */}
      <Section
        heading="Depends on"
        note={detail.imports.length === 0 ? null : `${detail.imports.length} files`}
      >
        <PathList hovered={hovered} items={detail.imports} onHover={onHoverPath} onSelect={onSelectPath} />
      </Section>

      <Section
        heading="Depended on by"
        note={detail.importedBy.length === 0 ? null : `${detail.importedBy.length} files`}
      >
        <PathList hovered={hovered} items={detail.importedBy} onHover={onHoverPath} onSelect={onSelectPath} />
      </Section>
    </div>
  );
}

/**
 * A folded folder: what kinds of file are in it, and how many of each.
 *
 * No import list, because a box is not a file. The composition is the thing worth
 * reading here, and the folder's own fan-in and fan-out are already on the box on
 * the map.
 */
function FolderStructure({ detail }: { detail: FolderDetail }) {
  return (
    <div className="pb-6">
      <header className="border-b border-border px-3.5 py-3">
        <h2 className="break-all font-mono text-[12px] leading-[17px] text-text">
          {detail.path === "." ? "repository root" : detail.path}
        </h2>
      </header>

      <dl className="grid grid-cols-3 gap-px border-b border-border bg-border text-[10px]">
        <Cell label="files" value={detail.fileCount} />
        <Cell label="lines" value={detail.lines} />
        <Cell
          label="internal imports"
          value={detail.internalEdgeCount}
          title="Imports between files inside this folder. A collapsed box cannot draw them, because both ends would be the same node."
        />
      </dl>

      {/*
        How the folder divides up, by its own subfolders rather than by category.
        The categories group the whole repository at one depth, so a folder inside
        one of them is entirely that category — which made this list a single row
        for 21 of the 23 folders here, answering nothing. These are the folder's own
        parts, so no swatch is shown: a hue on this screen means a category, and
        this is not one.
      */}
      <Section
        heading="Inside"
        note={detail.parts.length === 1 ? "one part" : `${detail.parts.length} parts`}
      >
        <ul className="min-w-0">
          {detail.parts.map((part) => (
            <li
              className="flex items-baseline gap-2 px-3.5 py-[3px] font-mono text-[10.5px] leading-[15px] text-text-muted"
              key={part.id}
            >
              <span className="min-w-0 flex-1 truncate" title={part.id === LOOSE_FILES ? part.label : `${detail.path}/${part.id}`}>
                {part.label}
              </span>
              <span className="shrink-0 tabular-nums">{part.fileCount}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/**
 * Explanation, before anything can produce one.
 *
 * This says the reason rather than inviting a click that would do nothing. When a
 * model call fills this tab, the request happens here; until then there is nothing
 * to fetch and no spinner to imply otherwise.
 */
function ExplanationEmpty() {
  return (
    <div className="px-3.5 py-6">
      <h2 className="text-[11px] font-medium text-text">Nothing written yet</h2>
      <p className="mt-1.5 text-[10.5px] leading-[15px] text-text-muted">
        An explanation is written from this file&rsquo;s contents and its real neighbours, and
        nothing in this phase calls a model. Structure above is arithmetic over the parse and is
        already correct; this tab is where a written explanation will appear.
      </p>
    </div>
  );
}

function Section({ heading, note, children }: { heading: string; note?: string | null; children: React.ReactNode }) {
  return (
    <section className="border-b border-border">
      <div className="flex items-baseline justify-between gap-2 px-3.5 py-2">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">{heading}</h3>
        {note ? <span className="shrink-0 text-[9.5px] tabular-nums text-text-muted">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** How many of a total a list is showing. Says "all" when nothing was cut. */
function shown(total: number, listed: number): string {
  return total === listed ? "all" : `${listed}`;
}

function Figure({ label, text, title, value }: { label: string; text?: string; title?: string; value?: number }) {
  return (
    <div className="bg-surface px-3.5 py-2" title={title}>
      <div className="text-[16px] leading-5 tabular-nums text-text">{text ?? value}</div>
      <div className="mt-0.5 text-[9.5px] leading-3 text-text-muted">{label}</div>
    </div>
  );
}

function Cell({
  label,
  title,
  tone,
  value,
}: {
  label: string;
  title?: string;
  tone?: "incoming" | "outgoing";
  value: number;
}) {
  return (
    <div className="bg-surface px-3.5 py-2" title={title}>
      <div className={`text-[13px] leading-4 tabular-nums ${tone === "incoming" ? "text-incoming" : tone === "outgoing" ? "text-outgoing" : "text-text"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[9.5px] leading-3 text-text-muted">{label}</div>
    </div>
  );
}
