// TASK 016: tolerant JSON parsing + Zod validation for structured AI output.
// The provider must not blindly trust model JSON (spec §5).

import type { z } from "zod"
import { AIError } from "@/lib/lead-engine/ai/types"

export function parseAIJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) throw new Error("AI returned no JSON object")
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

export function parseStructured<T>(text: string, schema: z.ZodType<T>): T {
  let raw: unknown
  try {
    raw = parseAIJson(text)
  } catch {
    throw new AIError("AI_INVALID_RESPONSE", "AI returned no JSON object")
  }
  try {
    return schema.parse(raw)
  } catch {
    throw new AIError("AI_SCHEMA_VALIDATION_ERROR", "AI output failed schema validation")
  }
}
