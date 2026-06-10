/**
 * evidence-retriever.ts — hybrid-search evidence retriever for grade_take
 *
 * Replaces the v0.36.1.0 stub defaultEvidenceRetriever with real
 * keyword + vector hybrid search over GBrain content chunks.
 *
 * Strategy:
 *   1. Vector search (embedding similarity) → top-6 chunks (primary path;
 *      works for Chinese claims where Postgres english FTS returns 0 hits)
 *   2. Keyword search (tokenmax mode) → top-2 chunks (precision boost for
 *      English/code-ish claims)
 *   3. Dedup by chunk_id, format into evidence block
 *   4. since_date filter: only pages updated AFTER the take was created
 *      (prevents "prophecy" — using future evidence to judge past claims)
 */

import type { BrainEngine, Take } from "../engine.ts";
import type { Chunk, SearchResult } from "../types.ts";
import type { ScopedReadOpts } from "./base-phase.ts";
import { embedOne } from "../ai/gateway.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceRetrieverOpts {
  /** Max origin-page chunks to include (default 2) */
  originLimit?: number;
  /** Max vector results to fetch (default 6) — primary path for Chinese claims */
  vectorLimit?: number;
  /** Max keyword results to fetch (default 2) — precision boost for English/code */
  keywordLimit?: number;
  /** Max total evidence chunks after dedup (default 8) */
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
function buildEvidenceBlock(chunk: SearchResult, source: "keyword" | "vector" | "origin", rank: number): string {
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
function formatEvidence(chunks: Array<{ chunk: SearchResult; source: "keyword" | "vector" | "origin"; rank: number }>): string {
  if (chunks.length === 0) {
    return "[evidence retrieval: no relevant pages found in brain]";
  }

  const header = `[evidence retrieved ${new Date().toISOString().slice(0, 10)}]`;
  const blocks = chunks.map((c, i) => `\n--- Evidence ${i + 1} ---\n${buildEvidenceBlock(c.chunk, c.source, c.rank)}`);
  return header + blocks.join("");
}

/** Score a chunk from the take's own page against the claim text. */
function originChunkScore(claim: string, chunkText: string): number {
  const claimTokens = Array.from(claim.matchAll(/[\p{Script=Han}A-Za-z0-9_\-]{2,}/gu)).map((m) => m[0]);
  if (claimTokens.length === 0) return 0;
  const hits = claimTokens.filter((t) => chunkText.includes(t)).length;
  return hits / claimTokens.length;
}

function chunkToSearchResult(chunk: Chunk, take: Take, title: string | undefined, score: number): SearchResult {
  return {
    slug: take.page_slug,
    page_id: take.page_id,
    title: title ?? take.page_slug,
    type: 'note' as SearchResult['type'],
    chunk_text: chunk.chunk_text,
    chunk_source: chunk.chunk_source === 'fenced_code' ? 'compiled_truth' : chunk.chunk_source,
    chunk_id: chunk.id,
    chunk_index: chunk.chunk_index,
    score,
    stale: false,
  };
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
  const originLimit = opts.originLimit ?? 2;
  const vectorLimit = opts.vectorLimit ?? 6;
  const keywordLimit = opts.keywordLimit ?? 2;
  const maxTotal = opts.maxTotal ?? 8;
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

    try {
      // Phase 0: origin page context. This anchors the judge in the page where
      // the take was authored before adding cross-page retrieval evidence.
      let originResults: SearchResult[] = [];
      try {
        const page = await engine.getPage(take.page_slug, _scope);
        if (page) {
          const chunks = await engine.getChunks(take.page_slug, { sourceId: page.source_id });
          originResults = chunks
            .map((chunk) => ({ chunk, score: originChunkScore(query, chunk.chunk_text) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, originLimit)
            .map(({ chunk, score }) => chunkToSearchResult(chunk, take, page.title, score));
        }
        if (process.env.GBRAIN_DEBUG_EVIDENCE) {
          console.error(`[evidence] origin: ${originResults.length} chunks for ${take.page_slug}`);
        }
      } catch (err) {
        if (process.env.GBRAIN_DEBUG_EVIDENCE) {
          console.error(`[evidence] origin page failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Phase 1: vector search (PRIMARY — works for Chinese claims where
      // Postgres english FTS returns 0 hits)
      let vecResults: SearchResult[] = [];
      try {
        const embedding = await embedOne(query);
        vecResults = await engine.searchVector(embedding, {
          limit: vectorLimit,
          ...(since ? { since } : {}),
        } as any);
        if (process.env.GBRAIN_DEBUG_EVIDENCE) {
          console.error(`[evidence] vector: ${vecResults.length} results for "${query.slice(0, 60)}"`);
        }
      } catch (err) {
        if (process.env.GBRAIN_DEBUG_EVIDENCE) {
          console.error(`[evidence] vector search failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Phase 2: keyword search (best-effort — precision boost for English/code)
      let kwResults: SearchResult[] = [];
      try {
        const searchOpts: Record<string, unknown> = {
          limit: keywordLimit,
          mode: searchMode,
        };
        if (since) {
          searchOpts.since = since;
        }
        kwResults = await engine.searchKeyword(query, searchOpts as any);
        if (process.env.GBRAIN_DEBUG_EVIDENCE) {
          console.error(`[evidence] keyword: ${kwResults.length} results for "${query.slice(0, 60)}"`);
        }
      } catch (err) {
        if (process.env.GBRAIN_DEBUG_EVIDENCE) {
          console.error(`[evidence] keyword search failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Phase 3: dedup by chunk_id (or slug + chunk_index as fallback)
      const seen = new Set<string>();
      const merged: Array<{ chunk: SearchResult; source: "keyword" | "vector" | "origin"; rank: number }> = [];

      const addChunk = (chunk: SearchResult, source: "keyword" | "vector" | "origin", rank: number) => {
        const key = (chunk as any).chunk_id
          ?? `${chunk.slug ?? ""}:${chunk.chunk_index ?? 0}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push({ chunk, source, rank });
      };

      // Origin first (source context), then vector (primary), then keyword (secondary)
      originResults.forEach((c, i) => addChunk(c, "origin", i + 1));
      vecResults.forEach((c, i) => addChunk(c, "vector", i + 1));
      kwResults.forEach((c, i) => addChunk(c, "keyword", i + 1));

      // Phase 4: sort by score descending, cap at maxTotal
      merged.sort((a, b) => (b.chunk.score ?? 0) - (a.chunk.score ?? 0));
      const capped = merged.slice(0, maxTotal);

      return formatEvidence(capped);
    } catch (err) {
      return `[evidence retrieval error: ${err instanceof Error ? err.message : String(err)}]`;
    }
  };
}
