/**
 * Leaf module holding the default embedding model + dimensions.
 *
 * Extracted so schema helpers (pglite-schema.ts, postgres-engine.ts) +
 * registry helpers (search/embedding-column.ts) can import the constants
 * without pulling the full AI gateway (which loads every provider SDK).
 *
 * gateway.ts re-exports these so existing import sites keep working.
 *
 * Single source of truth for "what does a fresh brain look like when the
 * user passes zero flags?" Touching these defaults touches every fresh
 * install AND every doctor consistency check.
 */

// Domi fork default: production standardized on DashScope text-embedding-v4
// at 1536 dimensions. Keep defaults aligned with runtime config so chunk
// upserts do not rewrite content_chunks.model back to zeroentropyai:zembed-1.
export const DEFAULT_EMBEDDING_MODEL = 'dashscope:text-embedding-v4';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
