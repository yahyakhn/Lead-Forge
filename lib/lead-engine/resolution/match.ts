// Pairwise matching: reasons, centralized weights and thresholds
// (TASK 009 §4, §16-§18). Pure functions, fully deterministic, no AI (§64).

import {
  emailDomain,
  hasFirstLastName,
  isGenericEmailDomain,
  nameTokens,
  normalizeCompanyName,
  normalizeDomain,
  normalizeLinkedInUrl,
  normalizePersonName,
} from "@/lib/lead-engine/resolution/normalize"
import { normalizeEmail, normalizePhone } from "@/lib/lead-engine/extraction/normalize"

// ── Thresholds (§18) — centralized, tunable ───────────────────────────────

export const THRESHOLDS = {
  AUTO_MATCH: 90,
  REVIEW: 70,
} as const

export type MatchDecision = "AUTO_MATCH" | "REVIEW" | "NOT_MATCH"

export function decideMatch(score: number): MatchDecision {
  if (score >= THRESHOLDS.AUTO_MATCH) return "AUTO_MATCH"
  if (score >= THRESHOLDS.REVIEW) return "REVIEW"
  return "NOT_MATCH"
}

// ── Reasons (§4) ──────────────────────────────────────────────────────────

export const MATCH_REASONS = [
  "DOMAIN_EXACT",
  "EMAIL_EXACT",
  "EMAIL_DOMAIN_EXACT",
  "PHONE_EXACT",
  "LINKEDIN_EXACT",
  "WEBSITE_EXACT",
  "COMPANY_NAME_EXACT",
  "COMPANY_NAME_SIMILAR",
  "CONTACT_NAME_EXACT",
  "CONTACT_NAME_SIMILAR",
  "CONTACT_COMPANY_MATCH",
  "LOCATION_MATCH",
  "JOB_TITLE_MATCH",
] as const

export type MatchReason = (typeof MATCH_REASONS)[number]

// ── Weights (§16-§17) — centralized, not magic numbers ────────────────────

export const COMPANY_WEIGHTS = {
  DOMAIN_EXACT: 100,
  COMPANY_LINKEDIN_EXACT: 100,
  EMAIL_DOMAIN_EXACT: 60,
  COMPANY_NAME_EXACT: 70,
  COMPANY_NAME_SIMILAR: 40,
  LOCATION_MATCH: 10,
  WEBSITE_SIMILAR: 20,
} as const

export const CONTACT_WEIGHTS = {
  EMAIL_EXACT: 100,
  LINKEDIN_EXACT: 100,
  PHONE_EXACT: 85,
  NAME_EXACT: 50,
  NAME_SIMILAR: 30,
  SAME_COMPANY: 20,
  JOB_TITLE: 10,
  LOCATION: 5,
} as const

// ── Similarity helpers ────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d: number[] = new Array(n + 1)
  for (let j = 0; j <= n; j++) d[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[n]
}

