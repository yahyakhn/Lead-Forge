// TASK 013: provider abstraction (§3). Providers are pluggable; the registry
// decides which are available and the org settings decide which are enabled.

import type { EnrichmentFieldName } from "@/lib/lead-engine/enrichment/fields"

export type EnrichmentCapability = "COMPANY" | "CONTACT" | "TECHNOLOGY" | "EVIDENCE"

export interface EnrichmentField {
  field: EnrichmentFieldName
  value: string
  normalizedValue?: string
  source: string
  sourceUrl?: string
  evidence?: string
  method: string
  confidence: number
}

export interface EnrichmentTarget {
  kind: "candidate" | "lead"
  id: string
  companyName?: string | null
  companyDomain?: string | null
  websiteUrl?: string | null
  contactFullName?: string | null
  email?: string | null
}

export interface EnrichmentInput {
  target: EnrichmentTarget
  forceRefresh: boolean
  requestId: string
  maxPages: number
  maxDepth: number
  requestDelayMs: number
  requestTimeoutMs: number
  allowedDomains: string[]
}

export interface EnrichmentOutcome {
  fields: EnrichmentField[]
  pagesVisited: number
  errorCode?: string
  errorMessage?: string
}

export interface EnrichmentProvider {
  id: string
  name: string
  capabilities: EnrichmentCapability[]
  enrich(input: EnrichmentInput): Promise<EnrichmentOutcome>
}

export const WEBSITE_PROVIDER_ID = "WEBSITE"
