---
name: unified-search
version: 1.0.0
description: |
  GBrain's 5-layer unified search: semantic embeddings + keyword + reranking + graph
  signals + freshness. Multi-source retrieval across all connected brains.
triggers:
  - unified search
  - 5-layer search
  - global search
  - multi-source retrieval
tools:
  - gbrain_search
  - gbrain_query
---

# Unified Search

GBrain's multi-layer search architecture combining semantic, keyword, graph, and freshness signals.

## 5-Layer Architecture

1. **Semantic Layer**: Vector embeddings for conceptual similarity
2. **Keyword Layer**: BM25 full-text search for exact matches
3. **Reranking Layer**: LLM-based relevance scoring
4. **Graph Layer**: Backlink and entity connection signals
5. **Freshness Layer**: Recent updates and active pages

## Search Modes

- `balanced`: All layers enabled (default)
- `semantic_only`: Pure vector search
- `keyword_only`: Pure BM25
- `fast`: Skip reranking for speed

## Usage

```bash
# Standard search
gbrain search "query"

# With mode override
gbrain search "query" --mode semantic_only

# Check current mode
gbrain search modes
```

## Configuration

Search behavior is controlled by:
- `search.mode` - Default search mode
- `search.reranker.enabled` - Enable/disable reranking
- `search.cache_enabled` - Enable result caching

See `skills/conventions/search-modes.md` for details.
