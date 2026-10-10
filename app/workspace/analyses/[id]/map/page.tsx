import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { loadAnalysisParse } from "@/lib/analysis-map";
import { MapWorkspace } from "@/components/map/map-workspace";
import { CoverageBanner } from "@/components/coverage-banner";

/**
 * The map for one stored analysis.
 *
 * This is the page the checked-in JSON used to feed. Nothing about the workspace
 * changed: `MapWorkspace` still takes a `RepositoryParseResult`, because the graph
 * maths is arithmetic over a file list and an edge list and has no idea where either
 * came from. `loadAnalysisParse` is the adapter that turns rows into that shape.
 *
 * A run that failed has no files, so there is no map to draw and the page says so
 * rather than rendering an empty graph, which would look like a repository with
 * nothing in it.
 */
export default async function AnalysisMapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await auth.protect();
  const { id } = await params;

  const parse = await loadAnalysisParse(id);

  if (parse.files.length === 0) {
    // Either it failed, or it is still running and has written nothing yet. Both are
    // states with a place to look, and neither is a map.
    notFound();
  }

  return (
    <div className="h-dvh">
      <MapWorkspace parse={parse} />
      <CoverageBanner
        resolved={parse.coverage.resolved}
        outside={parse.coverage.outside}
        excluded={parse.coverage.excluded}
        unresolved={parse.coverage.unresolved}
        filesParsed={parse.summary.filesParsed}
        filesFound={parse.summary.filesFound}
        filesSkipped={parse.summary.filesSkipped}
      />
    </div>
  );
}