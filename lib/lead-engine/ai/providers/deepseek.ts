// TASK 016: DeepSeek provider (spec §28). Generalized from the extraction
// client: native fetch, env-driven config, timeout, bounded retries and
// normalized errors. No CRM/ICP/scoring knowledge lives here.

import type { z } from "zod"
import { parseStructured } from "@/lib/lead-engine/ai/parse"
import { AIError } from "@/lib/lead-engine/ai/types"
import type { AIGenerateRequest, AIGenerateResult, AIProvider } from "@/lib/lead-engine/ai/types"

export interface DeepSeekProviderConfig {
  apiKey?: string
  model?: string
  baseUrl?: string
  timeoutMs?: number
  maxRetries?: number
  retryBaseMs?: number
  fetchFn?: typeof fetch
}

const MAX_OUTPUT_TOKENS = 8192
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504])

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class DeepSeekProvider implements AIProvider {
  readonly configured: boolean
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly retryBaseMs: number
  private readonly fetchFn: typeof fetch

  constructor(config: DeepSeekProviderConfig = {}) {
    this.apiKey = (config.apiKey ?? process.env.AI_API_KEY)?.trim() ?? ""
    this.model = (config.model ?? process.env.AI_MODEL)?.trim() || "deepseek-chat"
    this.baseUrl = (config.baseUrl ?? process.env.AI_BASE_URL)?.trim() || "https://api.deepseek.com"
    this.timeoutMs = config.timeoutMs ?? 60_000
    this.maxRetries = config.maxRetries ?? 2
    this.retryBaseMs = config.retryBaseMs ?? 500
    this.fetchFn = config.fetchFn ?? fetch
    this.configured = Boolean(this.apiKey)
  }

  private assertConfigured(): void {
    if (!this.apiKey) throw new AIError("AI_CONFIGURATION_ERROR", "AI_API_KEY is not configured")
  }

  private statusError(status: number): AIError {
    if (status === 401 || status === 403) {
      return new AIError("AI_AUTHENTICATION_ERROR", `AI provider authentication failed (HTTP ${status})`)
    }
    if (status === 429) {
      return new AIError("AI_RATE_LIMITED", "AI provider rate limit exceeded (HTTP 429)", true)
    }
    if (TRANSIENT_STATUSES.has(status)) {
      return new AIError("AI_PROVIDER_ERROR", `AI provider error (HTTP ${status})`, true)
    }
    return new AIError("AI_PROVIDER_ERROR", `AI provider error (HTTP ${status})`)
  }

  private async fetchCompletion(payload: Record<string, unknown>): Promise<AIGenerateResult> {
    let response: Response
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      if (isAbortError(e)) throw new AIError("AI_TIMEOUT", "AI request timed out", true)
      throw new AIError("AI_NETWORK_ERROR", "AI network error", true)
    }

    if (!response.ok) throw this.statusError(response.status)

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new AIError("AI_INVALID_RESPONSE", "AI provider returned a non-JSON response")
    }

    const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      throw new AIError("AI_INVALID_RESPONSE", "AI provider returned empty content")
    }

    const usage = (body as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage
    return {
      text: content,
      model: payload.model as string,
      usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } : undefined,
    }
  }

  async generateText(request: AIGenerateRequest): Promise<AIGenerateResult> {
    this.assertConfigured()

    const messages: { role: string; content: string }[] = []
    if (request.systemPrompt) messages.push({ role: "system", content: request.systemPrompt })
    messages.push({ role: "user", content: request.userPrompt })

    const payload: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages,
      temperature: request.temperature ?? 0,
      ...(request.responseFormat ? { response_format: { type: request.responseFormat } } : {}),
      ...(request.maxTokens != null ? { max_tokens: Math.min(Math.max(1, Math.round(request.maxTokens)), MAX_OUTPUT_TOKENS) } : {}),
    }

    let attempt = 0
    for (;;) {
      try {
        return await this.fetchCompletion(payload)
      } catch (e) {
        if (!(e instanceof AIError) || !e.retryable || attempt >= this.maxRetries) throw e
        await sleep(this.retryBaseMs * 2 ** attempt)
        attempt += 1
      }
    }
  }

  async generateStructured<T>(request: AIGenerateRequest, schema: z.ZodType<T>): Promise<T> {
    const { text } = await this.generateText(request)
    return parseStructured(text, schema)
  }
}