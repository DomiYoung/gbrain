import type { Recipe } from '../types.ts';
import { deepseekReasoningContentCompatFetch } from './deepseek.ts';

/**
 * Ziggie Airouter exposes an OpenAI-compatible endpoint. Hermes uses it as a
 * first-class provider instead of spoofing DeepSeek's provider id with a custom
 * base URL: model ids must keep provenance (`ziggie:...`) so config, pricing,
 * budget checks, and provider diagnostics all describe the real route.
 *
 * The currently pinned GBrain-safe models are the DeepSeek V4 pair because
 * their wire shape and pricing match the existing DeepSeek integration. Ziggie
 * may expose more models at `/v1/models`; add them here only when their pricing
 * and tool/structured-output behavior are verified for GBrain workloads.
 */
export const ziggie: Recipe = {
  id: 'ziggie',
  name: 'Ziggie Airouter',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  base_url_default: 'https://airouter.ziggie.cn/v1',
  auth_env: {
    required: ['ZIGGIE_API_KEY'],
    optional: ['HERMES_PROVIDER_ZIGGIE_AIROUTER_API_KEY', 'ZIGGIE_BASE_URL'],
    setup_url: 'https://airouter.ziggie.cn/',
  },
  touchpoints: {
    expansion: {
      models: ['deepseek-v4-flash'],
      cost_per_1m_tokens_usd: 0.14,
      price_last_verified: '2026-08-01',
    },
    chat: {
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      supports_tools: true,
      supports_subagent_loop: true,
      supports_prompt_cache: false,
      max_context_tokens: 1_000_000,
      cost_per_1m_input_usd: 0.14,
      cost_per_1m_output_usd: 0.28,
      price_last_verified: '2026-08-01',
    },
  },
  setup_hint:
    'Set `ZIGGIE_API_KEY` (or Hermes `HERMES_PROVIDER_ZIGGIE_AIROUTER_API_KEY`) and use models like `ziggie:deepseek-v4-flash`.',
  compat: { fetch: deepseekReasoningContentCompatFetch },
};
