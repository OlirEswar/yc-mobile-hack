/**
 * The model client: one OpenAI-compatible chat completion over fetch, no SDK. Configured by the
 * deployment env: LLM_API_KEY (required), LLM_BASE_URL and LLM_MODEL (optional), and
 * LLM_REASONING_EFFORT for a reasoning model, which takes an effort instead of a temperature.
 * The default is OpenAI's gpt-6-luna with no reasoning (about 2 s per plan) and strict structured
 * output; any other base URL gets plain JSON mode, which every OpenAI-compatible provider supports.
 */

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-6-luna';
const DEFAULT_REASONING_EFFORT = 'none';
const TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 600;

export type ProviderConfig = { apiKey: string; baseUrl: string; model: string; provider: string; reasoningEffort?: string };

/** Null when no key is configured, so the world runs on rule-based plans alone. */
export function providerConfig(): ProviderConfig | null {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const host = new URL(baseUrl).hostname;
  const provider = host === 'api.openai.com' ? 'openai' : host.replace(/^api\./, '');
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  const reasoningEffort = process.env.LLM_REASONING_EFFORT || (model === DEFAULT_MODEL ? DEFAULT_REASONING_EFFORT : undefined);
  return { apiKey, baseUrl, model, provider, reasoningEffort };
}

export type ChatRequest = {
  system: string;
  user: string;
  maxTokens: number;
  /** JSON schema for strict structured output where the provider supports it. */
  schema?: { name: string; schema: Record<string, unknown> };
  temperature?: number;
};

export type ChatResult = { text: string; tokensIn: number; tokensOut: number; latencyMs: number };

/** A failed call. retryable is true for timeouts, 429 and 5xx. The message never holds the key. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** One completion with a 20 s timeout and a single retry on a retryable failure. */
export async function chat(config: ProviderConfig, request: ChatRequest): Promise<ChatResult> {
  try {
    return await chatOnce(config, request);
  } catch (error) {
    if (!(error instanceof ProviderError) || !error.retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return await chatOnce(config, request);
  }
}

async function chatOnce(config: ProviderConfig, request: ChatRequest): Promise<ChatResult> {
  const openai = config.provider === 'openai';
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : { temperature: request.temperature ?? 0.8 }),
    response_format:
      openai && request.schema
        ? { type: 'json_schema', json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema } }
        : { type: 'json_object' },
    [openai ? 'max_completion_tokens' : 'max_tokens']: request.maxTokens,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(config.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ProviderError(controller.signal.aborted ? 'timeout after ' + TIMEOUT_MS + ' ms' : 'network: ' + String(error).slice(0, 160), true);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200).replace(/sk-[\w-]+/g, 'sk-***');
    throw new ProviderError('HTTP ' + response.status + ' ' + detail, response.status === 429 || response.status >= 500);
  }
  const json = (await response.json()) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = json.choices?.[0]?.message;
  if (!message?.content) throw new ProviderError(message?.refusal ? 'refused: ' + message.refusal.slice(0, 120) : 'empty completion', false);
  return {
    text: message.content,
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}
