import preview from "@/data/preview/vuejs-devtools.json";
import { MapWorkspace } from "@/components/map/map-workspace";
import { validateRepositoryParseResult } from "@/parser/validate-result.mts";

/**
 * The map, drawn from a real parse of a real repository that is checked into the
 * project as a typed data file.
 *
 * This route exists so the interface can be built and looked at without an
 * account, a database or a network. Once analyses are stored properly this page
 * goes away and the same workspace renders whatever the query returned — the
 * shell does not change with it.
 *
 * vuejs/devtools at v3.5.43: 215 parsed source files across 59 folders, chosen
 * because a repository of a couple of dozen files would make the folding look
 * like it works without having been tested.
 */
export default function PreviewPage() {
  // The data file is a contract, not a convenience. If it stops being one, the
  // map would draw a plausible picture of nothing, so this fails loudly instead.
  if (!validateRepositoryParseResult(preview)) {
    throw new Error(
      "data/preview/vuejs-devtools.json no longer satisfies the parser's typed " +
        "data contract. Re-run: pnpm parse:repo <path> --out data/preview/vuejs-devtools.json",
    );
  }

  return (
    <div className="h-dvh">
      <MapWorkspace parse={preview} />
    </div>
  );
}