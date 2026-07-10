import type { Recipe } from '../types.ts';

/**
 * Alibaba DashScope (灵积). OpenAI-compatible /embeddings and /chat/completions
 * endpoints at dashscope-intl.aliyuncs.com. Hosts text-embedding-v2/v3/v4 for
 * embeddings, and qwen3.7-max/qwen3.7-plus for chat.
 *
 * Reference: https://help.aliyun.com/zh/model-studio/getting-started/
 *
 * Note: the international endpoint requires a region-aware DASHSCOPE_API_KEY.
 * China-region users typically point at https://dashscope.aliyuncs.com/...
 * via cfg.base_urls['dashscope']. v0.32 ships with the international
 * default; users override per the recipe convention.
 */
export const dashscope: Recipe = {
  id: 'dashscope',
  name: 'Alibaba DashScope (灵积)',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  base_url_default: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  auth_env: {
    required: ['DASHSCOPE_API_KEY'],
    setup_url: 'https://help.aliyun.com/zh/model-studio/getting-started/',
  },
  touchpoints: {
    embedding: {
      models: ['text-embedding-v4', 'text-embedding-v3', 'text-embedding-v2'],
      default_dims: 1024,
      // text-embedding-v4 supports 2048/1536/1024/768/512/256/128/64
      // text-embedding-v3 supports 1024/768/512/256/128/64
      // text-embedding-v2 fixed 1536
      dims_options: [64, 128, 256, 512, 768, 1024, 1536, 2048],
      // Alibaba doesn't publish a hard batch-token cap for the OpenAI-compat
      // path. Conservative declaration so the gateway pre-splits before
      // hitting whatever undocumented server-side limit exists.
      max_batch_tokens: 8192,
      // text-embedding-v3/v4 mix English + CJK heavily; the tokenizer is
      // closer to Voyage density than OpenAI tiktoken for CJK-dominant
      // content. Conservative chars_per_token=2 leaves headroom.
      chars_per_token: 2,
    },
    chat: {
      models: [
        'qwen3.7-max-2026-06-08',
        'qwen3.7-max-2026-05-26',
        'qwen3.7-plus-2026-05-26',
        'qwen3.7-plus',
        'qwen3.7-max-preview',
        'qwen3.7-max-2026-05-17',
        'qwen3.7-max-2026-05-20',
        'qwen-max',
        'qwen-plus',
        'qwen-turbo',
      ],
      supports_tools: true,
      supports_subagent_loop: true,
      supports_prompt_cache: false,
      max_context_tokens: 128000,
      cost_per_1m_input_usd: 0.5, // estimated
      cost_per_1m_output_usd: 2.0,
      price_last_verified: '2026-07-10',
    },
  },
  setup_hint:
    'Get an API key at https://help.aliyun.com/zh/model-studio/getting-started/, then `export DASHSCOPE_API_KEY=...`',
};
