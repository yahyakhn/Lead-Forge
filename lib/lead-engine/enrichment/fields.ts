// TASK 013: enrichment field catalog, source hierarchy and normalized
// comparators (§18-§19, §61-§64). Pure, no DB.

import { normalizeDomain } from "@/lib/lead-engine/resolution/normalize"
import { normalizeEmail, normalizePhone, normalizeUrl } from "@/lib/lead-engine/extraction/normalize"

export const ENRICHMENT_FIELDS = [
  "company_name",
  "company_domain",
  "website",
  "description",
  "industry",
  "country",
  "region",
  "city",
  "phone",
  "email",
  "linkedin_url",
  "social_links",
  "keywords",
  "technology",
  "contact_name",
  "job_title",
] as const

export type EnrichmentFieldName = (typeof ENRICHMENT_FIELDS)[number]

export const FIELD_LABELS: Record<EnrichmentFieldName, string> = {
  company_name: "Company name",
  company_domain: "Domain",
  website: "Website",
  description: "Company description",
  industry: "Industry",
  country: "Country",
  region: "Region",
  city: "City",
  phone: "Phone",
  email: "Email",
  linkedin_url: "LinkedIn",
  social_links: "Social links",
  keywords: "Keywords",
  technology: "Technology",
  contact_name: "Contact name",
  job_title: "Job title",
}

// Fields that can be written onto the target entity. The rest (social
// links, keywords, technology) are informational evidence only.
export const MERGEABLE_FIELDS = new Set<EnrichmentFieldName>([
  "company_name",
  "company_domain",
  "website",
  "description",
  "industry",
  "country",
  "region",
  "city",
  "phone",
  "email",
  "linkedin_url",
  "contact_name",
  "job_title",
])

// Source hierarchy (§62) — centralized, configurable in one place.
export const SOURCE_PRIORITY: Record<string, number> = {
  MANUAL: 100,
  VERIFIED_INTERNAL: 80,
  USER_IMPORT: 60,
  PUBLIC_WEBSITE: 40,
  OTHER_PROVIDER: 30,
  INFERRED: 10,
}

export function sourcePriority(source: string | null | undefined): number {
  if (!source) return 0
  const key = source.toUpperCase()
  if (key in SOURCE_PRIORITY) return SOURCE_PRIORITY[key]
  return SOURCE_PRIORITY.OTHER_PROVIDER
}

export function isTrustedSource(source: string | null | undefined): boolean {
  return sourcePriority(source) >= SOURCE_PRIORITY.VERIFIED_INTERNAL
}

// Same-value detection per field — normalized compare so re-runs don't
// create duplicates (§35, §71-§75).
export function sameValue(field: EnrichmentFieldName, a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true
  switch (field) {
    case "company_domain":
      return normalizeDomain(a) === normalizeDomain(b)
    case "website":
    case "linkedin_url":
      return normalizeUrl(a) === normalizeUrl(b)
    case "email":
      return normalizeEmail(a) === normalizeEmail(b)
    case "phone":
      return normalizePhone(a) === normalizePhone(b)
    case "company_name":
      return a.trim().toLowerCase() === b.trim().toLowerCase()
    case "country":
    case "region":
    case "city":
    case "industry":
    case "description":
    case "keywords":
    case "technology":
    case "social_links":
    case "contact_name":
    case "job_title":
      return a.trim().toLowerCase() === b.trim().toLowerCase()
    default:
      return a.trim() === b.trim()
  }
}
