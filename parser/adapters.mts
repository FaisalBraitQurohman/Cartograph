import type { SourceFile } from "ts-morph";

/**
 * Framework knowledge enters through this boundary. Phase 03 intentionally has
 * one adapter: it makes no assumptions about where a route or entry point is.
 */
export interface ParserAdapter {
  name: string;
  isEntryPoint(sourceFile: SourceFile): boolean;
}

export const fallbackAdapter: ParserAdapter = {
  name: "fallback",
  isEntryPoint: () => false,
};