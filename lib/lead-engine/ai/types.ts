// TASK 016: generic AI provider abstraction (spec §28). The provider layer
// knows nothing about CRM, leads, ICP, scraping or scoring — it only executes
// an authorized AI request and returns normalized results.

import type { z } from "zod"

export type AIErrorCode =
  | "AI_CONFIGURATION_ERROR"
  | "AI_AUTHENTICATION_ERROR"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_PROVIDER_ERROR"
  | "AI_INVALID_RESPONSE"
  | "AI_SCHEMA_VALIDATION_ERROR"
  | "AI_NETWORK_ERROR"

export class AIError extends Error {
  readonly code: AIErrorCode
  readonly retryable: boolean

  constructor(code: AIErrorCode, message: string, retryable = false) {
    super(message)
    this.name = "AIError"
    this.code = code
    this.retryable = retryable
  }
}

export interface AIGenerateRequest {
  systemPrompt?: string
  userPrompt: string
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "json_object"
}

export interface AIGenerateResult {
  text: string
  model: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

export interface AIProvider {
  // False when the provider cannot make calls (e.g. missing API key), so
  // callers can skip AI without recording a failure.
  readonly configured: boolean

  generateText(request: AIGenerateRequest): Promise<AIGenerateResult>

  generateStructured<T>(request: AIGenerateRequest, schema: z.ZodType<T>): Promise<T>
}
