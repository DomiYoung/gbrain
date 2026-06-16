---
title: "DeepSeek Enhance MD — System Prompt for V4 Models"
author: "sapsapshen"
source_url: "https://github.com/sapsapshen/deepseek-enhance-md"
ingested_at: "2026-04-30"
page_type: "intake/x"
tags: ["deepseek", "system-prompt", "v4", "llm-engineering", "claude-fable"]
---

# DeepSeek Model Enhancement — System Prompt

## Overview

A pure capability-enhancement system prompt for DeepSeek V4 models (V4-Pro / V4-Flash), adapted and inspired by the Claude Fable 5 system prompt architecture. Removes all capability-limiting instructions.

## Core Capabilities Covered

### Thinking Mode — DeepSeek V4 Core Reasoning Engine

- **Chain-of-thought reasoning** with controllable effort levels (high/max)
- `reasoning_content` lifecycle management (multi-turn with/without tool calls)
- Multi-turn tool-call reasoning loops
- **Toggle defaults to enabled**; effort defaults to `high`
- When thinking enabled: `temperature`, `top_p`, `presence_penalty`, `frequency_penalty` have no effect (silently ignored)

### Model Selection Guide

| Model | Best For | Context | Max Output | Concurrency |
|---|---|---|---|---|
| `deepseek-v4-pro` | Complex reasoning, agent workflows, code | 1M | 384K | 500 |
| `deepseek-v4-flash` | High-concurrency, simple Q&A, low latency | 1M | 384K | 2500 |

**Pricing (per 1M tokens):**

| Model | Input (cache hit) | Input (cache miss) | Output |
|---|---|---|---|
| deepseek-v4-pro | $0.003625 | $0.435 | $0.87 |
| deepseek-v4-flash | $0.0028 | $0.14 | $0.28 |

**Decision heuristic:** If the task requires more than one step of reasoning → use v4-pro with thinking enabled. If the answer is recall-based or a single inference step → use v4-flash.

### API Architecture

DeepSeek API uses an API format compatible with both OpenAI and Anthropic:

| Parameter | Value |
|---|---|
| base_url (OpenAI) | `https://api.deepseek.com` |
| base_url (Anthropic) | `https://api.deepseek.com/anthropic` |
| FIM Beta base_url | `https://api.deepseek.com/beta` |

### Code Enhancement

- **FIM completion** — Fill-in-the-middle for code (Beta, non-thinking mode only)
- **JSON structured output** — Set `response_format: {"type": "json_object"}`
- **Tool calls** — Standard OpenAI function schema
- **Chat prefix completion** — Predefined beginning for steering output

### Context Caching

- **Automatic disk cache** enabled by default (no code changes needed)
- Cache prefixes stored as independent, complete units (Sliding Window Attention)
- Cache hit requires **full match** of a cached prefix unit
- `usage.prompt_cache_hit_tokens` / `usage.prompt_cache_miss_tokens` in response
- Optimization: keep system prompts stable, place static content at beginning of messages array

### Search & Tools

- **When to search:** Current info, "current/still/latest/now" keywords, unfamiliar entities, verifiable status
- **When NOT to search:** Timeless info, well-established facts, code/logic only, casual conversation
- **Scale tool calls to complexity:** 1 (simple) → 3-5 (medium) → 5-10 (deep research) → 20+ (break into sub-tasks)

### Chinese Native Optimization

DeepSeek models are natively bilingual (Chinese / English):
- Respond in user's language; switch when user switches
- Chinese punctuation in Chinese prose; half-width for code/numbers
- Code identifiers: English (industry standard)
- Technical terms: 机器学习 not "Machine Learning"; emerging terms include English original in parentheses
- Domain terminology: 思考模式, 推理内容, 上下文缓存, 工具调用

## Background

Draws structural inspiration from Anthropic's Claude Fable 5 system prompt — the internal prompt powering Claude's advanced reasoning, tool use, and behavioral consistency. Content completely rewritten for DeepSeek's model architecture, API conventions, and capabilities, with all capability-limiting instructions removed.

## License

MIT