export function nameSimilarity(a: string, b: string): number {
  const x = normalizePersonName(a)
  const y = normalizePersonName(b)
  if (x === y) return 1
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

export function companyNameSimilarity(a: string, b: string): number {
  const x = normalizeCompanyName(a)
  const y = normalizeCompanyName(b)
  if (x === y) return 1
  const edit = 1 - levenshtein(x, y) / Math.max(x.length, y.length)
  const ax = nameTokens(x)
  const bx = nameTokens(y)
  const commonPrefix = ax.length > 0 && bx.length > 0 && ax[0] === bx[0] && edit >= 0.5
  return commonPrefix ? Math.max(edit, 0.55) : edit
}

// ── Candidate projection ──────────────────────────────────────────────────

export interface CandidateIdentity {
  id: string
  companyName?: string | null
  companyDomain?: string | null
  websiteUrl?: string | null
  email?: string | null
  phone?: string | null
  linkedinUrl?: string | null
  contactFullName?: string | null
  contactJobTitle?: string | null
  country?: string | null
  region?: string | null
  city?: string | null
  companyLinkedinUrl?: string | null
  rawPageFetchedAt?: Date | null
  runCreatedAt?: Date | null
}

export interface MatchResult {
  score: number
  reasons: MatchReason[]
}

// ── Company matching (§16) ────────────────────────────────────────────────

export function scoreCompanyMatch(a: CandidateIdentity, b: CandidateIdentity): MatchResult {
  const reasons: MatchReason[] = []
  let score = 0

  const aDomain = normalizeDomain(a.companyDomain ?? a.websiteUrl ?? "")
  const bDomain = normalizeDomain(b.companyDomain ?? b.websiteUrl ?? "")
  if (aDomain && bDomain && aDomain === bDomain) {
    score += COMPANY_WEIGHTS.DOMAIN_EXACT
    reasons.push("DOMAIN_EXACT")
  }

  if (reasons.includes("DOMAIN_EXACT")) {
    const aName = normalizeCompanyName(a.companyName ?? "")
    const bName = normalizeCompanyName(b.companyName ?? "")
    if (aName && bName && aName === bName) {
      score += COMPANY_WEIGHTS.COMPANY_NAME_EXACT
      reasons.push("COMPANY_NAME_EXACT")
    }
    // Website URLs from the same domain are a weaker, redundant signal;
    // only meaningful when domains differ.
  } else if (aDomain && bDomain && (aDomain.endsWith(bDomain) || bDomain.endsWith(aDomain))) {
    score += COMPANY_WEIGHTS.WEBSITE_SIMILAR
    reasons.push("WEBSITE_EXACT")
  }

  if (a.companyLinkedinUrl && b.companyLinkedinUrl && a.companyLinkedinUrl === b.companyLinkedinUrl) {
    score += COMPANY_WEIGHTS.COMPANY_LINKEDIN_EXACT
    reasons.push("LINKEDIN_EXACT")
  }

  const aEmailDomain = a.email ? emailDomain(a.email) : null
  const bEmailDomain = b.email ? emailDomain(b.email) : null
  if (!reasons.includes("DOMAIN_EXACT") && aEmailDomain && bEmailDomain && aEmailDomain === bEmailDomain && !isGenericEmailDomain(aEmailDomain)) {
    score += COMPANY_WEIGHTS.EMAIL_DOMAIN_EXACT
    reasons.push("EMAIL_DOMAIN_EXACT")
  }

  if (a.companyName && b.companyName) {
    const similarity = companyNameSimilarity(a.companyName, b.companyName)
    const exactAlreadyCredited = reasons.includes("COMPANY_NAME_EXACT")
    if (similarity === 1 && !exactAlreadyCredited) {
      score += COMPANY_WEIGHTS.COMPANY_NAME_EXACT
      reasons.push("COMPANY_NAME_EXACT")
    } else if (similarity >= 0.72 && !exactAlreadyCredited && !reasons.includes("COMPANY_NAME_SIMILAR")) {
      score += COMPANY_WEIGHTS.COMPANY_NAME_SIMILAR
      reasons.push("COMPANY_NAME_SIMILAR")
    }
  }

  if (a.country && b.country && a.country.toLowerCase() === b.country.toLowerCase()) {
    score += COMPANY_WEIGHTS.LOCATION_MATCH
    reasons.push("LOCATION_MATCH")
  }

  return { score, reasons }
}

// ── Contact matching (§17, §33-§34) ───────────────────────────────────────

export function scoreContactMatch(a: CandidateIdentity, b: CandidateIdentity): MatchResult {
  const reasons: MatchReason[] = []
  let score = 0

  const aEmail = a.email ? normalizeEmail(a.email) : null
  const bEmail = b.email ? normalizeEmail(b.email) : null
  if (aEmail && bEmail && aEmail === bEmail) {
    score += CONTACT_WEIGHTS.EMAIL_EXACT
    reasons.push("EMAIL_EXACT")
  }

  const aLinkedIn = a.linkedinUrl ? normalizeLinkedInUrl(a.linkedinUrl) : null
  const bLinkedIn = b.linkedinUrl ? normalizeLinkedInUrl(b.linkedinUrl) : null
  if (aLinkedIn && bLinkedIn && aLinkedIn === bLinkedIn) {
    score += CONTACT_WEIGHTS.LINKEDIN_EXACT
    reasons.push("LINKEDIN_EXACT")
  }

  const aPhone = a.phone ? normalizePhone(a.phone) : null
  const bPhone = b.phone ? normalizePhone(b.phone) : null
  if (aPhone && bPhone && aPhone === bPhone && !aEmail && !bEmail) {
    score += CONTACT_WEIGHTS.PHONE_EXACT
    reasons.push("PHONE_EXACT")
  }

  const aName = a.contactFullName
  const bName = b.contactFullName
  if (aName && bName) {
    const similarity = nameSimilarity(aName, bName)
    if (similarity === 1 && hasFirstLastName(aName)) {
      score += CONTACT_WEIGHTS.NAME_EXACT
      reasons.push("CONTACT_NAME_EXACT")
    } else if (similarity >= 0.8 && hasFirstLastName(aName) && hasFirstLastName(bName)) {
      score += CONTACT_WEIGHTS.NAME_SIMILAR
      reasons.push("CONTACT_NAME_SIMILAR")
    }
  }

  // Same company context — only meaningful for contact scoring (§33).
  const aDomain = normalizeDomain(a.companyDomain ?? "")
  const bDomain = normalizeDomain(b.companyDomain ?? "")
  const aCompany = normalizeCompanyName(a.companyName ?? "")
  const bCompany = normalizeCompanyName(b.companyName ?? "")
  const aEmailDomain = aEmail ? emailDomain(aEmail) : null
  const bEmailDomain = bEmail ? emailDomain(bEmail) : null
  const sameCompany = (aDomain && bDomain && aDomain === bDomain) || (aCompany && bCompany && aCompany === bCompany)
  const sameEmailDomain = Boolean(aEmailDomain && bEmailDomain) && !isGenericEmailDomain(aEmailDomain) && aEmailDomain === bEmailDomain
  if ((sameCompany || sameEmailDomain) && !reasons.includes("EMAIL_EXACT")) {
    score += CONTACT_WEIGHTS.SAME_COMPANY
    reasons.push("CONTACT_COMPANY_MATCH")
  }

  if (a.contactJobTitle && b.contactJobTitle && nameSimilarity(a.contactJobTitle, b.contactJobTitle) >= 0.8) {
    score += CONTACT_WEIGHTS.JOB_TITLE
    reasons.push("JOB_TITLE_MATCH")
  }

  if (a.country && b.country && a.country.toLowerCase() === b.country.toLowerCase()) {
    score += CONTACT_WEIGHTS.LOCATION
    reasons.push("LOCATION_MATCH")
  }

  return { score, reasons }
}

// ── Combined: company or contact resolution style ─────────────────────────

export function entityDecision(a: CandidateIdentity, b: CandidateIdentity): {
  entityType: "COMPANY" | "CONTACT"
  match: MatchResult
} {
  const company = scoreCompanyMatch(a, b)
  const contact = scoreContactMatch(a, b)
  if (company.score >= contact.score) return { entityType: "COMPANY", match: company }
  return { entityType: "CONTACT", match: contact }
}