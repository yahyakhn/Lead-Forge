// Data quality assessment (TASK 009 §44-§50). Measures completeness, format
// correctness, and source evidence — NOT sales/ICP fit. Pure and deterministic.

import {
  normalizeCompanyName,
  normalizeDomain,
} from "@/lib/lead-engine/resolution/normalize"
import { normalizeEmail, normalizePhone, normalizeUrl } from "@/lib/lead-engine/extraction/normalize"
import { normalizeLinkedInUrl } from "@/lib/lead-engine/resolution/normalize"

export const QUALITY_FLAGS = [
  "MISSING_COMPANY",
  "MISSING_DOMAIN",
  "MISSING_CONTACT",
  "MISSING_EMAIL",
  "INVALID_EMAIL",
  "INVALID_PHONE",
  "INVALID_URL",
  "CONFLICTING_DATA",
  "LOW_CONFIDENCE",
  "WEAK_SOURCE",
] as const

export type QualityFlag = (typeof QUALITY_FLAGS)[number]

// Component weights — explainable, centralized (§45).
export const QUALITY_WEIGHTS = {
  COMPANY_NAME: 15,
  DOMAIN: 15,
  CONTACT_NAME: 15,
  EMAIL_FORMAT: 15,
  PHONE_FORMAT: 10,
  LINKEDIN_URL: 10,
  SOURCE_URL: 10,
  EVIDENCE: 10,
} as const

export interface QualityAssessmentInput {
  companyName?: string | null
  companyDomain?: string | null
  websiteUrl?: string | null
  contactFullName?: string | null
  email?: string | null
  phone?: string | null
  linkedinUrl?: string | null
  extractionConfidence?: number | null
  extractionMethod?: "DETERMINISTIC" | "AI" | "HYBRID" | null
  pageClassification?: string | null
  hasEvidence?: boolean
}

export interface QualityAssessment {
  score: number
  flags: QualityFlag[]
  weights: Record<string, { label: string; earned: number; note: string }>
}

// Rough source ranking (§31): prefer direct company/team/contact pages.
export function sourceQuality(pageClassification: string | null | undefined): number {
  switch (pageClassification) {
    case "TEAM":
    case "PEOPLE":
      return 1
    case "CONTACT":
      return 0.9
    case "ABOUT":
    case "COMPANY_HOME":
      return 0.8
    case "CAREERS":
    case "JOB":
      return 0.7
    case "DIRECTORY":
    case "PRODUCT":
      return 0.5
    case "SOCIAL_PROFILE":
      return 0.6
    case null:
    case undefined:
      return 0.4
    default:
      return 0.3
  }
}

export function assessQuality(input: QualityAssessmentInput): QualityAssessment {
  const flags: QualityFlag[] = []
  const weights: QualityAssessment["weights"] = {}

  const companyName = input.companyName?.trim()
  if (!companyName) flags.push("MISSING_COMPANY")
  else if (!normalizeCompanyName(companyName)) flags.push("MISSING_COMPANY")

  const domain = normalizeDomain(input.companyDomain ?? input.websiteUrl ?? "")
  if (!input.companyDomain && !input.websiteUrl) flags.push("MISSING_DOMAIN")
  else if (!domain) flags.push("INVALID_URL")

  const contactName = input.contactFullName?.trim()
  if (!contactName) flags.push("MISSING_CONTACT")

  let emailValid = false
  if (!input.email) flags.push("MISSING_EMAIL")
  else if (normalizeEmail(input.email)) emailValid = true
  else flags.push("INVALID_EMAIL")

  const phoneValid = input.phone ? Boolean(normalizePhone(input.phone)) : false
  if (input.phone && !phoneValid) flags.push("INVALID_PHONE")

  const linkedInValid = input.linkedinUrl ? Boolean(normalizeLinkedInUrl(input.linkedinUrl)) : false
  if (input.linkedinUrl && !linkedInValid) flags.push("INVALID_URL")

  const urlValid = input.websiteUrl ? Boolean(normalizeUrl(input.websiteUrl)) && Boolean(normalizeDomain(input.websiteUrl)) : true
  if (input.websiteUrl && !urlValid) flags.push("INVALID_URL")

  if ((input.extractionConfidence ?? 1) < 0.5) flags.push("LOW_CONFIDENCE")
  if (sourceQuality(input.pageClassification) < 0.5) flags.push("WEAK_SOURCE")

  const weight = (key: keyof typeof QUALITY_WEIGHTS, label: string, earned: boolean, note: string) => {
    weights[key] = { label, earned: earned ? QUALITY_WEIGHTS[key] : 0, note }
  }

  weight("COMPANY_NAME", "Company identified", !flags.includes("MISSING_COMPANY"), companyName ?? "")
  weight("DOMAIN", "Domain identified", Boolean(domain), domain ?? "")
  weight("CONTACT_NAME", "Contact identified", Boolean(contactName), contactName ?? "")
  weight("EMAIL_FORMAT", "Email format valid", emailValid, input.email ?? "")
  weight("PHONE_FORMAT", "Phone format valid", phoneValid, input.phone ?? "")
  weight("LINKEDIN_URL", "LinkedIn URL valid", linkedInValid, input.linkedinUrl ?? "")
  weight("SOURCE_URL", "Source URL present", Boolean(input.websiteUrl || input.companyDomain), input.websiteUrl ?? "")
  weight("EVIDENCE", "Evidence present", Boolean(input.hasEvidence), input.hasEvidence ? "evidence recorded" : "")

  const score = Object.values(weights).reduce((sum, w) => sum + w.earned, 0)
  return { score, flags, weights }
}