// TASK 016: deterministic mock provider for tests (spec §28). Never touches
// the network; results are fully injectable and default values are stable.

import { z } from "zod"
import { parseStructured } from "@/lib/lead-engine/ai/parse"
import type { AIGenerateRequest, AIGenerateResult, AIProvider } from "@/lib/lead-engine/ai/types"

export interface MockAIProviderOptions {
  text?: string | ((request: AIGenerateRequest) => string)
  structured?: unknown | ((request: AIGenerateRequest) => unknown)
}

export class MockAIProvider implements AIProvider {
  readonly configured = true

  constructor(private readonly options: MockAIProviderOptions = {}) {}

  async generateText(request: AIGenerateRequest): Promise<AIGenerateResult> {
    const text =
      typeof this.options.text === "function"
        ? this.options.text(request)
        : this.options.text ?? `mock response for: ${request.userPrompt.split("\n")[0].slice(0, 80)}`
    return { text, model: "mock", usage: { promptTokens: request.userPrompt.length, completionTokens: text.length } }
  }

  async generateStructured<T>(request: AIGenerateRequest, schema: z.ZodType<T>): Promise<T> {
    const raw =
      typeof this.options.structured === "function"
        ? this.options.structured(request)
        : this.options.structured ?? mockStructuredValue(schema)
    return parseStructured(JSON.stringify(raw), schema)
  }
}

// Deterministic defaults per zod type; tests needing specific values inject
// them through MockAIProviderOptions instead.
function mockStructuredValue(schema: z.ZodType<unknown>): unknown {
  if (schema instanceof z.ZodObject) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(schema.shape)) out[key] = mockStructuredValue(child)
    return out
  }
  if (schema instanceof z.ZodArray) return []
  if (schema instanceof z.ZodString) return "test"
  if (schema instanceof z.ZodNumber) return 10
  if (schema instanceof z.ZodBoolean) return true
  if (schema instanceof z.ZodEnum) {
    const values = (schema as unknown as { _def: { values?: readonly string[] } })._def.values
    return values?.[0] ?? null
  }
  const inner = (schema as unknown as { _def?: { innerType?: z.ZodType<unknown> } })._def?.innerType
  if (inner) return mockStructuredValue(inner)
  return null
}
