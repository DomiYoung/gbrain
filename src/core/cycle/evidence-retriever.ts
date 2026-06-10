/**
 * evidence-retriever.ts — hybrid-search evidence retriever for grade_take
 *
 * Replaces the v0.36.1.0 stub defaultEvidenceRetriever with real
 * keyword + vector hybrid search over GBrain content chunks.
 *
 * Strategy:
 *   1. Keyword search (tokenmax mode) → top-3 chunks
 *   2. Vector search (embedding similarity) → top-2 chunks
 *   3. Dedup by chunk_id, format into evidence block
 *   4. since_date filter: only pages updated AFTER the take was created
 *      (prevents "prophecy" — using future evidence to judge past claims)
 */

import type { BrainEngine, Take } from "../engine.ts";
import type { SearchResult } from "../types.ts";
import type { ScopedReadOpts } from "./base-phase.ts";
import { embedOne } from "../ai/gateway.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceRetrieverOpts {
  /** Max keyword results to fetch (default 3) */
  keywordLimit?: number;
  /** Max vector results to fetch (default 2) */
  vectorLimit?: number;
  /** Max total evidence chunks after dedup (default 5) */
  maxTotal?: number;
  /** Search mode for keyword search (default 'tokenmax') */
  searchMode?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable evidence block from a chunk.
 */
function buildEvidenceBlock(chunk: SearchResult, source: "keyword" | "vector", rank: number): string {
  const score = chunk.score ? `Score:${chunk.score.toFixed(2)}` : "Score:—";
  const slug = chunk.slug ?? "unknown";
  const sourceLine = `${slug}#chunk-${chunk.chunk_index ?? chunk.chunk_id ?? "?"}`;
  const title = chunk.title ? `Title: ${chunk.title}\n` : "";
  const effectiveDate = chunk.effective_date ? `Effective date: ${chunk.effective_date}\n` : "";

  let context = `${title}${effectiveDate}${chunk.chunk_text ?? ""}`;
  // Trim to reasonable length — judge gets the gist, not the full page
  if (context.length > 600) {
    context = context.slice(0, 600) + "…";
  }

  return [
    `[${source}#${rank}] ${sourceLine} | ${score}`,
    context,
  ].join("\n");
}

/**
 * Format deduped chunks into a single evidence string for the judge prompt.
 */
function formatEvidence(chunks: Array<{ chunk: SearchResult; source: "keyword" | "vector"; rank: number }>): string {
  if (chunks.length === 0) {
    return "[evidence retrieval: no relevant pages found in brain]";
  }

  const header = `[evidence retrieved ${new Date().toISOString().slice(0, 10)}]`;
  const blocks = chunks.map((c, i) => `\n--- Evidence ${i + 1} ---\n${buildEvidenceBlock(c.chunk, c.source, c.rank)}`);
  return header + blocks.join("");
}

// ---------------------------------------------------------------------------
// Main retriever
// ---------------------------------------------------------------------------

/**
 * Create a hybrid-search evidence retriever bound to a BrainEngine instance.
 *
 * Returns a function matching the EvidenceRetrieverFn signature:
 *   (take: Take, scope: ScopedReadOpts) => Promise<string>
 *
 * Usage:
 *   const retriever = createHybridEvidenceRetriever(engine, opts);
 *   // Pass as opts.evidenceRetriever to runPhaseGradeTakes
 */
export function createHybridEvidenceRetriever(
  engine: BrainEngine,
  opts: EvidenceRetrieverOpts = {},
): (take: Take, _scope: ScopedReadOpts) => Promise<string> {
  const keywordLimit = opts.keywordLimit ?? 3;
  const vectorLimit = opts.vectorLimit ?? 2;
  const maxTotal = opts.maxTotal ?? 5;
  const searchMode = opts.searchMode ?? "tokenmax";

  return async (take: Take, _scope: ScopedReadOpts): Promise<string> => {
    const query = take.claim;
    if (!query || query.trim().length === 0) {
      return "[evidence retrieval: take has no claim text]";
    }

    // Build since_date filter — only pages created/updated AFTER the take
    const since = take.since_date
      ? new Date(take.since_date).toISOString().slice(0, 10)
      : undefined;

    const searchOpts: Record<string, unknown> = {
      limit: Math.max(keywordLimit, vectorLimit),
      mode: searchMode,
    };
    if (since) {
      searchOpts.since = since;
    }

    try {
      // Phase 1: keyword search
      const kwResults: SearchResult[] = await engine.searchKeyword(query, searchOpts as any);
      if (process.env.GBRAIN_DEBUG_EVIDENCE) console.error(`[evidence] keyword: ${kwResults.length} results for "${query.slice(0, 60)}"`);

      // Phase 2: vector search (best-effort — embedding may not exist)
      let vecResults: SearchResult[] = [];
      try {
        const embedding = await embedOne(query);
        vecResults = await engine.searchVector(embedding, {
          limit: vectorLimit,
          ...(since ? { since } : {}),
        } as any);
      } catch {
        // Vector search is optional — keyword alone is usually sufficient
      }

      // Phase 3: dedup by chunk_id (or slug + start_line as fallback)
      const seen = new Set<string>();
      const merged: Array<{ chunk: SearchResult; source: "keyword" | "vector"; rank: number }> = [];

      const addChunk = (chunk: SearchResult, source: "keyword" | "vector", rank: number) => {
        const key = (chunk as any).chunk_id
          ?? `${chunk.slug ?? ""}:${chunk.chunk_index ?? 0}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push({ chunk, source, rank });
      };

      kwResults.forEach((c, i) => addChunk(c, "keyword", i + 1));
      vecResults.forEach((c, i) => addChunk(c, "vector", i + 1));

      // Phase 4: sort by score descending, cap at maxTotal
      merged.sort((a, b) => (b.chunk.score ?? 0) - (a.chunk.score ?? 0));
      const capped = merged.slice(0, maxTotal);

      return formatEvidence(capped);
    } catch (err) {
      return `[evidence retrieval error: ${err instanceof Error ? err.message : String(err)}]`;
    }
  };
}
