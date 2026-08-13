// TASK 013 §14-§15, §61-§64: enrichment merge engine. Pure and deterministic.
// Decides what happens when enriched data meets an existing value — it never
// silently overwrites; every decision is traceable to a result status.

import { isTrustedSource, sameValue, sourcePriority, type EnrichmentFieldName } from "@/lib/lead-engine/enrichment/fields"

export type MergeDecision = "ACCEPT" | "CONFIRM" | "CONFLICT"

export interface MergeInput {
  field: EnrichmentFieldName
  existingValue: string | null | undefined
  existingSource: string | null | undefined
  enrichedValue: string
  enrichedSource: string
  enrichedConfidence: number
}

export interface MergeVerdict {
  decision: MergeDecision
  /** Which value should win on user resolution (hint only). */
  suggestedResolution: "ACCEPT_NEW" | "KEEP_EXISTING" | "KEEP_BOTH"
}

export function mergeValue(input: MergeInput): MergeVerdict {
  const { field, enrichedValue, enrichedSource } = input
  const existing = input.existingValue?.trim()
  const incoming = enrichedValue.trim()
  if (!existing) return { decision: "ACCEPT", suggestedResolution: "ACCEPT_NEW" }
  if (sameValue(field, existing, incoming)) return { decision: "CONFIRM", suggestedResolution: "KEEP_EXISTING" }

  // Different value → conflict. Trusted existing data (manual/verified) is
  // never overwritten automatically (§15, §61).
  if (isTrustedSource(input.existingSource)) {
    return { decision: "CONFLICT", suggestedResolution: "KEEP_EXISTING" }
  }
  // High-confidence enrichment against weak existing data → candidate for
  // replacement, still surfaced as a conflict for human review (§15).
  if (input.enrichedConfidence >= 0.8 && sourcePriority(enrichedSource) > sourcePriority(input.existingSource)) {
    return { decision: "CONFLICT", suggestedResolution: "ACCEPT_NEW" }
  }
  return { decision: "CONFLICT", suggestedResolution: "KEEP_BOTH" }
}
