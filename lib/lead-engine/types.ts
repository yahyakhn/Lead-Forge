import type { LeadSourceType, SourceCapability } from "@/generated/prisma/enums"

export interface LeadSourceDefinition {
  id: string
  name: string
  slug: string
  type: LeadSourceType
}

export interface DiscoveryTarget {
  type: "URL" | "DOMAIN" | "QUERY"
  value: string
  title?: string
}

export interface DiscoveryInput {
  icp: { id: string; name: string; criteria: Record<string, unknown> } | null
  source: LeadSourceDefinition
  maxResults?: number
  query?: string
  config?: unknown
}

export interface RawLeadRecord {
  externalId?: string
  sourceUrl?: string
  data: Record<string, unknown>
}

export interface ScrapeInput {
  runId: string
  organizationId: string
  source: LeadSourceDefinition
  targets: DiscoveryTarget[]
  config: unknown
  testMode?: boolean
}

export interface ScrapeResult {
  records: RawLeadRecord[]
  stats: {
    discovered: number
    processed: number
    failed: number
    pages?: {
      discovered: number
      queued: number
      processed: number
      succeeded: number
      failed: number
      skipped: number
    }
  }
}

export type ConfigValidation = { ok: true } | { ok: false; error: string }

export interface LeadSourceAdapter {
  id: string
  name: string
  description: string
  type: LeadSourceType
  capabilities: SourceCapability[]
  validateConfig(config: unknown): ConfigValidation
  discover(input: DiscoveryInput): Promise<DiscoveryTarget[]>
  scrape(input: ScrapeInput): Promise<ScrapeResult>
}

export interface SourceAdapterInfo {
  id: string
  name: string
  description: string
  type: LeadSourceType
  capabilities: SourceCapability[]
}